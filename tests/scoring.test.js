const test = require("node:test");
const assert = require("node:assert");
const { engine, man, pin, honor, winContext } = require("./helpers");

const { calculateScore } = engine.score;

/**
 * 子・3翻40符の手(リーチ+一発+役牌白、嵌張待ち)。
 * 基本点 40 × 2^(2+3) = 1280、子のロンは ×4 = 5120 → 1000点未満切り上げで6000点。
 */
function han3fu40Hand() {
  const winTile = man(4);
  return {
    winTile,
    hand: {
      concealedTiles: [
        man(2), man(3), man(4),
        man(6), man(7), man(8),
        man(3), winTile, man(5),
        honor("white"), honor("white"), honor("white"),
        pin(1), pin(1),
      ],
      melds: [],
    },
  };
}

test("子の3翻40符ロンは6000点(1000点未満切り上げ)", () => {
  const { hand, winTile } = han3fu40Hand();
  const context = winContext({ isRiichi: true, isIppatsu: true, isTsumo: false, winningTile: winTile });
  const result = calculateScore(hand, context, false, 0);

  assert.strictEqual(result.isWin, true);
  assert.deepStrictEqual(result.tier, { kind: "points", han: 3, fu: 40 });
  assert.strictEqual(result.points, 6000);
});

test("切り上げ満貫: 4翻30符は満貫として扱う", () => {
  // ダブルリーチ+一発+ツモ+平和相当で4翻、嵌張なしの30符になる手
  const winTile = man(4);
  const hand = {
    concealedTiles: [
      man(1), man(2), man(3),
      man(5), man(5), man(5),
      man(7), man(8), man(9),
      man(3), winTile, man(5),
      pin(1), pin(1),
    ],
    melds: [],
  };
  const context = winContext({ isDoubleRiichi: true, isIppatsu: true, isTsumo: true, winningTile: winTile });
  const result = calculateScore(hand, context, false, 0);

  assert.strictEqual(result.tier.kind, "fixed");
  assert.strictEqual(result.tier.tier, "mangan");
  // ツモは総額の4分の3: 満貫(子)8000 × 3/4 = 6000
  assert.strictEqual(result.points, 6000);
});

test("ツモ和了はロン基準の総額を4分の3にする", () => {
  const hand = {
    concealedTiles: [
      honor("east"), honor("east"), honor("south"), honor("south"),
      honor("west"), honor("west"), honor("north"), honor("north"),
      honor("white"), honor("white"), honor("green"), honor("green"),
      honor("red"), honor("red"),
    ],
    melds: [],
  };

  // 大七星(役満)。子のロンは32000点
  const ron = calculateScore(hand, winContext({ winningTile: hand[13] }), false, 0);
  assert.strictEqual(ron.points, 32000);

  // 同じ手を親がツモると 32000 × 1.5 × 3/4 = 36000点
  const tsumo = calculateScore(hand, winContext({ isTsumo: true, winningTile: hand[13] }), true, 0);
  assert.strictEqual(tsumo.points, 36000);
});

test("ドラは通常役に加算され、合計翻数で点数帯が決まる", () => {
  const { hand, winTile } = han3fu40Hand();
  const context = winContext({ isRiichi: true, isIppatsu: true, winningTile: winTile });

  // 3翻 + ドラ2 = 5翻 → 満貫
  const withDora = calculateScore(hand, context, false, 2);
  assert.strictEqual(withDora.tier.kind, "fixed");
  assert.strictEqual(withDora.tier.tier, "mangan");
  assert.strictEqual(withDora.points, 8000);
});

test("13翻以上は数え役満になる", () => {
  const { hand, winTile } = han3fu40Hand();
  const context = winContext({ isRiichi: true, isIppatsu: true, winningTile: winTile });

  // 3翻 + ドラ10 = 13翻
  const result = calculateScore(hand, context, false, 10);
  assert.deepStrictEqual(result.tier, { kind: "yakuman", multiplier: 1 });
  assert.strictEqual(result.points, 32000);
});
