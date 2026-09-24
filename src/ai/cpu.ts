import { GameState } from "../types/game";
import { Seat } from "../types/player";
import { Tile, TileKind, tileKindKey } from "../types/tile";
import { buildWinContext, seatWindOf } from "../game/actions";
import { canDeclareRon, canDeclarePon, canDeclareMinkan, getDrawActionOptions } from "../game/legalActions";
import { isMissedRonFuriten } from "../yaku/furiten";
import { KIND_COUNT, KIND_LIST, kindIndex, toCounts, shantenFromCounts } from "./shanten";
import { DefenseProfile, opponentThreat, tileDanger } from "./defense";
import { handValue, handValueBreakdown } from "./value";
import { Meld } from "../types/meld";
import { evaluateWait, WaitQuality } from "./wait";

/**
 * CPU(牌効率型)の意思決定。すべて GameState を受け取る純粋関数。
 * 合法性の判定はエンジン既存の関数(getDrawActionOptions / canDeclareRon / canDeclarePon 等)に任せ、
 * ここでは「合法な行動のうちどれを選ぶか」だけを決める。
 */

export type CpuTurnAction =
  | { type: "tsumo" }
  | { type: "ankan"; kind: TileKind }
  | { type: "kakan"; kind: TileKind }
  | { type: "discard"; tile: Tile; declareRiichi: boolean };

export type CpuCallAction = "ron" | "pon" | "minkan" | "pass";

export interface DiscardEvaluation {
  tile: Tile;
  shanten: number;
  ukeire: number;
  isolationScore: number;
  /** 守備ありのCPUで、降りる(安全な牌を優先する)判断をしたか */
  folding?: boolean;
}

function handWithDraw(state: GameState, seat: Seat): Tile[] {
  const p = state.players[seat];
  return p.drawnTile ? [...p.hand, p.drawnTile] : p.hand.slice();
}

/**
 * seat から見えている牌の枚数(種類ごと)。自分の手牌・両者の河(鳴かれた牌は副露側で数える)・
 * 両者の副露・表示済みのドラ表示牌。
 */
export function visibleCounts(state: GameState, seat: Seat): number[] {
  const counts = toCounts(handWithDraw(state, seat));
  const add = (t: Tile) => counts[kindIndex(t.kind)]++;
  for (const s of ["east", "south"] as Seat[]) {
    const p = state.players[s];
    for (const d of p.discards) if (!d.isCalled) add(d.tile);
    for (const m of p.melds) for (const t of m.tiles) add(t);
  }
  for (const t of state.wall.revealedDoraIndicators) add(t);
  return counts;
}

/** 受け入れ枚数: 加えると向聴数が下がる牌の、見えていない残り枚数の合計 */
export function countUkeire(counts: number[], meldCount: number, visible: number[]): number {
  const base = shantenFromCounts(counts, meldCount);
  let total = 0;
  for (let k = 0; k < KIND_COUNT; k++) {
    if (counts[k] >= 4) continue;
    const remaining = Math.max(0, 4 - visible[k]);
    if (remaining === 0) continue;
    counts[k]++;
    if (shantenFromCounts(counts, meldCount) < base) total += remaining;
    counts[k]--;
  }
  return total;
}

/**
 * 孤立度(打牌の優先度)。孤立した字牌 > 孤立した么九牌 > 孤立した中張牌 > それ以外。
 * 萬子は前後2つ以内に牌があれば孤立ではない。
 */
function isolationScore(counts: number[], idx: number): number {
  if (counts[idx] >= 2) return 0;
  const kind = KIND_LIST[idx];
  if (kind.kind === "honor") return 3;
  if (kind.suit !== "man") return 2; // 筒子・索子は1と9しかなく順子にならない
  for (let d = -2; d <= 2; d++) {
    if (d === 0) continue;
    const j = idx + d;
    if (j >= 0 && j <= 8 && counts[j] > 0) return 0;
  }
  return kind.rank === 1 || kind.rank === 9 ? 2 : 1;
}

/** 打牌候補(同じ種類は1回だけ)を評価する */
export function evaluateDiscards(state: GameState, seat: Seat): DiscardEvaluation[] {
  const player = state.players[seat];
  const tiles = handWithDraw(state, seat);
  const counts = toCounts(tiles);
  const visible = visibleCounts(state, seat);
  const meldCount = player.melds.length;
  const forbiddenKey = player.forbiddenDiscardKind ? tileKindKey(player.forbiddenDiscardKind) : null;

  const results: DiscardEvaluation[] = [];
  const seen = new Set<string>();
  // ツモ牌を先に見ることで、同じ種類ならツモ切りを選ぶ
  const ordered = player.drawnTile ? [player.drawnTile, ...player.hand] : player.hand;
  for (const tile of ordered) {
    const key = tileKindKey(tile.kind);
    if (seen.has(key) || key === forbiddenKey) continue;
    seen.add(key);
    const idx = kindIndex(tile.kind);
    const iso = isolationScore(counts, idx);
    counts[idx]--;
    const shanten = shantenFromCounts(counts, meldCount);
    const ukeire = countUkeire(counts, meldCount, visible);
    counts[idx]++;
    results.push({ tile, shanten, ukeire, isolationScore: iso });
  }
  return results;
}

/** 向聴数最小 → 受け入れ最大 → 孤立度最大 の順で打牌を選ぶ */
export function chooseDiscard(state: GameState, seat: Seat): DiscardEvaluation {
  const player = state.players[seat];
  if (player.isRiichi && player.drawnTile) {
    return { tile: player.drawnTile, shanten: 0, ukeire: 0, isolationScore: 0 };
  }
  const evals = evaluateDiscards(state, seat);
  if (evals.length === 0) throw new Error("打牌できる牌がありません");
  let best = evals[0];
  for (const e of evals.slice(1)) {
    if (
      e.shanten < best.shanten ||
      (e.shanten === best.shanten && e.ukeire > best.ukeire) ||
      (e.shanten === best.shanten && e.ukeire === best.ukeire && e.isolationScore > best.isolationScore)
    ) {
      best = e;
    }
  }
  return best;
}

function drawOptions(state: GameState, seat: Seat) {
  const player = state.players[seat];
  const context = buildWinContext(state, seat, player.drawnTile as Tile, true);
  return getDrawActionOptions(
    handWithDraw(state, seat),
    player.melds,
    player.score,
    state.wall.liveWall.length,
    player.isRiichi,
    player.hand,
    context,
    !!player.forbiddenDiscardKind,
    state.kanCount
  );
}

/** 暗槓しても向聴数が悪化しないか */
function ankanKeepsShanten(state: GameState, seat: Seat, kind: TileKind): boolean {
  const player = state.players[seat];
  const counts = toCounts(handWithDraw(state, seat));
  const before = shantenFromCounts(counts, player.melds.length);
  const idx = kindIndex(kind);
  counts[idx] -= 4;
  const after = shantenFromCounts(counts, player.melds.length + 1);
  return after <= before;
}

/**
 * 守備ありの打牌選択(押し引き)。
 *   - 相手の脅威度が低い間は普段通り(向聴数・受け入れ優先)。ただし効率が同じくらいなら危険な牌を避ける。
 *   - 脅威度が高い(リーチ・高そうな鳴き)とき、自分の手が遠い・安い・待ちが悪いなら降りる
 *     (危険度の低い牌 = 現物・筋・見えている字牌 から切る)。
 */
export function chooseDiscardWithDefense(state: GameState, seat: Seat, profile: DefenseProfile): DiscardEvaluation {
  const player = state.players[seat];
  if (player.isRiichi && player.drawnTile) {
    return { tile: player.drawnTile, shanten: 0, ukeire: 0, isolationScore: 0 };
  }
  const evals = evaluateDiscards(state, seat);
  if (evals.length === 0) throw new Error("打牌できる牌がありません");
  const visible = visibleCounts(state, seat);
  const threat = opponentThreat(state, seat);
  const danger = new Map(evals.map((e) => [e, tileDanger(state, seat, e.tile.kind, visible)]));
  const bestShanten = Math.min(...evals.map((e) => e.shanten));
  const bestUkeire = Math.max(...evals.filter((e) => e.shanten === bestShanten).map((e) => e.ukeire));

  // 打点: 各候補を切った後の手の翻数の目安(ドラ・役牌・染め手・対々和・断么九)
  const counts = toCounts(handWithDraw(state, seat));
  const value = new Map(
    evals.map((e) => {
      const idx = kindIndex(e.tile.kind);
      counts[idx]--;
      const v = handValue(state, seat, counts, player.melds);
      counts[idx]++;
      return [e, v] as [DiscardEvaluation, number];
    })
  );
  const bestValueAtBest = Math.max(...evals.filter((e) => e.shanten === bestShanten).map((e) => value.get(e)!));

  // 待ちの質: 聴牌する打牌について、残り枚数・役の有無・フリテン・出やすさを評価する
  const waits = new Map<DiscardEvaluation, WaitQuality>();
  for (const e of evals) {
    if (e.shanten !== 0) continue;
    const idx = kindIndex(e.tile.kind);
    counts[idx]--;
    waits.set(e, evaluateWait(state, seat, counts, visible));
    counts[idx]++;
  }
  // 聴牌時の「受け入れ」は、待ちの良さの点数に置き換える(和了れない待ちは大きく減点)
  const efficiency = (e: DiscardEvaluation) => {
    const w = waits.get(e);
    if (!w) return e.ukeire;
    return w.remaining === 0 ? -30 : profile.waitWeight * w.score;
  };

  // 攻める場合: 向聴数を落とさない牌の中から、受け入れ・打点・危険度のバランスで選ぶ。
  // 序盤(2向聴以上)は、1向聴遅れても打点が大きく上がるなら(ドラ・役牌・染め手を残す)そちらも候補にする。
  const attack = (): DiscardEvaluation => {
    const candidates = evals.filter(
      (e) =>
        e.shanten === bestShanten ||
        (bestShanten >= 2 && e.shanten === bestShanten + 1 && value.get(e)! - bestValueAtBest >= profile.valueTradeoffHan)
    );
    const score = (e: DiscardEvaluation) =>
      efficiency(e) +
      profile.valueWeight * 4 * value.get(e)! -
      (e.shanten - bestShanten) * 20 -
      profile.dangerWeight * threat * 3 * danger.get(e)!;
    let best = candidates[0];
    for (const e of candidates.slice(1)) {
      const d = score(e) - score(best);
      if (d > 0 || (d === 0 && e.isolationScore > best.isolationScore)) best = e;
    }
    return best;
  };

  if (threat < profile.threatThreshold) return attack();

  // 押し引きに使う自分の打点: 向聴数を保つ打牌の中で最も高くなる形の見積もり
  const handVal = bestValueAtBest;
  const push =
    (bestShanten === 0 &&
      (threat < profile.foldWhenTenpaiThreat || handVal >= profile.tenpaiPushValue || bestUkeire >= profile.tenpaiPushWait)) ||
    (bestShanten === 1 && threat < 1 && handVal >= profile.pushOneShantenValue) ||
    (bestShanten === 2 && threat < 1 && handVal >= profile.pushTwoShantenValue);
  if (push) return attack();

  // 降りる: 危険度の低い牌 → 向聴数を保てる牌 → 受け入れの多い牌
  let best = evals[0];
  for (const e of evals.slice(1)) {
    const dd = danger.get(e)! - danger.get(best)!;
    if (
      dd < 0 ||
      (dd === 0 && e.shanten < best.shanten) ||
      (dd === 0 && e.shanten === best.shanten && e.ukeire > best.ukeire)
    ) {
      best = e;
    }
  }
  return { ...best, folding: true };
}

/** 打牌後の手の待ち(聴牌していなければ残り0) */
function waitAfterDiscard(state: GameState, seat: Seat, tile: Tile): WaitQuality {
  const counts = toCounts(handWithDraw(state, seat));
  counts[kindIndex(tile.kind)]--;
  return evaluateWait(state, seat, counts, visibleCounts(state, seat));
}

/**
 * 自分の手番(打牌フェーズ)の行動を決める。
 * profile を渡すと守備(押し引き・ベタオリ)ありで判断する。省略時は従来通りの牌効率だけのCPU。
 */
export function decideTurnAction(state: GameState, seat: Seat, profile?: DefenseProfile): CpuTurnAction {
  const player = state.players[seat];
  const options = drawOptions(state, seat);
  if (options.canTsumo) return { type: "tsumo" };

  for (const kind of options.ankanKinds) {
    // リーチ中の暗槓はエンジン側で「待ちが変わらない」場合に限られている
    if (player.isRiichi || ankanKeepsShanten(state, seat, kind)) {
      return { type: "ankan", kind };
    }
  }

  // 強化版: 加槓(相手の脅威が低く、加える牌を切るのと比べて手が悪くならない場合)
  if (profile && profile.extendedCalls && opponentThreat(state, seat) < profile.threatThreshold) {
    for (const kind of options.kakanKinds) {
      if (kakanKeepsShanten(state, seat, kind)) return { type: "kakan", kind };
    }
  }

  const choice = profile ? chooseDiscardWithDefense(state, seat, profile) : chooseDiscard(state, seat);
  const declareRiichi =
    !player.isRiichi &&
    !choice.folding &&
    // 強化版: 和了れる待ち牌が残っていない(空聴)ならリーチしない
    (!profile || waitAfterDiscard(state, seat, choice.tile).remaining > 0) &&
    choice.shanten === 0 &&
    options.riichiDiscardOptions.some((t) => t.id === choice.tile.id);
  return { type: "discard", tile: choice.tile, declareRiichi };
}

/** 役牌(三元牌・自風・場風)かどうか */
export function isYakuhai(state: GameState, seat: Seat, kind: TileKind): boolean {
  if (kind.kind !== "honor") return false;
  if (kind.honor === "white" || kind.honor === "green" || kind.honor === "red") return true;
  return kind.honor === seatWindOf(state, seat) || kind.honor === state.roundWind;
}

/**
 * 相手の捨て牌(call_window)に対する行動を決める。
 * profile を渡した場合、相手の脅威度が高く自分の手が遠い(1向聴以上)ときはポンしない(降りる手を崩さない)。
 */
export function decideCall(state: GameState, seat: Seat, profile?: DefenseProfile): CpuCallAction {
  const discard = state.lastDiscard;
  if (!discard || discard.from === seat) return "pass";
  const player = state.players[seat];
  const context = buildWinContext(state, seat, discard.tile, false);
  const ron = canDeclareRon(
    player.hand,
    player.melds,
    player.discards.map((d) => d.tile),
    isMissedRonFuriten(player),
    discard.tile,
    context
  );
  if (ron) return "ron";
  const pon = canDeclarePon(
    player.hand,
    discard.tile,
    player.isRiichi,
    state.wall.liveWall.length,
    state.fourKanAbortivePending
  );
  const threatened = !!profile && opponentThreat(state, seat) >= profile.threatThreshold;
  const currentShanten = shantenFromCounts(toCounts(player.hand), player.melds.length);
  // 相手の脅威が高く自分の手が遠いときは、鳴いて手を崩さない
  if (threatened && currentShanten >= 2) return "pass";

  if (pon && isYakuhai(state, seat, discard.tile.kind)) return "pon";

  if (profile && profile.extendedCalls) {
    const canKan = canDeclareMinkan(
      player.hand,
      discard.tile,
      player.isRiichi,
      state.wall.liveWall.length,
      state.kanCount
    );
    if (canKan && !threatened && shouldMinkan(state, seat, discard.tile.kind)) return "minkan";
    if (pon && shouldPon(state, seat, discard.tile.kind)) return "pon";
  }
  return "pass";
}

const dummyTiles = (kind: TileKind, n: number, tag: string): Tile[] =>
  Array.from({ length: n }, (_, i) => ({ id: `cpu-${tag}-${i}`, kind, isRedDora: false }));

/**
 * 強化版: 役牌以外のポンをするか。
 *   - ポンして1枚切った後の向聴数が、今より進む(下がる)こと
 *   - 鳴いた後も役がつく見込みがあること(役牌の刻子・混一色/清一色・対々和・断么九のいずれか)
 *   - 門前で既に聴牌している手は、リーチを捨ててまで鳴かない
 */
export function shouldPon(state: GameState, seat: Seat, kind: TileKind): boolean {
  const player = state.players[seat];
  const counts = toCounts(player.hand);
  const before = shantenFromCounts(counts, player.melds.length);
  const isMenzen = player.melds.every((m) => m.type === "kan_closed");
  if (isMenzen && before === 0) return false;

  const idx = kindIndex(kind);
  counts[idx] -= 2;
  const melds: Meld[] = [...player.melds, { type: "triplet", tiles: dummyTiles(kind, 3, "pon"), isOpen: true }];
  // ポン後の打牌(喰い替えになる同じ牌は切れない)の中で最も良い形
  let bestAfter = Infinity;
  let bestCounts: number[] | null = null;
  for (let i = 0; i < KIND_COUNT; i++) {
    if (counts[i] === 0 || i === idx) continue;
    counts[i]--;
    const s = shantenFromCounts(counts, melds.length);
    if (s < bestAfter) {
      bestAfter = s;
      bestCounts = counts.slice();
    }
    counts[i]++;
  }
  if (!bestCounts || bestAfter >= before) return false;

  const b = handValueBreakdown(state, seat, bestCounts, melds);
  const hasYakuPath = b.yakuhai >= 1 || b.flush >= 1 || b.toitoi >= 1 || b.tanyao >= 1;
  return hasYakuPath;
}

/**
 * 強化版: 大明槓するか。すでに鳴いている手(門前を崩さない)か役牌の刻子で、
 * カンしても向聴数が悪くならない場合だけ(ドラが増え、嶺上牌も引ける)。
 */
export function shouldMinkan(state: GameState, seat: Seat, kind: TileKind): boolean {
  const player = state.players[seat];
  const isMenzen = player.melds.every((m) => m.type === "kan_closed");
  if (isMenzen && !isYakuhai(state, seat, kind)) return false;
  const counts = toCounts(player.hand);
  const before = shantenFromCounts(counts, player.melds.length);
  counts[kindIndex(kind)] -= 3;
  const after = shantenFromCounts(counts, player.melds.length + 1);
  return after <= before;
}

/** 加槓しても、加える牌を普通に切った場合より向聴数が悪くならないか */
function kakanKeepsShanten(state: GameState, seat: Seat, kind: TileKind): boolean {
  const player = state.players[seat];
  const counts = toCounts(handWithDraw(state, seat));
  const idx = kindIndex(kind);
  counts[idx]--;
  // 加槓後は面子数が変わらない(刻子→槓子)ので、手牌から1枚減った状態の向聴数を比べる
  const after = shantenFromCounts(counts, player.melds.length);
  counts[idx]++;
  let bestDiscard = Infinity;
  for (let i = 0; i < KIND_COUNT; i++) {
    if (counts[i] === 0) continue;
    counts[i]--;
    bestDiscard = Math.min(bestDiscard, shantenFromCounts(counts, player.melds.length));
    counts[i]++;
  }
  return after <= bestDiscard;
}


// ---------------- ポンコツ型(弱いCPU) ----------------

/**
 * ポンコツ型の打ち方の設定。random は 0以上1未満の乱数を返す関数(テストでは固定値を渡せる)。
 * 基本は牌効率で打つが、ときどき適当な牌を切る・和了を見逃す・リーチしない・無駄にポンする。
 * 守備(降り)はしない。
 */
export const WEAK_CPU = {
  /** 和了できるのに見逃す確率(ポンコツ型でも和了できる場合は必ず和了する) */
  missWinRate: 0,
  /** 牌効率を無視して適当な牌を切る確率 */
  randomDiscardRate: 0.35,
  /** リーチできるのにしない確率 */
  skipRiichiRate: 0.5,
  /** 役牌以外でも、鳴けるならポンしてしまう確率(役が無くなって和了れなくなることもある) */
  pointlessPonRate: 0.3,
};

export function decideTurnActionWeak(state: GameState, seat: Seat, random: () => number = Math.random): CpuTurnAction {
  const player = state.players[seat];
  const base = decideTurnAction(state, seat);
  if (base.type === "tsumo") {
    if (random() >= WEAK_CPU.missWinRate) return base;
    // 見逃した場合は、下の打牌選択へ
  } else if (base.type !== "discard") {
    return base; // 暗槓はそのまま
  }
  if (player.isRiichi && player.drawnTile) {
    return { type: "discard", tile: player.drawnTile, declareRiichi: false };
  }
  let tile = base.type === "discard" ? base.tile : chooseDiscard(state, seat).tile;
  let declareRiichi = base.type === "discard" ? base.declareRiichi : false;
  if (random() < WEAK_CPU.randomDiscardRate) {
    const forbiddenKey = player.forbiddenDiscardKind ? tileKindKey(player.forbiddenDiscardKind) : null;
    const pool = handWithDraw(state, seat).filter((t) => tileKindKey(t.kind) !== forbiddenKey);
    if (pool.length > 0) {
      tile = pool[Math.floor(random() * pool.length) % pool.length];
      declareRiichi = false;
    }
  }
  if (declareRiichi && random() < WEAK_CPU.skipRiichiRate) declareRiichi = false;
  return { type: "discard", tile, declareRiichi };
}

export function decideCallWeak(state: GameState, seat: Seat, random: () => number = Math.random): CpuCallAction {
  const base = decideCall(state, seat);
  if (base === "ron") return random() < WEAK_CPU.missWinRate ? "pass" : "ron";
  if (base !== "pass") return base;
  const discard = state.lastDiscard;
  if (!discard) return "pass";
  const player = state.players[seat];
  const pon = canDeclarePon(
    player.hand,
    discard.tile,
    player.isRiichi,
    state.wall.liveWall.length,
    state.fourKanAbortivePending
  );
  return pon && random() < WEAK_CPU.pointlessPonRate ? "pon" : "pass";
}
