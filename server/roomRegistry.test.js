"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { RoomRegistry } = require("./roomRegistry");

function fakeConn(label) {
  const received = [];
  return {
    label,
    received,
    send(obj) {
      received.push(obj);
    },
  };
}

test("createRoom: ホストをeast家として着席させ、コードを返す", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const { code } = registry.createRoom(host);
  assert.equal(typeof code, "string");
  assert.equal(code.length, 6);
  assert.deepEqual(registry.infoFor(host), { code, seat: "east" });
  assert.equal(registry.isFull(code), false);
});

test("joinRoom: ゲストをsouth家として着席させ、両者にreadyを中継できる", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  const { code } = registry.createRoom(host);

  const { seat } = registry.joinRoom(code, guest);
  assert.equal(seat, "south");
  assert.equal(registry.isFull(code), true);
  assert.equal(registry.peerOf(host), guest);
  assert.equal(registry.peerOf(guest), host);
});

test("joinRoom: 存在しないコードはエラー", () => {
  const registry = new RoomRegistry();
  const guest = fakeConn("guest");
  assert.throws(() => registry.joinRoom("NOSUCH", guest), /見つかりませんでした/);
});

test("joinRoom: 満席のルームはエラー", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest1 = fakeConn("guest1");
  const guest2 = fakeConn("guest2");
  const { code } = registry.createRoom(host);
  registry.joinRoom(code, guest1);
  assert.throws(() => registry.joinRoom(code, guest2), /満席/);
});

test("startGameIfReady: 両者が揃うとサーバーが対局を始め、各座席に自分向けの対局データを配る", () => {
  const registry = new RoomRegistry();
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  const { code } = registry.createRoom(host, "たろう", { dealerChoice: "opponent" });
  registry.startGameIfReady(code); // 相手がまだ居ない → 始まらない
  assert.equal(registry.rooms.get(code).session, null);
  registry.joinRoom(code, guest);
  registry.startGameIfReady(code);
  const session = registry.rooms.get(code).session;
  assert.ok(session);
  assert.equal(session.state.startingDealer, "south");
  const hv = host.received.at(-1);
  const gv = guest.received.at(-1);
  assert.equal(hv.type, "game");
  assert.ok(hv.payload.state.players.south.hand.every((t) => t.kind === null));
  assert.ok(gv.payload.state.players.east.hand.every((t) => t.kind === null));
  registry.startGameIfReady(code); // 2回目は何もしない
  assert.equal(registry.rooms.get(code).session, session);
  registry.leaveRoom(host);
  assert.equal(session.destroyed, true);
});

test("applyAction: ルームに属していない・対局前の操作は action-rejected", () => {
  const registry = new RoomRegistry();
  const stray = fakeConn("stray");
  assert.equal(registry.applyAction(stray, { type: "pass" }), false);
  assert.equal(stray.received.at(-1).type, "action-rejected");
  const host = fakeConn("host");
  registry.createRoom(host);
  assert.equal(registry.applyAction(host, { type: "pass" }), false);
  assert.equal(host.received.at(-1).type, "action-rejected");
});

test("handleDisconnect: 部屋に属していないconnに対しては何もしない(例外を投げない)", () => {
  const registry = new RoomRegistry();
  const stray = fakeConn("stray");
  assert.doesNotThrow(() => registry.handleDisconnect(stray));
});

test("2つのルームが互いに影響しないこと", () => {
  const registry = new RoomRegistry();
  const hostA = fakeConn("hostA");
  const guestA = fakeConn("guestA");
  const hostB = fakeConn("hostB");
  const guestB = fakeConn("guestB");

  const { code: codeA } = registry.createRoom(hostA);
  const { code: codeB } = registry.createRoom(hostB);
  assert.notEqual(codeA, codeB);

  registry.joinRoom(codeA, guestA);
  registry.joinRoom(codeB, guestB);

  registry.startGameIfReady(codeA);
  assert.equal(guestA.received.at(-1).type, "game");
  assert.equal(guestB.received.length, 0);
  assert.equal(registry.rooms.get(codeB).session, null);
});

// ---------------- 再接続 ----------------

/** 猶予タイマーを手動で進められるレジストリ */
function manualTimerRegistry() {
  const timers = new Set();
  const registry = new RoomRegistry({
    graceMs: 1000,
    setTimer: (fn) => {
      const t = { fn };
      timers.add(t);
      return t;
    },
    clearTimer: (t) => timers.delete(t),
  });
  const expireAll = () => {
    for (const t of [...timers]) {
      timers.delete(t);
      t.fn();
    }
  };
  return { registry, timers, expireAll };
}

function setupFullRoom(registry) {
  const host = fakeConn("host");
  const guest = fakeConn("guest");
  const { code, token: hostToken } = registry.createRoom(host, "たろう");
  const { token: guestToken } = registry.joinRoom(code, guest, "じろう");
  return { host, guest, code, hostToken, guestToken };
}

test("createRoom/joinRoom: 座席ごとに異なる再接続トークンが発行される", () => {
  const { registry } = manualTimerRegistry();
  const { hostToken, guestToken } = setupFullRoom(registry);
  assert.equal(typeof hostToken, "string");
  assert.ok(hostToken.length >= 16);
  assert.notEqual(hostToken, guestToken);
});

test("handleDisconnect: すぐにはルームを破棄せず、相手に peer-offline を通知して座席を予約する", () => {
  const { registry, timers } = manualTimerRegistry();
  const { host, guest, code } = setupFullRoom(registry);
  registry.handleDisconnect(host);
  assert.deepEqual(guest.received.at(-1), { type: "peer-offline" });
  assert.equal(registry.roomCount(), 1);
  assert.equal(registry.isFull(code), true, "切断中の座席も予約されたまま");
  assert.equal(registry.isBothConnected(code), false);
  assert.equal(timers.size, 1);
  // 予約中の座席に、別の人が join で割り込むことはできない
  assert.throws(() => registry.joinRoom(code, fakeConn("intruder")), /満席/);
});

test("rejoinRoom: 正しいトークンなら同じ座席に戻り、最新の対局データを受け取れる。相手には peer-online", () => {
  const { registry, timers } = manualTimerRegistry();
  const { host, guest, code, guestToken } = setupFullRoom(registry);
  registry.handleDisconnect(guest);
  assert.equal(registry.rejoinRoom(code, guestToken, fakeConn("g-before")).lastGame, null); // 対局前は null
  registry.handleDisconnect(registry.rooms.get(code).conns.south);
  registry.startGameIfReady(code); // 相手の切断中でも対局はサーバーにある
  const version = registry.rooms.get(code).session.version;

  const guest2 = fakeConn("guest2");
  const result = registry.rejoinRoom(code, guestToken, guest2);
  assert.equal(result.seat, "south");
  // 最新の、自分(south)向けの対局データ
  assert.equal(result.lastGame.version, version);
  assert.ok(result.lastGame.state.players.east.hand.every((t) => t.kind === null));
  assert.deepEqual(result.names, { east: "たろう", south: "じろう" });
  assert.equal(result.peerConnected, true);
  assert.deepEqual(host.received.at(-1), { type: "peer-online" });
  assert.equal(registry.rooms.get(code).graceTimers.south, null, "猶予タイマーは解除される");
  // 戻った後は、この接続に対局データが配られる
  registry.applyAction(host, { type: "pass" }); // east の手番でなくても、配り直しは本人にだけ
  registry._broadcastGame(code);
  assert.equal(guest2.received.at(-1).type, "game");
});

test("rejoinRoom: トークン違い・存在しないルームはエラー", () => {
  const { registry } = manualTimerRegistry();
  const { guest, code } = setupFullRoom(registry);
  registry.handleDisconnect(guest);
  assert.throws(() => registry.rejoinRoom(code, "wrong-token", fakeConn("x")), /一致しません/);
  assert.throws(() => registry.rejoinRoom("NOSUCH", "t", fakeConn("x")), /見つかりませんでした/);
});

test("rejoinRoom: サーバーが古い接続の切断にまだ気付いていなくても、新しい接続に差し替わる", () => {
  const { registry } = manualTimerRegistry();
  const { host, guest, code, guestToken } = setupFullRoom(registry);
  let closed = false;
  guest.close = () => {
    closed = true;
  };
  const guest2 = fakeConn("guest2");
  registry.rejoinRoom(code, guestToken, guest2);
  assert.equal(closed, true, "古い接続は閉じられる");
  assert.equal(registry.peerOf(host), guest2);
  // 古い接続の close イベントが後から届いても、新しい接続には影響しない
  registry.handleDisconnect(guest);
  assert.equal(registry.peerOf(host), guest2);
  assert.equal(host.received.filter((m) => m.type === "peer-offline").length, 0);
});

test("猶予時間内に戻らなければ、相手に peer-left を通知してルームを破棄する", () => {
  const { registry, expireAll } = manualTimerRegistry();
  const { host, guest, code, hostToken } = setupFullRoom(registry);
  registry.handleDisconnect(host);
  expireAll();
  assert.deepEqual(guest.received.at(-1), { type: "peer-left", reason: "timeout" });
  assert.equal(registry.roomCount(), 0);
  assert.throws(() => registry.rejoinRoom(code, hostToken, fakeConn("late")), /見つかりませんでした/);
});

test("leaveRoom: 自分から退出した場合は予約を残さず、相手に peer-left を通知してすぐ破棄する", () => {
  const { registry, timers } = manualTimerRegistry();
  const { host, guest } = setupFullRoom(registry);
  registry.leaveRoom(host);
  assert.deepEqual(guest.received.at(-1), { type: "peer-left", reason: "left" });
  assert.equal(registry.roomCount(), 0);
  assert.equal(timers.size, 0);
  // 退出後の close イベントは何もしない
  assert.doesNotThrow(() => registry.handleDisconnect(host));
});

test("相手の切断中に退室した場合、相手が後から rejoin すると「対戦相手が退室しました」(reason: peer-left)", () => {
  const { registry, expireAll } = manualTimerRegistry();
  const { host, guest, code, hostToken, guestToken } = setupFullRoom(registry);
  registry.handleDisconnect(guest); // guest が回線切れ
  registry.leaveRoom(host); // その間に host が退室
  assert.equal(registry.roomCount(), 0);
  let err = null;
  try {
    registry.rejoinRoom(code, guestToken, fakeConn("guest2"));
  } catch (e) {
    err = e;
  }
  assert.ok(err);
  assert.equal(err.reason, "peer-left");
  assert.match(err.message, /対戦相手が退室しました/);
  // 退室した本人のトークンや、無関係なトークンでは通常の「見つからない」
  assert.throws(() => registry.rejoinRoom(code, hostToken, fakeConn("x")), /見つかりませんでした/);
  assert.throws(() => registry.rejoinRoom(code, "other", fakeConn("x")), /見つかりませんでした/);
  // 猶予時間が過ぎれば記録も消える
  expireAll();
  assert.throws(() => registry.rejoinRoom(code, guestToken, fakeConn("x")), /見つかりませんでした/);
  void host;
});
