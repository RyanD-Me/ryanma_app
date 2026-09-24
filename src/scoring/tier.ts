import { YakuResult, FixedTier } from "../yaku/context";

/** 子の点数(ロン時の総取得点)。親はこれの1.5倍。 */
export const FIXED_CHILD_POINTS: Record<FixedTier, number> = {
  mangan: 8000,
  haneman: 12000,
  baiman: 16000,
  sanbaiman: 24000,
};

export const YAKUMAN_CHILD_POINTS = 32000;

export type TierInfo =
  | { kind: "yakuman"; multiplier: number }
  | { kind: "fixed"; tier: FixedTier }
  | { kind: "points"; han: number; fu: number };

/**
 * 役判定結果(YakuResult[])と符、ドラ翻数から、最終的な点数帯を決定する。
 *
 * 優先順位:
 * 1. 役満(isYakuman)が1つでもあれば、役満同士の翻数(倍率)を合算する
 *    (数え役満を除く役満同士の複合ありというルールに対応)。この時点で通常役
 *    (n翻役)は evaluateYaku 側で既に判定結果から除かれているため、ここでは
 *    役満同士の合算だけを考えればよい。
 * 2. それ以外は、通常役の翻数 + ドラ翻数を合計し、その合計翻数から帯を決定する
 *    (13翻以上は数え役満、切り上げ満貫の判定も含む)。三槓子(11翻)・大三元(鳴き)
 *    (8翻)・四暗刻シャンポン(8翻)・国士無双非13面(8翻)のような、実際の麻雀では
 *    符に依存しない固定帯として扱われる役も、単なる高翻数の通常役として
 *    ここで合算されることで、結果的に同じ点数帯(倍満・三倍満)に落ち着く。
 */
/** 通常役・ドラを合算した翻数(役満が確定している場合はそもそも使わない)。 */
export function totalHanOf(yakuList: YakuResult[], doraHan: number): number {
  let hanTotal = doraHan;
  for (const y of yakuList) {
    hanTotal += y.han ?? 0;
  }
  return hanTotal;
}

export function resolveTier(yakuList: YakuResult[], fu: number, doraHan: number): TierInfo {
  const yakumanEntries = yakuList.filter((y) => y.isYakuman);
  if (yakumanEntries.length > 0) {
    const multiplier = yakumanEntries.reduce((sum, y) => sum + (y.yakumanMultiplier ?? 1), 0);
    return { kind: "yakuman", multiplier };
  }

  const hanTotal = totalHanOf(yakuList, doraHan);

  if (hanTotal >= 13) return { kind: "yakuman", multiplier: 1 }; // 数え役満
  if (hanTotal >= 11) return { kind: "fixed", tier: "sanbaiman" };
  if (hanTotal >= 8) return { kind: "fixed", tier: "baiman" };
  if (hanTotal >= 6) return { kind: "fixed", tier: "haneman" };
  if (hanTotal === 5) return { kind: "fixed", tier: "mangan" };

  // 切り上げ満貫
  if ((hanTotal === 4 && fu === 30) || (hanTotal === 3 && fu === 60)) {
    return { kind: "fixed", tier: "mangan" };
  }

  const kihonten = fu * Math.pow(2, 2 + hanTotal);
  if (kihonten >= 2000) {
    return { kind: "fixed", tier: "mangan" };
  }

  return { kind: "points", han: hanTotal, fu };
}
