import { GameState, isBusted } from "../types/game";
import { Seat, createInitialPlayerState } from "../types/player";
import { buildWall, dealInitialHands, revealNextDoraIndicator } from "../wall/wallGenerator";
import { Rng } from "../wall/rng";
import { otherSeat } from "./actions";

const WIND_ORDER: Array<"east" | "south" | "west" | "north"> = ["east", "south", "west", "north"];

/**
 * 局が終わった理由と(流局の場合の)聴牌者一覧から、親が続投(連荘)するかどうかを判定する。
 *
 * - ロン・ツモ: 親自身が和了した場合のみ連荘
 * - 四開槓などの途中流局: 常に連荘扱い
 * - 通常の流局: 親が聴牌していれば連荘
 */
export function determineDealerContinuation(state: GameState, tenpaiSeats: Seat[] = []): boolean {
  const reason = state.roundEndReason;
  if (!reason) {
    throw new Error("局が終了していないため連荘判定できません(内部エラー)");
  }
  switch (reason.type) {
    case "ron":
    case "tsumo":
      return reason.winner === state.dealer;
    case "abortive_draw":
      return true;
    case "exhaustive_draw":
      return tenpaiSeats.includes(state.dealer);
    default:
      return false;
  }
}

/**
 * 局を終えて次の局(または連荘による同じ局のやり直し、あるいは対局終了)へ進める。
 *
 * @param dealerContinues determineDealerContinuation() の結果
 * @param seed 次の牌山のシャッフルに使うシード値、または乱数関数(省略時はランダム。buildWall 参照)
 */
export function advanceRound(state: GameState, dealerContinues: boolean, seed?: number | Rng): GameState {
  const busted = isBusted(state);
  if (busted) {
    // トビ終了時に場に残っている供託は、トばなかった側(勝者)が受け取る。
    const winner = otherSeat(busted);
    const bonus = state.riichiSticks * 1000;
    const players =
      bonus > 0
        ? { ...state.players, [winner]: { ...state.players[winner], score: state.players[winner].score + bonus } }
        : state.players;
    return {
      ...state,
      players,
      riichiSticks: 0,
      phase: "game_end",
      gameEndReason:
        bonus > 0
          ? { type: "bust", bustedPlayer: busted, riichiBonus: { seat: winner, points: bonus } }
          : { type: "bust", bustedPlayer: busted },
    };
  }

  let dealer = state.dealer;
  let roundWind = state.roundWind;
  let roundNumber = state.roundNumber;
  let overallRoundIndex = state.overallRoundIndex;

  if (!dealerContinues) {
    dealer = otherSeat(dealer);

    if (roundNumber === 1) {
      roundNumber = 2;
    } else {
      const windIndex = WIND_ORDER.indexOf(roundWind);
      if (windIndex === WIND_ORDER.length - 1) {
        // 北2局(8局目)が終わった場合、対局終了。
        // オーラス時点で供託されたままのリーチ棒は起家が受け取る。
        const startingDealer = state.startingDealer;
        const bonus = state.riichiSticks * 1000;
        const players =
          bonus > 0
            ? {
                ...state.players,
                [startingDealer]: {
                  ...state.players[startingDealer],
                  score: state.players[startingDealer].score + bonus,
                },
              }
            : state.players;

        return {
          ...state,
          players,
          riichiSticks: 0,
          phase: "game_end",
          gameEndReason:
            bonus > 0
              ? { type: "all_rounds_complete", riichiBonus: { seat: startingDealer, points: bonus } }
              : { type: "all_rounds_complete" },
        };
      }
      roundWind = WIND_ORDER[windIndex + 1];
      roundNumber = 1;
    }
    overallRoundIndex += 1;
  }

  const { wall } = buildWall(seed);
  const wallWithDora = revealNextDoraIndicator(wall);
  // 配牌は親(その局の東家)から順に配る
  const { wall: dealtWall, hands } = dealInitialHands(wallWithDora, [dealer, otherSeat(dealer)]);

  return {
    ...state,
    dealer,
    roundWind,
    roundNumber,
    overallRoundIndex,
    kanCount: 0,
    fourKanAbortivePending: false,
    wall: dealtWall,
    players: {
      east: { ...createInitialPlayerState("east", state.players.east.score), hand: hands.east },
      south: { ...createInitialPlayerState("south", state.players.south.score), hand: hands.south },
    },
    currentTurn: dealer,
    lastDiscard: null,
    roundEndReason: null,
    phase: "draw",
  };
}
