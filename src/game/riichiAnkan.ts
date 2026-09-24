import { Tile, TileKind, tileKindKey } from "../types/tile";
import { Meld } from "../types/meld";
import { getWinningTileKinds, sameWinningKinds } from "../yaku/tenpai";
import { decomposeConcealedHand } from "../yaku/decompose";

/**
 * リーチ後の暗槓が許されるかどうかを判定する。次のすべてを満たす場合だけ可能:
 *   1. 今ツモってきた牌で4枚目が揃った(手の中の3枚+ツモ)。すでに4枚持っていた牌をカンする
 *      「送り槓」は不可。
 *   2. 待ち牌が変わらない(例: 4445 は 3・5・6 待ちだが、4をカンすると5単騎になるので不可)。
 *   3. 牌の構成・待ちの形が変わらない: カンする前の聴牌形で、どの待ち牌で和了した場合の
 *      どの面子の取り方でも、その3枚が常に刻子になっている。
 *      (例: 11123444 の1・4、1113444 の1 は、雀頭や嵌張の一部としても取れるので不可)
 *
 * @param concealedBeforeDraw リーチ宣言時に確定していた13枚の手牌
 * @param concealedAfterDraw  今回ツモした後の14枚の手牌(暗槓対象の4枚を含む)
 * @param melds 既存の副露・槓
 * @param kind 暗槓しようとしている牌の種類
 */
export function canAnkanDuringRiichi(
  concealedBeforeDraw: Tile[],
  concealedAfterDraw: Tile[],
  melds: Meld[],
  kind: TileKind
): boolean {
  const beforeWaits = getWinningTileKinds(concealedBeforeDraw, melds);
  const kindKey = tileKindKey(kind);

  // 1. ツモ牌がその種類であること(送り槓の禁止)
  const beforeIds = new Set(concealedBeforeDraw.map((t) => t.id));
  const drawn = concealedAfterDraw.filter((t) => !beforeIds.has(t.id));
  if (drawn.length !== 1 || tileKindKey(drawn[0].kind) !== kindKey) return false;

  // 3. どの和了形・面子の取り方でも、その3枚が刻子であること
  if (beforeWaits.length === 0) return false;
  const requiredSets = 4 - melds.length;
  for (const w of beforeWaits) {
    const winTile: Tile = { id: `riichi-ankan-check-${tileKindKey(w)}`, kind: w, isRedDora: false };
    const decompositions = decomposeConcealedHand([...concealedBeforeDraw, winTile], requiredSets);
    if (decompositions.length === 0) return false; // 七対子・国士無双などの特殊形では刻子にならない
    for (const groups of decompositions) {
      const isTriplet = groups.some((g) => g.type === "triplet" && tileKindKey(g.tiles[0].kind) === kindKey);
      if (!isTriplet) return false;
    }
  }

  const kanTiles: Tile[] = [];
  const afterTiles: Tile[] = [];
  for (const t of concealedAfterDraw) {
    if (tileKindKey(t.kind) === kindKey && kanTiles.length < 4) {
      kanTiles.push(t);
    } else {
      afterTiles.push(t);
    }
  }
  if (kanTiles.length !== 4) {
    // そもそも4枚揃っていなければ暗槓自体ができない
    return false;
  }

  const kanMeld: Meld = { type: "kan_closed", tiles: kanTiles, isOpen: false };
  const afterWaits = getWinningTileKinds(afterTiles, [...melds, kanMeld]);

  return sameWinningKinds(beforeWaits, afterWaits);
}
