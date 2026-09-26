const test = require("node:test");
const assert = require("node:assert");
const { engine } = require("./helpers");

const { buildWall, dealInitialHands, revealNextDoraIndicator, createFullTileSet } = engine.wallGenerator;
const { activeUraDoraIndicators } = engine.wall;

test("牌一式は80枚で、同じIDの牌が重複しない", () => {
  const tiles = createFullTileSet();
  assert.strictEqual(tiles.length, 80);
  assert.strictEqual(new Set(tiles.map((t) => t.id)).size, 80);
});

test("王牌14枚は嶺上4枚・表ドラ5枚・裏ドラ5枚に分かれ、全体は80枚のまま", () => {
  const { wall } = buildWall(42);
  assert.strictEqual(wall.deadWallDraws.length, 4);
  assert.strictEqual(wall.doraIndicatorTiles.length, 5);
  assert.strictEqual(wall.uraDoraIndicatorTiles.length, 5);
  assert.strictEqual(wall.liveWall.length, 66);

  const total =
    wall.deadWallDraws.length +
    wall.doraIndicatorTiles.length +
    wall.uraDoraIndicatorTiles.length +
    wall.liveWall.length;
  assert.strictEqual(total, 80);
});

test("配牌後の自摸山は40枚になる(80 - 王牌14 - 配牌26)", () => {
  const { wall } = buildWall(42);
  const { wall: dealt, hands } = dealInitialHands(wall, ["east", "south"]);
  assert.strictEqual(hands.east.length, 13);
  assert.strictEqual(hands.south.length, 13);
  assert.strictEqual(dealt.liveWall.length, 40);
});

test("配牌は東家→南家の順に交互に4枚・4枚・4枚・1枚ずつ、自摸山の先頭から取る", () => {
  const { wall } = buildWall(42);
  const live = wall.liveWall.map((t) => t.id);
  const { hands } = dealInitialHands(wall, ["east", "south"]);
  // 自摸山の並び: 東4 南4 東4 南4 東4 南4 東1 南1
  const expectedEast = [...live.slice(0, 4), ...live.slice(8, 12), ...live.slice(16, 20), live[24]];
  const expectedSouth = [...live.slice(4, 8), ...live.slice(12, 16), ...live.slice(20, 24), live[25]];
  assert.deepStrictEqual(hands.east.map((t) => t.id), expectedEast);
  assert.deepStrictEqual(hands.south.map((t) => t.id), expectedSouth);
});

test("同じシードなら牌山の並びが再現される", () => {
  const a = buildWall(12345).wall.liveWall.map((t) => t.id);
  const b = buildWall(12345).wall.liveWall.map((t) => t.id);
  assert.deepStrictEqual(a, b);
});

test("有効な裏ドラ表示牌は、表をめくった枚数と同じになる(カン裏あり)", () => {
  let wall = buildWall(42).wall;
  assert.strictEqual(activeUraDoraIndicators(wall).length, 0);

  wall = revealNextDoraIndicator(wall);
  assert.strictEqual(activeUraDoraIndicators(wall).length, 1);

  wall = revealNextDoraIndicator(wall);
  assert.strictEqual(activeUraDoraIndicators(wall).length, 2);
});

test("シード値を渡すと同じ牌山になり、乱数関数を渡すとそれでシャッフルする", () => {
  const ids = (w) => [...w.liveWall, ...w.deadWallDraws, ...w.doraIndicatorTiles, ...w.uraDoraIndicatorTiles].map((t) => t.id);
  // シード値は再現できる(これまでどおり)
  assert.deepStrictEqual(ids(buildWall(7).wall), ids(buildWall(7).wall));
  assert.strictEqual(buildWall(7).seed, 7);
  // 乱数関数を渡した場合(オンライン対戦のサーバーは暗号用の乱数を渡す)
  const crypto = require("node:crypto");
  const built = buildWall(() => crypto.randomInt(0, 2 ** 48 - 1) / 2 ** 48);
  assert.strictEqual(built.seed, null);
  const all = ids(built.wall);
  assert.strictEqual(all.length, 80);
  assert.strictEqual(new Set(all).size, 80);
  assert.strictEqual(built.wall.liveWall.length, 66);
  // 常に0を返す乱数関数なら、決まった並びになる(関数が実際に使われている)
  assert.deepStrictEqual(ids(buildWall(() => 0).wall), ids(buildWall(() => 0).wall));
  assert.notDeepStrictEqual(ids(buildWall(() => 0).wall), ids(buildWall(() => 0.999).wall));
});
