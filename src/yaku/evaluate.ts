import { decomposeConcealedHand } from "./decompose";
import { analyzeKokushi, analyzeChiitoitsu, analyzeChuuren } from "./specialHands";
import { toWinningGroups, determineWaitPattern } from "./waitPattern";
import { evaluateStandardYaku, evaluateSituationalYaku, evaluateChiitoitsuShapeYaku } from "./standardYaku";
import { HandForEvaluation, WinContext, YakuResult, EvaluationResult } from "./context";
import { calculateFu, CHIITOITSU_FU } from "./fu";
import { TileKind, tileKindKey } from "../types/tile";

/**
 * 役満・ダブル役満は、他の役満・ダブル役満とは複合するが、それ以外の通常役(n翻役)とは
 * 複合しない(実際の点数計算(resolveTier)でも通常役側は無視されるため、判定結果の一覧
 * 自体もそれに合わせて絞り込む)。役満が1つも無ければ何もしない。
 */
function excludeNonYakumanIfYakumanPresent(yakuList: YakuResult[]): YakuResult[] {
  if (!yakuList.some((y) => y.isYakuman)) return yakuList;
  return yakuList.filter((y) => y.isYakuman);
}

/** 複数の役判定候補(手牌の解釈違い)から、最も点数が高くなるものを選ぶための比較値 */
function scoreForComparison(yakuList: YakuResult[], fu: number): number {
  let yakumanTotal = 0;
  let hanTotal = 0;
  for (const y of yakuList) {
    if (y.isYakuman) {
      yakumanTotal += y.yakumanMultiplier ?? 1;
    } else {
      hanTotal += y.han ?? 0;
    }
  }
  if (yakumanTotal > 0) {
    // 役満が成立している場合、通常役の翻数は点数(比較値)に影響させない
    return yakumanTotal * 1000000;
  }
  // 翻数が同じ場合は符の高さで実際の点数が変わるため、僅かな重みとして加味する
  return hanTotal * 100 + fu;
}

function buildKokushiYaku(isThirteenWait: boolean): YakuResult {
  if (isThirteenWait) {
    return { id: "kokushi_13", name: "純正国士無双", isYakuman: true, yakumanMultiplier: 1, combinable: false };
  }
  return { id: "kokushi_other", name: "国士無双", isYakuman: false, han: 8, combinable: true };
}

/**
 * 七対子系の役一覧を組み立てる。
 *
 * 大七星・大数隣は専用の役満のため、それ以外の役(混一色・清一色・混老頭、および
 * リーチ・一発・門前清自摸和などの状況役)とは複合させない(役満は他の役満とのみ複合)。
 * 通常の七対子はこれらすべてと複合し得るため、手牌の形に基づく役・状況役を合わせて判定する。
 * 最終的な役満の絞り込みは呼び出し側(evaluateYaku)の excludeNonYakumanIfYakumanPresent で行う。
 */
function buildChiitoitsuYaku(
  result: { isDaichiishin: boolean; isDaisuurin: boolean; kinds: TileKind[] },
  context: WinContext
): YakuResult[] {
  const base: YakuResult[] = result.isDaichiishin
    ? [{ id: "daichiishin", name: "大七星", isYakuman: true, yakumanMultiplier: 1, combinable: false }]
    : result.isDaisuurin
      ? [{ id: "daisuurin", name: "大数隣", isYakuman: true, yakumanMultiplier: 1, combinable: false }]
      : [{ id: "chiitoitsu", name: "七対子", isYakuman: false, han: 2, combinable: true }];

  const shapeYaku = result.isDaichiishin || result.isDaisuurin ? [] : evaluateChiitoitsuShapeYaku(result.kinds);
  // 七対子は常に門前(鳴きなしが前提の特殊形)なので isMenzen は常に true。
  const situationalYaku = evaluateSituationalYaku(context, true);

  return excludeNonYakumanIfYakumanPresent([...base, ...shapeYaku, ...situationalYaku]);
}

function buildChuurenYaku(isNineSidedWait: boolean): YakuResult {
  if (isNineSidedWait) {
    return { id: "chuuren_9men", name: "純正九蓮宝燈", isYakuman: true, yakumanMultiplier: 2, combinable: false };
  }
  return { id: "chuuren", name: "九蓮宝燈", isYakuman: true, yakumanMultiplier: 1, combinable: false };
}

/**
 * 和了した手牌から成立する役を判定する。
 *
 * NOTE: フリテン判定(国士無双13面・九蓮宝燈9面待ちの「フリテンなし」条件)は
 * 捨て牌履歴を必要とするため、この関数の外部で判定し context.isFuriten に
 * 結果を渡してもらう想定。ここでは isFuriten をそのまま反映するだけ。
 */
export function evaluateYaku(hand: HandForEvaluation, context: WinContext): EvaluationResult {
  if (context.isTenhou) {
    // 天和: 和了牌(ツモ牌)は14枚のうち最も点数が高くなる牌とみなす。
    // 手牌に含まれる牌の種類ごとにその牌を和了牌として判定し、最良の結果を採用する
    // (四暗刻単騎・純正九蓮宝燈・純正国士無双などとの複合が可能になる)。
    const baseContext: WinContext = { ...context, isTenhou: false, isChiihou: false };
    const seen = new Set<string>();
    let best: EvaluationResult | null = null;
    let bestScore = -1;
    for (const t of hand.concealedTiles) {
      const key = tileKindKey(t.kind);
      if (seen.has(key)) continue;
      seen.add(key);
      const r = evaluateYakuCore(hand, { ...baseContext, winningTile: t });
      if (!r.isWin) continue;
      const score = scoreForComparison(r.yaku, r.fu);
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (!best) return { isWin: false, yaku: [], fu: 0 };
    return { isWin: true, yaku: excludeNonYakumanIfYakumanPresent([TENHOU, ...best.yaku]), fu: best.fu };
  }
  const result = evaluateYakuCore(hand, context);
  if (context.isChiihou && result.isWin) {
    return { ...result, yaku: excludeNonYakumanIfYakumanPresent([CHIIHOU, ...result.yaku]) };
  }
  return result;
}

const TENHOU: YakuResult = { id: "tenhou", name: "天和", isYakuman: true, yakumanMultiplier: 1, combinable: false };
const CHIIHOU: YakuResult = { id: "chiihou", name: "地和", isYakuman: true, yakumanMultiplier: 1, combinable: false };

function evaluateYakuCore(hand: HandForEvaluation, context: WinContext): EvaluationResult {
  const isMenzen = hand.melds.every((m) => !m.isOpen);

  // ---- 特殊形(門前限定): 国士無双、七対子系 ----
  // 七対子形(同じ種類の牌がちょうど2枚ずつ×7組)は、同じ牌構成のまま
  // 標準形(4面子+雀頭)としても解釈できてしまう場合がある
  // (例: 同一順子を2回ずつ使う二盃口の形は、必ず七対子としても成立する)。
  // そのため七対子は即座に確定させず、点数の高い方を採用する候補として保持する
  // (国士無双は牌構成上、標準形との併存が起こり得ないためそのまま確定させてよい)。
  let chiitoitsuCandidate: { yaku: YakuResult[]; fu: number } | null = null;
  if (hand.melds.length === 0) {
    const kokushi = analyzeKokushi(hand.concealedTiles, context.winningTile);
    if (kokushi?.isKokushi) {
      const isThirteenWait = kokushi.isThirteenWait && !context.isFuriten;
      if (isThirteenWait) {
        // 純正国士無双(13面待ち)は役満のため、他の役満以外とは複合しない。
        return { isWin: true, yaku: [buildKokushiYaku(true)], fu: 0 };
      }
      // 国士無双(非13面待ち、8翻)は役満ではない通常役のため、
      // 立直・一発・門前清自摸和・海底摸月・河底撈魚などの状況役と複合する
      // (国士無双は常に門前かつ標準形との併存が起こり得ないため、そのまま確定させてよい)。
      const situationalYaku = evaluateSituationalYaku(context, true);
      return { isWin: true, yaku: [buildKokushiYaku(false), ...situationalYaku], fu: 0 };
    }

    const chiitoitsu = analyzeChiitoitsu(hand.concealedTiles);
    if (chiitoitsu?.isChiitoitsu) {
      chiitoitsuCandidate = { yaku: buildChiitoitsuYaku(chiitoitsu, context), fu: CHIITOITSU_FU };
      if (chiitoitsu.isDaichiishin) {
        // 大七星と字一色(標準形)の複合は認めず、大七星を優先する。
        // 両条件を満たし得る手牌であっても、他の解釈(標準形分解)とは比較せず
        // 大七星をそのまま確定させる。
        return { isWin: true, yaku: chiitoitsuCandidate.yaku, fu: chiitoitsuCandidate.fu };
      }
    }
  }

  // ---- 通常形(4面子+雀頭) ----
  const requiredSets = 4 - hand.melds.length;
  const decompositions = decomposeConcealedHand(hand.concealedTiles, requiredSets);
  if (decompositions.length === 0) {
    if (chiitoitsuCandidate) {
      return { isWin: true, yaku: chiitoitsuCandidate.yaku, fu: chiitoitsuCandidate.fu };
    }
    return { isWin: false, yaku: [], fu: 0 };
  }

  // 九蓮宝燈は解釈(面子分解)に依らず、生の牌構成だけで判定できる
  let chuurenYaku: YakuResult | null = null;
  if (isMenzen && hand.melds.length === 0) {
    const chuuren = analyzeChuuren(hand.concealedTiles, context.winningTile);
    if (chuuren?.isChuuren) {
      const isNineSidedWait = chuuren.isNineSidedWait && !context.isFuriten;
      chuurenYaku = buildChuurenYaku(isNineSidedWait);
    }
  }

  let best: YakuResult[] | null = null;
  let bestFu = 0;
  let bestScore = -1;
  if (chiitoitsuCandidate) {
    best = chiitoitsuCandidate.yaku;
    bestFu = chiitoitsuCandidate.fu;
    bestScore = scoreForComparison(chiitoitsuCandidate.yaku, chiitoitsuCandidate.fu);
  }
  for (const decomposition of decompositions) {
    const groups = toWinningGroups(decomposition, hand.melds);
    const yakuList = evaluateStandardYaku(groups, isMenzen, context);
    if (chuurenYaku) {
      yakuList.push(chuurenYaku);
    }
    const wait = determineWaitPattern(groups, context.winningTile);
    const hasPinfu = yakuList.some((y) => y.id === "pinfu");
    const fu = calculateFu(groups, isMenzen, context.isTsumo, wait, context, hasPinfu);
    // 役満・ダブル役満が成立していれば、他の通常役(n翻役)は判定結果からも除く。
    const finalYakuList = excludeNonYakumanIfYakumanPresent(yakuList);
    const score = scoreForComparison(finalYakuList, fu);
    if (score > bestScore) {
      bestScore = score;
      best = finalYakuList;
      bestFu = fu;
    }
  }

  return { isWin: true, yaku: best ?? [], fu: bestFu };
}
