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
 *   create {name, allowSpectate, timeControl, dealerChoice} ルーム作成 → created {code, seat, token, protocol}
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
 *   match  {name, clientId}   自動マッチング → 相手がいなければ match-waiting、
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

/** プレイヤー名を、表示・中継してよい形に正規化する(前後空白除去・最大20文字・不正値は null)。 */
function normalizePlayerName(rawName) {
  if (typeof rawName !== "string") return null;
  const trimmed = rawName.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 20);
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
    const result = registry.enqueueMatch(conn, normalizePlayerName(msg.name), normalizeClientId(msg.clientId));
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

module.exports = { handleClientMessage, RoomRegistry, PROTOCOL_VERSION };
