import { Tile, TileKind, allTileKinds, tileKindKey } from "../types/tile";
import { Meld } from "../types/meld";
import { decomposeConcealedHand, bucketize } from "./decompose";
import { analyzeKokushi, analyzeChiitoitsu } from "./specialHands";

let dummyIdCounter = 0;
function makeDummyTile(kind: TileKind): Tile {
  dummyIdCounter++;
  return { id: `dummy#${dummyIdCounter}`, kind, isRedDora: false };
}

function countKindInTiles(tiles: Tile[], kind: TileKind): number {
  const key = tileKindKey(kind);
  return tiles.filter((t) => tileKindKey(t.kind) === key).length;
}

function countKindInMelds(melds: Meld[], kind: TileKind): number {
  const key = tileKindKey(kind);
  let count = 0;
  for (const m of melds) {
    count += m.tiles.filter((t) => tileKindKey(t.kind) === key).length;
  }
  return count;
}

/** 与えられた牌(濃縮手牌+鳴き)が、その牌を加えることで和了形になるかどうか */
function isCompleteHand(hypotheticalConcealed: Tile[], melds: Meld[], winningTile: Tile): boolean {
  if (melds.length === 0) {
    const kokushi = analyzeKokushi(hypotheticalConcealed, winningTile);
    if (kokushi?.isKokushi) return true;

    const chiitoitsu = analyzeChiitoitsu(hypotheticalConcealed);
    if (chiitoitsu?.isChiitoitsu) return true;
  }

  const requiredSets = 4 - melds.length;
  return decomposeConcealedHand(hypotheticalConcealed, requiredSets).length > 0;
}

/**
 * 聴牌時に和了牌となり得る牌の種類を、全20種類を総当たりして求める。
 * このルールは牌の種類が20種類しかないため、力任せに試しても十分高速。
 *
 * NOTE: 「すでに場に4枚見えている牌は引けない」という可視牌の考慮は、
 * 手牌・鳴きの中にある分しかここでは見ていない(捨て牌や相手の手牌までは
 * 参照しない、待ちの理論上の広さを求めるための判定)。
 */
export function getWinningTileKinds(concealedTiles: Tile[], melds: Meld[]): TileKind[] {
  const winners: TileKind[] = [];

  for (const kind of allTileKinds()) {
    const usedCount = countKindInTiles(concealedTiles, kind) + countKindInMelds(melds, kind);
    if (usedCount >= 4) continue;

    const dummy = makeDummyTile(kind);
    const hypothetical = [...concealedTiles, dummy];
    if (isCompleteHand(hypothetical, melds, dummy)) {
      winners.push(kind);
    }
  }

  return winners;
}

/** 聴牌しているか(和了牌が1種類以上あるか) */
export function isTenpai(concealedTiles: Tile[], melds: Meld[]): boolean {
  return getWinningTileKinds(concealedTiles, melds).length > 0;
}

/** 2つの和了牌集合が(種類として)完全に同じかどうか。リーチ後の暗槓可否判定に使う。 */
export function sameWinningKinds(a: TileKind[], b: TileKind[]): boolean {
  if (a.length !== b.length) return false;
  const aKeys = new Set(a.map(tileKindKey));
  for (const k of b) {
    if (!aKeys.has(tileKindKey(k))) return false;
  }
  return true;
}
