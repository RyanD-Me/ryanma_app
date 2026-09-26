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

const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

// ルールごとの人数が変わったら(ルームの作成・参加・退室、相手待ちの出入り)全員へ知らせる。
// 続けて何度も変わることがあるので、少しまとめてから送る。
let countsTimer = null;
registry.onCountsChanged = () => {
  if (countsTimer) return;
  countsTimer = setTimeout(() => {
    countsTimer = null;
    broadcastOnlineCount();
  }, 300);
};

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

wss.on("connection", (ws) => {
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
    registry.handleDisconnect(conn);
    broadcastOnlineCount();
  });

  ws.on("error", () => {
    registry.handleDisconnect(conn);
    broadcastOnlineCount();
  });

  // 接続直後の時点で wss.clients には既にこの ws 自身が含まれているため、
  // 全員(この接続自身も含む)へ最新の人数を知らせる。
  broadcastOnlineCount();
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
