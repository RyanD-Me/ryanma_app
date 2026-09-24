import { Tile, Honor } from "../types/tile";
import { Meld } from "../types/meld";

/** 風のみを表す字牌(東・南・西・北) */
export type WindHonor = "east" | "south" | "west" | "north";

export interface WinContext {
  isTsumo: boolean;
  /** 自分の自風 */
  seatWind: WindHonor;
  /** 場風 */
  roundWind: WindHonor;
  isRiichi: boolean;
  isDoubleRiichi: boolean;
  /** リーチ後1巡以内・鳴きなしでの和了か */
  isIppatsu: boolean;
  /** 海底摸月(山の最後の1枚でのツモ和了) */
  isHaitei: boolean;
  /** 河底撈魚(最後の捨て牌でのロン和了) */
  isHoutei: boolean;
  /** 嶺上開花(カンの後に引いた嶺上牌でのツモ和了) */
  isRinshan?: boolean;
  /**
   * フリテンでないかどうか。
   * TODO: フリテン判定は捨て牌履歴を参照する別モジュールで行い、
   * その結果をここに渡す想定(このモジュール単体では判定しない)。
   */
  isFuriten: boolean;
  /** 実際に和了を完成させた牌 */
  winningTile: Tile;
  /**
   * 天和(親の配牌後最初のツモで和了、鳴き・カンなし)。役満。
   * 和了牌は14枚のうち最も高い点数になる牌を選んだものとして扱う(evaluateYaku 側で処理)。
   */
  isTenhou?: boolean;
  /** 地和(子の最初のツモで和了、それ以前に鳴き・カン(暗槓含む)なし)。役満。 */
  isChiihou?: boolean;
}

export interface HandForEvaluation {
  /** 手牌のうち、鳴き・カンで独立していない部分(和了牌を含む) */
  concealedTiles: Tile[];
  /** 副露・槓によって独立した面子(ポン・明槓・暗槓) */
  melds: Meld[];
}

/** 点数帯(役満は含まない)。役の翻数の合計から resolveTier が導出する。 */
export type FixedTier = "mangan" | "haneman" | "baiman" | "sanbaiman";

export interface YakuResult {
  id: string;
  name: string;
  isYakuman: boolean;
  /** isYakuman の場合のみ。1=役満、2=ダブル役満(複合時は合計値で表記: 3=トリプル役満、4=四倍役満…) */
  yakumanMultiplier?: number;
  /**
   * 通常役(役満以外)の翻数(門前・鳴きの差はここで解決済みの値を入れる)。
   * 四暗刻シャンポン・国士無双(非13面)・大三元(鳴き)・三槓子のように、実際の麻雀では
   * 符に依存しない固定の点数帯(倍満=8翻・三倍満=11翻)として扱われる役も、
   * このコードベースでは単純にその翻数の通常役として表現する。
   */
  han?: number;
  /** 他の役・ドラと合算してよいか(役満単体で完結する役や、役満と複合しない場合は false) */
  combinable: boolean;
}

export interface EvaluationResult {
  isWin: boolean;
  yaku: YakuResult[];
  /** 通常形の符(七対子は25固定、役満のみが確定している手では未使用のため0) */
  fu: number;
}
