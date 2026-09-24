const test = require("node:test");
const assert = require("node:assert");
const { engine, man, pin, sou, honor } = require("./helpers");

const { calculateShanten, standardShanten, chiitoitsuShanten, kokushiShanten, toCounts } = engine.shanten;

test("和了形(14枚)は -1", () => {
  const hand = [man(1), man(2), man(3), man(4), man(5), man(6), man(7), man(8), man(9), honor("east"), honor("east"), honor("east"), pin(1), pin(1)];
  assert.strictEqual(calculateShanten(hand, 0), -1);
});

test("聴牌(13枚・両面待ち)は 0", () => {
  const hand = [man(2), man(3), man(5), man(6), man(7), honor("white"), honor("white"), honor("white"), pin(9), pin(9), pin(9), sou(1), sou(1)];
  assert.strictEqual(calculateShanten(hand, 0), 0);
});

test("筒子・索子は順子にならない(1筒9筒は塔子扱いしない)", () => {
  // 萬子で1面子+字牌対子... 筒子/索子の1と9は隣接しない
  const hand = [pin(1), pin(9), sou(1), sou(9), man(1), man(2), man(3), man(4), man(5), man(6), honor("red"), honor("red"), honor("green")];
  // 萬子2面子 + 中の対子 → 雀頭あり、残り孤立 → 8-4-0-1 = 3
  assert.strictEqual(standardShanten(toCounts(hand), 0), 3);
});

test("副露(ポン)がある場合は面子数を考慮する", () => {
  // ポン2つ + 萬子 234 + 67 + 東東 → 聴牌
  const concealed = [man(2), man(3), man(4), man(6), man(7), honor("east"), honor("east")];
  assert.strictEqual(calculateShanten(concealed, 2), 0);
  assert.strictEqual(calculateShanten(concealed, 0) > 0, true);
});

test("七対子の向聴数", () => {
  const hand = [man(1), man(1), man(3), man(3), man(5), man(5), pin(9), pin(9), honor("east"), honor("east"), honor("red"), honor("red"), sou(1)];
  assert.strictEqual(chiitoitsuShanten(toCounts(hand), 0), 0);
  assert.strictEqual(calculateShanten(hand, 0), 0);
  // 副露があれば七対子は成立しない
  assert.strictEqual(chiitoitsuShanten(toCounts(hand), 1), Infinity);
});

test("国士無双の向聴数", () => {
  const hand = [man(1), man(9), pin(1), pin(9), sou(1), sou(9), honor("east"), honor("south"), honor("west"), honor("north"), honor("white"), honor("green"), honor("red")];
  assert.strictEqual(kokushiShanten(toCounts(hand), 0), 0);
  assert.strictEqual(calculateShanten(hand, 0), 0);
  const hand2 = [man(1), man(9), pin(1), pin(9), sou(1), sou(9), honor("east"), honor("south"), honor("west"), honor("north"), man(5), man(5), man(4)];
  // 么九牌10種・対子なし → 13 - 10 = 3
  assert.strictEqual(kokushiShanten(toCounts(hand2), 0), 3);
});

test("バラバラの手は向聴数が大きい", () => {
  const hand = [man(1), man(5), man(9), pin(1), pin(9), sou(1), sou(9), honor("east"), honor("south"), honor("west"), honor("north"), honor("white"), man(3)];
  // 国士無双の2向聴(么九牌11種、対子なし)
  assert.strictEqual(calculateShanten(hand, 0), 2);
  assert.ok(standardShanten(toCounts(hand), 0) >= 5);
});
