import { Tile, TileKind, Honor, tileKindKey } from "../types/tile";
import { bucketize, decomposeConcealedHand } from "./decompose";

// ---------------- 国士無双 ----------------

const KOKUSHI_KINDS: TileKind[] = [
  { kind: "number", suit: "man", rank: 1 },
  { kind: "number", suit: "man", rank: 9 },
  { kind: "number", suit: "pin", rank: 1 },
  { kind: "number", suit: "pin", rank: 9 },
  { kind: "number", suit: "sou", rank: 1 },
  { kind: "number", suit: "sou", rank: 9 },
  { kind: "honor", honor: "east" },
  { kind: "honor", honor: "south" },
  { kind: "honor", honor: "west" },
  { kind: "honor", honor: "north" },
  { kind: "honor", honor: "white" },
  { kind: "honor", honor: "green" },
  { kind: "honor", honor: "red" },
];
const KOKUSHI_KEY_SET = new Set(KOKUSHI_KINDS.map(tileKindKey));

export interface KokushiResult {
  isKokushi: boolean;
  /** フリテンなしの13面待ちだったか(和了牌を引く前が13種すべて1枚ずつの状態) */
  isThirteenWait: boolean;
}

/** 国士無双が成立しているか判定する。門前(鳴きなし)が前提。 */
export function analyzeKokushi(concealedTiles: Tile[], winningTile: Tile): KokushiResult | null {
  if (concealedTiles.length !== 14) return null;

  const buckets = bucketize(concealedTiles);
  for (const key of buckets.keys()) {
    if (!KOKUSHI_KEY_SET.has(key)) return null;
  }
  if (buckets.size !== 13) return null;

  let pairCount = 0;
  for (const bucket of buckets.values()) {
    if (bucket.tiles.length === 2) {
      pairCount++;
    } else if (bucket.tiles.length !== 1) {
      return null;
    }
  }
  if (pairCount !== 1) return null;

  // 和了牌を除いた13枚が「13種すべて1枚ずつ」であれば13面待ち
  const preWin = [...concealedTiles];
  const idx = preWin.findIndex((t) => t.id === winningTile.id);
  preWin.splice(idx, 1);
  const preWinBuckets = bucketize(preWin);
  const isThirteenWait =
    preWinBuckets.size === 13 &&
    Array.from(preWinBuckets.values()).every((b) => b.tiles.length === 1);

  return { isKokushi: true, isThirteenWait };
}

// ---------------- 七対子系(通常・大七星・大数隣) ----------------

export interface ChiitoitsuResult {
  isChiitoitsu: boolean;
  isDaichiishin: boolean; // 大七星: 字牌7種を2枚ずつ
  isDaisuurin: boolean; // 大数隣: 萬子2〜8を2枚ずつ
  /** 対子7組それぞれの牌種(混一色・清一色・混老頭など、七対子と複合する役の判定に使う) */
  kinds: TileKind[];
}

export function analyzeChiitoitsu(concealedTiles: Tile[]): ChiitoitsuResult | null {
  if (concealedTiles.length !== 14) return null;

  const buckets = bucketize(concealedTiles);
  if (buckets.size !== 7) return null;
  for (const b of buckets.values()) {
    if (b.tiles.length !== 2) return null;
  }

  const kinds = Array.from(buckets.values()).map((b) => b.kind);
  const isDaichiishin = kinds.every((k) => k.kind === "honor");
  const isDaisuurin = kinds.every(
    (k) => k.kind === "number" && k.suit === "man" && k.rank >= 2 && k.rank <= 8
  );

  return { isChiitoitsu: true, isDaichiishin, isDaisuurin, kinds };
}

// ---------------- 九蓮宝燈 ----------------

export interface ChuurenResult {
  isChuuren: boolean;
  /** フリテンなし9面待ちだったか(和了前の13枚が 1112345678999 の純正形) */
  isNineSidedWait: boolean;
}

/**
 * 九蓮宝燈は門前・清一色(萬子)限定。
 * 判定条件: 萬子のみ14枚で、ランク1が3枚以上、ランク9が3枚以上、
 * ランク2〜8が1枚以上ずつ存在し、かつ全体が有効な(4面子+雀頭に分解できる)手であること。
 */
export function analyzeChuuren(concealedTiles: Tile[], winningTile: Tile): ChuurenResult | null {
  if (concealedTiles.length !== 14) return null;
  if (!concealedTiles.every((t) => t.kind.kind === "number" && t.kind.suit === "man")) {
    return null;
  }

  const counts = new Array(10).fill(0);
  for (const t of concealedTiles) {
    if (t.kind.kind === "number" && t.kind.suit === "man") {
      counts[t.kind.rank]++;
    }
  }

  const basicShapeOk =
    counts[1] >= 3 && counts[9] >= 3 && [2, 3, 4, 5, 6, 7, 8].every((r) => counts[r] >= 1);
  if (!basicShapeOk) return null;

  // 実際に4面子+雀頭へ分解できることを確認(=正式に和了形になっているか)
  const decompositions = decomposeConcealedHand(concealedTiles, 4);
  if (decompositions.length === 0) return null;

  // 和了前の13枚が純正形(1,1,1,2,3,4,5,6,7,8,9,9,9)かどうかで9面待ちを判定
  const preWinCounts = [...counts];
  if (winningTile.kind.kind === "number" && winningTile.kind.suit === "man") {
    preWinCounts[winningTile.kind.rank]--;
  }
  const isPureThirteen =
    preWinCounts[1] === 3 &&
    preWinCounts[9] === 3 &&
    [2, 3, 4, 5, 6, 7, 8].every((r) => preWinCounts[r] === 1) &&
    preWinCounts.reduce((a, b) => a + b, 0) === 13;

  return { isChuuren: true, isNineSidedWait: isPureThirteen };
}
