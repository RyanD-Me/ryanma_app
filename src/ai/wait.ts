import { GameState } from "../types/game";
import { Seat } from "../types/player";
import { Tile, tileKindKey } from "../types/tile";
import { otherSeat, buildWinContext } from "../game/actions";
import { evaluateYaku } from "../yaku/evaluate";
import { KIND_COUNT, KIND_LIST, toCounts, shantenFromCounts } from "./shanten";

/**
 * CPUの「待ちの質」の評価。聴牌(打牌後の13枚)の待ちがどれくらい和了りやすいかを数値にする。
 *
 *   - 残り枚数: 待ち牌のうち、自分から見えていない枚数(多いほど良い)。
 *   - 役なし: 副露していて役が無い待ち牌はロンもツモもできないので数えない。
 *   - フリテン: 待ち牌を自分で捨てていればロンできない(ツモのみ)ので大きく割り引く。
 *   - 出やすさ(相手の立場で考える。相手の手牌は見ない):
 *       * 自分の捨て牌の筋(萬子で3つ離れた牌を自分が捨てている)は、相手からは安全そうに見えるので出やすい
 *         (いわゆる引っ掛け・筋待ち)。
 *       * 相手がすでに同じ牌やすぐ隣の萬子を捨てている牌は、相手が要らない牌なので出やすい。
 *       * 字牌・筒子/索子の1・9は、場に1枚見えている(相手から見て使いにくい)と出やすい。
 */

export interface WaitQuality {
  /** 待ち牌の種類(役なしを除く) */
  kinds: string[];
  /** 待ち牌の見えていない残り枚数の合計(役なしを除く) */
  remaining: number;
  /** 待ちの良さの総合点(残り枚数を、出やすさ・フリテンで補正したもの) */
  score: number;
  /** フリテン(待ち牌を自分で捨てている)か */
  furiten: boolean;
}

const dummy = (i: number): Tile => ({ id: `wait-check-${i}`, kind: KIND_LIST[i], isRedDora: false });

/**
 * counts: 打牌後(13枚相当)の門前部分の種類ごとの枚数。visible: 自分から見えている枚数(visibleCounts)。
 * 聴牌していなければ remaining = 0 を返す。
 */
export function evaluateWait(state: GameState, seat: Seat, counts: number[], visible: number[]): WaitQuality {
  const player = state.players[seat];
  const meldCount = player.melds.length;
  const empty: WaitQuality = { kinds: [], remaining: 0, score: 0, furiten: false };
  if (shantenFromCounts(counts, meldCount) !== 0) return empty;

  const isMenzen = player.melds.every((m) => m.type === "kan_closed");
  const myDiscardKeys = new Set(player.discards.map((d) => tileKindKey(d.tile.kind)));
  const opp = state.players[otherSeat(seat)];
  const oppDiscardKeys = new Set(opp.discards.map((d) => tileKindKey(d.tile.kind)));

  // 門前部分の牌(役判定用のダミー)
  const concealed: Tile[] = [];
  counts.forEach((n, i) => {
    for (let c = 0; c < n; c++) concealed.push({ id: `wait-hand-${i}-${c}`, kind: KIND_LIST[i], isRedDora: false });
  });

  const kinds: string[] = [];
  let remaining = 0;
  let weighted = 0;
  let furiten = false;
  for (let i = 0; i < KIND_COUNT; i++) {
    if (counts[i] >= 4) continue;
    counts[i]++;
    const wins = shantenFromCounts(counts, meldCount) === -1;
    counts[i]--;
    if (!wins) continue;

    const key = tileKindKey(KIND_LIST[i]);
    // 副露していて役が無い待ちは和了れない(門前ならリーチで役が付くので数える)
    if (!isMenzen) {
      const tile = dummy(i);
      const ctx = buildWinContext(state, seat, tile, false);
      const r = evaluateYaku({ concealedTiles: [...concealed, tile], melds: player.melds }, ctx);
      if (!(r.isWin && r.yaku.length > 0)) continue;
    }
    if (myDiscardKeys.has(key)) furiten = true;

    const left = Math.max(0, 4 - visible[i]);
    kinds.push(key);
    remaining += left;

    // 出やすさの補正(1枚あたりの倍率)
    let ease = 1;
    const k = KIND_LIST[i];
    if (k.kind === "number" && k.suit === "man") {
      const suji = (r: number) => r >= 1 && r <= 9 && myDiscardKeys.has(`number:man:${r}`);
      if (suji(k.rank - 3) || suji(k.rank + 3)) ease += 0.4; // 自分の捨て牌の筋 = 相手から安全そうに見える
      const near = (r: number) => r >= 1 && r <= 9 && oppDiscardKeys.has(`number:man:${r}`);
      if (near(k.rank - 1) || near(k.rank + 1) || near(k.rank - 2) || near(k.rank + 2)) ease += 0.2;
    } else if (visible[i] - counts[i] >= 1) {
      ease += 0.3; // 字牌・1・9は場に見えていると相手が切りやすい
    }
    if (oppDiscardKeys.has(key)) ease += 0.3; // 相手が既に切っている牌は要らない牌
    weighted += left * ease;
  }

  const score = furiten ? weighted * 0.4 : weighted;
  return { kinds, remaining, score, furiten };
}

/** 手牌(Tile配列、13枚)から待ちの質を求める */
export function evaluateWaitOfTiles(state: GameState, seat: Seat, tiles: Tile[], visible: number[]): WaitQuality {
  return evaluateWait(state, seat, toCounts(tiles), visible);
}
