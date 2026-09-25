"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameSession } = require("./gameSession");
const E = require("./mahjong-engine");

/** タイマーを手動で進めるための偽物 */
function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  return {
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    /** 待ち時間が ms 以下のタイマーをすべて動かす */
    runUpTo(ms) {
      for (const [id, t] of [...timers]) {
        if (t.ms <= ms && timers.has(id)) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    count() {
      return timers.size;
    },
  };
}

function newSession(extra = {}) {
  const timers = fakeTimers();
  const session = new GameSession(Object.assign({ setTimer: timers.setTimer, clearTimer: timers.clearTimer }, extra));
  session.start();
  timers.runUpTo(3000); // 配牌の演出の待ち
  return { session, timers };
}

function pick(list, rnd) {
  return list[Math.floor(rnd() * list.length)];
}

/** 簡単な乱数(再現できるよう種を固定) */
function seeded(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

/** 合法手の中からランダムに1つ選んで適用する */
function playRandomStep(session, rnd) {
  const s = session.state;
  if (s.phase === "round_end") {
    session.apply("east", { type: "confirm" });
    session.apply("south", { type: "confirm" });
    return;
  }
  const d = session.pendingDecision();
  if (!d) return;
  if (d.kind === "call") {
    const o = session.callOptions(d.seat);
    const choices = ["pass"];
    if (o.canRon) choices.push("ron", "ron", "ron");
    if (o.canPon) choices.push("pon");
    if (o.canMinkan) choices.push("minkan");
    session.apply(d.seat, { type: pick(choices, rnd) });
    return;
  }
  const player = s.players[d.seat];
  const opts = session.drawOptions(d.seat);
  if (opts.canTsumo && rnd() < 0.8) return session.apply(d.seat, { type: "tsumo" });
  if (opts.ankanKinds.length && rnd() < 0.5) return session.apply(d.seat, { type: "ankan", kind: opts.ankanKinds[0] });
  if (opts.kakanKinds.length && rnd() < 0.5) return session.apply(d.seat, { type: "kakan", kind: opts.kakanKinds[0] });
  if (opts.riichiDiscardOptions.length && rnd() < 0.5) {
    return session.apply(d.seat, { type: "discard", tileId: pick(opts.riichiDiscardOptions, rnd).id, riichi: true });
  }
  let candidates = session.handWithDraw(d.seat);
  if (player.isRiichi) candidates = [player.drawnTile];
  if (player.forbiddenDiscardKind) {
    const key = E.tileKindKey(player.forbiddenDiscardKind);
    candidates = candidates.filter((t) => E.tileKindKey(t.kind) !== key);
  }
  session.apply(d.seat, { type: "discard", tileId: pick(candidates, rnd).id, riichi: false });
}

/** 相手の手牌・牌山などの中身が、その家向けのデータに含まれていないか */
function assertNoLeak(session, seat) {
  const s = session.state;
  const view = session.viewFor(seat);
  const json = JSON.stringify(view);
  const inResult = s.phase === "round_end" || s.phase === "game_end";
  const opp = seat === "east" ? "south" : "east";
  const secretIds = s.wall.liveWall.map((t) => t.id).concat(s.wall.deadWallDraws.map((t) => t.id), s.wall.doraIndicatorTiles.map((t) => t.id));
  if (!inResult) {
    secretIds.push(...s.players[opp].hand.map((t) => t.id));
    if (s.players[opp].drawnTile) secretIds.push(s.players[opp].drawnTile.id);
  }
  if (!(inResult && session.revealUraDora)) secretIds.push(...s.wall.uraDoraIndicatorTiles.map((t) => t.id));
  for (const id of secretIds) {
    assert.ok(!json.includes(`"${id}"`), `伏せるべき牌 ${id} が ${seat} 向けのデータに含まれている(${s.phase})`);
  }
  assert.equal(view.state.players[seat].hand.length, s.players[seat].hand.length);
  if (!inResult) assert.ok(view.state.players[opp].hand.every((t) => t.kind === null));
}

test("ランダムな合法手で対局を最後まで進められ、伏せるべき情報がどちらの家にも渡らない", () => {
  for (let g = 0; g < 25; g++) {
    const rnd = seeded(1234 + g);
    const { session, timers } = newSession({ dealerChoice: g % 2 ? "opponent" : "self" });
    let steps = 0;
    while (session.state.phase !== "game_end" && steps < 5000) {
      playRandomStep(session, rnd);
      timers.runUpTo(3000); // 次の局の配牌の待ち
      assertNoLeak(session, "east");
      assertNoLeak(session, "south");
      steps++;
    }
    assert.equal(session.state.phase, "game_end", `対局 ${g} が終わらなかった`);
    session.destroy();
  }
});

test("合法でない操作は受け付けず、局面も変わらない", () => {
  const { session } = newSession();
  const s = session.state;
  const turn = s.currentTurn;
  const other = turn === "east" ? "south" : "east";
  const before = session.version;
  // 相手の手番に打牌
  assert.throws(() => session.apply(other, { type: "discard", tileId: s.players[other].hand[0].id }));
  // 手牌に無い牌(相手の牌)を打牌
  assert.throws(() => session.apply(turn, { type: "discard", tileId: s.players[other].hand[0].id }));
  assert.throws(() => session.apply(turn, { type: "discard", tileId: "number:man:1#9" }));
  // 和了していないのにツモ・ロン、鳴けないのにポン
  if (!session.drawOptions(turn).canTsumo) assert.throws(() => session.apply(turn, { type: "tsumo" }));
  assert.throws(() => session.apply(turn, { type: "ron" }));
  assert.throws(() => session.apply(turn, { type: "pon" }));
  // 聴牌していない打牌でのリーチ
  const riichiIds = new Set(session.drawOptions(turn).riichiDiscardOptions.map((t) => t.id));
  const notRiichi = session.handWithDraw(turn).find((t) => !riichiIds.has(t.id));
  if (notRiichi) assert.throws(() => session.apply(turn, { type: "discard", tileId: notRiichi.id, riichi: true }));
  // 持っていない牌の暗槓、形の壊れた操作
  assert.throws(() => session.apply(turn, { type: "ankan", kind: { kind: "honor", honor: "nothing" } }));
  assert.throws(() => session.apply(turn, { type: "ankan", kind: null }));
  assert.throws(() => session.apply(turn, { type: "unknown" }));
  assert.throws(() => session.apply("west", { type: "discard" }));
  assert.throws(() => session.apply(turn, { type: "confirm" }));
  assert.throws(() => session.apply(turn, { type: "rematch" }));
  assert.equal(session.version, before);
  // 正しい打牌は通る
  session.apply(turn, { type: "discard", tileId: s.players[turn].drawnTile.id });
  assert.ok(session.version > before);
  assert.equal(session.lastAction.tsumogiri, true);
  session.destroy();
});

test("起家の設定: self は east、opponent は south、random はどちらか", () => {
  assert.equal(newSession({ dealerChoice: "self" }).session.state.startingDealer, "east");
  assert.equal(newSession({ dealerChoice: "opponent" }).session.state.startingDealer, "south");
  assert.equal(newSession({ dealerChoice: "random", random: () => 0.9 }).session.state.startingDealer, "south");
  assert.equal(newSession({ dealerChoice: "random", random: () => 0.1 }).session.state.startingDealer, "east");
});

test("配牌の直後は、演出の時間が過ぎるまで最初のツモをしない", () => {
  const timers = fakeTimers();
  const session = new GameSession({ setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  session.start();
  assert.equal(session.state.phase, "draw");
  assert.equal(session.pendingDecision(), null);
  let updated = 0;
  session.onUpdate = () => updated++;
  timers.runUpTo(3000);
  assert.equal(session.state.phase, "discard");
  assert.ok(session.state.players[session.state.currentTurn].drawnTile);
  assert.equal(updated, 1);
});

test("操作が届かないまま持ち時間を大きく過ぎたら、サーバーがツモ切りで進める", () => {
  const { session, timers } = newSession({ timeControl: { perAction: 5, bank: 20 } });
  const turn = session.state.currentTurn;
  const drawn = session.state.players[turn].drawnTile;
  let updated = 0;
  session.onUpdate = () => updated++;
  timers.runUpTo(5000); // まだ(25秒 + 余裕)経っていない
  assert.equal(session.state.players[turn].drawnTile.id, drawn.id);
  timers.runUpTo(30000);
  assert.ok(updated >= 1);
  const discards = session.state.players[turn].discards;
  if (session.state.phase !== "round_end") assert.equal(discards[discards.length - 1].tile.id, drawn.id);
});

test("結果画面は両者の確認か、一定時間で次の局へ進む", () => {
  const { session, timers } = newSession();
  // 流局まで進める(ツモ切りだけ)
  let guard = 0;
  while (session.state.phase !== "round_end" && guard++ < 500) {
    const d = session.pendingDecision();
    if (!d) break;
    if (d.kind === "call") session.apply(d.seat, { type: "pass" });
    else session.apply(d.seat, { type: "discard", tileId: session.state.players[d.seat].drawnTile.id });
  }
  if (session.state.phase !== "round_end") return; // ツモ切りの和了はしないので通常は流局になる
  const serial = session.state.roundSerial;
  timers.runUpTo(18000);
  assert.ok(session.state.roundSerial > serial || session.state.phase === "game_end");
});

test("観戦者向けのデータは両者の手牌を見せるが、牌山は伏せる", () => {
  const { session } = newSession();
  const view = session.viewFor(null);
  assert.ok(view.state.players.east.hand.every((t) => t.kind !== null));
  assert.ok(view.state.players.south.hand.every((t) => t.kind !== null));
  assert.ok(view.state.wall.liveWall.every((t) => t.kind === null));
  assert.ok(view.state.wall.uraDoraIndicatorTiles.every((t) => t.kind === null));
});
