import { GameState } from "../types/game";
import { Seat } from "../types/player";
import { Meld } from "../types/meld";
import { seatWindOf } from "../game/actions";
import { doraFromIndicator } from "../yaku/dora";
import { KIND_COUNT, KIND_LIST, kindIndex } from "./shanten";

/**
 * CPUの打点評価。手牌(種類ごとの枚数)と副露から「この手が最終的にどれくらい高くなりそうか」を
 * おおよその翻数で見積もる。打牌選択で、効率が同じくらいの候補の中から高くなる方を選ぶのに使う。
 *
 * このルールの牌は 萬子1〜9・筒子/索子の1と9・字牌 のみなので、
 *   - 混一色・清一色は事実上「萬子(+字牌)」で作る
 *   - 筒子・索子の1・9は対子・刻子にしかならず、対々和・七対子に向く
 *   - 断么九は萬子の2〜8だけで作る
 * という特徴がある。見積もりはあくまで目安(実際の役判定はエンジンの evaluateYaku が行う)。
 */

/** 評価の内訳(デバッグ・テスト用) */
export interface HandValueBreakdown {
  dora: number;
  yakuhai: number;
  flush: number;
  toitoi: number;
  tanyao: number;
  total: number;
}

const MAN_LAST = 8; // 萬子のインデックスは 0..8
const HONOR_FIRST = 13; // 字牌のインデックスは 13..19

function isHonorIdx(i: number): boolean {
  return i >= HONOR_FIRST;
}
function isManIdx(i: number): boolean {
  return i <= MAN_LAST;
}

/** 役牌(三元牌・場風・自風)のインデックス集合。場風と自風が同じ牌なら2回数える(連風牌) */
function yakuhaiWeights(state: GameState, seat: Seat): number[] {
  const w = new Array<number>(KIND_COUNT).fill(0);
  const seatWind = seatWindOf(state, seat);
  KIND_LIST.forEach((k, i) => {
    if (k.kind !== "honor") return;
    if (k.honor === "white" || k.honor === "green" || k.honor === "red") w[i] += 1;
    if (k.honor === state.roundWind) w[i] += 1;
    if (k.honor === seatWind) w[i] += 1;
  });
  return w;
}

/**
 * 手の打点の目安(翻数くらいの値)。counts は門前部分(ツモ牌を含めてもよい)の種類ごとの枚数。
 */
export function handValueBreakdown(state: GameState, seat: Seat, counts: number[], melds: Meld[]): HandValueBreakdown {
  // 副露も含めた全体の枚数
  const all = counts.slice();
  for (const m of melds) for (const t of m.tiles) all[kindIndex(t.kind)]++;
  const isMenzen = melds.every((m) => m.type === "kan_closed");

  // ドラ(持っているだけ翻数になる)
  let dora = 0;
  for (const ind of state.wall.revealedDoraIndicators) dora += all[kindIndex(doraFromIndicator(ind.kind))];

  // 役牌: 刻子なら確定、対子なら刻子になる見込みの分だけ
  const yw = yakuhaiWeights(state, seat);
  let yakuhai = 0;
  for (let i = HONOR_FIRST; i < KIND_COUNT; i++) {
    if (yw[i] === 0) continue;
    if (all[i] >= 3) yakuhai += yw[i];
    else if (all[i] === 2) yakuhai += yw[i] * 0.4;
  }

  // 染め手: 萬子と字牌だけでどれだけ構成されているか(筒子・索子の1・9が混ざるほど遠い)
  let man = 0;
  let honor = 0;
  let other = 0;
  for (let i = 0; i < KIND_COUNT; i++) {
    if (isManIdx(i)) man += all[i];
    else if (isHonorIdx(i)) honor += all[i];
    else other += all[i];
  }
  let flush = 0;
  if (man >= 7 && other <= 2) {
    const honitsuHan = isMenzen ? 3 : 2;
    const chinitsuHan = isMenzen ? 6 : 5;
    const closeness = other === 0 ? 1 : other === 1 ? 0.6 : 0.3; // 筒子・索子の残り枚数で見込みを下げる
    flush = (honor === 0 && man >= 11 ? chinitsuHan : honitsuHan) * closeness;
  }

  // 対々和: 対子・刻子(と副露の刻子・槓子)が多いほど見込みあり。筒子・索子の1・9はこれに向く
  let pairsOrSets = melds.length;
  for (let i = 0; i < KIND_COUNT; i++) if (counts[i] >= 2) pairsOrSets++;
  const toitoi = pairsOrSets >= 5 ? 2 : pairsOrSets === 4 ? 1 : 0;

  // 断么九: 萬子の2〜8だけで構成されていそうなら
  let terminalsOrHonors = 0;
  for (let i = 0; i < KIND_COUNT; i++) {
    if (all[i] === 0) continue;
    const k = KIND_LIST[i];
    if (k.kind === "honor" || k.rank === 1 || k.rank === 9) terminalsOrHonors += all[i];
  }
  const tanyao = terminalsOrHonors === 0 ? 1 : terminalsOrHonors === 1 ? 0.4 : 0;

  // 門前ならリーチ・ツモの分
  const menzenBonus = isMenzen ? 1 : 0;

  const total = dora + yakuhai + flush + toitoi + tanyao + menzenBonus;
  return { dora, yakuhai, flush, toitoi, tanyao, total };
}

export function handValue(state: GameState, seat: Seat, counts: number[], melds: Meld[]): number {
  return handValueBreakdown(state, seat, counts, melds).total;
}
