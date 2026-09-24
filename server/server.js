"use strict";

/**
 * オンライン対戦(自前サーバー方式)の本体。
 *
 * 麻雀のルールは一切知らない、ごく薄い中継サーバー。
 * - クライアントが { type: "create" } を送るとルームを作り、コードを返す。
 * - もう一方が { type: "join", code } を送ると着席し、両者に { type: "ready" } を送る。
 * - 以後はどちらかが { type: "game", payload } を送るたびに、もう一方へそのまま転送するだけ。
 * - 実際のゲーム進行判断(誰が今送信してよいか等)はすべてクライアント側
 *   (online-shared.js の OnlineMahjongApp)が行う。
 * - 接続が切れても座席は一定時間(5分)予約され、{ type: "rejoin", code, token } で同じ座席に
 *   戻れる(詳細は roomRegistry.js)。
 * - 応答の無くなった接続(スマホの電波切れ等で close が届かないもの)は、WebSocket の
 *   ping/pong で検出して切断扱いにする。
 * - 接続数が変わるたび(誰かがつながった・切れた)、今つながっている全員に
 *   { type: "online-count", count } を送る(ロビー画面等のオンライン人数表示用)。
 *   まだルームに入っていない接続にも送るため、これだけは protocol.js を通さずここで直接行う。
 *
 * 起動: `node server.js`(PORTは環境変数 PORT、省略時 8080)。
 * 依存パッケージは `ws` のみ(プロジェクトルートで `npm install` 済みであること)。
 */

const http = require("http");
const { WebSocketServer } = require("ws");
const { RoomRegistry, handleClientMessage } = require("./protocol");

const PORT = process.env.PORT || 8080;

const registry = new RoomRegistry();

const httpServer = http.createServer((req, res) => {
  // ホスティング先のヘルスチェック用に、素のHTTPリクエストにも簡単に応答しておく。
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(`二人麻雀オンライン対戦・中継サーバー稼働中(現在のルーム数: ${registry.roomCount()})\n`);
});

const wss = new WebSocketServer({ server: httpServer });

/** WebSocket レベルの生存確認の間隔(ミリ秒)。この間に pong が返らなければ切断扱いにする。 */
const HEARTBEAT_INTERVAL_MS = 30000;

/** 今つながっている全員(ルーム未参加でも)に、現在の接続数を送る。 */
function broadcastOnlineCount() {
  const payload = JSON.stringify({ type: "online-count", count: wss.clients.size });
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

  ws.on("message", (raw) => {
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
