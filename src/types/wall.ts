import { Tile } from "./tile";

/**
 * 牌山(壁牌)
 *
 * 配牌枚数・王牌の枚数は通常の四人麻雀と同じ(変更なし)。
 * 全80枚 → 配牌13枚×2人=26枚、王牌14枚を除いた
 * 80-26-14=40枚が自摸山(liveWall)の枚数になる。
 *
 * 王牌14枚の内訳:
 *  - 嶺上牌(カン用) 4枚
 *  - 表ドラ表示牌   5枚(最初に1枚、カンのたびに1枚ずつめくる)
 *  - 裏ドラ表示牌   5枚(表と同じ位置が対応。カン裏ありのため、
 *    表をめくった枚数と同じ枚数だけ有効になる)
 */
export interface Wall {
  /** これから自摸で取られていく牌(先頭から取る想定) */
  liveWall: Tile[];
  /** 表ドラ表示牌のうち、まだ伏せてある分(先頭からめくる) */
  doraIndicatorTiles: Tile[];
  /** めくって公開済みの表ドラ表示牌 */
  revealedDoraIndicators: Tile[];
  /**
   * 裏ドラ表示牌(常に伏せたまま)。
   * i番目の要素が i番目の表ドラ表示牌と対応しており、
   * revealedDoraIndicators.length 枚分だけが有効(カン裏あり)。
   * 実際に参照できるのはリーチ和了時のみ。
   */
  uraDoraIndicatorTiles: Tile[];
  /** カン成立時に補充する嶺上牌(リンシャン牌) */
  deadWallDraws: Tile[];
}

/** 山から自摸(ツモ)できるかどうかの残り枚数チェック用 */
export function remainingDrawCount(wall: Wall): number {
  return wall.liveWall.length;
}

/**
 * 現在有効な裏ドラ表示牌(表をめくった枚数と同じ枚数分)。
 * リーチ和了時のドラ計算でのみ使う。
 */
export function activeUraDoraIndicators(wall: Wall): Tile[] {
  return wall.uraDoraIndicatorTiles.slice(0, wall.revealedDoraIndicators.length);
}
