import { HandForEvaluation, WinContext, YakuResult } from "../yaku/context";
import { evaluateYaku } from "../yaku/evaluate";
import { resolveTier, totalHanOf, TierInfo, FIXED_CHILD_POINTS, YAKUMAN_CHILD_POINTS } from "./tier";

export interface ScoreResult {
  isWin: boolean;
  tier: TierInfo | null;
  /** 実際に授受される点数。ロンなら放銃者の支払額、ツモなら相手1人の支払額(二人麻雀なので常に1人払い)。 */
  points: number;
  /** 成立した役の一覧(表示用) */
  yaku: YakuResult[];
  /** 符(七対子は25符固定、役満のみが確定した手では使わない) */
  fu: number;
  /**
   * ドラを含めた合計翻数(表示用)。
   * 役満や単独扱いの固定帯が確定した場合は翻数で点数が決まらないため undefined。
   */
  totalHan?: number;
}

/** 子(非親)の総取得点(ロン基準)を求める */
function childTotalPoints(tier: TierInfo): number {
  if (tier.kind === "yakuman") {
    return YAKUMAN_CHILD_POINTS * tier.multiplier;
  }
  if (tier.kind === "fixed") {
    return FIXED_CHILD_POINTS[tier.tier];
  }
  // 基本点 = 符 × 2^(2+翻)、子のロンは基本点の4倍
  const kihonten = tier.fu * Math.pow(2, 2 + tier.han);
  return kihonten * 4;
}

/**
 * 和了点を計算する。
 *
 * @param isDealer 和了者が親(東家)かどうか
 * @param doraHan 表ドラ・裏ドラの合計翻数(役満・単独扱いの固定帯が確定した場合は無視される)
 */
export function calculateScore(
  hand: HandForEvaluation,
  context: WinContext,
  isDealer: boolean,
  doraHan: number
): ScoreResult {
  const evaluation = evaluateYaku(hand, context);
  if (!evaluation.isWin || evaluation.yaku.length === 0) {
    return { isWin: false, tier: null, points: 0, yaku: [], fu: 0 };
  }

  const tier = resolveTier(evaluation.yaku, evaluation.fu, doraHan);

  let total = childTotalPoints(tier);
  if (isDealer) {
    total *= 1.5;
  }
  if (context.isTsumo) {
    // ツモ和了時は和了点(ロン基準の総額)を4分の3にしてから端数処理する独自ルール
    total *= 3 / 4;
  }
  total = Math.ceil(total / 1000) * 1000;

  // 翻数で点数帯が決まったケース(=役満が成立していない)のみ、合計翻数を表示用に持たせる
  const decidedByHan = !evaluation.yaku.some((y) => y.isYakuman);
  const totalHan = decidedByHan ? totalHanOf(evaluation.yaku, doraHan) : undefined;

  return { isWin: true, tier, points: total, yaku: evaluation.yaku, fu: evaluation.fu, totalHan };
}
