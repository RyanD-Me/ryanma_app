import { Wall } from "./wall";
import { PlayerState, Seat } from "./player";
import { Tile } from "./tile";

/**
 * 対局の進行フェーズ。
 * 二人麻雀特有の「鳴き受付」タイミングをどう扱うかは要検討。
 */
export type GamePhase =
  | "waiting_for_players" // 対戦相手待ち(オンライン対戦向け)
  | "dealing" // 配牌中
  | "draw" // 手番プレイヤーの自摸待ち
  | "discard" // 手番プレイヤーの打牌待ち
  | "call_window" // 相手の捨て牌に対してポン/チー/カン/ロンできるか確認中
  | "kan_replacement" // カン後の嶺上ツモ〜打牌待ち
  | "round_end" // 局の終了(和了 or 流局)処理中
  | "game_end"; // 対局全体の終了

/** 和了・流局など、局が終わった理由 */
export type RoundEndReason =
  | { type: "tsumo"; winner: Seat }
  | { type: "ron"; winner: Seat; loser: Seat }
  | { type: "exhaustive_draw" } // 流局(牌山が尽きた)
  | { type: "abortive_draw"; reason: string }; // 九種九牌など途中流局

export interface GameState {
  /** ゲーム全体を一意に識別するID(オンライン対戦のルーム紐付け用) */
  gameId: string;

  phase: GamePhase;

  /**
   * 場風。一荘戦(東南西北 各2局ずつ計8局)のため4種類ある。
   * 例: east-1局, east-2局, south-1局, south-2局, west-1局, west-2局, north-1局, north-2局
   */
  roundWind: "east" | "south" | "west" | "north";
  /** その場風の中で何局目か(1 or 2) */
  roundNumber: 1 | 2;
  /** 一荘戦を通じた通し番号(1〜8)。UI表示や進行管理に使う */
  overallRoundIndex: number;
  /** リーチ棒の供託本数 */
  riichiSticks: number;
  /** 起家(最初の東家)。オーラス供託の受け取り先の判定に使う */
  startingDealer: Seat;
  /** この局の親。1局ごとに交代する(2人麻雀のため単純に交互) */
  dealer: Seat;
  /**
   * これまでに成立したカンの総数(二人合計)。
   * 4回に到達するとそれ以降そのカンはできなくなる(1人で4回=四槓子の場合を除く)。
   */
  kanCount: number;
  /**
   * 二人合計で4回目のカンが成立し(かつ4回とも同じプレイヤーによるもの=四槓子ではない)、
   * その嶺上ツモ〜打牌の結果を待っている状態かどうか。true の間に、その打牌がロンされずに
   * 決着した場合(見送り・ポンいずれも)、途中流局(四開槓)になる。
   */
  fourKanAbortivePending: boolean;

  wall: Wall;

  players: Record<Seat, PlayerState>;

  /** 現在手番のプレイヤー */
  currentTurn: Seat;

  /** 直前に捨てられた牌(鳴き判定の対象。鳴かれたらnullに戻す) */
  lastDiscard: {
    tile: Tile;
    from: Seat;
    /**
     * この牌でリーチ宣言したか。true の場合、リーチ棒(1000点)の供託は
     * まだ確定しておらず、ロンされずに決着した時点(見送り・ポン・カンいずれか)で
     * 初めて score から差し引かれ riichiSticks に加算される。
     * ロンされた場合は供託されない(点数も減らさない)。
     */
    isRiichiDeclaration: boolean;
  } | null;

  /** 局終了理由(進行中はnull) */
  roundEndReason: RoundEndReason | null;

  /**
   * 対局の長さ。8 = 一荘戦(東南西北 各2局の計8局)、4 = 半荘戦(東・南 各2局の計4局)。
   * 最後の場風(一荘戦は北、半荘戦は南)の2局目を終えると対局終了(連荘中は続く)。
   */
  readonly totalRounds: 4 | 8;
  startingScore: number;

  /**
   * 対局が終了した理由。
   * - all_rounds_complete: 全局(一荘戦は8局、半荘戦は4局)を終えた
   * - bust: いずれかのプレイヤーの持ち点がマイナスになった(トビ、即終了)
   */
  gameEndReason:
    | { type: "all_rounds_complete"; riichiBonus?: RiichiBonus }
    | { type: "bust"; bustedPlayer: Seat; riichiBonus?: RiichiBonus }
    | null;
}

/**
 * 対局終了時に場に残っていた供託(リーチ棒)の行き先。供託が無かった場合は付かない。
 * 北2局終了(all_rounds_complete)では起家、トビ終了(bust)ではトばなかった側(勝者)が受け取る。
 */
export interface RiichiBonus {
  seat: Seat;
  points: number;
}

/** プレイヤーの持ち点がマイナスかどうか(トビ判定) */
export function isBusted(state: GameState): Seat | null {
  for (const seat of Object.keys(state.players) as Seat[]) {
    if (state.players[seat].score < 0) {
      return seat;
    }
  }
  return null;
}
