import { WinningGroup, WaitPattern } from "./waitPattern";
import { WinContext } from "./context";
import { isTerminalOrHonor, isDragonKind, isWindKind, isRealAnkou } from "./standardYaku";

/** 七対子は符計算を行わず、常に25符固定として扱う */
export const CHIITOITSU_FU = 25;

/**
 * 通常形(4面子+雀頭)の符を計算する。
 * 平和(ツモ20符固定・ロン30符固定)の場合は hasPinfu=true を渡す。
 */
export function calculateFu(
  groups: WinningGroup[],
  isMenzen: boolean,
  isTsumo: boolean,
  wait: WaitPattern,
  context: WinContext,
  hasPinfu: boolean
): number {
  if (hasPinfu) return isTsumo ? 20 : 30;

  let fu = 20; // 副底

  if (isMenzen && !isTsumo) {
    fu += 10; // 門前加符(門前ロン)
  }
  if (isTsumo) {
    fu += 2; // ツモ符(嶺上開花もツモ扱いのためここに含まれる)
  }

  if (wait === "kanchan" || wait === "penchan" || wait === "tanki") {
    fu += 2;
  }

  const pair = groups.find((g) => g.type === "pair")!;
  if (isDragonKind(pair.kind)) {
    fu += 2;
  } else if (isWindKind(pair.kind) && pair.kind.kind === "honor") {
    const isSeat = pair.kind.honor === context.seatWind;
    const isRound = pair.kind.honor === context.roundWind;
    if (isSeat && isRound) {
      fu += 4; // 連風牌(ダブ東など)
    } else if (isSeat || isRound) {
      fu += 2;
    }
  }

  for (const g of groups) {
    if (g.type !== "triplet" && g.type !== "kan") continue;

    // ロンでシャンポン完成した面子は、実際には手の中にあった刻子でも
    // 符計算上は「明刻」として扱う(標準ルール)。
    const isOpenForFu = g.isOpen || (g.type === "triplet" && !isRealAnkou(g, context));
    const isYaochu = isTerminalOrHonor(g.kind);

    if (g.type === "triplet") {
      fu += isOpenForFu ? (isYaochu ? 4 : 2) : isYaochu ? 8 : 4;
    } else {
      // 槓子はロンによる完成という概念がないため isOpen(鳴きによる明槓か暗槓か)のみで判定
      fu += g.isOpen ? (isYaochu ? 16 : 8) : isYaochu ? 32 : 16;
    }
  }

  return Math.ceil(fu / 10) * 10;
}
