import { Tile } from "./tile";

/**
 * 面子(メンツ)の種類
 *
 * このMeld型は「副露(鳴き)によって、または槓によって手牌から
 * 分離・公開された面子」だけを表す。自摸のみで完成した順子・暗刻は
 * 手牌(hand)の中に牌のまま残り、和了時に初めて分解されるため
 * ここには含まれない。
 *
 * チーは不可のルールのため、順子(sequence)がMeldとして
 * 現れることはない(=常に non-open。呼ぶ場面がないので型自体を
 * 用意していない)。鳴きで成立しうるのはポン(刻子)とカンのみ。
 */
export type MeldType =
  | "triplet" // 刻子(ポン)
  | "kan_open" // 明槓(大明槓・加槓)
  | "kan_closed"; // 暗槓

export interface Meld {
  type: MeldType;
  tiles: Tile[]; // 刻子=3枚、槓子=4枚
  /** 鳴いた牌(相手の捨て牌、または加槓元の牌) */
  calledTile?: Tile;
  /** 誰から鳴いたか(暗槓では undefined) */
  calledFrom?: "opponent";
  /** 副露(鳴き)によって成立したか。false なら暗刻・暗槓(手の中で完成) */
  isOpen: boolean;
  /**
   * type が "kan_open" のとき、大明槓(相手の捨て牌を直接カン)ではなく
   * 加槓(既存のポンに4枚目を足す形)で成立したかどうか。
   * フロントエンドで表示形(4枚目を上に重ねる等)を分けるための表示専用フラグ。
   */
  viaKakan?: boolean;
}
