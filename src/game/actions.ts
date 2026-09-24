import { GameState } from "../types/game";
import { PlayerState, Seat, DiscardedTile } from "../types/player";
import { Meld } from "../types/meld";
import { Tile, TileKind, tileKindKey } from "../types/tile";
import { WinContext, WindHonor, HandForEvaluation } from "../yaku/context";
import { isTenpai } from "../yaku/tenpai";
import { isPermanentFuriten, isMissedRonFuriten } from "../yaku/furiten";
import { countDoraForHand, DoraBreakdown } from "../yaku/dora";
import { calculateScore, ScoreResult } from "../scoring/score";
import { YAKUMAN_CHILD_POINTS } from "../scoring/tier";
import { revealNextDoraIndicator } from "../wall/wallGenerator";

export function otherSeat(seat: Seat): Seat {
  return seat === "east" ? "south" : "east";
}

/**
 * 親であるプレイヤーが東家、子であるプレイヤーが南家となる(2人麻雀の自風ルール)。
 * Seat型自体("east"/"south")は単なる固定のプレイヤー識別子であり、
 * 実際の自風(東家/南家)は毎局の親交代によって変わるため、
 * 表示・役判定など「自風」を扱う箇所は必ずこの関数を経由すること。
 */
export function seatWindOf(state: GameState, seat: Seat): WindHonor {
  return seat === state.dealer ? "east" : "south";
}

function clearAllIppatsu(players: Record<Seat, PlayerState>): Record<Seat, PlayerState> {
  const east = { ...players.east, hasIppatsuChance: false };
  const south = { ...players.south, hasIppatsuChance: false };
  return { east, south };
}

export function buildWinContext(
  state: GameState,
  seat: Seat,
  winningTile: Tile,
  isTsumo: boolean,
  extra: Partial<Pick<WinContext, "isIppatsu" | "isHaitei" | "isHoutei" | "isFuriten">> = {}
): WinContext {
  const player = state.players[seat];
  // 天和・地和: その局でまだ誰も鳴き・カン(暗槓含む)をしておらず、和了者自身が
  // 一度も打牌していない状態(=その局の最初のツモ)でのツモ和了。局は親の自摸から
  // 始まる(配牌は13枚ずつ)ため、親の最初のツモ=天和、子の最初のツモ=地和となる。
  // カンをすれば面子が残るため、嶺上牌でのツモもここで除外される。
  const isFirstUninterruptedDraw =
    isTsumo &&
    player.discards.length === 0 &&
    state.players.east.melds.length === 0 &&
    state.players.south.melds.length === 0;
  const isDealer = seat === state.dealer;
  // 嶺上開花: カン直後の嶺上ツモ〜打牌待ち(phase "kan_replacement")の間のツモ和了。
  // このとき手番プレイヤーの drawnTile は必ず嶺上牌になっている。
  const isRinshan = isTsumo && state.phase === "kan_replacement";
  // 海底摸月・河底撈魚は盤面から自動で判定する(呼び出し側が渡し忘れても、画面のツモ/ロン
  // ボタンやCPUの判定と、実際の和了処理とで結果が食い違わないようにするため)。
  // 海底: 自摸山が尽きた後の最後のツモ(嶺上牌でのツモは除く)。
  // 河底: 自摸山が尽きた後の最後の捨て牌をロン。
  const isLiveWallEmpty = state.wall.liveWall.length === 0;
  const autoHaitei = isTsumo && isLiveWallEmpty && !isRinshan;
  const autoHoutei = !isTsumo && isLiveWallEmpty;
  return {
    isRinshan,
    isTenhou: isFirstUninterruptedDraw && isDealer,
    isChiihou: isFirstUninterruptedDraw && !isDealer,
    isTsumo,
    seatWind: seatWindOf(state, seat),
    roundWind: state.roundWind,
    isRiichi: player.isRiichi,
    isDoubleRiichi: player.isDoubleRiichi,
    isIppatsu: extra.isIppatsu ?? player.hasIppatsuChance,
    isHaitei: extra.isHaitei ?? autoHaitei,
    isHoutei: extra.isHoutei ?? autoHoutei,
    isFuriten: extra.isFuriten ?? false,
    winningTile,
  };
}

// ---------------- 自摸・打牌 ----------------

export function drawTile(state: GameState): GameState {
  const seat = state.currentTurn;
  if (state.wall.liveWall.length === 0) {
    return state; // 呼び出し側で resolveExhaustiveDraw を呼ぶ想定
  }
  const [drawn, ...restLive] = state.wall.liveWall;
  const player = state.players[seat];

  return {
    ...state,
    wall: { ...state.wall, liveWall: restLive },
    players: { ...state.players, [seat]: { ...player, drawnTile: drawn } },
    phase: "discard",
  };
}

export function discardTile(state: GameState, tile: Tile, declareRiichi: boolean): GameState {
  const seat = state.currentTurn;
  const player = state.players[seat];

  // リーチ後は手出し不可。ツモ切り(ツモった牌をそのまま打牌)のみ許される。
  if (player.isRiichi && (!player.drawnTile || player.drawnTile.id !== tile.id)) {
    throw new Error("リーチ後は手出しできません(ツモった牌のみ打牌可能です)");
  }

  // 喰い替え禁止: ポンした直後(実際に打牌するまで)は、そのポンで使った牌と
  // 同じ種類の牌を打牌できない(例: 3萬をポン→3萬を打牌、は不可)。
  if (player.forbiddenDiscardKind && tileKindKey(tile.kind) === tileKindKey(player.forbiddenDiscardKind)) {
    throw new Error("ポンした牌と同じ牌は打牌できません(喰い替え)");
  }

  const handWithDraw = player.drawnTile ? [...player.hand, player.drawnTile] : player.hand;
  const remainingHand = handWithDraw.filter((t) => t.id !== tile.id);

  const isRiichiDeclaration = declareRiichi && !player.isRiichi;
  const isFirstDiscardEver = player.discards.length === 0;

  const seq = state.players.east.discards.length + state.players.south.discards.length;
  const discardEntry: DiscardedTile = { tile, isRiichiDeclaration, isCalled: false, seq };

  const updatedPlayer: PlayerState = {
    ...player,
    hand: remainingHand,
    drawnTile: null,
    discards: [...player.discards, discardEntry],
    isRiichi: player.isRiichi || isRiichiDeclaration,
    isDoubleRiichi: player.isDoubleRiichi || (isRiichiDeclaration && isFirstDiscardEver),
    hasIppatsuChance: isRiichiDeclaration,
    isTemporaryFuriten: false,
    forbiddenDiscardKind: null,
  };

  return {
    ...state,
    players: { ...state.players, [seat]: updatedPlayer },
    lastDiscard: { tile, from: seat, isRiichiDeclaration },
    phase: "call_window",
  };
}

/**
 * 直前の捨て牌がリーチ宣言牌で、かつロンされずに決着した(見送り・ポン・カンいずれか)
 * 場合に、この時点で初めてリーチ棒(1000点)の供託を確定させる
 * (score から差し引き、riichiSticks に加算する)。ロンされた場合はこの関数は
 * 呼ばれない(呼び出し側で declareRon の際は呼ばないこと)ため、供託は発生しない。
 */
function commitPendingRiichiStick(state: GameState): GameState {
  const discard = state.lastDiscard;
  if (!discard || !discard.isRiichiDeclaration) return state;
  const seat = discard.from;
  const player = state.players[seat];
  return {
    ...state,
    players: { ...state.players, [seat]: { ...player, score: player.score - 1000 } },
    riichiSticks: state.riichiSticks + 1,
  };
}

/** 相手の捨て牌に対してロン・ポン・カンいずれも行わなかった場合、手番を進める */
export function passDiscard(state: GameState): GameState {
  const discardedSeat = state.lastDiscard?.from;
  if (!discardedSeat) return state;

  // ロンされずに決着したので、リーチ宣言牌であればここでリーチ棒を供託する。
  state = commitPendingRiichiStick(state);

  // 4回目のカン(1人で4回=四槓子の場合を除く)の後の打牌がロンされずに見送られた場合、
  // 途中流局(四開槓)になる。
  if (state.fourKanAbortivePending) {
    return {
      ...state,
      lastDiscard: null,
      fourKanAbortivePending: false,
      phase: "round_end",
      roundEndReason: { type: "abortive_draw", reason: "四開槓" },
    };
  }

  const opponent = otherSeat(discardedSeat);
  // ロンを見逃した場合は一時的フリテンを立てる(実際に見逃したかどうかの判定は
  // 呼び出し側で canDeclareRon の結果を見て決める想定。ここでは無条件に反映する)
  return {
    ...state,
    currentTurn: opponent,
    lastDiscard: null,
    phase: "draw",
  };
}

/**
 * ロンを見逃した(=ロン可能だったが見逃した)ことを記録し、フリテンを立てる。
 *
 * 通常は同巡内(次に自分が打牌するまで)の一時的フリテンだが、リーチ後の見逃しは
 * その局が終わるまでフリテンが続く(リーチ中は手牌も待ちも変えられないため)。
 */
export function markMissedRon(state: GameState, seat: Seat): GameState {
  const player = state.players[seat];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...player,
        isTemporaryFuriten: true,
        isRiichiMissedFuriten: player.isRiichiMissedFuriten || player.isRiichi,
      },
    },
  };
}

// ---------------- ポン ----------------

export function callPon(state: GameState, callingSeat: Seat, tilesUsed: [Tile, Tile]): GameState {
  // ロンされずポンで決着したので、リーチ宣言牌であればここでリーチ棒を供託する。
  state = commitPendingRiichiStick(state);

  // 4回目のカン(四槓子の場合を除く)の後の打牌は、ロン以外では受けられない。
  // ポンしようとしても、その時点で途中流局(四開槓)が確定する。
  if (state.fourKanAbortivePending) {
    return {
      ...state,
      lastDiscard: null,
      fourKanAbortivePending: false,
      phase: "round_end",
      roundEndReason: { type: "abortive_draw", reason: "四開槓" },
    };
  }

  const discard = state.lastDiscard!;
  const fromSeat = discard.from;
  const player = state.players[callingSeat];

  const meld: Meld = {
    type: "triplet",
    tiles: [...tilesUsed, discard.tile],
    calledTile: discard.tile,
    calledFrom: "opponent",
    isOpen: true,
  };

  const usedIds = new Set(tilesUsed.map((t) => t.id));
  const updatedCaller: PlayerState = {
    ...player,
    hand: player.hand.filter((t) => !usedIds.has(t.id)),
    melds: [...player.melds, meld],
    hasIppatsuChance: false,
    // 喰い替え禁止: このポンで使った牌と同じ種類は、実際に打牌するまで打てない。
    forbiddenDiscardKind: discard.tile.kind,
  };

  const fromPlayer = state.players[fromSeat];
  const updatedFromDiscards = fromPlayer.discards.map((d, idx) =>
    idx === fromPlayer.discards.length - 1 ? { ...d, isCalled: true } : d
  );
  const updatedFromPlayer: PlayerState = {
    ...fromPlayer,
    discards: updatedFromDiscards,
    hasIppatsuChance: false,
  };

  return {
    ...state,
    players: { ...clearAllIppatsu(state.players), [callingSeat]: updatedCaller, [fromSeat]: updatedFromPlayer },
    currentTurn: callingSeat,
    lastDiscard: null,
    phase: "discard",
  };
}

// ---------------- カン(暗槓・大明槓・加槓) ----------------

function drawRinshanAndRevealDora(state: GameState): { state: GameState; rinshanTile: Tile } {
  const wallAfterReveal = revealNextDoraIndicator(state.wall);
  const [rinshanTile, ...restDeadDraws] = wallAfterReveal.deadWallDraws;

  // 嶺上牌を1枚補充した分、王牌(死に牌)を一定に保つため自摸山の末尾を1枚減らす
  // (実際の四人麻雀と同様、その牌は誰にも取られず場に出ないまま消える)。
  // これにより、カンの回数だけ残り自摸山が減り、海底牌(自摸山の最後の1枚)も
  // カンのたびに前倒しになる。
  const liveWallAfterKan = wallAfterReveal.liveWall.slice(0, -1);

  return {
    state: {
      ...state,
      wall: { ...wallAfterReveal, liveWall: liveWallAfterKan, deadWallDraws: restDeadDraws },
    },
    rinshanTile,
  };
}

/** 面子一覧の中に含まれるカン(暗槓・明槓とも)の数を数える */
function countKanMelds(melds: Meld[]): number {
  return melds.filter((m) => m.type === "kan_open" || m.type === "kan_closed").length;
}

/**
 * カンの後処理(嶺上牌を引いてドラを1枚めくる)を行う。
 *
 * 4回目のカン(二人合計)が成立した場合は、以降そのカンによる牌を打牌してロンされ
 * なければ途中流局(四開槓)になる(fourKanAbortivePending に反映し、実際の流局判定は
 * その打牌の call_window が解決される passDiscard/callPon 側で行う)。
 * ただし、その4回のカンがすべて同じプレイヤーによるもの(四槓子の可能性がある形)の
 * 場合は例外として、この途中流局の対象にはしない。
 *
 * なお、4回目のカンが成立した時点でそれ以降のカン自体ができなくなる
 * (呼び出し側の getAnkanKinds/getKakanKinds/canDeclareMinkan が kanCount を見て弾くため)、
 * 実運用上5回目のカンがここに到達することは無いはずだが、念のための保険として残す。
 */
function finishKan(state: GameState, seat: Seat, updatedPlayer: PlayerState): GameState {
  const newKanCount = state.kanCount + 1;
  if (newKanCount > 4) {
    return {
      ...state,
      phase: "round_end",
      roundEndReason: { type: "abortive_draw", reason: "四開槓" },
    };
  }

  const opponent = otherSeat(seat);
  const callerKanCount = countKanMelds(updatedPlayer.melds);
  const opponentKanCount = countKanMelds(state.players[opponent].melds);
  const isSingleSeatFourKan = newKanCount === 4 && callerKanCount === 4 && opponentKanCount === 0;
  const fourKanAbortivePending = newKanCount === 4 && !isSingleSeatFourKan;

  const { state: stateWithWall, rinshanTile } = drawRinshanAndRevealDora(state);
  const finalPlayer: PlayerState = { ...updatedPlayer, drawnTile: rinshanTile, hasIppatsuChance: false };

  return {
    ...stateWithWall,
    players: { ...clearAllIppatsu(stateWithWall.players), [seat]: finalPlayer },
    kanCount: newKanCount,
    fourKanAbortivePending,
    currentTurn: seat,
    lastDiscard: null,
    phase: "kan_replacement",
  };
}

/**
 * 加槓(ポンした明刻に、手牌の4枚目を加えて槓子にする)。嶺上牌を引いた状態まで進める。
 *
 * 槍槓(加槓された牌へのロン)はこのゲームでは扱わない。2人麻雀では、加槓できるのは
 * 相手の捨て牌をポンした後に限られ、その牌種は必ず相手自身が捨てているため、相手が
 * 加槓された牌で和了しようとしても必ずフリテンになり、槍槓は起こり得ないため。
 */
export function performKakan(state: GameState, kind: TileKind): GameState {
  const seat = state.currentTurn;
  const player = state.players[seat];
  // ポンした後、まだ実際に打牌していない間はカン(暗槓・加槓)を禁止する。
  if (player.forbiddenDiscardKind) {
    throw new Error("ポンの後、打牌するまでカンはできません");
  }
  // 4回目のカンが成立した後は、その局ではもうカンできない。
  if (state.kanCount >= 4) {
    throw new Error("この局ではもうカンできません(4回目のカンが成立済みです)");
  }
  const handWithDraw = player.drawnTile ? [...player.hand, player.drawnTile] : player.hand;
  const key = tileKindKey(kind);
  const addedTile = handWithDraw.find((t) => tileKindKey(t.kind) === key);
  if (!addedTile) {
    throw new Error("加槓対象の牌が手牌にありません(内部エラー)");
  }

  const remaining = handWithDraw.filter((t) => t.id !== addedTile.id);
  const melds = player.melds.map((m) =>
    m.type === "triplet" && m.isOpen && tileKindKey(m.tiles[0].kind) === key
      ? { ...m, type: "kan_open" as const, tiles: [...m.tiles, addedTile], viaKakan: true }
      : m
  );

  const updatedPlayer: PlayerState = { ...player, hand: remaining, melds };
  return finishKan(state, seat, updatedPlayer);
}

/** 暗槓(自分のツモ番、手牌に4枚揃っている牌をカンする) */
export function performAnkan(state: GameState, kind: TileKind): GameState {
  const seat = state.currentTurn;
  const player = state.players[seat];
  // ポンした後、まだ実際に打牌していない間はカン(暗槓・加槓)を禁止する。
  if (player.forbiddenDiscardKind) {
    throw new Error("ポンの後、打牌するまでカンはできません");
  }
  // 4回目のカンが成立した後は、その局ではもうカンできない。
  if (state.kanCount >= 4) {
    throw new Error("この局ではもうカンできません(4回目のカンが成立済みです)");
  }
  const handWithDraw = player.drawnTile ? [...player.hand, player.drawnTile] : player.hand;
  const key = tileKindKey(kind);

  const kanTiles: Tile[] = [];
  const remaining: Tile[] = [];
  for (const t of handWithDraw) {
    if (tileKindKey(t.kind) === key && kanTiles.length < 4) {
      kanTiles.push(t);
    } else {
      remaining.push(t);
    }
  }

  const meld: Meld = { type: "kan_closed", tiles: kanTiles, isOpen: false };
  const updatedPlayer: PlayerState = { ...player, hand: remaining, melds: [...player.melds, meld] };

  return finishKan(state, seat, updatedPlayer);
}

/** 大明槓(相手の捨て牌をカンする) */
export function performMinkan(state: GameState, callingSeat: Seat, tilesUsed: [Tile, Tile, Tile]): GameState {
  // 4回目のカンが成立した後は、その局ではもうカンできない
  // (4回目のカンの打牌自体は fourKanAbortivePending 側で処理するため、ここに到達するのは
  // それ以前の通常のカン、または保険的なガード)。
  if (state.kanCount >= 4) {
    throw new Error("この局ではもうカンできません(4回目のカンが成立済みです)");
  }

  // ロンされず大明槓で決着したので、リーチ宣言牌であればここでリーチ棒を供託する。
  state = commitPendingRiichiStick(state);

  const discard = state.lastDiscard!;
  const fromSeat = discard.from;
  const player = state.players[callingSeat];

  const meld: Meld = {
    type: "kan_open",
    tiles: [...tilesUsed, discard.tile],
    calledTile: discard.tile,
    calledFrom: "opponent",
    isOpen: true,
  };

  const usedIds = new Set(tilesUsed.map((t) => t.id));
  const updatedCaller: PlayerState = {
    ...player,
    hand: player.hand.filter((t) => !usedIds.has(t.id)),
    melds: [...player.melds, meld],
  };

  const fromPlayer = state.players[fromSeat];
  const updatedFromDiscards = fromPlayer.discards.map((d, idx) =>
    idx === fromPlayer.discards.length - 1 ? { ...d, isCalled: true } : d
  );

  const stateWithFromPlayerUpdated: GameState = {
    ...state,
    players: { ...state.players, [fromSeat]: { ...fromPlayer, discards: updatedFromDiscards } },
    currentTurn: callingSeat,
  };

  return finishKan(stateWithFromPlayerUpdated, callingSeat, updatedCaller);
}

// ---------------- 和了(ロン・ツモ) ----------------

export interface WinOutcome {
  state: GameState;
  scoreResult: ScoreResult;
  /** この和了に乗ったドラの内訳(表ドラ・裏ドラ) */
  dora: DoraBreakdown;
}

export function declareRon(
  state: GameState,
  winner: Seat,
  wonTile: Tile
): WinOutcome {
  const loser = state.lastDiscard!.from;
  const player = state.players[winner];
  const context = buildWinContext(state, winner, wonTile, false, {
    isHoutei: state.wall.liveWall.length === 0,
    isFuriten: false,
  });
  const hand: HandForEvaluation = { concealedTiles: [...player.hand, wonTile], melds: player.melds };
  const isDealer = winner === state.dealer;
  const dora = countDoraForHand(hand, state.wall, player.isRiichi);
  const scoreResult = calculateScore(hand, context, isDealer, dora.total);

  const riichiBonus = state.riichiSticks * 1000;
  const totalGain = scoreResult.points + riichiBonus;

  const players: Record<Seat, PlayerState> = {
    ...state.players,
    [winner]: { ...state.players[winner], score: state.players[winner].score + totalGain },
    [loser]: { ...state.players[loser], score: state.players[loser].score - scoreResult.points },
  };

  const newState: GameState = {
    ...state,
    players,
    riichiSticks: 0,
    phase: "round_end",
    roundEndReason: { type: "ron", winner, loser },
  };

  return { state: newState, scoreResult, dora };
}

export function declareTsumo(state: GameState, winner: Seat): WinOutcome {
  const player = state.players[winner];
  const winningTile = player.drawnTile!;
  const opponent = otherSeat(winner);
  // ツモはフリテンでも和了できるが、国士無双13面待ち・九蓮宝燈9面待ちの
  // 「フリテンなし」で純正扱いとする条件のために、実際のフリテン状態を判定して渡す
  // (渡さないと常に false 扱いになり、フリテンでも純正のまま判定されてしまう)。
  const isFuriten =
    isMissedRonFuriten(player) ||
    isPermanentFuriten(player.hand, player.melds, player.discards.map((d) => d.tile));
  const context = buildWinContext(state, winner, winningTile, true, {
    // 嶺上牌でのツモは海底摸月にならない(標準ルール)
    isHaitei: state.wall.liveWall.length === 0 && state.phase !== "kan_replacement",
    isFuriten,
  });
  const hand: HandForEvaluation = { concealedTiles: [...player.hand, winningTile], melds: player.melds };
  const isDealer = winner === state.dealer;
  const dora = countDoraForHand(hand, state.wall, player.isRiichi);
  const scoreResult = calculateScore(hand, context, isDealer, dora.total);

  const riichiBonus = state.riichiSticks * 1000;
  const totalGain = scoreResult.points + riichiBonus;

  const players: Record<Seat, PlayerState> = {
    ...state.players,
    [winner]: { ...state.players[winner], score: state.players[winner].score + totalGain },
    [opponent]: {
      ...state.players[opponent],
      score: state.players[opponent].score - scoreResult.points,
    },
  };

  const newState: GameState = {
    ...state,
    players,
    riichiSticks: 0,
    phase: "round_end",
    roundEndReason: { type: "tsumo", winner },
  };

  return { state: newState, scoreResult, dora };
}

// ---------------- 流局 ----------------

function isNagashiYakumanDiscards(discards: DiscardedTile[]): boolean {
  if (discards.length === 0) return false;
  return discards.every((d) => {
    if (d.isCalled) return false;
    const k = d.tile.kind;
    return k.kind === "number" && k.suit === "man" && k.rank >= 2 && k.rank <= 8;
  });
}

export interface ExhaustiveDrawOutcome {
  state: GameState;
  tenpaiSeats: Seat[];
  nagashiYakumanSeats: Seat[];
}

/** 流局処理(牌山が尽きた場合)。ノーテン罰符と流し役満を反映する。 */
export function resolveExhaustiveDraw(state: GameState): ExhaustiveDrawOutcome {
  const seats: Seat[] = ["east", "south"];

  const tenpaiSeats = seats.filter((s) => {
    const p = state.players[s];
    const handWithDraw = p.drawnTile ? [...p.hand, p.drawnTile] : p.hand;
    return isTenpai(handWithDraw, p.melds);
  });
  const nagashiYakumanSeats = seats.filter((s) => isNagashiYakumanDiscards(state.players[s].discards));

  let players = { ...state.players };

  if (tenpaiSeats.length === 1) {
    const winner = tenpaiSeats[0];
    const loser = otherSeat(winner);
    players = {
      ...players,
      [winner]: { ...players[winner], score: players[winner].score + 5000 },
      [loser]: { ...players[loser], score: players[loser].score - 5000 },
    };
  }

  for (const s of nagashiYakumanSeats) {
    const opponent = otherSeat(s);
    const isDealer = s === state.dealer;
    const points = isDealer ? YAKUMAN_CHILD_POINTS * 1.5 : YAKUMAN_CHILD_POINTS;
    players = {
      ...players,
      [s]: { ...players[s], score: players[s].score + points },
      [opponent]: { ...players[opponent], score: players[opponent].score - points },
    };
  }

  const newState: GameState = {
    ...state,
    players,
    phase: "round_end",
    roundEndReason: { type: "exhaustive_draw" },
  };

  return { state: newState, tenpaiSeats, nagashiYakumanSeats };
}
