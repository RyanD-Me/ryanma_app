/**
 * 牌(パイ)関連の型定義
 *
 * 使用牌(全80枚):
 *  - 萬子 1〜9 各4枚 = 36枚
 *  - 筒子 1・9    各4枚 = 8枚
 *  - 索子 1・9    各4枚 = 8枚
 *  - 字牌 7種      各4枚 = 28枚
 *  合計 80枚
 */

/** 数牌のスート */
export type NumberSuit = "man" | "pin" | "sou";

/** 字牌の種類(風牌4種 + 三元牌3種 = 7種) */
export type Honor =
  | "east" // 東
  | "south" // 南
  | "west" // 西
  | "north" // 北
  | "white" // 白(白板)
  | "green" // 發
  | "red"; // 中

/** 萬子で使える数字(1〜9) */
export type ManRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** 筒子・索子で使える数字(1と9のみ) */
export type TerminalRank = 1 | 9;

/** 数牌本体 */
export type NumberTile =
  | { kind: "number"; suit: "man"; rank: ManRank }
  | { kind: "number"; suit: "pin"; rank: TerminalRank }
  | { kind: "number"; suit: "sou"; rank: TerminalRank };

/** 字牌本体 */
export interface HonorTile {
  kind: "honor";
  honor: Honor;
}

/** 牌の「種類」(赤ドラ等の付随情報を除いた同一視できる単位) */
export type TileKind = NumberTile | HonorTile;

/**
 * 赤ドラの扱いは未確定のためオプショナルにしてある。
 * ルールが決まったら isRedDora を必須化するか、
 * 別途 RedDoraTile 型に分けるか検討する。
 * TODO: 赤ドラ(赤5など)を採用するか要確認
 */
export interface Tile {
  /** 牌1枚ごとに一意なID(同じ種類が4枚あるため区別用) */
  id: string;
  /** 牌の種類 */
  kind: TileKind;
  /** 赤ドラかどうか(未採用なら常にfalse) */
  isRedDora: boolean;
}

/** 2枚の牌が「同じ種類」かどうかを判定するためのキー文字列を作る */
export function tileKindKey(kind: TileKind): string {
  if (kind.kind === "number") {
    return `number:${kind.suit}:${kind.rank}`;
  }
  return `honor:${kind.honor}`;
}

/** すべての牌の種類(重複なし)を列挙する。牌山生成の元データに使う。 */
export function allTileKinds(): TileKind[] {
  const kinds: TileKind[] = [];

  // 萬子 1-9
  for (let rank = 1; rank <= 9; rank++) {
    kinds.push({ kind: "number", suit: "man", rank: rank as ManRank });
  }
  // 筒子 1・9
  for (const rank of [1, 9] as TerminalRank[]) {
    kinds.push({ kind: "number", suit: "pin", rank });
  }
  // 索子 1・9
  for (const rank of [1, 9] as TerminalRank[]) {
    kinds.push({ kind: "number", suit: "sou", rank });
  }
  // 字牌 7種
  const honors: Honor[] = [
    "east",
    "south",
    "west",
    "north",
    "white",
    "green",
    "red",
  ];
  for (const honor of honors) {
    kinds.push({ kind: "honor", honor });
  }

  return kinds;
}
