import { Tile, TileKind, allTileKinds, tileKindKey } from "../types/tile";

/**
 * 向聴数(シャンテン数)の計算。このルールの80枚構成(萬子1-9・筒子/索子の1と9・字牌7種)に合わせてある。
 * 筒子・索子には1と9しかないため、順子(と両面・嵌張・辺張などの順子の塔子)は萬子にしか存在しない。
 *
 * 戻り値: -1 = 和了形、0 = 聴牌、1 以上 = n向聴。
 */

/** 全20種の牌の種類(インデックス順: 萬1-9=0..8, 筒1,9=9,10, 索1,9=11,12, 字牌=13..19) */
export const KIND_LIST: TileKind[] = allTileKinds();
const KIND_INDEX = new Map<string, number>(KIND_LIST.map((k, i) => [tileKindKey(k), i]));
export const KIND_COUNT = KIND_LIST.length; // 20
/** 萬子(順子を作れる唯一のスート)のインデックス範囲 [0, 8] */
const MAN_LAST = 8;

export function kindIndex(kind: TileKind): number {
  const idx = KIND_INDEX.get(tileKindKey(kind));
  if (idx === undefined) throw new Error(`unknown tile kind: ${tileKindKey(kind)}`);
  return idx;
}

/** 牌の配列を種類ごとの枚数配列(長さ20)にする */
export function toCounts(tiles: Tile[]): number[] {
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (const t of tiles) counts[kindIndex(t.kind)]++;
  return counts;
}

/** 么九牌(国士無双の対象)のインデックス */
const YAOCHU_INDICES = [0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

/**
 * 一般形(4面子1雀頭)の向聴数。meldCount は既に副露・槓で確定している面子の数。
 * 公式: 8 - 2*面子 - 塔子 - 雀頭(面子+塔子 は 4 まで)。
 */
export function standardShanten(counts: number[], meldCount: number): number {
  const c = counts.slice();
  let best = 8;

  const evaluate = (sets: number, partials: number, pair: number) => {
    const totalSets = sets + meldCount;
    const usablePartials = Math.min(partials, 4 - totalSets);
    const s = 8 - 2 * totalSets - usablePartials - pair;
    if (s < best) best = s;
  };

  // 面子を抜き出す段階(i から先を走査)。面子を取り尽くしたら塔子の段階へ移る。
  const extractSets = (i: number, sets: number, pair: number) => {
    while (i < KIND_COUNT && c[i] === 0) i++;
    if (i >= KIND_COUNT) {
      extractPartials(0, sets, 0, pair);
      return;
    }
    // 刻子
    if (c[i] >= 3) {
      c[i] -= 3;
      extractSets(i, sets + 1, pair);
      c[i] += 3;
    }
    // 順子(萬子のみ)
    if (i + 2 <= MAN_LAST && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      extractSets(i, sets + 1, pair);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    // この種類ではもう面子を取らない
    extractSets(i + 1, sets, pair);
  };

  const extractPartials = (i: number, sets: number, partials: number, pair: number) => {
    while (i < KIND_COUNT && c[i] === 0) i++;
    if (i >= KIND_COUNT) {
      evaluate(sets, partials, pair);
      return;
    }
    if (c[i] >= 2) {
      c[i] -= 2;
      // 雀頭として
      if (pair === 0) extractPartials(i, sets, partials, 1);
      // 対子(刻子の塔子)として
      extractPartials(i, sets, partials + 1, pair);
      c[i] += 2;
    }
    if (i <= MAN_LAST) {
      if (i + 1 <= MAN_LAST && c[i + 1] > 0) {
        c[i]--; c[i + 1]--;
        extractPartials(i, sets, partials + 1, pair);
        c[i]++; c[i + 1]++;
      }
      if (i + 2 <= MAN_LAST && c[i + 2] > 0) {
        c[i]--; c[i + 2]--;
        extractPartials(i, sets, partials + 1, pair);
        c[i]++; c[i + 2]++;
      }
    }
    // 孤立牌として捨て置く
    const saved = c[i];
    c[i] = 0;
    extractPartials(i + 1, sets, partials, pair);
    c[i] = saved;
  };

  extractSets(0, 0, 0);
  return best;
}

/** 七対子の向聴数(副露があれば成立しないので Infinity) */
export function chiitoitsuShanten(counts: number[], meldCount: number): number {
  if (meldCount > 0) return Infinity;
  let pairs = 0;
  let kinds = 0;
  for (const n of counts) {
    if (n > 0) kinds++;
    if (n >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** 国士無双の向聴数(副露があれば成立しないので Infinity) */
export function kokushiShanten(counts: number[], meldCount: number): number {
  if (meldCount > 0) return Infinity;
  let kinds = 0;
  let hasPair = false;
  for (const i of YAOCHU_INDICES) {
    if (counts[i] > 0) kinds++;
    if (counts[i] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** 枚数配列に対する向聴数(一般形・七対子・国士無双の最小値) */
export function shantenFromCounts(counts: number[], meldCount: number): number {
  return Math.min(
    standardShanten(counts, meldCount),
    chiitoitsuShanten(counts, meldCount),
    kokushiShanten(counts, meldCount)
  );
}

/**
 * 手牌(門前部分)と副露・槓の数から向聴数を求める。
 * concealed は 3n+1 枚(打牌後)または 3n+2 枚(ツモ直後)のどちらでもよい。
 */
export function calculateShanten(concealed: Tile[], meldCount: number): number {
  return shantenFromCounts(toCounts(concealed), meldCount);
}
