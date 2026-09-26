"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { GameSession } = require("./gameSession");
const E = require("./mahjong-engine");

/** 時計とタイマーの偽物。advance(ms) で時刻を進めると、期限の来たタイマーが順に動く */
function fakeTimers() {
  const timers = new Map();
  let nextId = 1;
  let time = 0;
  const api = {
    now: () => time,
    setTimer(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: time + ms, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    /** 時刻を ms 進め、その間に期限が来たタイマーを(途中で新しく張られたものも含めて)順に動かす */
    advance(ms) {
      const end = time + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        time = Math.max(time, next[1].at);
        next[1].fn();
      }
      time = end;
    },
    count() {
      return timers.size;
    },
  };
  // これまでのテストの書き方(runUpTo)も同じ意味で使えるようにしておく
  api.runUpTo = api.advance;
  return api;
}

function newSession(extra = {}) {
  const timers = fakeTimers();
  // 見送りのランダムな待ちは、専用のテスト以外では入れない(結果を決まったものにするため)
  const session = new GameSession(
    Object.assign({ setTimer: timers.setTimer, clearTimer: timers.clearTimer, now: timers.now, passDelayChance: 0 }, extra)
  );
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
  const session = new GameSession({ setTimer: timers.setTimer, clearTimer: timers.clearTimer, now: timers.now, passDelayChance: 0 });
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
    if (!d) {
      timers.advance(600); // 流局前の待ち(0.5秒)など
      if (!session.pendingDecision()) break;
      continue;
    }
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

test("牌山は渡した乱数(既定は暗号用の乱数)でシャッフルする", () => {
  let calls = 0;
  const { session } = newSession({
    secureRandom: () => {
      calls++;
      return 0.5;
    },
  });
  assert.ok(calls >= 79, "シャッフルに渡した乱数関数が使われる");
  // 同じ乱数なら同じ並び = 渡した乱数だけで決まっている(シード値は使っていない)
  const again = newSession({ secureRandom: () => 0.5 }).session;
  const ids = (x) => x.state.players.east.hand.map((t) => t.id).join();
  assert.equal(ids(session), ids(again));
  // 既定(暗号用の乱数)では対局ごとに違う牌山になる
  const a = newSession({}).session;
  const b = newSession({}).session;
  assert.notEqual(a.state.wall.liveWall.map((t) => t.id).join(), b.state.wall.liveWall.map((t) => t.id).join());
});

/** 相手が鳴けない牌を1枚探す */
function unCallableTile(session, turn) {
  const other = turn === "east" ? "south" : "east";
  return session.handWithDraw(turn).find((t) => {
    const key = E.tileKindKey(t.kind);
    return session.state.players[other].hand.filter((h) => E.tileKindKey(h.kind) === key).length < 2;
  });
}

test("鳴けない捨て牌でも、ときどき待ってから見送る(その間は誰の判断でもなく、見た目は鳴ける時と同じ)", () => {
  const { session, timers } = newSession({ passDelayChance: 1 });
  const turn = session.state.currentTurn;
  const other = turn === "east" ? "south" : "east";
  const cut = unCallableTile(session, turn);
  assert.ok(cut);
  session.apply(turn, { type: "discard", tileId: cut.id });
  if (session.state.phase === "call_window" && session.callOptions(other).canRon) return; // たまたまロンできる形は対象外
  // 待っている間は見送らず、局面は「相手の判断待ち」と同じ
  assert.equal(session.state.phase, "call_window");
  assert.equal(session.pendingDecision(), null);
  assert.equal(session.viewFor(turn).state.phase, "call_window");
  assert.throws(() => session.apply(other, { type: "pass" })); // 待ちの間は誰も操作できない
  timers.advance(250);
  assert.equal(session.state.phase, "call_window"); // 最短 0.3秒
  timers.advance(1600); // 最長 1.8秒
  // 待ち終わると見送って、相手のツモに進む
  assert.equal(session.state.phase, "discard");
  assert.equal(session.state.currentTurn, other);
});

test("見送りの待ちは毎回ではなく、既定では約1/7の確率で入る", () => {
  let delayed = 0;
  let counted = 0;
  for (let i = 0; i < 200; i++) {
    const { session } = newSession({ passDelayChance: undefined }); // 既定の確率(1/7)
    const turn = session.state.currentTurn;
    const other = turn === "east" ? "south" : "east";
    const cut = unCallableTile(session, turn);
    if (!cut) continue;
    session.apply(turn, { type: "discard", tileId: cut.id });
    if (session.state.phase === "call_window" && session.callOptions(other).canRon) continue;
    counted++;
    if (session.state.phase === "call_window") delayed++;
  }
  assert.ok(delayed > counted * 0.05 && delayed < counted * 0.25, `待ちが入った回数: ${delayed}/${counted}`);
});

test("持ち時間: サーバーも局ごとの残り時間を数え、切れたら打牌ごとの時間(+通信の余裕)で代わりに進める", () => {
  const { session, timers } = newSession({ timeControl: { perAction: 5, bank: 20 } });
  const seat = session.state.currentTurn;
  const other = seat === "east" ? "south" : "east";
  // 1回目: 15秒考える → 打牌ごと5秒 + 通信の余裕2秒 を超えた8秒が引かれ、局ごとの残りは 12秒
  timers.advance(15000);
  session.apply(seat, { type: "discard", tileId: unCallableTile(session, seat).id });
  assert.equal(session._bankMs[seat], 12000);
  // 相手の番をすぐ済ませる
  if (session.state.phase !== "discard" || session.state.currentTurn !== other) return; // 途中で局が終わった場合は対象外
  session.apply(other, { type: "discard", tileId: unCallableTile(session, other).id });
  if (session.state.phase !== "discard" || session.state.currentTurn !== seat) return;
  // 2回目: 5 + 12 + 2 = 19秒を過ぎると、サーバーが代わりにツモ切りする
  const drawn = session.state.players[seat].drawnTile;
  timers.advance(18900);
  assert.equal(session.state.players[seat].drawnTile.id, drawn.id);
  timers.advance(200);
  const discards = session.state.players[seat].discards;
  assert.equal(discards[discards.length - 1].tile.id, drawn.id);
  assert.equal(session._bankMs[seat], 0);
});

test("持ち時間: 打牌ごとの時間内(+通信の余裕)に操作すれば、局ごとの残り時間は減らない", () => {
  const { session, timers } = newSession({ timeControl: { perAction: 5, bank: 20 } });
  const seat = session.state.currentTurn;
  timers.advance(6500); // 5秒 + 余裕2秒 以内
  session.apply(seat, { type: "discard", tileId: session.state.players[seat].drawnTile.id });
  assert.equal(session._bankMs[seat], 20000);
});

test("持ち時間: 局が変わると局ごとの残り時間は満タンに戻る", () => {
  const { session, timers } = newSession({ timeControl: { perAction: 5, bank: 20 } });
  const seat = session.state.currentTurn;
  timers.advance(20000);
  session.apply(seat, { type: "discard", tileId: session.state.players[seat].drawnTile.id });
  assert.ok(session._bankMs[seat] < 20000);
  let guard = 0;
  while (session.state.phase !== "round_end" && guard++ < 500) {
    const d = session.pendingDecision();
    if (!d) {
      timers.advance(600); // 流局前の待ち(0.5秒)など
      if (!session.pendingDecision()) break;
      continue;
    }
    if (d.kind === "call") session.apply(d.seat, { type: "pass" });
    else session.apply(d.seat, { type: "discard", tileId: session.state.players[d.seat].drawnTile.id });
  }
  if (session.state.phase !== "round_end") return;
  session.apply("east", { type: "confirm" });
  session.apply("south", { type: "confirm" });
  timers.advance(3000); // 配牌の演出
  assert.deepEqual(session._bankMs, { east: 20000, south: 20000 });
});

test("見送りの待ちが入る設定(本番と同じ確率)でも、対局が最後まで進み、情報が漏れない", () => {
  for (let g = 0; g < 8; g++) {
    const rnd = seeded(777 + g);
    const { session, timers } = newSession({ passDelayChance: undefined }); // 既定の確率(1/7)
    let steps = 0;
    while (session.state.phase !== "game_end" && steps < 8000) {
      playRandomStep(session, rnd);
      timers.advance(3000); // 配牌の演出・見送りの待ち(最長1.8秒)
      assertNoLeak(session, "east");
      assertNoLeak(session, "south");
      steps++;
    }
    assert.equal(session.state.phase, "game_end", `対局 ${g} が終わらなかった`);
    session.destroy();
  }
});

test("流局は最後の打牌から0.5秒待ってから(その間は局面が進まない)", () => {
  const { session, timers } = newSession();
  let guard = 0;
  while (session.state.wall.liveWall.length > 0 || session.state.phase !== "draw") {
    if (guard++ > 500 || session.state.phase === "round_end") break;
    const d = session.pendingDecision();
    if (!d) {
      timers.advance(100);
      continue;
    }
    if (d.kind === "call") session.apply(d.seat, { type: "pass" });
    else session.apply(d.seat, { type: "discard", tileId: session.state.players[d.seat].drawnTile.id });
  }
  if (session.state.phase !== "draw") return; // 途中で和了した場合は対象外
  assert.equal(session.state.wall.liveWall.length, 0);
  timers.advance(400);
  assert.equal(session.state.phase, "draw"); // まだ流局にしない
  timers.advance(200);
  assert.equal(session.state.phase, "round_end");
  assert.equal(session.state.roundEndReason.type, "exhaustive_draw");
});
