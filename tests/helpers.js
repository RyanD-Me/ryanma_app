/**
 * テスト用のヘルパー。
 * テストはコンパイル済みの dist/ を対象にするため、実行前に `npm run build` が必要
 * (`npm test` は build を含んでいる)。
 */
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");

const engine = {
  tile: require(path.join(DIST, "types/tile")),
  player: require(path.join(DIST, "types/player")),
  wall: require(path.join(DIST, "types/wall")),
  wallGenerator: require(path.join(DIST, "wall/wallGenerator")),
  dora: require(path.join(DIST, "yaku/dora")),
  evaluate: require(path.join(DIST, "yaku/evaluate")),
  tenpai: require(path.join(DIST, "yaku/tenpai")),
  furiten: require(path.join(DIST, "yaku/furiten")),
  score: require(path.join(DIST, "scoring/score")),
  actions: require(path.join(DIST, "game/actions")),
  legalActions: require(path.join(DIST, "game/legalActions")),
  roundTransition: require(path.join(DIST, "game/roundTransition")),
  shanten: require(path.join(DIST, "ai/shanten")),
  cpu: require(path.join(DIST, "ai/cpu")),
  defense: require(path.join(DIST, "ai/defense")),
  value: require(path.join(DIST, "ai/value")),
  wait: require(path.join(DIST, "ai/wait")),
};

let tileIdCounter = 0;

/** テスト用の牌を作る。IDは牌ごとに一意であればよい */
function tile(kind) {
  tileIdCounter++;
  return { id: `test-${tileIdCounter}`, kind, isRedDora: false };
}

const man = (rank) => tile({ kind: "number", suit: "man", rank });
const pin = (rank) => tile({ kind: "number", suit: "pin", rank });
const sou = (rank) => tile({ kind: "number", suit: "sou", rank });
const honor = (h) => tile({ kind: "honor", honor: h });

/** 表示確認用の牌の名前(テスト失敗時に読みやすくするため) */
const HONOR_LABEL = { east: "東", south: "南", west: "西", north: "北", white: "白", green: "發", red: "中" };
function tileLabel(kind) {
  if (kind.kind === "honor") return HONOR_LABEL[kind.honor];
  return kind.rank + { man: "萬", pin: "筒", sou: "索" }[kind.suit];
}

/** 和了判定・点数計算に渡す標準的な状況(必要な項目だけ上書きして使う) */
function winContext(overrides = {}) {
  return {
    isTsumo: false,
    seatWind: "east",
    roundWind: "east",
    isRiichi: false,
    isDoubleRiichi: false,
    isIppatsu: false,
    isHaitei: false,
    isHoutei: false,
    isFuriten: false,
    winningTile: null,
    ...overrides,
  };
}

/**
 * テスト用のゲーム状態。牌山は固定シードで作るため、同じ seed なら毎回同じ配牌になる。
 * 手牌は呼び出し側で上書きする前提で、ここでは空のプレイヤーを用意する。
 */
function gameState(overrides = {}) {
  const { wall } = engine.wallGenerator.buildWall(overrides.seed ?? 1);
  const state = {
    gameId: "test",
    phase: "draw",
    roundWind: "east",
    roundNumber: 1,
    overallRoundIndex: 1,
    riichiSticks: 0,
    startingDealer: "east",
    dealer: "east",
    kanCount: 0,
    fourKanAbortivePending: false,
    wall,
    players: {
      east: engine.player.createInitialPlayerState("east", 45000),
      south: engine.player.createInitialPlayerState("south", 45000),
    },
    currentTurn: "east",
    lastDiscard: null,
    roundEndReason: null,
    totalRounds: 8,
    startingScore: 45000,
    gameEndReason: null,
  };
  delete overrides.seed;
  return { ...state, ...overrides };
}

module.exports = { engine, tile, man, pin, sou, honor, tileLabel, winContext, gameState };
