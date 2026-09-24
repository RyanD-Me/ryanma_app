"use strict";

/**
 * オンライン対戦(自前サーバー方式)のルーム管理・中継ロジック。
 *
 * このモジュールは実際のネットワーク(WebSocket)には一切依存しない、純粋なロジックだけを
 * 持つ。テストしやすくするため、また将来別のトランスポート(例:WebTransportなど)に
 * 差し替えられるようにするための分離。実際の接続は server.js が `ws` パッケージで受け、
 * ここが要求する { send(obj), close?() } という最小限の形(conn)に包んでから渡す。
 *
 * サーバーは麻雀のルールを一切知らない、ただの「2人の間でメッセージを中継するだけ」の
 * 相乗り役。実際のゲーム進行ロジック・状態はすべてクライアント側(online-shared.js の
 * OnlineMahjongApp)が持っており、そこから送られてきた `game` ペイロードをそのまま
 * もう一方へ転送するだけで良い。
 *
 * ---- 再接続 ----
 * 着席したプレイヤーには座席ごとの秘密のトークン(rejoin token)を発行する。
 * 接続が切れても座席とトークンはすぐには消さず、猶予時間(既定5分)の間は予約したままにする。
 * その間に同じトークンで `rejoin` すれば同じ座席に戻れる。猶予時間を過ぎても戻らなければ、
 * 残っている相手に peer-left を通知してルームを破棄する。
 * また、中継した最新の `game` ペイロードをルームごとに保持しておき、再接続してきた側に
 * そのまま渡す(切断中に相手が進めた分も含めて追いつけるようにするため)。
 *
 * ---- 観戦 ----
 * 観戦を許可したルーム(ルーム作成時に選択。自動マッチングの対局は常に許可)は、対局が
 * 始まっていれば一覧に載り、ルームコードでも観戦できる。観戦者には入室時に保持している
 * 最新の `game` を渡し、以後は対局者どうしの中継と同じ `game` をそのまま配る(観戦者からの
 * 送信は一切中継しない)。観戦者数が変わるたびに、対局者と観戦者の全員へ人数を知らせる。
 */

const crypto = require("crypto");

// 紛らわしい文字 (0/O, 1/I/L) を除いた英数字。声に出して伝えても書き取りやすいように。
const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ROOM_CODE_LENGTH = 6;
/** 切断後、同じ座席に戻ってこられる猶予時間(ミリ秒) */
const DEFAULT_RECONNECT_GRACE_MS = 5 * 60 * 1000;

const SEATS = ["east", "south"];

function randomRoomCode() {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    out += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

function randomToken() {
  return crypto.randomBytes(16).toString("hex");
}

function otherSeat(seat) {
  return seat === "east" ? "south" : "east";
}

/**
 * 観戦一覧用に、中継中の game ペイロードから局と点数だけを抜き出す。
 * 形が想定と違う(古いクライアント等)場合は null を返し、一覧では「対局中」とだけ表示する。
 */
function summarizeGame(game) {
  try {
    const s = game && game.state;
    if (!s || !s.players) return null;
    const score = (seat) => (s.players[seat] && typeof s.players[seat].score === "number" ? s.players[seat].score : null);
    return {
      roundWind: typeof s.roundWind === "string" ? s.roundWind : null,
      roundNumber: typeof s.roundNumber === "number" ? s.roundNumber : null,
      scores: { east: score("east"), south: score("south") },
      ended: s.phase === "game_end",
    };
  } catch (e) {
    return null;
  }
}

function safeSend(conn, obj) {
  if (!conn) return;
  try {
    conn.send(obj);
  } catch (e) {
    /* 相手も既に切断中などは無視 */
  }
}

class RoomRegistry {
  /**
   * @param {{graceMs?: number, setTimer?: Function, clearTimer?: Function, random?: Function}} [options]
   *   テストでは setTimer/clearTimer を差し替えて猶予時間の経過を手動で進める。
   *   random は自動マッチングの東家・南家の決定に使う(テストで固定できるよう差し替え可能)。
   */
  constructor(options = {}) {
    this.random = options.random || Math.random;
    this.graceMs = options.graceMs != null ? options.graceMs : DEFAULT_RECONNECT_GRACE_MS;
    this.setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer || ((t) => clearTimeout(t));
    /**
     * code -> {
     *   code, createdAt,
     *   conns:  {east, south}  いま接続中の conn(切断中は null)
     *   tokens: {east, south}  座席の予約トークン(未着席は null)
     *   names:  {east, south}
     *   lastGame: 最後に中継した game ペイロード(未開始なら null)
     *   graceTimers: {east, south} 切断中の座席の猶予タイマー
     *   allowSpectate: 観戦を許可するか
     *   spectators: Set<conn> 観戦中の接続
     * }
     */
    this.rooms = new Map();
    /** conn -> {code, seat} の逆引き(切断時にどの部屋の何家だったか調べるため) */
    this.connInfo = new Map();
    /**
     * 退室によって終了したルームの記録(code -> {remainingToken, timer})。
     * 退室した側の相手が、切断中だったため退室を知らないまま後から rejoin してきたときに
     * 「対戦相手が退室しました」と伝えるために、猶予時間と同じ間だけ覚えておく。
     */
    this.leftRooms = new Map();
    /** 自動マッチングの待ち行列(先に来た順)。要素は {conn, name} */
    this.matchQueue = [];
    /** 観戦中の conn -> code の逆引き */
    this.spectatorInfo = new Map();
  }

  // ---------------- 自動マッチング ----------------

  /** conn が自動マッチングの待ち行列にいるか */
  isQueued(conn) {
    return this.matchQueue.some((e) => e.conn === conn);
  }

  /**
   * 自動マッチングの待ち行列に入る。既に待っている人がいれば、その人と組んで新しいルームを作る。
   * どちらが east 家(=起家・ホスト)になるかはランダムに決める。
   *
   * clientId が待ち行列の先頭の相手と一致する場合(=相手待ち中に接続が切れて、サーバーが
   * まだそれに気付いていないうちに、同じ端末が新しい接続でもう一度自動マッチングをやり直した
   * 場合)は、自分自身とマッチングしてしまわないよう、古い接続を新しい接続に差し替えて
   * 相手待ちを続ける(マッチングはしない)。
   *
   * @returns {null | {code: string, players: Array<{conn: object, seat: string, token: string}>}}
   *   null なら待ち行列に入った(相手待ち)
   */
  enqueueMatch(conn, name, clientId) {
    if (this.isQueued(conn)) return null;
    const waiting = this.matchQueue[0];
    if (waiting && clientId && waiting.clientId === clientId) {
      // 同じ端末からの再試行: 古い(切れているはずの)接続を新しい接続に差し替えるだけで、
      // 相手待ちの順番(先頭)はそのまま保つ。
      this.matchQueue[0] = { conn, name: name || null, clientId };
      return null;
    }
    this.matchQueue.shift();
    if (!waiting) {
      this.matchQueue.push({ conn, name: name || null, clientId: clientId || null });
      return null;
    }
    const newcomer = { conn, name: name || null, clientId: clientId || null };
    const [eastP, southP] = this.random() < 0.5 ? [waiting, newcomer] : [newcomer, waiting];
    const { code, token: eastToken } = this.createRoom(eastP.conn, eastP.name);
    const { seat, token: southToken } = this.joinRoom(code, southP.conn, southP.name);
    return {
      code,
      players: [
        { conn: eastP.conn, seat: "east", token: eastToken },
        { conn: southP.conn, seat, token: southToken },
      ],
    };
  }

  /** 自動マッチングの待ち行列から抜ける。抜けたら true */
  cancelMatch(conn) {
    const before = this.matchQueue.length;
    this.matchQueue = this.matchQueue.filter((e) => e.conn !== conn);
    return this.matchQueue.length !== before;
  }

  /**
   * 新しいルームを作成し、conn を east 家として着席させる。
   * @param {{allowSpectate?: boolean}} [options] 観戦を許可するか(省略時は許可)
   * @returns {{code: string, token: string}} 発行されたルームコードと再接続用トークン
   */
  createRoom(conn, name, options = {}) {
    let code;
    do {
      code = randomRoomCode();
    } while (this.rooms.has(code));
    const token = randomToken();
    this.rooms.set(code, {
      code,
      conns: { east: conn, south: null },
      tokens: { east: token, south: null },
      names: { east: name || null, south: null },
      lastGame: null,
      graceTimers: { east: null, south: null },
      createdAt: Date.now(),
      allowSpectate: options.allowSpectate !== false,
      spectators: new Set(),
    });
    this.connInfo.set(conn, { code, seat: "east" });
    return { code, token };
  }

  /**
   * 既存のルームに参加する(まだ誰も着席していない座席に着席する)。
   * 切断中でも予約されている座席(トークン発行済み)には着席できない(再接続は rejoin で行う)。
   * @returns {{seat: "east"|"south", token: string}}
   * @throws {Error} ルームが存在しない/既に満席の場合(message はそのまま利用者向けに表示してよい文言)
   */
  joinRoom(code, conn, name) {
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error("そのルームコードは見つかりませんでした。コードをご確認ください。");
    }
    const openSeat = SEATS.find((s) => !room.tokens[s]);
    if (!openSeat) {
      throw new Error("このルームはすでに満席です。");
    }
    const token = randomToken();
    room.conns[openSeat] = conn;
    room.tokens[openSeat] = token;
    room.names[openSeat] = name || null;
    this.connInfo.set(conn, { code, seat: openSeat });
    return { seat: openSeat, token };
  }

  /**
   * 切断した座席に、発行済みトークンで戻る。
   * サーバー側がまだ前の接続の切断に気付いていない(半開きの接続が残っている)場合は、
   * 古い接続を切り離して新しい接続に差し替える。
   * @returns {{seat: "east"|"south", names: object, lastGame: any, peerConnected: boolean}}
   * @throws {Error} ルームが無い/トークンが一致しない場合
   */
  rejoinRoom(code, token, conn) {
    const room = this.rooms.get(code);
    if (!room) {
      const left = this.leftRooms.get(code);
      if (left && typeof token === "string" && token && left.remainingToken === token) {
        const err = new Error("対戦相手が退室しました。");
        err.reason = "peer-left";
        throw err;
      }
      throw new Error("ルームが見つかりませんでした(時間が経ちすぎたか、対局が終了しています)。");
    }
    const seat = typeof token === "string" && token ? SEATS.find((s) => room.tokens[s] === token) : null;
    if (!seat) {
      throw new Error("再接続の情報が一致しませんでした。");
    }
    const old = room.conns[seat];
    if (old && old !== conn) {
      // 古い接続は、この後 close イベントが来ても何もしないよう逆引きから外しておく
      this.connInfo.delete(old);
      try {
        if (typeof old.close === "function") old.close();
      } catch (e) {
        /* ignore */
      }
    }
    if (room.graceTimers[seat]) {
      this.clearTimer(room.graceTimers[seat]);
      room.graceTimers[seat] = null;
    }
    room.conns[seat] = conn;
    this.connInfo.set(conn, { code, seat });
    const peer = room.conns[otherSeat(seat)];
    safeSend(peer, { type: "peer-online" });
    return { seat, names: this.namesFor(code), lastGame: room.lastGame, peerConnected: !!peer };
  }

  /**
   * ルームの両座席のプレイヤー名を返す(入力されていない座席は "Player1"/"Player2" を補う)。
   * ルームが存在しなければデフォルト値のみを返す。
   */
  namesFor(code) {
    const room = this.rooms.get(code);
    const names = (room && room.names) || {};
    return {
      east: names.east || "Player1",
      south: names.south || "Player2",
    };
  }

  /** conn が今どのルーム・Seatに属しているか。属していなければ null。 */
  infoFor(conn) {
    return this.connInfo.get(conn) || null;
  }

  /** 相手側(同じルームのもう一方の座席)の conn。まだ居ない/切断中なら null。 */
  peerOf(conn) {
    const info = this.infoFor(conn);
    if (!info) return null;
    const room = this.rooms.get(info.code);
    if (!room) return null;
    return room.conns[otherSeat(info.seat)];
  }

  /** ルームの両座席に着席済み(切断中の予約も含む)か。 */
  isFull(code) {
    const room = this.rooms.get(code);
    return !!(room && room.tokens.east && room.tokens.south);
  }

  /** ルームの両座席が今まさに接続中か。 */
  isBothConnected(code) {
    const room = this.rooms.get(code);
    return !!(room && room.conns.east && room.conns.south);
  }

  /** そのルームで最後に中継した game ペイロード(再接続時の追いつき用)。 */
  lastGameFor(code) {
    const room = this.rooms.get(code);
    return room ? room.lastGame : null;
  }

  /**
   * ゲーム進行データを、同じルームのもう一方の座席へ中継する。
   * 相手が切断中でも最新の状態としてルームに保持しておき、相手の再接続時に渡す。
   * @returns {boolean} 相手に実際に届けたか
   */
  relayGame(conn, payload) {
    const info = this.infoFor(conn);
    if (!info) return false;
    const room = this.rooms.get(info.code);
    if (!room) return false;
    room.lastGame = payload;
    for (const sp of room.spectators) safeSend(sp, { type: "game", payload });
    const peer = room.conns[otherSeat(info.seat)];
    if (!peer) return false;
    peer.send({ type: "game", payload });
    return true;
  }

  /**
   * 切断処理。座席とトークンは猶予時間の間は予約したまま残し、相手に peer-offline を通知する。
   * 猶予時間内に rejoin されなければ、相手に peer-left を通知してルームを破棄する。
   * 両者とも切断中のまま一方の猶予が切れた場合も、ルームを破棄する。
   */
  handleDisconnect(conn) {
    this.cancelMatch(conn); // 相手待ちのまま切断した場合は待ち行列から外す
    this.stopSpectating(conn); // 観戦中なら観戦をやめる
    const info = this.connInfo.get(conn);
    if (!info) return;
    this.connInfo.delete(conn);
    const room = this.rooms.get(info.code);
    if (!room || room.conns[info.seat] !== conn) return;
    room.conns[info.seat] = null;
    const peer = room.conns[otherSeat(info.seat)];
    safeSend(peer, { type: "peer-offline" });
    if (room.graceTimers[info.seat]) this.clearTimer(room.graceTimers[info.seat]);
    room.graceTimers[info.seat] = this.setTimer(() => this._expireSeat(info.code, info.seat), this.graceMs);
  }

  /**
   * 自分の意思で退出する(「やめる」など)。再接続の予約は残さず、相手に peer-left を通知して
   * ルームを即座に破棄する。
   */
  leaveRoom(conn) {
    const info = this.connInfo.get(conn);
    if (!info) return;
    const room = this.rooms.get(info.code);
    if (!room) {
      this.connInfo.delete(conn);
      return;
    }
    const peerSeat = otherSeat(info.seat);
    safeSend(room.conns[peerSeat], { type: "peer-left", reason: "left" });
    // 相手が切断中で退室を受け取れなかった場合に備え、相手のトークンだけ一定時間覚えておく
    if (room.tokens[peerSeat] && !room.conns[peerSeat]) {
      const prev = this.leftRooms.get(info.code);
      if (prev) this.clearTimer(prev.timer);
      const timer = this.setTimer(() => this.leftRooms.delete(info.code), this.graceMs);
      this.leftRooms.set(info.code, { remainingToken: room.tokens[peerSeat], timer });
    }
    this._deleteRoom(info.code);
  }

  /** 猶予時間切れ: 戻ってこなかったのでルームを終了する。 */
  _expireSeat(code, seat) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.graceTimers[seat] = null;
    if (room.conns[seat]) return; // 念のため(既に戻っている)
    const peer = room.conns[otherSeat(seat)];
    safeSend(peer, { type: "peer-left", reason: "timeout" });
    this._deleteRoom(code);
  }

  _deleteRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const sp of room.spectators) {
      this.spectatorInfo.delete(sp);
      safeSend(sp, { type: "spectate-ended", message: "対局が終了しました。" });
    }
    room.spectators.clear();
    for (const s of SEATS) {
      if (room.graceTimers[s]) this.clearTimer(room.graceTimers[s]);
      if (room.conns[s]) this.connInfo.delete(room.conns[s]);
    }
    this.rooms.delete(code);
  }

  // ---------------- 観戦 ----------------

  /** conn が観戦中なら、そのルームコード。観戦していなければ null。 */
  spectatingCode(conn) {
    return this.spectatorInfo.get(conn) || null;
  }

  /** そのルームが今観戦できるか(観戦許可・両者着席済み・対局開始済み)。 */
  _isSpectatable(room) {
    return !!(room && room.allowSpectate && room.tokens.east && room.tokens.south && room.lastGame);
  }

  /**
   * 観戦できる対局の一覧。一覧表示に必要な最小限の情報だけを返す(牌山・手牌は含めない)。
   * 局・点数は中継している game ペイロードから読むだけで、ルールの判断はしない。
   * @returns {Array<{code: string, names: object, spectators: number, round: object|null}>}
   */
  listSpectatableGames() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (!this._isSpectatable(room)) continue;
      // 両者とも切断中(再接続の猶予中)の対局は、止まったままなので一覧には出さない
      if (!room.conns.east && !room.conns.south) continue;
      list.push({
        code: room.code,
        names: this.namesFor(room.code),
        spectators: room.spectators.size,
        round: summarizeGame(room.lastGame),
      });
    }
    list.sort((a, b) => this.rooms.get(a.code).createdAt - this.rooms.get(b.code).createdAt);
    return list;
  }

  /**
   * 観戦を始める。
   * @returns {{names: object, lastGame: any, spectators: number}}
   * @throws {Error} ルームが無い/観戦不可の場合(message はそのまま利用者向けに表示してよい文言)
   */
  spectate(code, conn) {
    const room = this.rooms.get(code);
    if (!room) {
      throw new Error("その対局は見つかりませんでした(ルームコードをご確認ください。対局が終了した可能性もあります)。");
    }
    if (!room.allowSpectate) throw new Error("この対局は観戦が許可されていません。");
    if (!this._isSpectatable(room)) throw new Error("この対局はまだ始まっていません。しばらくしてからお試しください。");
    this.stopSpectating(conn);
    room.spectators.add(conn);
    this.spectatorInfo.set(conn, code);
    this._broadcastSpectatorCount(room);
    return { names: this.namesFor(code), lastGame: room.lastGame, spectators: room.spectators.size };
  }

  /** 観戦をやめる(観戦していなければ何もしない)。 */
  stopSpectating(conn) {
    const code = this.spectatorInfo.get(conn);
    if (!code) return;
    this.spectatorInfo.delete(conn);
    const room = this.rooms.get(code);
    if (!room) return;
    room.spectators.delete(conn);
    this._broadcastSpectatorCount(room);
  }

  /** そのルームの観戦者数(ルームが無ければ 0)。 */
  spectatorCountFor(code) {
    const room = this.rooms.get(code);
    return room ? room.spectators.size : 0;
  }

  /** 観戦者数を、そのルームの対局者と観戦者の全員に知らせる。 */
  _broadcastSpectatorCount(room) {
    const msg = { type: "spectators", count: room.spectators.size };
    for (const s of SEATS) safeSend(room.conns[s], msg);
    for (const sp of room.spectators) safeSend(sp, msg);
  }

  /** 現在保持しているルーム数(死活監視・デバッグ用)。 */
  roomCount() {
    return this.rooms.size;
  }
}

module.exports = { RoomRegistry, randomRoomCode, ROOM_CODE_LENGTH, DEFAULT_RECONNECT_GRACE_MS };
