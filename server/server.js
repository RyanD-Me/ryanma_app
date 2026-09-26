"use strict";

/**
 * オンライン対戦(自前サーバー方式)の本体。
 *
 * オンライン対戦のサーバー。対局の進行(合法手の判定・牌山・点数)はサーバーが持つ(gameSession.js)。
 * - クライアントが { type: "create" } を送るとルームを作り、コードを返す。
 * - もう一方が { type: "join", code } を送ると着席し、両者に { type: "ready" } を送る。
 * - 両者が揃うとサーバーが対局を始め、各自に見てよい情報だけの { type: "game", payload } を配る。
 * - クライアントは { type: "action", action } で操作を送り、サーバーが合法なものだけを反映する
 *   (相手の手牌・牌山はクライアントに届かない)。
 * - 接続が切れても座席は一定時間(5分)予約され、{ type: "rejoin", code, token } で同じ座席に
 *   戻れる(詳細は roomRegistry.js)。
 * - 応答の無くなった接続(スマホの電波切れ等で close が届かないもの)は、WebSocket の
 *   ping/pong で検出して切断扱いにする。
 * - 接続数には上限がある(サーバー全体 MAX_CONNECTIONS・同じ接続元 MAX_CONNECTIONS_PER_IP)。超えた接続には
 *   { type: "error", message } を送ってすぐ切る(大量の接続でサーバーのメモリを使い切られないように)。
 * - 接続数が変わるたび(誰かがつながった・切れた)、今つながっている全員に
 *   { type: "online-count", count, byRule: {full, half} } を送る(ロビー画面等のオンライン人数表示用。
 *   byRule はルールごとの対局中・相手待ちの人数で、ルームの出入りや相手待ちの出入りでも送り直す)。
 *   まだルームに入っていない接続にも送るため、これだけは protocol.js を通さずここで直接行う。
 *
 * 起動: `node server.js`(PORTは環境変数 PORT、省略時 8080)。
 * 依存パッケージは `ws` のみ(プロジェクトルートで `npm install` 済みであること)。
 */

const http = require("http");
const { WebSocketServer } = require("ws");
const { RoomRegistry, handleClientMessage, PROTOCOL_VERSION } = require("./protocol");

/** 起動した時刻(/version で返す。再デプロイされたかどうかの目安) */
const STARTED_AT = new Date().toISOString();

const PORT = process.env.PORT || 8080;

// 観戦の遅れ(ミリ秒)。既定は3分。動作確認のため、環境変数 SPECTATOR_DELAY_MS で短くできる
const spectatorDelayMs = Number.isFinite(Number(process.env.SPECTATOR_DELAY_MS)) && process.env.SPECTATOR_DELAY_MS !== ""
  ? Number(process.env.SPECTATOR_DELAY_MS)
  : undefined;
const registry = new RoomRegistry({ spectatorDelayMs });

const httpServer = http.createServer((req, res) => {
  // ホスティング先のヘルスチェック用に、素のHTTPリクエストにも簡単に応答しておく。
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }
  // 動いている版の確認用(自動デプロイで新しい版に入れ替わったかを外から確かめるため)。
  // commit は Render が自動で設定する環境変数 RENDER_GIT_COMMIT(デプロイしたコミット)。
  if (req.url === "/version") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(
      JSON.stringify({
        commit: process.env.RENDER_GIT_COMMIT || null,
        protocol: PROTOCOL_VERSION,
        startedAt: STARTED_AT,
      })
    );
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`二人麻雀オンライン対戦・中継サーバー稼働中(現在のルーム数: ${registry.roomCount()})\n`);
});

/**
 * 1メッセージの最大サイズ(バイト)。対局データ一式でも数十KB程度なので、これを超えるものは
 * 改造したクライアント等からの異常なデータとして受け付けない(ws が接続を切る)。
 */
const MAX_MESSAGE_BYTES = 512 * 1024;
/** 1接続が RATE_WINDOW_MS の間に送ってよいメッセージ数。超えたら接続を切る(大量送信でサーバーを止められないように) */
const RATE_WINDOW_MS = 10000;
const RATE_MAX_MESSAGES = 300;

/** 環境変数の正の整数(無い・不正なら既定値) */
function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v > 0 ? v : def;
}
/** サーバー全体の同時接続数の上限 */
const MAX_CONNECTIONS = envInt("MAX_CONNECTIONS", 1000);
/** 同じ接続元(IPアドレス)からの同時接続数の上限。学校や会社など同じ回線から複数人がつなぐこともあるので多めにする */
const MAX_CONNECTIONS_PER_IP = envInt("MAX_CONNECTIONS_PER_IP", 20);
const TOO_MANY_CONNECTIONS_MESSAGE = "サーバーが混み合っているため接続できませんでした。しばらくしてからお試しください。";

/**
 * 接続元のIPアドレス。ホスティング先(Render)の手前の中継(Cloudflare 等)が付ける接続元のヘッダーを優先し、
 * 無ければ X-Forwarded-For の先頭、それも無ければ直接の接続元。ヘッダーは偽装されることもあるが、
 * その場合でもサーバー全体の上限(MAX_CONNECTIONS)で守られる。
 */
function clientIp(req) {
  const h = (req && req.headers) || {};
  const first = (v) => (typeof v === "string" ? v.split(",")[0].trim() : "");
  return first(h["cf-connecting-ip"]) || first(h["true-client-ip"]) || first(h["x-forwarded-for"]) || (req && req.socket && req.socket.remoteAddress) || "unknown";
}
/** 接続元ごとの今の接続数 */
const connectionsPerIp = new Map();

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

// 人数(接続数・ルールごとの対局中/相手待ちの人数)が変わったら全員へ知らせる。接続の出入りやルームの作成・参加・
// 退室などで続けて何度も変わることがあるので、少しまとめてから送る(大量に接続・切断されても送る回数が増えすぎないように)。
let countsTimer = null;
function scheduleOnlineCountBroadcast() {
  if (countsTimer) return;
  countsTimer = setTimeout(() => {
    countsTimer = null;
    broadcastOnlineCount();
  }, 300);
}
registry.onCountsChanged = scheduleOnlineCountBroadcast;

/** WebSocket レベルの生存確認の間隔(ミリ秒)。この間に pong が返らなければ切断扱いにする。 */
const HEARTBEAT_INTERVAL_MS = 30000;

/**
 * 今つながっている全員(ルーム未参加でも)に、現在の接続数と、ルールごとの対局中・相手待ちの人数
 * (byRule: {full: 一荘戦, half: 半荘戦}。自動マッチングのルール選択画面の「接続数」)を送る。
 */
function broadcastOnlineCount() {
  const payload = JSON.stringify({ type: "online-count", count: wss.clients.size, byRule: registry.ruleCounts() });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

wss.on("connection", (ws, req) => {
  // 接続数の上限を超えたら、理由を伝えてすぐ切る(ルーム・相手待ちなどには一切登録しない)
  const ip = clientIp(req);
  const ipCount = connectionsPerIp.get(ip) || 0;
  if (wss.clients.size > MAX_CONNECTIONS || ipCount >= MAX_CONNECTIONS_PER_IP) {
    try {
      ws.send(JSON.stringify({ type: "error", message: TOO_MANY_CONNECTIONS_MESSAGE }));
      ws.close(1013, "too many connections");
    } catch (e) {
      ws.terminate();
    }
    return;
  }
  connectionsPerIp.set(ip, ipCount + 1);
  let released = false;
  const releaseIp = () => {
    if (released) return;
    released = true;
    const n = (connectionsPerIp.get(ip) || 1) - 1;
    if (n > 0) connectionsPerIp.set(ip, n);
    else connectionsPerIp.delete(ip);
  };

  const conn = {
    send(obj) {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(obj));
    },
    close() {
      try {
        ws.close();
      } catch (e) {
        /* ignore */
      }
    },
  };

  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  let windowStart = Date.now();
  let windowCount = 0;
  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - windowStart > RATE_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    if (++windowCount > RATE_MAX_MESSAGES) {
      conn.send({ type: "error", message: "送信が多すぎるため接続を切りました。" });
      ws.terminate();
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      conn.send({ type: "error", message: "不正なメッセージ形式です。" });
      return;
    }
    handleClientMessage(registry, conn, msg);
  });

  ws.on("close", () => {
    releaseIp();
    registry.handleDisconnect(conn);
    scheduleOnlineCountBroadcast();
  });

  ws.on("error", () => {
    releaseIp();
    registry.handleDisconnect(conn);
    scheduleOnlineCountBroadcast();
  });

  // 接続直後の時点で wss.clients には既にこの ws 自身が含まれているため、
  // 全員(この接続自身も含む)へ最新の人数を知らせる(少しまとめてから)。
  scheduleOnlineCountBroadcast();
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate(); // close イベント → handleDisconnect(座席は猶予時間の間予約される)
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (e) {
      /* ignore */
    }
  }
}, HEARTBEAT_INTERVAL_MS);
wss.on("close", () => clearInterval(heartbeat));

httpServer.listen(PORT, () => {
  console.log(`二人麻雀 中継サーバーを起動しました: ws://localhost:${PORT}`);
});
