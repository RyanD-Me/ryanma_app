const test = require("node:test");
const assert = require("node:assert");
const { engine, man, pin, sou, honor, gameState } = require("./helpers");

const actions = engine.actions;
const { determineDealerContinuation, advanceRound } = engine.roundTransition;

test("親であるプレイヤーが東家、相手が南家になる", () => {
  const state = gameState({ dealer: "east" });
  assert.strictEqual(actions.seatWindOf(state, "east"), "east");
  assert.strictEqual(actions.seatWindOf(state, "south"), "south");

  // 親が交代すると自風も入れ替わる
  const flipped = { ...state, dealer: "south" };
  assert.strictEqual(actions.seatWindOf(flipped, "south"), "east");
  assert.strictEqual(actions.seatWindOf(flipped, "east"), "south");
});

test("リーチ後はツモ切りのみ可能で、手出しは拒否される", () => {
  const drawn = man(9);
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.players.east = {
    ...state.players.east,
    isRiichi: true,
    hand: [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), pin(9), pin(9), sou(1)],
    drawnTile: drawn,
  };

  // ツモ切りは通る
  assert.doesNotThrow(() => actions.discardTile(state, drawn, false));

  // 手牌からの打牌は弾かれる
  assert.throws(() => actions.discardTile(state, state.players.east.hand[0], false), /リーチ後は手出しできません/);
});

test("リーチしていなければ手出しできる", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.players.east = {
    ...state.players.east,
    hand: [man(1), man(2), man(3)],
    drawnTile: pin(9),
  };
  assert.doesNotThrow(() => actions.discardTile(state, state.players.east.hand[0], false));
});

test("流局時、片方だけ聴牌ならノーテン罰符5000点が動く", () => {
  const state = gameState();
  // 東家は七対子の単騎待ち(聴牌)
  state.players.east = {
    ...state.players.east,
    hand: [
      man(2), man(2), man(4), man(4), man(6), man(6),
      pin(1), pin(1), pin(9), pin(9),
      honor("east"), honor("east"), honor("white"),
    ],
  };
  // 南家はバラバラ(ノーテン)
  state.players.south = {
    ...state.players.south,
    hand: [
      man(2), man(5), man(8), pin(1), sou(1),
      honor("east"), honor("south"), honor("west"), honor("north"),
      honor("white"), honor("green"), honor("red"), man(3),
    ],
  };
  state.wall = { ...state.wall, liveWall: [] };

  const outcome = actions.resolveExhaustiveDraw(state);
  assert.deepStrictEqual(outcome.tenpaiSeats, ["east"]);
  assert.strictEqual(outcome.state.players.east.score, 50000);
  assert.strictEqual(outcome.state.players.south.score, 40000);
});

test("加槓: ポンした明刻に4枚目を加えて槓子にし、嶺上牌を引く", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  // 東家: 5萬をポン済みで、4枚目の5萬を持ってきて加槓する
  state.players.east = {
    ...state.players.east,
    hand: [man(1), man(2), man(3), man(7), man(8), man(9), pin(1), pin(1), honor("east"), honor("south")],
    melds: [{ type: "triplet", tiles: [man(5), man(5), man(5)], isOpen: true, calledFrom: "opponent" }],
    drawnTile: man(5),
  };

  const after = actions.performKakan(state, { kind: "number", suit: "man", rank: 5 });
  assert.strictEqual(after.players.east.melds[0].type, "kan_open");
  assert.strictEqual(after.players.east.melds[0].tiles.length, 4);
  assert.strictEqual(after.players.east.hand.length, 10);
  assert.strictEqual(after.kanCount, 1);
  assert.strictEqual(after.phase, "kan_replacement");
  assert.ok(after.players.east.drawnTile, "嶺上牌を引いていない");
});

test("カンのたびに表ドラと裏ドラが1枚ずつ増える", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.wall = engine.wallGenerator.revealNextDoraIndicator(state.wall);
  state.players.east = {
    ...state.players.east,
    hand: [man(3), man(3), man(3), man(3), man(5), man(6), man(7), pin(1), pin(1), man(1)],
    drawnTile: man(9),
  };

  assert.strictEqual(state.wall.revealedDoraIndicators.length, 1);
  assert.strictEqual(engine.wall.activeUraDoraIndicators(state.wall).length, 1);

  const afterKan = actions.performAnkan(state, { kind: "number", suit: "man", rank: 3 });
  assert.strictEqual(afterKan.wall.revealedDoraIndicators.length, 2);
  assert.strictEqual(engine.wall.activeUraDoraIndicators(afterKan.wall).length, 2);
});

test("親が和了すれば連荘、子が和了すれば親交代して次の局へ進む", () => {
  const dealerWin = gameState({ roundEndReason: { type: "ron", winner: "east", loser: "south" } });
  assert.strictEqual(determineDealerContinuation(dealerWin), true);
  const continued = advanceRound(dealerWin, true, 2);
  assert.strictEqual(continued.dealer, "east");
  assert.strictEqual(continued.roundWind, "east");
  assert.strictEqual(continued.roundNumber, 1);

  const childWin = gameState({ roundEndReason: { type: "tsumo", winner: "south" } });
  assert.strictEqual(determineDealerContinuation(childWin), false);
  const advanced = advanceRound(childWin, false, 3);
  assert.strictEqual(advanced.dealer, "south");
  assert.strictEqual(advanced.roundNumber, 2);
});

test("次の局の配牌は、親(その局の東家)から4枚・4枚・4枚・1枚の順に配る", () => {
  const { buildWall, revealNextDoraIndicator } = engine.wallGenerator;
  for (const [winner, expectedDealer] of [["south", "south"], ["east", "east"]]) {
    const prev = gameState({ roundEndReason: { type: "tsumo", winner } });
    const continues = determineDealerContinuation(prev);
    const seed = 777;
    const next = advanceRound(prev, continues, seed);
    assert.strictEqual(next.dealer, expectedDealer);
    const live = revealNextDoraIndicator(buildWall(seed).wall).liveWall.map((t) => t.id);
    const other = expectedDealer === "east" ? "south" : "east";
    const dealerHand = next.players[expectedDealer].hand.map((t) => t.id);
    const otherHand = next.players[other].hand.map((t) => t.id);
    assert.deepStrictEqual(dealerHand, [...live.slice(0, 4), ...live.slice(8, 12), ...live.slice(16, 20), live[24]]);
    assert.deepStrictEqual(otherHand, [...live.slice(4, 8), ...live.slice(12, 16), ...live.slice(20, 24), live[25]]);
  }
});

test("北2局(8局目)を終えると対局終了し、供託は起家が受け取る", () => {
  const state = gameState({
    roundWind: "north",
    roundNumber: 2,
    overallRoundIndex: 8,
    dealer: "south",
    riichiSticks: 2,
    roundEndReason: { type: "ron", winner: "east", loser: "south" },
  });

  const ended = advanceRound(state, false, 4);
  assert.strictEqual(ended.phase, "game_end");
  assert.deepStrictEqual(ended.gameEndReason, {
    type: "all_rounds_complete",
    riichiBonus: { seat: "east", points: 2000 },
  });
  assert.strictEqual(ended.players.east.score, 47000, "起家が供託2000点を受け取っていない");
  assert.strictEqual(ended.riichiSticks, 0);
});

test("持ち点がマイナスになった時点で対局終了(トビ)", () => {
  const state = gameState({ roundEndReason: { type: "tsumo", winner: "east" } });
  state.players.south = { ...state.players.south, score: -1000 };

  const ended = advanceRound(state, false, 5);
  assert.strictEqual(ended.phase, "game_end");
  assert.deepStrictEqual(ended.gameEndReason, { type: "bust", bustedPlayer: "south" });
});

test("トビ終了時に残っていた供託は、トばなかった側(勝者)が受け取る", () => {
  // 流局のノーテン罰符で南家がトんだ(東家のリーチ棒1本・南家のリーチ棒1本が供託に残っている)
  const state = gameState({ riichiSticks: 2, roundEndReason: { type: "exhaustive_draw" } });
  state.players.east = { ...state.players.east, score: 60000 };
  state.players.south = { ...state.players.south, score: -500 };

  const ended = advanceRound(state, false, 6);
  assert.strictEqual(ended.phase, "game_end");
  assert.deepStrictEqual(ended.gameEndReason, {
    type: "bust",
    bustedPlayer: "south",
    riichiBonus: { seat: "east", points: 2000 },
  });
  assert.strictEqual(ended.players.east.score, 62000, "勝者が供託2000点を受け取っていない");
  assert.strictEqual(ended.players.south.score, -500);
  assert.strictEqual(ended.riichiSticks, 0);
});

test("喰い替え禁止: ポンした牌と同じ牌は、そのまま打牌できない", () => {
  const ponnedTile = man(3);
  const state = gameState({ phase: "call_window", currentTurn: "south" });
  state.lastDiscard = { tile: ponnedTile, from: "south" };
  state.players.east = {
    ...state.players.east,
    // 3萬を3枚持っておき、2枚をポンに使っても手牌にもう1枚残る形にする
    hand: [man(3), man(3), man(3), man(5), man(6), man(7), pin(1), pin(1), pin(9), pin(9), sou(1), sou(9), sou(9)],
  };

  const afterPon = actions.callPon(state, "east", [state.players.east.hand[0], state.players.east.hand[1]]);
  assert.strictEqual(afterPon.phase, "discard");
  assert.deepStrictEqual(afterPon.players.east.forbiddenDiscardKind, ponnedTile.kind);

  // ポンした牌(3萬)と同じ種類は打牌できない
  const sameTile = afterPon.players.east.hand.find((t) => t.kind.suit === "man" && t.kind.rank === 3);
  assert.ok(sameTile, "手牌にまだ3萬が残っていない(テスト前提が崩れている)");
  assert.throws(() => actions.discardTile(afterPon, sameTile, false), /喰い替え/);

  // それ以外の牌は通常通り打牌できる
  const otherTile = afterPon.players.east.hand.find((t) => !(t.kind.suit === "man" && t.kind.rank === 3));
  const afterDiscard = actions.discardTile(afterPon, otherTile, false);
  assert.strictEqual(afterDiscard.players.east.forbiddenDiscardKind, null, "打牌後は喰い替え制限が解除されるべき");
});

test("ポンの後は、打牌するまでカンが禁止される(暗槓・加槓とも)", () => {
  const ponnedTile = man(3);
  const state = gameState({ phase: "call_window", currentTurn: "south" });
  state.lastDiscard = { tile: ponnedTile, from: "south" };
  state.players.east = {
    ...state.players.east,
    // 5萬を4枚(暗槓可能)、7萬を3枚(すでにポン済み想定→加槓可能)持たせる
    hand: [man(3), man(3), man(5), man(5), man(5), man(5), man(6), pin(1), pin(1), pin(9), pin(9), sou(1), sou(9)],
    melds: [{ type: "triplet", tiles: [man(7), man(7), man(7)], isOpen: true, calledFrom: "opponent" }],
  };

  const afterPon = actions.callPon(state, "east", [state.players.east.hand[0], state.players.east.hand[1]]);

  // 暗槓(5萬)は禁止される
  assert.throws(
    () => actions.performAnkan(afterPon, { kind: "number", suit: "man", rank: 5 }),
    /ポンの後、打牌するまでカンはできません/
  );

  // 加槓(7萬)も禁止される
  assert.throws(
    () => actions.performKakan(afterPon, { kind: "number", suit: "man", rank: 7 }),
    /ポンの後、打牌するまでカンはできません/
  );

  // getDrawActionOptions 側でも、暗槓・加槓の選択肢自体が出ないことを確認する
  const context = actions.buildWinContext(afterPon, "east", null, true);
  const options = engine.legalActions.getDrawActionOptions(
    afterPon.players.east.hand,
    afterPon.players.east.melds,
    afterPon.players.east.score,
    afterPon.wall.liveWall.length,
    afterPon.players.east.isRiichi,
    afterPon.players.east.hand,
    context,
    true
  );
  assert.deepStrictEqual(options.ankanKinds, []);
  assert.deepStrictEqual(options.kakanKinds, []);

  // 打牌後はカン禁止が解除される
  const otherTile = afterPon.players.east.hand.find((t) => !(t.kind.suit === "man" && t.kind.rank === 3));
  const afterDiscard = actions.discardTile(afterPon, otherTile, false);
  assert.strictEqual(afterDiscard.players.east.forbiddenDiscardKind, null);
});

test("4回目のカン(2人で分担)の後、打牌がロンされなければ途中流局(四開槓)になる", () => {
  const state = gameState({ phase: "discard", currentTurn: "south" });
  state.kanCount = 3;
  state.players.east = {
    ...state.players.east,
    melds: [
      { type: "kan_closed", tiles: [honor("east"), honor("east"), honor("east"), honor("east")], isOpen: false },
      { type: "kan_closed", tiles: [honor("south"), honor("south"), honor("south"), honor("south")], isOpen: false },
    ],
  };
  state.players.south = {
    ...state.players.south,
    hand: [man(1), man(1), man(1), man(1), man(2), man(4), man(6), pin(1), pin(1), pin(9)],
    melds: [{ type: "kan_closed", tiles: [honor("west"), honor("west"), honor("west"), honor("west")], isOpen: false }],
  };

  const afterKan = actions.performAnkan(state, { kind: "number", suit: "man", rank: 1 });
  assert.strictEqual(afterKan.kanCount, 4);
  assert.strictEqual(afterKan.fourKanAbortivePending, true, "2人で分担した4回目のカンなので途中流局待ちになるはず");
  assert.strictEqual(afterKan.phase, "kan_replacement");

  // 4回目のカンが成立した後は、この局ではもうカンできない
  assert.throws(
    () => actions.performAnkan(afterKan, { kind: "number", suit: "pin", rank: 1 }),
    /もうカンできません/
  );
  assert.throws(
    () => actions.performMinkan(afterKan, "east", [afterKan.players.east.hand[0], afterKan.players.east.hand[0], afterKan.players.east.hand[0]]),
    /もうカンできません/
  );

  // 4回目のカンの嶺上牌を打牌し、ロンされなければ途中流局になる
  const rinshanTile = afterKan.players.south.drawnTile;
  const afterDiscard = actions.discardTile(afterKan, rinshanTile, false);
  assert.strictEqual(afterDiscard.phase, "call_window");
  assert.strictEqual(afterDiscard.fourKanAbortivePending, true);

  const afterPass = actions.passDiscard(afterDiscard);
  assert.strictEqual(afterPass.phase, "round_end");
  assert.deepStrictEqual(afterPass.roundEndReason, { type: "abortive_draw", reason: "四開槓" });
  assert.strictEqual(afterPass.fourKanAbortivePending, false);
});

test("1人で4回カンをした場合(四槓子の可能性)は例外として途中流局にしない", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.kanCount = 3;
  state.players.east = {
    ...state.players.east,
    hand: [man(2), man(2), man(2), man(2), man(4), man(6), pin(1), pin(1), pin(9), pin(9)],
    melds: [
      { type: "kan_closed", tiles: [honor("east"), honor("east"), honor("east"), honor("east")], isOpen: false },
      { type: "kan_closed", tiles: [honor("south"), honor("south"), honor("south"), honor("south")], isOpen: false },
      { type: "kan_closed", tiles: [honor("west"), honor("west"), honor("west"), honor("west")], isOpen: false },
    ],
  };

  const afterKan = actions.performAnkan(state, { kind: "number", suit: "man", rank: 2 });
  assert.strictEqual(afterKan.kanCount, 4);
  assert.strictEqual(afterKan.fourKanAbortivePending, false, "1人で4回カンした場合は途中流局の対象外のはず");

  // それでもこの局ではもうカンできない
  assert.throws(
    () => actions.performAnkan(afterKan, { kind: "number", suit: "pin", rank: 1 }),
    /もうカンできません/
  );

  const rinshanTile = afterKan.players.east.drawnTile;
  const afterDiscard = actions.discardTile(afterKan, rinshanTile, false);
  const afterPass = actions.passDiscard(afterDiscard);
  assert.strictEqual(afterPass.phase, "draw", "四槓子の例外なので通常通り次の手番へ進むはず");
  assert.strictEqual(afterPass.currentTurn, "south");
});

test("4回目のカンの後の打牌にポンしても、ロンでない限り途中流局になる", () => {
  const state = gameState({ phase: "call_window", currentTurn: "south" });
  state.kanCount = 4;
  state.fourKanAbortivePending = true;
  state.lastDiscard = { tile: man(3), from: "south" };
  state.players.east = {
    ...state.players.east,
    hand: [man(3), man(3), man(5), man(6), man(7), pin(1), pin(1), pin(9), pin(9), sou(1)],
  };

  const afterPon = actions.callPon(state, "east", [state.players.east.hand[0], state.players.east.hand[1]]);
  assert.strictEqual(afterPon.phase, "round_end");
  assert.deepStrictEqual(afterPon.roundEndReason, { type: "abortive_draw", reason: "四開槓" });
  assert.strictEqual(afterPon.fourKanAbortivePending, false);
});

test("4回目のカンの後の打牌はロンのみ可能で、ポンはできない", () => {
  const discard = man(3);
  const hand = [man(3), man(3), man(5), man(6), man(7), pin(1), pin(1), pin(9), pin(9), sou(1)];

  // 通常時はポンできる
  assert.strictEqual(engine.legalActions.canDeclarePon(hand, discard, false, 30), true);

  // 4回目のカン(四槓子の場合を除く)の打牌に対してはポンできない
  assert.strictEqual(engine.legalActions.canDeclarePon(hand, discard, false, 30, true), false);
});

test("同じ種類の牌が複数あるとき、リーチ宣言牌はそのすべてが選択肢になる", () => {
  // 3萬を3枚持ち、3萬を1枚切れば聴牌(3萬の対子+5萬6萬の両面待ち)になる手牌。
  // 3枚のうちどれを切っても残る手牌は同じなので、3枚とも選択肢に入っている必要がある。
  const hand = [
    man(3), man(3), man(3),
    pin(1), pin(1), pin(1),
    pin(9), pin(9), pin(9),
    sou(9), sou(9), sou(9),
    man(5), man(6),
  ];
  const state = gameState({ currentTurn: "east" });
  const context = actions.buildWinContext(state, "east", hand[0], true);
  const options = engine.legalActions.getDrawActionOptions(
    hand,
    [],
    45000,
    30,
    false,
    hand.slice(0, 13),
    context
  );

  const man3Options = options.riichiDiscardOptions.filter(
    (t) => t.kind.kind === "number" && t.kind.suit === "man" && t.kind.rank === 3
  );
  assert.strictEqual(man3Options.length, 3, "3枚ある3萬のすべてがリーチ宣言牌として選べるはず");
  // 同じ牌が重複して入っていないこと(IDはすべて異なる)
  assert.strictEqual(new Set(man3Options.map((t) => t.id)).size, 3);
});

test("リーチ後にロンを見逃すと、その局が終わるまでフリテンになる", () => {
  const state = gameState({ phase: "call_window", currentTurn: "south" });
  state.players.south = { ...state.players.south, isRiichi: true };

  const afterMiss = actions.markMissedRon(state, "south");
  assert.strictEqual(afterMiss.players.south.isTemporaryFuriten, true);
  assert.strictEqual(afterMiss.players.south.isRiichiMissedFuriten, true);
  assert.strictEqual(engine.furiten.isMissedRonFuriten(afterMiss.players.south), true);

  // リーチ者はツモ切りしかできないが、打牌しても局中フリテンは解消されない
  const withHand = {
    ...afterMiss,
    currentTurn: "south",
    phase: "discard",
    players: {
      ...afterMiss.players,
      south: {
        ...afterMiss.players.south,
        hand: [man(1), man(2), man(3), man(5), man(6), man(7), pin(1), pin(1), pin(9), pin(9), sou(1), sou(1), sou(9)],
        drawnTile: man(9),
      },
    },
  };
  const afterDiscard = actions.discardTile(withHand, withHand.players.south.drawnTile, false);
  assert.strictEqual(afterDiscard.players.south.isTemporaryFuriten, false, "同巡内フリテンは打牌で解消される");
  assert.strictEqual(afterDiscard.players.south.isRiichiMissedFuriten, true, "リーチ後の見逃しは局中ずっと続くはず");
  assert.strictEqual(engine.furiten.isMissedRonFuriten(afterDiscard.players.south), true);

  // 次の局になれば手牌ごと作り直されるため、フリテンは持ち越されない
  const nextRound = advanceRound({ ...afterDiscard, phase: "round_end" }, false);
  assert.strictEqual(nextRound.players.south.isRiichiMissedFuriten, false);
});

test("リーチしていないプレイヤーの見逃しは同巡内フリテンのままで、打牌で解消される", () => {
  const state = gameState({ phase: "call_window", currentTurn: "south" });
  const afterMiss = actions.markMissedRon(state, "east");
  assert.strictEqual(afterMiss.players.east.isTemporaryFuriten, true);
  assert.strictEqual(afterMiss.players.east.isRiichiMissedFuriten, false, "リーチしていなければ局中フリテンにはならない");
});

// ---------------- リーチ棒(供託)の確定タイミング ----------------

test("リーチ宣言直後は、ロンされるかどうか確定するまで1000点も供託本数も動かない", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.players.east = {
    ...state.players.east,
    hand: [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), pin(9), pin(9)],
    drawnTile: sou(1),
  };

  const afterDiscard = actions.discardTile(state, sou(1), true);
  assert.strictEqual(afterDiscard.players.east.isRiichi, true, "リーチ状態自体は宣言時点で立つ");
  assert.strictEqual(afterDiscard.players.east.score, 45000, "ロンされるか未確定の間は1000点を引いてはいけない");
  assert.strictEqual(afterDiscard.riichiSticks, 0, "ロンされるか未確定の間は供託本数を増やしてはいけない");
  assert.strictEqual(afterDiscard.lastDiscard.isRiichiDeclaration, true);
});

test("リーチ宣言牌をロンされた場合、1000点は引かれず供託も増えない(見送られたことにならないため)", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.players.east = {
    ...state.players.east,
    hand: [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), pin(9), pin(9)],
    drawnTile: sou(1),
  };
  const afterDiscard = actions.discardTile(state, sou(1), true);

  // 南家が3-6索の両面待ちで、この宣言牌をロンする想定
  const southHand = [
    man(2), man(2), man(2),
    pin(3), pin(4), pin(5),
    sou(4), sou(5),
    honor("white"), honor("white"), honor("white"),
    honor("green"), honor("green"),
  ];
  const stateForRon = {
    ...afterDiscard,
    players: { ...afterDiscard.players, south: { ...afterDiscard.players.south, hand: southHand } },
  };

  const { state: afterRon } = actions.declareRon(stateForRon, "south", sou(1));
  assert.strictEqual(afterRon.players.east.score, 45000, "ロンされたのでリーチ宣言者から1000点を引いてはいけない");
  assert.strictEqual(afterRon.riichiSticks, 0, "ロンされたリーチ宣言牌の分は供託に計上されないはず");
});

test("リーチ宣言牌が見送られた(スルーされた)場合、その時点で1000点が引かれ供託が1本増える", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.players.east = {
    ...state.players.east,
    hand: [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), pin(9), pin(9)],
    drawnTile: sou(1),
  };
  const afterDiscard = actions.discardTile(state, sou(1), true);
  assert.strictEqual(afterDiscard.players.east.score, 45000);

  const afterPass = actions.passDiscard(afterDiscard);
  assert.strictEqual(afterPass.players.east.score, 44000, "見送られて決着した時点で1000点を引く");
  assert.strictEqual(afterPass.riichiSticks, 1, "見送られて決着した時点で供託を1本増やす");
});

test("リーチ宣言牌がポンされた(ロンでない)場合も、1000点が引かれ供託が1本増える", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.players.east = {
    ...state.players.east,
    hand: [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), pin(1), pin(1), pin(9), pin(9)],
    drawnTile: man(3),
  };
  const afterDiscard = actions.discardTile(state, man(3), true);
  state.players.south = {
    ...state.players.south,
    hand: [man(3), man(3), man(5), man(6), man(7), pin(1), pin(1), pin(9), pin(9), sou(1), sou(9), sou(9), honor("east")],
  };
  const stateForPon = {
    ...afterDiscard,
    players: { ...afterDiscard.players, south: { ...afterDiscard.players.south, hand: state.players.south.hand } },
  };

  const afterPon = actions.callPon(stateForPon, "south", [
    stateForPon.players.south.hand[0],
    stateForPon.players.south.hand[1],
  ]);
  assert.strictEqual(afterPon.players.east.score, 44000, "ロンされずポンで決着した時点で1000点を引く");
  assert.strictEqual(afterPon.riichiSticks, 1, "ロンされずポンで決着した時点で供託を1本増やす");
});

// ---------------- 天和・地和 ----------------

function tenhouTestState(dealerHand13, drawn, overrides = {}) {
  const base = gameState();
  const east = { ...base.players.east, hand: dealerHand13, drawnTile: drawn };
  return { ...base, phase: "discard", players: { ...base.players, east }, ...overrides };
}

function normalWinningHand() {
  // 123m 456m 789m 111p + 9s(9s ツモで一気通貫などの通常役も付く形。筒子・索子は1と9のみ)
  return [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), pin(1), pin(1), pin(1), sou(9)];
}

test("天和: 親の最初のツモで和了なら役満、通常役・ドラとは複合しない", () => {
  const state = tenhouTestState(normalWinningHand(), sou(9));
  const ctx = engine.actions.buildWinContext(state, "east", state.players.east.drawnTile, true);
  assert.strictEqual(ctx.isTenhou, true);
  assert.strictEqual(ctx.isChiihou, false);
  const opts = engine.legalActions.getDrawActionOptions(
    [...state.players.east.hand, state.players.east.drawnTile], [], 45000, 50, false, state.players.east.hand, ctx
  );
  assert.strictEqual(opts.canTsumo, true);
  const { scoreResult } = engine.actions.declareTsumo(state, "east");
  assert.deepStrictEqual(scoreResult.yaku.map((y) => y.id), ["tenhou"]);
  assert.deepStrictEqual(scoreResult.tier, { kind: "yakuman", multiplier: 1 });
  // ドラが大量にあっても役満のまま
  const hand = { concealedTiles: [...normalWinningHand(), sou(9)], melds: [] };
  const withDora = engine.score.calculateScore(hand, { ...ctx, winningTile: hand.concealedTiles[13] }, true, 10);
  assert.deepStrictEqual(withDora.tier, { kind: "yakuman", multiplier: 1 });
  assert.strictEqual(withDora.totalHan, undefined);
});

test("天和: 和了牌は最も高くなる牌を選ぶ(四暗刻単騎とのダブル役満)", () => {
  // 111p 999p 111s 999s + 5m。ツモ牌が5萬以外でも、5萬を和了牌とみなせば単騎待ち
  const hand = [pin(1), pin(1), pin(1), pin(9), pin(9), pin(9), sou(1), sou(1), sou(1), sou(9), sou(9), sou(9), man(5)];
  const state = tenhouTestState(hand, man(5));
  // ツモ牌を刻子側の牌にしても同じ結果
  const state2 = tenhouTestState([...hand.slice(1), man(5)], hand[0]);
  for (const s of [state, state2]) {
    const { scoreResult } = engine.actions.declareTsumo(s, "east");
    const ids = scoreResult.yaku.map((y) => y.id).sort();
    assert.deepStrictEqual(ids, ["suuankou_tanki", "tenhou"]);
    assert.deepStrictEqual(scoreResult.tier, { kind: "yakuman", multiplier: 2 });
  }
});

test("地和: 子の最初のツモで和了なら役満", () => {
  const base = gameState();
  const east = { ...base.players.east, discards: [{ tile: honor("north"), isRiichiDeclaration: false, isCalled: false }] };
  const south = { ...base.players.south, hand: normalWinningHand(), drawnTile: sou(9) };
  const state = { ...base, phase: "discard", currentTurn: "south", players: { east, south } };
  const ctx = engine.actions.buildWinContext(state, "south", south.drawnTile, true);
  assert.strictEqual(ctx.isChiihou, true);
  assert.strictEqual(ctx.isTenhou, false);
  const { scoreResult } = engine.actions.declareTsumo(state, "south");
  assert.deepStrictEqual(scoreResult.yaku.map((y) => y.id), ["chiihou"]);
  assert.deepStrictEqual(scoreResult.tier, { kind: "yakuman", multiplier: 1 });
});

test("地和: それ以前に鳴き・カン(暗槓含む)があれば不成立", () => {
  const base = gameState();
  const kan = { type: "kan_closed", tiles: [honor("red"), honor("red"), honor("red"), honor("red")], isOpen: false };
  const east = { ...base.players.east, melds: [kan], discards: [{ tile: honor("north"), isRiichiDeclaration: false, isCalled: false }] };
  const south = { ...base.players.south, hand: normalWinningHand(), drawnTile: sou(9) };
  const state = { ...base, phase: "discard", currentTurn: "south", players: { east, south } };
  const ctx = engine.actions.buildWinContext(state, "south", south.drawnTile, true);
  assert.strictEqual(ctx.isChiihou, false);
  const { scoreResult } = engine.actions.declareTsumo(state, "south");
  assert.ok(!scoreResult.yaku.some((y) => y.id === "chiihou"));
});

test("天和・地和: 2巡目以降(自分が打牌済み)のツモは対象外", () => {
  const base = gameState();
  const east = { ...base.players.east, hand: normalWinningHand(), drawnTile: sou(9), discards: [{ tile: honor("north"), isRiichiDeclaration: false, isCalled: false }] };
  const state = { ...base, phase: "discard", players: { ...base.players, east } };
  const ctx = engine.actions.buildWinContext(state, "east", east.drawnTile, true);
  assert.strictEqual(ctx.isTenhou, false);
  assert.strictEqual(ctx.isChiihou, false);
});

function rinshanTestState(rinshanTile, liveWallEmpty = false) {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  state.players.east = {
    ...state.players.east,
    hand: [man(2), man(2), man(2), man(2), man(3), man(4), pin(1), pin(1), pin(1), pin(9), pin(9), pin(9), sou(1)],
    drawnTile: sou(1),
    discards: [{ tile: honor("north"), isRiichiDeclaration: false, isCalled: false }],
  };
  state.wall = { ...state.wall, deadWallDraws: [rinshanTile, ...state.wall.deadWallDraws.slice(1)] };
  if (liveWallEmpty) state.wall = { ...state.wall, liveWall: [man(9)] }; // カンで末尾1枚が減り0枚になる
  return actions.performAnkan(state, { kind: "number", suit: "man", rank: 2 });
}

test("嶺上開花: カン後の嶺上牌でツモ和了すると1飜が付き、役の最後に並ぶ", () => {
  const afterKan = rinshanTestState(man(5));
  assert.strictEqual(afterKan.phase, "kan_replacement");
  assert.strictEqual(afterKan.players.east.drawnTile.kind.rank, 5);
  const ctx = actions.buildWinContext(afterKan, "east", afterKan.players.east.drawnTile, true);
  assert.strictEqual(ctx.isRinshan, true);
  const { scoreResult } = actions.declareTsumo(afterKan, "east");
  const ids = scoreResult.yaku.map((y) => y.id);
  assert.ok(ids.includes("rinshan"), `嶺上開花が付いていない: ${ids}`);
  assert.strictEqual(scoreResult.yaku.find((y) => y.id === "rinshan").han, 1);
});

test("嶺上開花: 嶺上牌の打牌後、通常の自摸での和了には付かない", () => {
  const state = gameState({ phase: "discard", currentTurn: "east" });
  const ctx = actions.buildWinContext(state, "east", man(5), true);
  assert.ok(!ctx.isRinshan);
});

test("嶺上開花: ロンには付かない", () => {
  const afterKan = rinshanTestState(man(5));
  const ctx = actions.buildWinContext(afterKan, "east", man(5), false);
  assert.ok(!ctx.isRinshan);
});

test("嶺上牌でのツモは(山が尽きていても)海底摸月にならない", () => {
  const afterKan = rinshanTestState(man(5), true);
  assert.strictEqual(afterKan.wall.liveWall.length, 0);
  const { scoreResult } = actions.declareTsumo(afterKan, "east");
  const ids = scoreResult.yaku.map((y) => y.id);
  assert.ok(ids.includes("rinshan"));
  assert.ok(!ids.includes("haitei"), `海底摸月が付いてしまっている: ${ids}`);
});

// 鳴いていて(門前清自摸和なし)、海底摸月・河底撈魚以外に役が無い手。
// ポン(1萬) + 234萬 + 567萬 + 999筒 + 1筒単騎
function haiteiOnlyHand() {
  return {
    hand: [man(2), man(3), man(4), man(5), man(6), man(7), pin(9), pin(9), pin(9), pin(1)],
    melds: [{ type: "pon", tiles: [man(1), man(1), man(1)], isOpen: true }],
  };
}

test("海底摸月: 役が海底摸月だけの手でも、山の最後の1枚のツモならツモ和了できる(画面・CPUの判定経路)", () => {
  const base = gameState({ phase: "discard", currentTurn: "east" });
  const east = { ...base.players.east, ...haiteiOnlyHand(), drawnTile: pin(1), discards: [{ tile: honor("north"), isRiichiDeclaration: false, isCalled: false }] };
  const state = { ...base, players: { ...base.players, east }, wall: { ...base.wall, liveWall: [] } };
  // 画面(app.js drawActionOptionsFor)・CPU(cpu.ts drawOptions)と同じく extra なしで呼ぶ
  const ctx = actions.buildWinContext(state, "east", east.drawnTile, true);
  assert.strictEqual(ctx.isHaitei, true);
  const opts = engine.legalActions.getDrawActionOptions(
    [...east.hand, east.drawnTile], east.melds, east.score, 0, false, east.hand, ctx, false, 0
  );
  assert.strictEqual(opts.canTsumo, true, "海底摸月のみの手でツモ和了ボタンが出ない");
  const { scoreResult } = actions.declareTsumo(state, "east");
  assert.deepStrictEqual(scoreResult.yaku.map((y) => y.id), ["haitei"]);

  // 山が残っているときは(役なしなので)ツモ和了できない
  const notLast = { ...state, wall: { ...state.wall, liveWall: [man(9)] } };
  const ctx2 = actions.buildWinContext(notLast, "east", east.drawnTile, true);
  assert.strictEqual(ctx2.isHaitei, false);
});

test("河底撈魚: 役が河底撈魚だけの手でも、最後の捨て牌ならロンできる(画面・CPUの判定経路)", () => {
  const base = gameState({ phase: "call_window", currentTurn: "south" });
  const ronTile = pin(1);
  const east = { ...base.players.east, ...haiteiOnlyHand(), discards: [{ tile: honor("north"), isRiichiDeclaration: false, isCalled: false }] };
  const state = {
    ...base,
    players: { ...base.players, east },
    wall: { ...base.wall, liveWall: [] },
    lastDiscard: { tile: ronTile, from: "south", isRiichiDeclaration: false },
  };
  const ctx = actions.buildWinContext(state, "east", ronTile, false);
  assert.strictEqual(ctx.isHoutei, true);
  assert.strictEqual(ctx.isHaitei, false);
  const canRon = engine.legalActions.canDeclareRon(east.hand, east.melds, east.discards.map((d) => d.tile), false, ronTile, ctx);
  assert.strictEqual(canRon, true, "河底撈魚のみの手でロンできない");
});

// ---------------- リーチ後の暗槓 ----------------
{
  const { canAnkanDuringRiichi } = require("../dist/game/riichiAnkan");
  const ank = (before, drawn, kind) => canAnkanDuringRiichi(before, [...before, drawn], [], kind);
  const W = () => honor("white");

  test("リーチ後の暗槓: ツモ牌で4枚目が揃い、構成・待ちが変わらなければできる", () => {
    const before = [man(1), man(1), man(1), man(4), man(5), man(6), man(7), man(8), man(9), pin(9), pin(9), honor("east"), honor("east")];
    assert.strictEqual(ank(before, man(1), man(1).kind), true);
  });

  test("リーチ後の暗槓: 送り槓(ツモ牌以外の4枚)はできない", () => {
    const before = [man(1), man(1), man(1), man(1), man(2), man(3), man(4), man(5), man(6), man(7), pin(9), pin(9), honor("east")];
    assert.strictEqual(ank(before, pin(1), man(1).kind), false);
  });

  test("リーチ後の暗槓: 11123444 の1・4(雀頭が確定していない構成)はできない", () => {
    const before = [man(1), man(1), man(1), man(2), man(3), man(4), man(4), man(4), man(7), man(8), man(9), W(), W()];
    assert.strictEqual(ank(before, man(1), man(1).kind), false);
    assert.strictEqual(ank(before, man(4), man(4).kind), false);
  });

  test("リーチ後の暗槓: 4445 に4(待ちが3・5・6から5単騎に変わる)はできない", () => {
    const before = [man(4), man(4), man(4), man(5), man(1), man(2), man(3), man(7), man(8), man(9), W(), W(), W()];
    assert.strictEqual(ank(before, man(4), man(4).kind), false);
  });

  test("リーチ後の暗槓: 1113444 に1(嵌張とも両面とも取れる形)はできない", () => {
    const before = [man(1), man(1), man(1), man(3), man(4), man(4), man(4), man(7), man(8), man(9), W(), W(), W()];
    assert.strictEqual(ank(before, man(1), man(1).kind), false);
  });
}
