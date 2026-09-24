const test = require("node:test");
const assert = require("node:assert");
const { engine, man, pin, sou, honor, tileLabel } = require("./helpers");

const { doraFromIndicator, countDoraTiles, countDoraForHand, allTilesOfHand } = engine.dora;
const { allTileKinds, tileKindKey } = engine.tile;

test("どのドラ表示牌からも、実際に存在する牌がドラになる", () => {
  const existing = new Set(allTileKinds().map(tileKindKey));
  for (const kind of allTileKinds()) {
    const dora = doraFromIndicator(kind);
    assert.ok(
      existing.has(tileKindKey(dora)),
      `${tileLabel(kind)} のドラ ${tileLabel(dora)} は存在しない牌`
    );
  }
});

test("萬子は 1→2→…→9→1 の順に循環する", () => {
  for (let rank = 1; rank <= 8; rank++) {
    assert.deepStrictEqual(doraFromIndicator({ kind: "number", suit: "man", rank }), {
      kind: "number",
      suit: "man",
      rank: rank + 1,
    });
  }
  assert.deepStrictEqual(doraFromIndicator({ kind: "number", suit: "man", rank: 9 }), {
    kind: "number",
    suit: "man",
    rank: 1,
  });
});

test("筒子・索子は1と9しかないため 1↔9 で循環する", () => {
  for (const suit of ["pin", "sou"]) {
    assert.deepStrictEqual(doraFromIndicator({ kind: "number", suit, rank: 1 }), {
      kind: "number",
      suit,
      rank: 9,
    });
    assert.deepStrictEqual(doraFromIndicator({ kind: "number", suit, rank: 9 }), {
      kind: "number",
      suit,
      rank: 1,
    });
  }
});

test("風牌は東→南→西→北→東、三元牌は白→發→中→白で循環する", () => {
  const winds = ["east", "south", "west", "north"];
  for (let i = 0; i < winds.length; i++) {
    assert.deepStrictEqual(doraFromIndicator({ kind: "honor", honor: winds[i] }), {
      kind: "honor",
      honor: winds[(i + 1) % winds.length],
    });
  }
  const dragons = ["white", "green", "red"];
  for (let i = 0; i < dragons.length; i++) {
    assert.deepStrictEqual(doraFromIndicator({ kind: "honor", honor: dragons[i] }), {
      kind: "honor",
      honor: dragons[(i + 1) % dragons.length],
    });
  }
});

test("鳴いた面子の中の牌もドラとして数える", () => {
  const hand = {
    concealedTiles: [man(5), man(6), man(7), pin(1), pin(1)],
    melds: [{ type: "triplet", tiles: [man(2), man(2), man(2)], isOpen: true, calledFrom: "opponent" }],
  };
  // 表示牌 1萬 → ドラは 2萬。鳴いた刻子の3枚が数えられる
  assert.strictEqual(countDoraTiles(allTilesOfHand(hand), [man(1)]), 3);
});

test("裏ドラはリーチして和了した場合のみ乗る", () => {
  const wall = {
    liveWall: [],
    doraIndicatorTiles: [],
    revealedDoraIndicators: [man(1)], // ドラ = 2萬
    uraDoraIndicatorTiles: [man(4), man(8)], // 有効なのは1枚目のみ → 裏ドラ = 5萬
    deadWallDraws: [],
  };
  const hand = {
    concealedTiles: [man(2), man(2), man(5), man(5), man(5), pin(1), pin(1)],
    melds: [],
  };

  assert.deepStrictEqual(countDoraForHand(hand, wall, false), { dora: 2, uraDora: 0, total: 2 });
  assert.deepStrictEqual(countDoraForHand(hand, wall, true), { dora: 2, uraDora: 3, total: 5 });
});
