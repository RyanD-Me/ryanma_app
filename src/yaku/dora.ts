import { Tile, TileKind, tileKindKey, ManRank, TerminalRank, Honor } from "../types/tile";
import { Wall, activeUraDoraIndicators } from "../types/wall";
import { HandForEvaluation } from "./context";

/**
 * ドラ表示牌から、実際のドラとなる牌の種類を求める。
 *
 * このルールは使用牌が特殊なため、循環は「実際に存在する牌だけ」で閉じる:
 *  - 萬子: 1→2→…→9→1(通常通り)
 *  - 筒子・索子: 1と9しかないため 1→9、9→1
 *  - 風牌: 東→南→西→北→東
 *  - 三元牌: 白→發→中→白
 */
export function doraFromIndicator(indicator: TileKind): TileKind {
  if (indicator.kind === "number") {
    if (indicator.suit === "man") {
      const next = indicator.rank === 9 ? 1 : ((indicator.rank + 1) as ManRank);
      return { kind: "number", suit: "man", rank: next as ManRank };
    }
    // 筒子・索子は1と9のみなので、その2枚で循環する
    const next: TerminalRank = indicator.rank === 1 ? 9 : 1;
    return { kind: "number", suit: indicator.suit, rank: next };
  }

  const WIND_CYCLE: Honor[] = ["east", "south", "west", "north"];
  const DRAGON_CYCLE: Honor[] = ["white", "green", "red"];

  const windIndex = WIND_CYCLE.indexOf(indicator.honor);
  if (windIndex >= 0) {
    return { kind: "honor", honor: WIND_CYCLE[(windIndex + 1) % WIND_CYCLE.length] };
  }
  const dragonIndex = DRAGON_CYCLE.indexOf(indicator.honor);
  return { kind: "honor", honor: DRAGON_CYCLE[(dragonIndex + 1) % DRAGON_CYCLE.length] };
}

/** 和了手に含まれるすべての牌(濃縮手牌+鳴き・カンした面子)を平坦に並べる */
export function allTilesOfHand(hand: HandForEvaluation): Tile[] {
  return [...hand.concealedTiles, ...hand.melds.flatMap((m) => m.tiles)];
}

/** 指定したドラ表示牌の一覧に対して、手牌に含まれるドラの枚数(=翻数)を数える */
export function countDoraTiles(tiles: Tile[], indicators: Tile[]): number {
  if (indicators.length === 0) return 0;

  const doraKeys = indicators.map((ind) => tileKindKey(doraFromIndicator(ind.kind)));
  let count = 0;
  for (const tile of tiles) {
    const key = tileKindKey(tile.kind);
    for (const doraKey of doraKeys) {
      if (key === doraKey) count++;
    }
  }
  return count;
}

export interface DoraBreakdown {
  /** 表ドラの枚数 */
  dora: number;
  /** 裏ドラの枚数(リーチしていない場合は常に0) */
  uraDora: number;
  /** 合計翻数 */
  total: number;
}

/**
 * 和了手のドラ翻数を計算する。
 * 裏ドラはリーチして和了した場合のみ適用される(カン裏あり)。
 */
export function countDoraForHand(hand: HandForEvaluation, wall: Wall, isRiichi: boolean): DoraBreakdown {
  const tiles = allTilesOfHand(hand);
  const dora = countDoraTiles(tiles, wall.revealedDoraIndicators);
  const uraDora = isRiichi ? countDoraTiles(tiles, activeUraDoraIndicators(wall)) : 0;
  return { dora, uraDora, total: dora + uraDora };
}
