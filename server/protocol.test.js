"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomRegistry, handleClientMessage } = require("./protocol");

function fakeConn(label) {
  const received = [];
  return { label, received, send(obj) { received.push(obj); } };
}

test("create → created を返す", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  handleClientMessage(registry, host, { type: "create" });
  assert.equal(host.received.length, 1);
  assert.equal(host.received[0].type, "created");
  assert.equal(host.received[0].seat, "east");
  assert.equal(typeof host.received[0].code, "string");
  assert.equal(typeof host.received[0].token, "string");
});

test("create を同じconnから2回送ると2回目はエラー", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  handleClientMessage(registry, host, { type: "create" });
  handleClientMessage(registry, host, { type: "create" });
  assert.equal(host.received[1].type, "error");
});

test("join: 両者揃うと両方にreadyが届く", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, { type: "create" });
  const code = host.received[0].code;

  handleClientMessage(registry, guest, { type: "join", code: code.toLowerCase() }); // 小文字でも通ることを確認
  assert.equal(guest.received[0].type, "joined");
  assert.equal(guest.received[0].seat, "south");

  // 両者に ready が届く(hostは joined ではなく直接 ready、guestは joined の次に ready)
  assert.deepEqual(
    host.received.map((m) => m.type),
    ["created", "ready"]
  );
  assert.deepEqual(
    guest.received.map((m) => m.type),
    ["joined", "ready"]
  );
});

test("プレイヤー名: 入力した名前がreadyのnamesに乗る", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, { type: "create", name: "  たろう  " }); // 前後空白は除去される
  const code = host.received[0].code;
  handleClientMessage(registry, guest, { type: "join", code, name: "じろう" });

  const hostReady = host.received.find((m) => m.type === "ready");
  const guestReady = guest.received.find((m) => m.type === "ready");
  assert.deepEqual(hostReady.names, { east: "たろう", south: "じろう" });
  assert.deepEqual(guestReady.names, { east: "たろう", south: "じろう" });
});

test("プレイヤー名: 未入力/不正な値はPlayer1・Player2で補われる", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, { type: "create" }); // name省略
  const code = host.received[0].code;
  handleClientMessage(registry, guest, { type: "join", code, name: "   " }); // 空白のみ

  const hostReady = host.received.find((m) => m.type === "ready");
  assert.deepEqual(hostReady.names, { east: "Player1", south: "Player2" });
});

test("プレイヤー名: 長すぎる名前は20文字に切り詰められる", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  const longName = "あ".repeat(50);
  handleClientMessage(registry, host, { type: "create", name: longName });
  const code = host.received[0].code;
  handleClientMessage(registry, guest, { type: "join", code });

  const hostReady = host.received.find((m) => m.type === "ready");
  assert.equal(hostReady.names.east.length, 20);
});

test("join: コード未指定はエラーで返す(例外を投げない)", () => {
  const registry = new RoomRegistry();
  const guest = fakeConn("guest");
  assert.doesNotThrow(() => handleClientMessage(registry, guest, { type: "join" }));
  assert.equal(guest.received[0].type, "error");
});

test("join: 存在しないコードはエラーで返す(例外を投げない)", () => {
  const registry = new RoomRegistry();
  const guest = fakeConn("guest");
  handleClientMessage(registry, guest, { type: "join", code: "ZZZZZZ" });
  assert.equal(guest.received[0].type, "error");
});

test("game: もう一方にだけ中継される", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, { type: "create" });
  const code = host.received[0].code;
  handleClientMessage(registry, guest, { type: "join", code });

  handleClientMessage(registry, host, { type: "game", payload: { phase: "draw" } });
  const gameMsgs = guest.received.filter((m) => m.type === "game");
  assert.equal(gameMsgs.length, 1);
  assert.deepEqual(gameMsgs[0].payload, { phase: "draw" });
});

test("不明なtypeやmsg自体が不正な場合はerrorを返す(例外を投げない)", () => {
  const registry = new RoomRegistry();
  const conn = fakeConn("c");
  assert.doesNotThrow(() => handleClientMessage(registry, conn, { type: "something-unknown" }));
  assert.equal(conn.received[0].type, "error");
  assert.doesNotThrow(() => handleClientMessage(registry, conn, null));
  assert.equal(conn.received[1].type, "error");
  assert.doesNotThrow(() => handleClientMessage(registry, conn, {}));
  assert.equal(conn.received[2].type, "error");
});

test("ping → pong", () => {
  const registry = new RoomRegistry();
  const c = fakeConn("c");
  handleClientMessage(registry, c, { type: "ping" });
  assert.deepEqual(c.received, [{ type: "pong" }]);
});

test("rejoin: 切断後に同じトークンで戻ると rejoined(最新の対局データ付き)、相手には peer-online", () => {
  const registry = new RoomRegistry({ setTimer: () => ({}), clearTimer: () => {} });
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, { type: "create", name: "たろう" });
  const code = host.received[0].code;
  handleClientMessage(registry, guest, { type: "join", code, name: "じろう" });
  const guestToken = guest.received[0].token;
  handleClientMessage(registry, host, { type: "game", payload: { phase: "draw" } });

  registry.handleDisconnect(guest);
  assert.equal(host.received.at(-1).type, "peer-offline");

  const guest2 = fakeConn("guest2");
  handleClientMessage(registry, guest2, { type: "rejoin", code: code.toLowerCase(), token: guestToken });
  const r = guest2.received[0];
  assert.equal(r.type, "rejoined");
  assert.equal(r.seat, "south");
  assert.deepEqual(r.game, { phase: "draw" });
  assert.deepEqual(r.names, { east: "たろう", south: "じろう" });
  assert.equal(r.peerConnected, true);
  assert.equal(r.bothSeated, true);
  assert.equal(host.received.at(-1).type, "peer-online");
});

test("rejoin: トークンが違えば rejoin-failed", () => {
  const registry = new RoomRegistry({ setTimer: () => ({}), clearTimer: () => {} });
  const host = fakeConn("host");
  handleClientMessage(registry, host, { type: "create" });
  const code = host.received[0].code;
  registry.handleDisconnect(host);
  const x = fakeConn("x");
  handleClientMessage(registry, x, { type: "rejoin", code, token: "bad" });
  assert.equal(x.received[0].type, "rejoin-failed");
});

test("leave: 相手に peer-left が届きルームが消える", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, { type: "create" });
  handleClientMessage(registry, guest, { type: "join", code: host.received[0].code });
  handleClientMessage(registry, guest, { type: "leave" });
  assert.equal(host.received.at(-1).type, "peer-left");
  assert.equal(registry.roomCount(), 0);
});

test("rejoin: 自分の切断中に相手が退室していたら rejoin-failed(reason: peer-left)", () => {
  const registry = new RoomRegistry({ setTimer: () => ({}), clearTimer: () => {} });
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, { type: "create" });
  const code = host.received[0].code;
  handleClientMessage(registry, guest, { type: "join", code });
  const guestToken = guest.received[0].token;
  registry.handleDisconnect(guest);
  handleClientMessage(registry, host, { type: "leave" });
  const g2 = fakeConn("g2");
  handleClientMessage(registry, g2, { type: "rejoin", code, token: guestToken });
  assert.equal(g2.received[0].type, "rejoin-failed");
  assert.equal(g2.received[0].reason, "peer-left");
  assert.match(g2.received[0].message, /対戦相手が退室しました/);
});

// ---------------- 自動マッチング ----------------

test("match: 1人目は match-waiting、2人目が来ると両者に matched と ready", () => {
  const registry = new RoomRegistry({ random: () => 0 }); // 先着側が east になる乱数に固定
  const a = fakeConn("a");
  const b = fakeConn("b");
  handleClientMessage(registry, a, { type: "match", name: "たろう" });
  assert.deepEqual(a.received.map((m) => m.type), ["match-waiting"]);
  handleClientMessage(registry, b, { type: "match", name: "じろう" });
  assert.deepEqual(a.received.map((m) => m.type), ["match-waiting", "matched", "ready"]);
  assert.deepEqual(b.received.map((m) => m.type), ["matched", "ready"]);
  const ma = a.received[1];
  const mb = b.received[0];
  assert.equal(ma.seat, "east");
  assert.equal(mb.seat, "south");
  assert.equal(ma.code, mb.code);
  assert.ok(ma.token && mb.token && ma.token !== mb.token);
  assert.deepEqual(a.received[2].names, { east: "たろう", south: "じろう" });
  // 組んだ後は通常のルームと同じく中継される
  handleClientMessage(registry, a, { type: "game", payload: { x: 1 } });
  assert.deepEqual(b.received.at(-1), { type: "game", payload: { x: 1 } });
  assert.equal(registry.matchQueue.length, 0);
});

test("match: 3人目は次の相手待ちになり、別のルームで組まれる", () => {
  const registry = new RoomRegistry();
  const [a, b, c, d] = ["a", "b", "c", "d"].map(fakeConn);
  for (const x of [a, b, c]) handleClientMessage(registry, x, { type: "match" });
  assert.equal(c.received.at(-1).type, "match-waiting");
  handleClientMessage(registry, d, { type: "match" });
  const codeAB = a.received.find((m) => m.type === "matched").code;
  const codeCD = c.received.find((m) => m.type === "matched").code;
  assert.notEqual(codeAB, codeCD);
  assert.equal(registry.roomCount(), 2);
});

test("match: 同じ接続が2回送っても自分自身とは組まれない", () => {
  const registry = new RoomRegistry();
  const a = fakeConn("a");
  handleClientMessage(registry, a, { type: "match" });
  handleClientMessage(registry, a, { type: "match" });
  assert.equal(registry.roomCount(), 0);
  assert.equal(registry.matchQueue.length, 1);
});

test("match: 相手待ち中に(切断に気付く前の)同じ端末から新しい接続で再試行しても、自分自身とは組まれない", () => {
  // 電波切れ等で接続が切れると、サーバーが close イベントで気付く(ping/pongのタイムアウト)より先に、
  // クライアントが新しい接続で自動マッチングをやり直すことがある。この時、待ち行列にまだ残っている
  // 「切断に気付かれていない古い自分の接続」と新しい接続を同一クライアントとして扱い、組ませない。
  const registry = new RoomRegistry();
  const oldConn = fakeConn("old"); // 切れているが、サーバーはまだ気付いていない接続
  const newConn = fakeConn("new"); // 同じ端末からの新しい接続
  handleClientMessage(registry, oldConn, { type: "match", name: "たろう", clientId: "device-1" });
  assert.deepEqual(oldConn.received.map((m) => m.type), ["match-waiting"]);

  handleClientMessage(registry, newConn, { type: "match", name: "たろう", clientId: "device-1" });
  // 組まれず、引き続き相手待ちのまま(待ち行列は1件のまま、新しい接続に差し替わる)
  assert.deepEqual(newConn.received.map((m) => m.type), ["match-waiting"]);
  assert.equal(registry.roomCount(), 0);
  assert.equal(registry.matchQueue.length, 1);
  assert.equal(registry.matchQueue[0].conn, newConn);

  // 本物の別の相手が来れば、新しい接続とちゃんと組まれる
  const other = fakeConn("other");
  handleClientMessage(registry, other, { type: "match", name: "じろう", clientId: "device-2" });
  assert.equal(newConn.received.find((m) => m.type === "matched") !== undefined, true);
  assert.equal(other.received.find((m) => m.type === "matched") !== undefined, true);
  assert.equal(registry.roomCount(), 1);
});

test("match: clientId が異なる(別端末)場合は通常通りマッチングする", () => {
  const registry = new RoomRegistry({ random: () => 0 });
  const a = fakeConn("a");
  const b = fakeConn("b");
  handleClientMessage(registry, a, { type: "match", clientId: "device-1" });
  handleClientMessage(registry, b, { type: "match", clientId: "device-2" });
  assert.equal(a.received.find((m) => m.type === "matched").seat, "east");
  assert.equal(b.received.find((m) => m.type === "matched").seat, "south");
  assert.equal(registry.roomCount(), 1);
});

test("cancel-match / 切断: 待ち行列から外れ、後から来た人とは組まれない", () => {
  const registry = new RoomRegistry();
  const [a, b, c] = ["a", "b", "c"].map(fakeConn);
  handleClientMessage(registry, a, { type: "match" });
  handleClientMessage(registry, a, { type: "cancel-match" });
  assert.equal(a.received.at(-1).type, "match-cancelled");
  handleClientMessage(registry, b, { type: "match" });
  registry.handleDisconnect(b); // 相手待ちのまま切断
  handleClientMessage(registry, c, { type: "match" });
  assert.equal(c.received.at(-1).type, "match-waiting");
  assert.equal(registry.roomCount(), 0);
});

test("match: 既にルームにいる接続はエラー", () => {
  const registry = new RoomRegistry();
  const a = fakeConn("a");
  handleClientMessage(registry, a, { type: "create" });
  handleClientMessage(registry, a, { type: "match" });
  assert.equal(a.received.at(-1).type, "error");
});

test("match: どちらが east(起家)になるかはランダム(乱数により先着・後着どちらもあり得る)", () => {
  for (const [r, firstSeat] of [[0.1, "east"], [0.9, "south"]]) {
    const registry = new RoomRegistry({ random: () => r });
    const a = fakeConn("a");
    const b = fakeConn("b");
    handleClientMessage(registry, a, { type: "match", name: "たろう" });
    handleClientMessage(registry, b, { type: "match", name: "じろう" });
    const ma = a.received.find((m) => m.type === "matched");
    const mb = b.received.find((m) => m.type === "matched");
    assert.equal(ma.seat, firstSeat);
    assert.equal(mb.seat, firstSeat === "east" ? "south" : "east");
    // 名前も座席に合わせて入れ替わる
    const names = a.received.find((m) => m.type === "ready").names;
    assert.equal(names[ma.seat], "たろう");
    assert.equal(names[mb.seat], "じろう");
  }
  // 実際の乱数でも、何度か組めば両方のパターンが出る
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const registry = new RoomRegistry();
    const a = fakeConn("a");
    handleClientMessage(registry, a, { type: "match" });
    handleClientMessage(registry, fakeConn("b"), { type: "match" });
    seen.add(a.received.find((m) => m.type === "matched").seat);
  }
  assert.deepEqual([...seen].sort(), ["east", "south"]);
});

// ---------------- 観戦 ----------------

/** host/guest でルームを作って対局データを1回中継した状態を作る */
function startedRoom(registry, createMsg = {}) {
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  handleClientMessage(registry, host, Object.assign({ type: "create", name: "たろう" }, createMsg));
  const code = host.received[0].code;
  handleClientMessage(registry, guest, { type: "join", code, name: "じろう" });
  const payload = {
    state: { phase: "discard", roundWind: "south", roundNumber: 2, players: { east: { score: 50000 }, south: { score: 40000 } } },
  };
  handleClientMessage(registry, host, { type: "game", payload });
  return { host, guest, code, payload };
}

test("観戦: 一覧には開始済み・観戦許可の対局だけが局と点数付きで載る", () => {
  const registry = new RoomRegistry();
  const { code } = startedRoom(registry);
  startedRoom(registry, { allowSpectate: false }); // 観戦不可
  const waitingHost = fakeConn("waiting");
  handleClientMessage(registry, waitingHost, { type: "create" }); // 相手待ち(未開始)

  const viewer = fakeConn("viewer");
  handleClientMessage(registry, viewer, { type: "list-games" });
  const msg = viewer.received[0];
  assert.equal(msg.type, "games");
  assert.equal(msg.list.length, 1);
  assert.equal(msg.list[0].code, code);
  assert.deepEqual(msg.list[0].names, { east: "たろう", south: "じろう" });
  assert.deepEqual(msg.list[0].round, { roundWind: "south", roundNumber: 2, scores: { east: 50000, south: 40000 }, ended: false });
  assert.equal(msg.list[0].spectators, 0);
  // 一覧に牌山・手牌などの対局データそのものは含めない
  assert.equal(msg.list[0].game, undefined);
});

test("観戦: 入室で最新の対局データが届き、以後の中継も届く。人数は全員に通知される", () => {
  const registry = new RoomRegistry();
  const { host, guest, code, payload } = startedRoom(registry);
  const viewer = fakeConn("viewer");
  handleClientMessage(registry, viewer, { type: "spectate", code: code.toLowerCase() });

  const spectating = viewer.received.find((m) => m.type === "spectating");
  assert.ok(spectating);
  assert.deepEqual(spectating.game, payload);
  assert.equal(spectating.spectators, 1);
  assert.deepEqual(host.received.at(-1), { type: "spectators", count: 1 });
  assert.deepEqual(guest.received.at(-1), { type: "spectators", count: 1 });

  const next = { state: { phase: "draw", players: {} } };
  handleClientMessage(registry, guest, { type: "game", payload: next });
  assert.deepEqual(viewer.received.at(-1), { type: "game", payload: next });
  assert.deepEqual(host.received.at(-1), { type: "game", payload: next });
});

test("観戦: 観戦者からの game は中継しない・観戦中は参加できない", () => {
  const registry = new RoomRegistry();
  const { host, guest, code } = startedRoom(registry);
  const viewer = fakeConn("viewer");
  handleClientMessage(registry, viewer, { type: "spectate", code });
  const hostCount = host.received.length;
  const guestCount = guest.received.length;
  handleClientMessage(registry, viewer, { type: "game", payload: { state: { hacked: true } } });
  assert.equal(host.received.length, hostCount);
  assert.equal(guest.received.length, guestCount);
  handleClientMessage(registry, viewer, { type: "create" });
  assert.equal(viewer.received.at(-1).type, "error");
});

test("観戦: 観戦不可・未開始・存在しないルームは spectate-failed", () => {
  const registry = new RoomRegistry();
  const { code: privateCode } = startedRoom(registry, { allowSpectate: false });
  const waitingHost = fakeConn("waiting");
  handleClientMessage(registry, waitingHost, { type: "create" });
  const waitingCode = waitingHost.received[0].code;
  const viewer = fakeConn("viewer");
  for (const code of [privateCode, waitingCode, "ZZZZZZ"]) {
    handleClientMessage(registry, viewer, { type: "spectate", code });
    assert.equal(viewer.received.at(-1).type, "spectate-failed");
  }
});

test("観戦: 観戦者の切断・観戦終了で人数が減り、対局者の退室で観戦者に spectate-ended が届く", () => {
  const registry = new RoomRegistry();
  const { host, guest, code } = startedRoom(registry);
  const v1 = fakeConn("v1");
  const v2 = fakeConn("v2");
  handleClientMessage(registry, v1, { type: "spectate", code });
  handleClientMessage(registry, v2, { type: "spectate", code });
  assert.deepEqual(host.received.at(-1), { type: "spectators", count: 2 });
  registry.handleDisconnect(v1);
  assert.deepEqual(host.received.at(-1), { type: "spectators", count: 1 });
  handleClientMessage(registry, guest, { type: "leave" });
  assert.equal(v2.received.at(-1).type, "spectate-ended");
  assert.equal(registry.spectatingCode(v2), null);
});

test("観戦: 自動マッチングの対局は観戦できる", () => {
  const registry = new RoomRegistry({ random: () => 0 });
  const a = fakeConn("a");
  const b = fakeConn("b");
  handleClientMessage(registry, a, { type: "match" });
  handleClientMessage(registry, b, { type: "match" });
  const code = a.received.find((m) => m.type === "matched").code;
  handleClientMessage(registry, a, { type: "game", payload: { state: { phase: "draw", players: {} } } });
  const viewer = fakeConn("viewer");
  handleClientMessage(registry, viewer, { type: "spectate", code });
  assert.equal(viewer.received.at(-1).type, "spectating");
});

test("観戦: 両者とも切断中の対局は一覧に出さない", () => {
  const registry = new RoomRegistry({ setTimer: () => 1, clearTimer: () => {} });
  const { host, guest } = startedRoom(registry);
  registry.handleDisconnect(host);
  const viewer = fakeConn("viewer");
  handleClientMessage(registry, viewer, { type: "list-games" });
  assert.equal(viewer.received.at(-1).list.length, 1); // 片方だけの切断なら載る
  registry.handleDisconnect(guest);
  handleClientMessage(registry, viewer, { type: "list-games" });
  assert.equal(viewer.received.at(-1).list.length, 0);
});
