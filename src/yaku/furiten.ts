import { Tile, tileKindKey } from "../types/tile";
import { Meld } from "../types/meld";
import { getWinningTileKinds } from "./tenpai";

/**
 * 永続フリテン: 自分の捨て牌の中に、現在の待ち牌と同じ種類が含まれていればフリテン。
 * 聴牌していない場合はフリテンの概念自体が無意味なので false を返す。
 *
 * NOTE: 同巡内の一時的フリテン(相手の捨てた和了牌を見逃した場合、
 * 次に自分が打牌するまでの間だけロン不可になるもの)はここでは扱わない。
 * ゲーム進行側(このゲームでは1手番1相手なので、直前の相手の捨て牌に対して
 * ロンしなかった場合のフラグ)で別途管理する想定。
 */
export function isPermanentFuriten(concealedTiles: Tile[], melds: Meld[], ownDiscards: Tile[]): boolean {
  const winningKinds = getWinningTileKinds(concealedTiles, melds);
  if (winningKinds.length === 0) return false;

  const winningKeys = new Set(winningKinds.map(tileKindKey));
  return ownDiscards.some((t) => winningKeys.has(tileKindKey(t.kind)));
}

/**
 * ロンの見逃しによってフリテンになっているか。
 *
 * - 同巡内の一時的フリテン(isTemporaryFuriten): 自分が次に打牌するまでロン不可。
 * - リーチ後の見逃し(isRiichiMissedFuriten): その局が終わるまでロン不可。
 *
 * 2種類のフリテンを判定し忘れないよう、ロン可否を見る箇所では必ずこの関数を通す。
 */
export function isMissedRonFuriten(player: {
  isTemporaryFuriten: boolean;
  isRiichiMissedFuriten: boolean;
}): boolean {
  return player.isTemporaryFuriten || player.isRiichiMissedFuriten;
}
