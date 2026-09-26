"use strict";

const { RoomRegistry } = require("./roomRegistry");

/**
 * 1つのクライアント接続から届いた1メッセージを処理する。
 * conn は `{ send(obj), close?() }` を持つオブジェクト(実運用では server.js が `ws` を包んだもの、
 * テストではフェイクの WebSocket を包んだもの)。
 *
 * server.js(実運用)とテスト(server/protocol.test.js)の両方が全く同じこの関数を使うことで、
 * 「サーバーが実際に実行するのと同じロジック」をテストできるようにしている。
 *
 * 対局はサーバーが進める(gameSession.js)。クライアントは操作(action)を送り、サーバーは合法な操作だけを
 * 反映して、各座席・観戦者にそれぞれが見てよい情報だけの対局データ(game {payload})を配る。
 * create/join/rejoin/match には protocol: 2 を付ける(付いていない古いアプリは受け付けない)。
 *
 * メッセージ一覧(クライアント → サーバー):
 *   create {name, allowSpectate, timeControl, dealerChoice, gameLength} ルーム作成 → created {code, seat, token, protocol}
 *                                           (gameLength: "full" = 一荘戦 8局 / "half" = 半荘戦 4局。省略時は一荘戦)
 *                                           (allowSpectate: 観戦を許可するか。省略時は許可。
 *                                            timeControl: {perAction, bank}(秒)か null。dealerChoice: 起家
 *                                            "self"(作成者)| "opponent" | "random")
 *   join   {code, name}       参加       → joined {code, seat, token, protocol}
 *                                           (両者揃えば両方に ready {names}、続けて最初の game)
 *   rejoin {code, token}      再接続     → rejoined {code, seat, token, names, game, peerConnected}
 *                                           (相手には peer-online)
 *   action {action}           操作       → 反映されれば全員に game {payload}。合法でなければ本人に
 *                                           action-rejected {message} と今の game {payload}
 *                                           (action の形は gameSession.js の apply() を参照)
 *   leave                     退出       → 相手に peer-left、ルーム破棄
 *   match  {name, clientId, gameLength} 自動マッチング(同じ gameLength の人とだけ組む)
 *                             → 相手がいなければ match-waiting、
 *                                           揃えば両者に matched {code, seat, token} と ready {names}
 *                                           (clientId は同一端末からの再試行を自分自身との
 *                                            マッチングとして扱わないための識別子。省略可)
 *   cancel-match              自動マッチングをやめる → match-cancelled
 *   list-games                観戦できる対局の一覧 → games {list: [{code, names, spectators, round}]}
 *   spectate {code}           観戦を始める → spectating {code, names, game, spectators, delayMs, startsInMs}
 *                                           (観戦者向けの対局データは delayMs(3分)遅れで届く。game は
 *                                            その時点で届いている最新のもので、まだ無ければ null。
 *                                            startsInMs は最初の対局データが届くまでの残り時間)
 *                                           失敗時は spectate-failed {message}
 *   stop-spectate             観戦をやめる
 *   ping                      生存確認   → pong
 * サーバー → クライアントの通知: peer-offline(相手が切断、再接続待ち) / peer-online /
 *   peer-left {reason: "left"(相手が退室) | "timeout"(相手の再接続の猶予切れ)}
 * rejoin-failed {reason}: reason が "peer-left" なら、自分の切断中に相手が退室していた。
 * 観戦関連の通知: spectators {count}(観戦者数が変わった。対局者・観戦者の全員へ) /
 *   spectate-ended {message}(観戦中の対局が終了・破棄された)
 */

/** プレイヤー名の最大文字数(見える文字で数える) */
const MAX_NAME_LENGTH = 20;

// 文字の向きを変える記号(許可する)。埋め込み・上書き(PDF で閉じる)と、分離(PDI で閉じる)と、向きの目印
const BIDI_EMBED_OPEN = "\u202A\u202B\u202D\u202E"; // LRE RLE LRO RLO
const BIDI_PDF = "\u202C";
const BIDI_ISOLATE_OPEN = "\u2066\u2067\u2068"; // LRI RLI FSI
const BIDI_PDI = "\u2069";
const BIDI_MARKS = "\u200E\u200F\u061C"; // LRM RLM ALM
const BIDI_ALLOWED = new Set([...BIDI_EMBED_OPEN, BIDI_PDF, ...BIDI_ISOLATE_OPEN, BIDI_PDI, ...BIDI_MARKS]);
/** 右から左に書く文字(アラビア文字・ヘブライ文字など)。名前の外側の文字の並びに影響しうる */
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
/**
 * 見えない文字(使用禁止)。制御文字・書式文字(ゼロ幅スペース・BOM・ソフトハイフン・タグ文字など)・行/段落区切り、
 * 空白に見えるが文字として扱われるもの(ハングルの埋め草・点字の空白など)。文字の向きを変える記号と、
 * 絵文字どうしをつなぐゼロ幅接合子は別に扱う。
 */
const INVISIBLE_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u115F\u1160\u3164\uFFA0\u2800\u034F\u17B4\u17B5\u180B-\u180F]/u;
const EXT_PICT = /\p{Extended_Pictographic}/u;

/**
 * プレイヤー名を、表示・中継してよい形に正規化する。
 * - 見えない文字は取り除く(使用禁止)。絵文字どうしをつなぐゼロ幅接合子(家族の絵文字など)だけは残す。
 * - 特殊な空白は普通の空白にし(全角スペースはそのまま)、続く空白は1つにまとめる。結合文字(濁点など)は1文字につき3つまで
 *   (大量に重ねて上下にはみ出す表示を防ぐ)。
 * - 文字の向きを変える記号は許可するが、閉じていないものは名前の末尾で閉じ、名前全体を分離
 *   (FSI … PDI)で囲んで、名前の外側(「○○家の…」などの前後の文字)の並びが崩れないようにする。
 * - 前後の空白を除き、見える文字で最大20文字。見える文字が残らなければ null(既定の名前になる)。
 */
function normalizePlayerName(rawName) {
  if (typeof rawName !== "string") return null;
  const chars = Array.from(rawName.normalize("NFC"));
  const kept = [];
  let marks = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (BIDI_ALLOWED.has(c)) {
      kept.push(c);
      continue;
    }
    if (c === "\u200D") {
      // ゼロ幅接合子は、絵文字(と異体字セレクタ)のあとに絵文字が続くときだけ残す
      const prev = kept.filter((k) => !BIDI_ALLOWED.has(k)).at(-1) || "";
      const prevBase = prev === "\uFE0F" ? kept.filter((k) => !BIDI_ALLOWED.has(k)).at(-2) || "" : prev;
      if (EXT_PICT.test(prevBase) && EXT_PICT.test(chars[i + 1] || "")) kept.push(c);
      continue;
    }
    if (INVISIBLE_CHAR.test(c)) continue;
    if (/\p{Zs}/u.test(c)) {
      // 全角スペースはそのまま、ほかの特殊な空白は普通の空白に。空白が続くときは最初の1つだけ残す
      const last = kept[kept.length - 1];
      if (kept.length && last !== " " && last !== "\u3000") kept.push(c === "\u3000" ? c : " ");
      marks = 0;
      continue;
    }
    if (/\p{M}/u.test(c)) {
      if (++marks > 3) continue;
    } else {
      marks = 0;
    }
    kept.push(c);
  }
  // 前後の空白を除き、見える文字で20文字まで(向きの記号は数えない)
  while (kept.length && (kept[0] === " " || kept[0] === "\u3000")) kept.shift();
  const out = [];
  let visible = 0;
  for (const c of kept) {
    if (!BIDI_ALLOWED.has(c) && c !== "\u200D" && !/\p{M}/u.test(c)) {
      if (visible >= MAX_NAME_LENGTH) break;
      visible++;
    }
    out.push(c);
  }
  while (out.length && (out[out.length - 1] === " " || out[out.length - 1] === "\u3000")) out.pop();
  if (!out.some((c) => !BIDI_ALLOWED.has(c) && c !== " " && c !== "\u3000" && c !== "\u200D" && !/\p{M}/u.test(c))) return null;
  // 向きの記号の対応をとる(対応しない閉じ記号は捨て、閉じていないものは末尾で閉じる)
  const stack = [];
  const balanced = [];
  for (const c of out) {
    if (BIDI_EMBED_OPEN.includes(c)) {
      stack.push(BIDI_PDF);
    } else if (BIDI_ISOLATE_OPEN.includes(c)) {
      stack.push(BIDI_PDI);
    } else if (c === BIDI_PDF) {
      if (stack[stack.length - 1] !== BIDI_PDF) continue;
      stack.pop();
    } else if (c === BIDI_PDI) {
      if (!stack.includes(BIDI_PDI)) continue;
      // 分離を閉じると、その内側の埋め込みも閉じる
      while (stack.length && stack[stack.length - 1] !== BIDI_PDI) balanced.push(stack.pop());
      stack.pop();
    }
    balanced.push(c);
  }
  while (stack.length) balanced.push(stack.pop());
  const name = balanced.join("").trim();
  // 向きの記号や右から左に書く文字を含む名前は、全体を分離で囲んで外側の文字に影響しないようにする
  const needsIsolate = balanced.some((c) => BIDI_ALLOWED.has(c)) || RTL_CHAR.test(name);
  return needsIsolate ? `\u2068${name}\u2069` : name;
}

function normalizeCode(raw) {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

/**
 * 自動マッチングの待ち行列で「同じ端末からの接続か」を判定するためのID(クライアントが
 * 端末ごとに1つ生成し、localStorage に保存して使い回す。roomRegistry.js の enqueueMatch 参照)。
 * 不正値は null(=識別できない古いクライアント等)として扱い、これまで通りの動作にフォールバックする。
 */
function normalizeClientId(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 100);
}

/** 対応しているクライアントの通信方式の版。これより古いアプリ(対局データを自分で送る方式)は受け付けない */
const PROTOCOL_VERSION = 2;
const OUTDATED_CLIENT_MESSAGE = "アプリが古いため接続できません。ページを再読み込みしてください。";

function isCurrentClient(msg) {
  return Number.isInteger(msg.protocol) && msg.protocol >= PROTOCOL_VERSION;
}

/** 持ち時間の設定({perAction, bank} か null)。不正値は undefined(=既定の持ち時間) */
function normalizeTimeControl(raw) {
  if (raw === null) return null;
  if (raw && Number.isInteger(raw.perAction) && Number.isInteger(raw.bank)) return { perAction: raw.perAction, bank: raw.bank };
  return undefined;
}

function handleClientMessage(registry, conn, msg) {
  if (!msg || typeof msg.type !== "string") {
    conn.send({ type: "error", message: "不正なメッセージ形式です。" });
    return;
  }

  if (["create", "join", "rejoin", "match"].includes(msg.type) && !isCurrentClient(msg)) {
    conn.send({ type: msg.type === "rejoin" ? "rejoin-failed" : "error", message: OUTDATED_CLIENT_MESSAGE });
    return;
  }

  // 自動マッチングの相手待ち中は、ほかのルームに入らない(入れてしまうと、マッチング成立時にこの接続が
  // 新しいルームのものになり、先に入ったルームが切断しても片付けられずにサーバーに残り続ける)
  if (registry.isQueued(conn) && ["create", "join", "rejoin", "spectate"].includes(msg.type)) {
    const text = "自動マッチングの相手待ち中です。";
    conn.send(msg.type === "spectate" ? { type: "spectate-failed", message: text } : { type: msg.type === "rejoin" ? "rejoin-failed" : "error", message: text });
    return;
  }

  if (msg.type === "ping") {
    conn.send({ type: "pong" });
    return;
  }

  if (msg.type === "list-games") {
    conn.send({ type: "games", list: registry.listSpectatableGames() });
    return;
  }

  if (msg.type === "spectate") {
    if (registry.infoFor(conn)) {
      conn.send({ type: "spectate-failed", message: "対局中は観戦できません。" });
      return;
    }
    const code = normalizeCode(msg.code);
    if (!code) {
      conn.send({ type: "spectate-failed", message: "ルームコードを指定してください。" });
      return;
    }
    try {
      const result = registry.spectate(code, conn);
      conn.send({
        type: "spectating",
        code,
        names: result.names,
        game: result.lastGame,
        spectators: result.spectators,
        delayMs: result.delayMs,
        startsInMs: result.startsInMs,
      });
    } catch (err) {
      conn.send({ type: "spectate-failed", message: err.message });
    }
    return;
  }

  if (msg.type === "stop-spectate") {
    registry.stopSpectating(conn);
    return;
  }

  if (registry.spectatingCode(conn) && ["create", "join", "rejoin", "match"].includes(msg.type)) {
    conn.send({ type: "error", message: "観戦中はルームに参加できません。" });
    return;
  }

  if (msg.type === "create") {
    if (registry.infoFor(conn)) {
      conn.send({ type: "error", message: "既にルームに参加しています。" });
      return;
    }
    const name = normalizePlayerName(msg.name);
    const { code, token } = registry.createRoom(conn, name, {
      allowSpectate: msg.allowSpectate !== false,
      timeControl: normalizeTimeControl(msg.timeControl),
      dealerChoice: ["self", "opponent", "random"].includes(msg.dealerChoice) ? msg.dealerChoice : "self",
      gameLength: msg.gameLength,
    });
    conn.send({ type: "created", code, seat: "east", token, protocol: PROTOCOL_VERSION });
    return;
  }

  if (msg.type === "join") {
    if (registry.infoFor(conn)) {
      conn.send({ type: "error", message: "既にルームに参加しています。" });
      return;
    }
    const code = normalizeCode(msg.code);
    if (!code) {
      conn.send({ type: "error", message: "ルームコードを指定してください。" });
      return;
    }
    const name = normalizePlayerName(msg.name);
    try {
      const { seat, token } = registry.joinRoom(code, conn, name);
      conn.send({ type: "joined", code, seat, token, protocol: PROTOCOL_VERSION });
      if (registry.isFull(code)) {
        const peer = registry.peerOf(conn);
        const names = registry.namesFor(code);
        conn.send({ type: "ready", names });
        if (peer) peer.send({ type: "ready", names });
        registry.startGameIfReady(code);
      }
    } catch (err) {
      conn.send({ type: "error", message: err.message });
    }
    return;
  }

  if (msg.type === "rejoin") {
    if (registry.infoFor(conn)) {
      conn.send({ type: "error", message: "既にルームに参加しています。" });
      return;
    }
    const code = normalizeCode(msg.code);
    try {
      const result = registry.rejoinRoom(code, msg.token, conn);
      conn.send({
        type: "rejoined",
        protocol: PROTOCOL_VERSION,
        code,
        seat: result.seat,
        token: msg.token,
        names: result.names,
        game: result.lastGame,
        peerConnected: result.peerConnected,
        bothSeated: registry.isFull(code),
        spectators: registry.spectatorCountFor(code),
      });
    } catch (err) {
      conn.send({ type: "rejoin-failed", message: err.message, reason: err.reason || null });
    }
    return;
  }

  if (msg.type === "match") {
    if (registry.infoFor(conn)) {
      conn.send({ type: "error", message: "既にルームに参加しています。" });
      return;
    }
    const result = registry.enqueueMatch(conn, normalizePlayerName(msg.name), normalizeClientId(msg.clientId), msg.gameLength);
    if (!result) {
      conn.send({ type: "match-waiting" });
      return;
    }
    const names = registry.namesFor(result.code);
    for (const p of result.players) {
      p.conn.send({ type: "matched", code: result.code, seat: p.seat, token: p.token, protocol: PROTOCOL_VERSION });
    }
    for (const p of result.players) {
      p.conn.send({ type: "ready", names });
    }
    registry.startGameIfReady(result.code);
    return;
  }

  if (msg.type === "cancel-match") {
    registry.cancelMatch(conn);
    conn.send({ type: "match-cancelled" });
    return;
  }

  if (msg.type === "action") {
    registry.applyAction(conn, msg.action);
    return;
  }

  // 古いアプリ(対局データを自分で送る方式)からの対局データは受け付けない
  if (msg.type === "game") {
    conn.send({ type: "error", message: OUTDATED_CLIENT_MESSAGE });
    return;
  }

  if (msg.type === "leave") {
    registry.leaveRoom(conn);
    return;
  }

  conn.send({ type: "error", message: `不明なメッセージ種別です: ${msg.type}` });
}

module.exports = { handleClientMessage, RoomRegistry, PROTOCOL_VERSION, normalizePlayerName };
