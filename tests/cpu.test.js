const test = require("node:test");
const assert = require("node:assert");
const { engine, man, pin, sou, honor, gameState } = require("./helpers");

const cpu = engine.cpu;

function withHand(seat, hand, drawnTile, extra = {}) {
  const state = gameState({ phase: "discard", currentTurn: seat });
  state.players[seat] = { ...state.players[seat], hand, drawnTile, ...extra };
  return state;
}

test("CPU: 繋がった萬子よりも孤立した字牌を切る", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), honor("north"), sou(9), sou(9)];
  const state = withHand("south", hand, honor("west"));
  const action = cpu.decideTurnAction(state, "south");
  assert.strictEqual(action.type, "discard");
  assert.strictEqual(action.tile.kind.kind, "honor");
});

test("CPU: 孤立した字牌を切る(ツモが繋がる萬子の場合)", () => {
  const hand = [man(2), man(3), man(6), man(7), pin(1), pin(1), pin(9), pin(9), honor("east"), honor("east"), honor("east"), honor("red"), sou(1)];
  const state = withHand("south", hand, man(4));
  const action = cpu.decideTurnAction(state, "south");
  assert.strictEqual(action.type, "discard");
  assert.notStrictEqual(action.tile.kind.suit, "man");
});

test("CPU: ツモ和了できるならツモする", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), honor("white"), honor("white"), honor("white"), pin(1)];
  const state = withHand("south", hand, pin(1));
  assert.deepStrictEqual(cpu.decideTurnAction(state, "south"), { type: "tsumo" });
});

test("CPU: ロンできるならロンする", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), honor("white"), honor("white"), honor("white"), pin(1)];
  const discard = pin(1);
  const state = gameState({ phase: "call_window", currentTurn: "east", lastDiscard: { tile: discard, from: "east", isRiichiDeclaration: false } });
  state.players.south = { ...state.players.south, hand };
  state.players.east = { ...state.players.east, discards: [{ tile: discard, isRiichiDeclaration: false, isCalled: false }] };
  assert.strictEqual(cpu.decideCall(state, "south"), "ron");
});

test("CPU: リーチ中はツモ切りする", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), pin(9), pin(9), sou(1)];
  const drawn = honor("north");
  const state = withHand("south", hand, drawn, { isRiichi: true });
  const action = cpu.decideTurnAction(state, "south");
  assert.strictEqual(action.type, "discard");
  assert.strictEqual(action.tile.id, drawn.id);
  assert.strictEqual(action.declareRiichi, false);
});

test("CPU: 門前で聴牌になる打牌ならリーチする", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), pin(9), pin(9), honor("red")];
  const state = withHand("south", hand, man(9));
  const action = cpu.decideTurnAction(state, "south");
  assert.strictEqual(action.type, "discard");
  assert.strictEqual(action.tile.kind.honor, "red");
  assert.strictEqual(action.declareRiichi, true);
});

test("CPU: 喰い替え禁止の牌は切らない", () => {
  const hand = [honor("white"), man(2), man(3), man(4), man(5), man(6), man(7), pin(1), pin(1), sou(9), sou(9)];
  const state = withHand("south", hand, null, {
    forbiddenDiscardKind: { kind: "honor", honor: "white" },
    melds: [{ type: "triplet", tiles: [honor("white"), honor("white"), honor("white")], isOpen: true }],
  });
  const action = cpu.decideTurnAction(state, "south");
  assert.strictEqual(action.type, "discard");
  assert.notStrictEqual(action.tile.kind.honor, "white");
});

test("CPU: 役牌の対子はポンし、役牌でなければ見送る", () => {
  const mk = (tile) => {
    const state = gameState({ phase: "call_window", currentTurn: "east", lastDiscard: { tile, from: "east", isRiichiDeclaration: false } });
    state.players.south = {
      ...state.players.south,
      hand: [honor("red"), honor("red"), honor("north"), honor("north"), man(1), man(4), man(7), pin(1), pin(9), sou(1), sou(9), man(2), man(9)],
    };
    return state;
  };
  assert.strictEqual(cpu.decideCall(mk(honor("red")), "south"), "pon");
  // 北は場風(東)でも自風(南)でもない
  assert.strictEqual(cpu.decideCall(mk(honor("north")), "south"), "pass");
});

// ---------------- 守備(押し引き・ベタオリ) ----------------

const disc = (tile) => ({ tile, isCalled: false, isRiichiDeclaration: false });

test("守備: 相手の現物は危険度0、筋の萬子は無筋より危険度が低い", () => {
  const state = gameState({ phase: "discard", currentTurn: "south" });
  state.players.east = { ...state.players.east, isRiichi: true, discards: [disc(man(2)), disc(man(8)), disc(honor("north"))] };
  const visible = cpu.visibleCounts(state, "south");
  assert.strictEqual(engine.defense.tileDanger(state, "south", honor("north").kind, visible), 0);
  const suji5 = engine.defense.tileDanger(state, "south", man(5).kind, visible); // 2・8 が現物(両筋)
  const musuji4 = engine.defense.tileDanger(state, "south", man(4).kind, visible); // 1・7 は通っていない
  assert.ok(suji5 < musuji4, `筋の5萬(${suji5})が無筋の4萬(${musuji4})より危険と判定された`);
});

test("守備: 相手のリーチに対し、手が遠ければ現物を切って降りる(守備なしのCPUは攻める)", () => {
  const hand = [man(1), man(2), man(4), man(7), man(9), pin(1), sou(1), sou(9), honor("white"), honor("green"), honor("red"), honor("north"), honor("east")];
  const state = withHand("south", hand, man(8));
  state.players.east = { ...state.players.east, isRiichi: true, discards: [disc(man(4)), disc(pin(9))] };
  const defended = cpu.decideTurnAction(state, "south", engine.defense.DEFENSE_PROFILES.balanced);
  assert.strictEqual(defended.type, "discard");
  assert.deepStrictEqual(defended.tile.kind, man(4).kind, "現物の4萬を切っていない");
  assert.strictEqual(defended.declareRiichi, false);
  const plain = cpu.decideTurnAction(state, "south");
  assert.notDeepStrictEqual(plain.tile.kind, man(4).kind, "守備なしのCPUの動きが変わっている");
});

test("守備: 相手がリーチしていなければ普段通り手を進める", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), honor("north"), sou(9), sou(9)];
  const state = withHand("south", hand, honor("west"));
  const a = cpu.decideTurnAction(state, "south", engine.defense.DEFENSE_PROFILES.balanced);
  const b = cpu.decideTurnAction(state, "south");
  assert.deepStrictEqual(a.tile.kind, b.tile.kind);
});

test("守備: 聴牌で待ちが十分なら、リーチを受けても押す(聴牌を崩さない)", () => {
  // 1-4萬待ち(両面)の聴牌。ツモった9筒は危険だが、聴牌を保つ牌を切る
  const hand = [man(2), man(3), man(5), man(6), man(7), honor("white"), honor("white"), honor("white"), honor("east"), honor("east"), honor("east"), pin(1), pin(1)];
  const state = withHand("south", hand, sou(9));
  state.players.east = { ...state.players.east, isRiichi: true, discards: [disc(honor("north"))] };
  const a = cpu.decideTurnAction(state, "south", engine.defense.DEFENSE_PROFILES.balanced);
  assert.strictEqual(a.type, "discard");
  assert.deepStrictEqual(a.tile.kind, sou(9).kind);
});

test("守備: 相手のフリテン(見逃し)はCPUには分からないので、それだけでは安全とみなさない", () => {
  const state = gameState({ phase: "discard", currentTurn: "south" });
  state.players.east = { ...state.players.east, isRiichi: true, isRiichiMissedFuriten: true, discards: [disc(honor("north"))] };
  const visible = cpu.visibleCounts(state, "south");
  assert.ok(engine.defense.tileDanger(state, "south", man(5).kind, visible) > 0);
});

test("守備: 相手のリーチ後に自分が切って通った牌は安全、リーチ前に切った牌は現物でなければ安全ではない", () => {
  const state = gameState({ phase: "discard", currentTurn: "south" });
  state.players.south = {
    ...state.players.south,
    discards: [{ ...disc(man(3)), seq: 1 }, { ...disc(man(6)), seq: 3 }],
  };
  state.players.east = {
    ...state.players.east,
    isRiichi: true,
    discards: [{ ...disc(honor("north")), seq: 0 }, { ...disc(pin(9)), seq: 2, isRiichiDeclaration: true }],
  };
  const visible = cpu.visibleCounts(state, "south");
  assert.strictEqual(engine.defense.tileDanger(state, "south", man(6).kind, visible), 0, "リーチ後に通った6萬");
  assert.ok(engine.defense.tileDanger(state, "south", man(3).kind, visible) > 0, "リーチ前に切った3萬");
});

test("打牌に通し番号(seq)が付く", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), pin(1), pin(1), pin(9), pin(9)];
  const state = withHand("south", hand, honor("west"));
  state.players.east = { ...state.players.east, discards: [{ ...disc(honor("north")), seq: 0 }] };
  const after = engine.actions.discardTile(state, state.players.south.drawnTile, false);
  assert.strictEqual(after.players.south.discards[0].seq, 1);
});

// ---------------- 打点評価 ----------------

const P = () => engine.defense.DEFENSE_PROFILES.balanced;

test("打点: 効率が同じなら、ドラの字牌を残して別の字牌を切る", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), sou(9), sou(9), honor("south")];
  const state = withHand("south", hand, honor("west"));
  state.wall = { ...state.wall, revealedDoraIndicators: [honor("east")] }; // ドラは南
  const a = cpu.decideTurnAction(state, "south", P());
  assert.strictEqual(a.type, "discard");
  assert.deepStrictEqual(a.tile.kind, honor("west").kind, "ドラの南を切った");
});

test("打点: 萬子と字牌が多い手では、孤立した筒子を先に切って混一色に向かう", () => {
  const hand = [man(1), man(2), man(3), man(5), man(6), man(7), man(8), man(9), honor("white"), honor("white"), honor("north"), pin(1), man(4)];
  const state = withHand("south", hand, honor("green"));
  const a = cpu.decideTurnAction(state, "south", P());
  assert.strictEqual(a.type, "discard");
  assert.deepStrictEqual(a.tile.kind, pin(1).kind, "筒子を残した");
  const plain = cpu.decideTurnAction(state, "south");
  assert.notDeepStrictEqual(plain.tile.kind, pin(1).kind, "通常CPUの動きが変わっている");
});

test("打点: 見積もりの内訳(役牌の刻子・ドラ)", () => {
  const state = gameState({ phase: "discard", currentTurn: "south" });
  state.wall = { ...state.wall, revealedDoraIndicators: [man(1)] }; // ドラは2萬
  const tiles = [honor("white"), honor("white"), honor("white"), man(2), man(2), man(3), man(4)];
  const counts = engine.shanten.toCounts(tiles);
  const b = engine.value.handValueBreakdown(state, "south", counts, []);
  assert.strictEqual(b.dora, 2);
  assert.strictEqual(b.yakuhai, 1);
});

// ---------------- 待ちの質 ----------------

test("待ち: フリテンになる両面より、フリテンでない嵌張を選ぶ(通常CPUは枚数の多い両面)", () => {
  const W = () => honor("white"), G = () => honor("green");
  const hand = [W(), W(), W(), G(), G(), G(), man(7), man(8), man(9), pin(9), pin(9), man(2), man(3)];
  const state = withHand("south", hand, man(5), { discards: [disc(man(1))] });
  const strong = cpu.decideTurnAction(state, "south", P());
  assert.strictEqual(strong.type, "discard");
  assert.deepStrictEqual(strong.tile.kind, man(2).kind, "フリテンの1-4萬待ちを選んだ");
  const plain = cpu.decideTurnAction(state, "south");
  assert.deepStrictEqual(plain.tile.kind, man(5).kind);
});

test("待ち: 残り枚数・フリテン・役なしの判定", () => {
  const state = gameState({ phase: "discard", currentTurn: "south" });
  const tiles = [honor("white"), honor("white"), honor("white"), honor("green"), honor("green"), honor("green"), man(7), man(8), man(9), pin(9), pin(9), man(2), man(3)];
  const counts = engine.shanten.toCounts(tiles);
  const visible = engine.shanten.toCounts(tiles);
  const w = engine.wait.evaluateWait(state, "south", counts, visible);
  assert.deepStrictEqual(w.kinds.sort(), ["number:man:1", "number:man:4"]);
  assert.strictEqual(w.remaining, 8);
  assert.strictEqual(w.furiten, false);
});

// ---------------- 鳴き判断の拡大 ----------------

function callState(hand, discardTile, extra = {}) {
  const state = gameState({ phase: "call_window", currentTurn: "east" });
  state.players.south = { ...state.players.south, hand, ...extra };
  state.players.east = { ...state.players.east, discards: [disc(discardTile)] };
  state.lastDiscard = { tile: discardTile, from: "east", isRiichiDeclaration: false };
  return state;
}

test("鳴き: 混一色に向かう手なら、役牌以外の萬子もポンする(通常CPUはしない)", () => {
  const hand = [man(2), man(2), man(3), man(4), man(5), man(5), man(6), man(7), man(8), man(8), honor("north"), honor("west"), man(6)];
  const state = callState(hand, man(2));
  assert.strictEqual(cpu.decideCall(state, "south", P()), "pon");
  assert.strictEqual(cpu.decideCall(state, "south"), "pass");
});

test("鳴き: 鳴いた後に役がつく見込みが無ければポンしない", () => {
  const hand = [man(2), man(2), man(4), man(6), man(8), pin(1), pin(9), sou(1), sou(9), honor("north"), honor("west"), man(5), man(7)];
  const state = callState(hand, man(2));
  assert.strictEqual(cpu.decideCall(state, "south", P()), "pass");
});

test("鳴き: 相手がリーチしていて手が遠ければ、役牌でもポンしない", () => {
  const hand = [honor("white"), honor("white"), man(1), man(4), man(7), pin(1), pin(9), sou(1), sou(9), honor("north"), honor("west"), man(9), honor("east")];
  const state = callState(hand, honor("white"));
  state.players.east = { ...state.players.east, isRiichi: true };
  assert.strictEqual(cpu.decideCall(state, "south", P()), "pass");
});

test("鳴き: 加槓しても手が悪くならなければ加槓する", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1)];
  const state = withHand("south", hand, honor("white"), {
    melds: [{ type: "triplet", tiles: [honor("white"), honor("white"), honor("white")], isOpen: true, calledFrom: "east" }],
  });
  const a = cpu.decideTurnAction(state, "south", P());
  assert.strictEqual(a.type, "kakan");
  assert.strictEqual(cpu.decideTurnAction(state, "south").type, "discard", "通常CPUは加槓しない");
});

// ---------------- 守備型・攻撃型・バランス型 ----------------

test("性格: 安い嵌張聴牌でリーチを受けたら、守備型は降り、バランス型・攻撃型は押す", () => {
  const W = () => honor("white"), G = () => honor("green");
  const hand = [W(), W(), W(), G(), G(), G(), man(7), man(8), man(9), pin(9), pin(9), man(2), man(4)];
  const state = withHand("south", hand, sou(9));
  state.players.east = { ...state.players.east, isRiichi: true, discards: [disc(pin(9)), disc(honor("north"))] };
  const profiles = engine.defense.DEFENSE_PROFILES;
  const d = cpu.decideTurnAction(state, "south", profiles.defensive);
  assert.deepStrictEqual(d.tile.kind, pin(9).kind, "守備型が現物を切っていない");
  for (const name of ["balanced", "offensive"]) {
    const a = cpu.decideTurnAction(state, "south", profiles[name]);
    assert.deepStrictEqual(a.tile.kind, sou(9).kind, `${name} が聴牌を崩した`);
  }
});

test("性格: 守備型は役牌以外のポンをしない", () => {
  const hand = [man(2), man(2), man(3), man(4), man(5), man(5), man(6), man(7), man(8), man(8), honor("north"), honor("west"), man(6)];
  const state = callState(hand, man(2));
  const profiles = engine.defense.DEFENSE_PROFILES;
  assert.strictEqual(cpu.decideCall(state, "south", profiles.defensive), "pass");
  assert.strictEqual(cpu.decideCall(state, "south", profiles.offensive), "pon");
});

// ---------------- ポンコツ型 ----------------

test("ポンコツ型: 和了できる場合は乱数によらず必ず和了し、それ以外は乱数しだいで適当な打牌・無駄なポンをする", () => {
  const always = () => 0; // すべての「失敗」が起きる
  const never = () => 0.99; // 何も失敗しない
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), honor("white"), honor("white"), honor("white"), pin(1)];
  const winState = withHand("south", hand, pin(1));
  assert.deepStrictEqual(cpu.decideTurnActionWeak(winState, "south", never), { type: "tsumo" });
  assert.deepStrictEqual(cpu.decideTurnActionWeak(winState, "south", always), { type: "tsumo" }, "和了できるなら見逃さない");

  const ponHand = [man(2), man(2), man(4), man(6), man(8), pin(1), pin(9), sou(1), sou(9), honor("north"), honor("west"), man(5), man(7)];
  const ponState = callState(ponHand, man(2));
  assert.strictEqual(cpu.decideCallWeak(ponState, "south", always), "pon");
  assert.strictEqual(cpu.decideCallWeak(ponState, "south", never), "pass");
});

test("ポンコツ型: ロンできる場合も乱数によらず必ずロンする", () => {
  const always = () => 0; // すべての「失敗」が起きる
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), honor("white"), honor("white"), honor("white"), pin(1)];
  const state = callState(hand, pin(1));
  assert.strictEqual(cpu.decideCallWeak(state, "south", always), "ron", "和了できるなら見逃さない");
});
