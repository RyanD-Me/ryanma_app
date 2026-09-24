import { GameState } from "../types/game";
import { Seat } from "../types/player";
import { Tile, TileKind, tileKindKey } from "../types/tile";
import { otherSeat, seatWindOf } from "../game/actions";
import { countDoraTiles } from "../yaku/dora";
import { kindIndex, toCounts } from "./shanten";
import { handValue } from "./value";

/**
 * CPUの守備(ベタオリ・押し引き)のための評価。
 *
 * 2人麻雀なので、ロンされる相手は常に1人(対面)だけ。
 *   - 危険度: その牌が相手に当たりそうな度合い(0 = 絶対に当たらない)。
 *   - 脅威度: 相手がどれくらい和了に近く、高そうか(0〜1)。
 *   - 押し引き: 自分の手(向聴数・受け入れ・打点)と脅威度を比べ、攻めるか降りるかを決める。
 *
 * このルールの牌は 萬子1〜9・筒子/索子の1と9・字牌 のみで、順子(両面・嵌張・辺張の待ち)は萬子にしか無い。
 * 筒子・索子・字牌への放銃は単騎・双碰(と国士無双)だけになるため、萬子の中張牌が最も危険になる。
 */

/** 守備の性格。のちの守備型・攻撃型・バランス型CPUで値を変える想定 */
export interface DefenseProfile {
  /** 脅威度がこれ以上なら押し引きを判断する(未満なら普段通り手を進める) */
  threatThreshold: number;
  /** 聴牌していても降りる脅威度(打点・待ちが悪い場合)。1より大きければ聴牌なら常に押す */
  foldWhenTenpaiThreat: number;
  /** 聴牌を受けても押す打点(翻数の目安)。これ以上か、待ちが tenpaiPushWait 枚以上なら押す */
  tenpaiPushValue: number;
  /** 聴牌を受けても押す待ちの残り枚数 */
  tenpaiPushWait: number;
  /** 1向聴でも押す打点(ドラ枚数などから見積もった翻数の目安)。これ未満なら降りる */
  pushOneShantenValue: number;
  /** 2向聴でも押す打点(リーチ以外の脅威に対してのみ) */
  pushTwoShantenValue: number;
  /** 攻めている最中でも、効率が同じくらいなら危険な牌を避ける強さ */
  dangerWeight: number;
  /** 打点(翻数の目安)をどれだけ重視するか。受け入れ枚数1枚 ≒ 翻数 1/(4×この値) */
  valueWeight: number;
  /** 向聴数が1つ遅れても打点を取る条件(翻数の目安がこれ以上増えるなら。2向聴以上の序盤のみ) */
  valueTradeoffHan: number;
  /** 聴牌する打牌で、待ちの良さ(残り枚数×出やすさ)をどれだけ重視するか */
  waitWeight: number;
  /** 役牌以外のポン(役がつく場合)や、加槓・大明槓をするか */
  extendedCalls: boolean;
}

/**
 * CPUの性格(テストプレイで選べる3種類)。
 *   - balanced(バランス型): 危ない時は降り、聴牌や高い手なら押す標準的な打ち方。
 *   - defensive(守備型): 相手の動きに早めに反応して降りる。鳴きは役牌だけで、門前を大事にする。
 *   - offensive(攻撃型): 聴牌なら必ず押し、1〜2向聴でも手が高ければ押す。打点を重視し、鳴きも積極的。
 */
export type CpuPersonality = "balanced" | "defensive" | "offensive";

export const DEFENSE_PROFILES: Record<CpuPersonality, DefenseProfile> = {
  balanced: {
    threatThreshold: 0.5,
    foldWhenTenpaiThreat: 0.9,
    tenpaiPushValue: 2,
    tenpaiPushWait: 4,
    pushOneShantenValue: 4,
    pushTwoShantenValue: Infinity,
    dangerWeight: 1,
    valueWeight: 1,
    valueTradeoffHan: 2,
    waitWeight: 1,
    extendedCalls: true,
  },
  defensive: {
    threatThreshold: 0.3,
    foldWhenTenpaiThreat: 0.5,
    tenpaiPushValue: 4,
    tenpaiPushWait: 6,
    pushOneShantenValue: Infinity,
    pushTwoShantenValue: Infinity,
    dangerWeight: 2,
    valueWeight: 0.8,
    valueTradeoffHan: 3,
    waitWeight: 1,
    extendedCalls: false,
  },
  offensive: {
    threatThreshold: 0.7,
    foldWhenTenpaiThreat: Infinity,
    tenpaiPushValue: 0,
    tenpaiPushWait: 0,
    pushOneShantenValue: 2,
    pushTwoShantenValue: 5,
    dangerWeight: 0.5,
    valueWeight: 1.3,
    valueTradeoffHan: 1.5,
    waitWeight: 1,
    extendedCalls: true,
  },
};

/**
 * 相手に対して確実に安全な牌の種類(見えている情報だけで判断する。相手の手牌やフリテン状態は見ない)。
 *   - 現物: 相手が捨てた牌。自分の捨て牌で待っていればフリテンでロンできない。
 *   - リーチ後に通った牌: 相手がリーチした後に自分が切ってロンされなかった牌。リーチ後は待ちが
 *     変わらないため、当たり牌でなかったか、見逃してその局はロンできなくなったかのどちらかになる。
 */
export function safeKindKeys(state: GameState, seat: Seat): Set<string> {
  const opponent = otherSeat(seat);
  const opp = state.players[opponent];
  const keys = new Set(opp.discards.map((d) => tileKindKey(d.tile.kind)));
  const riichiDecl = opp.discards.find((d) => d.isRiichiDeclaration);
  if (opp.isRiichi && riichiDecl && riichiDecl.seq != null) {
    for (const d of state.players[seat].discards) {
      if (d.seq != null && d.seq > riichiDecl.seq) keys.add(tileKindKey(d.tile.kind));
    }
  }
  return keys;
}

/**
 * 牌の種類ごとの危険度(0〜おおむね6)。seat(自分)から見て、相手 otherSeat(seat) に当たる度合い。
 * visible は自分から見えている枚数(visibleCounts)。
 */
export function tileDanger(state: GameState, seat: Seat, kind: TileKind, visible: number[]): number {
  // 相手の手牌・フリテン状態(見逃し等)は相手にしか分からないので使わない
  const genbutsu = safeKindKeys(state, seat);
  if (genbutsu.has(tileKindKey(kind))) return 0;

  const unseen = Math.max(0, 4 - visible[kindIndex(kind)]);
  // 単騎・双碰だけで当たる牌(字牌・筒子/索子): 残り枚数が少ないほど安全
  const pairWaitDanger = unseen <= 0 ? 0 : unseen === 1 ? 1 : unseen === 2 ? 2.5 : 3.5;
  if (kind.kind === "honor" || kind.suit !== "man") return pairWaitDanger;

  // 萬子: 両面・嵌張・辺張の待ちもある。筋(3つ離れた牌が現物)なら両面には当たらない
  const r = kind.rank;
  const isGen = (rank: number) => rank >= 1 && rank <= 9 && genbutsu.has(`number:man:${rank}`);
  // 両面待ちで r に当たりうる形: (r-2,r-1) は r-3 と、(r+1,r+2) は r+3 と同時待ち
  const lowSide = r >= 4; // (r-2, r-1) の両面(r-3 も待ち)
  const highSide = r <= 6; // (r+1, r+2) の両面(r+3 も待ち)
  let ryanmenOpen = 0;
  if (lowSide && !isGen(r - 3)) ryanmenOpen++;
  if (highSide && !isGen(r + 3)) ryanmenOpen++;
  // 嵌張・辺張・単騎・双碰のぶん
  const edgeBonus = r === 1 || r === 9 ? 0.5 : r === 2 || r === 8 ? 1 : 1.5;
  return pairWaitDanger * 0.6 + edgeBonus + ryanmenOpen * 1.5;
}

/**
 * 相手の脅威度(0〜1)。リーチなら1。鳴いている場合は副露数とドラ・残り巡目から見積もる。
 */
export function opponentThreat(state: GameState, seat: Seat): number {
  const opp = state.players[otherSeat(seat)];
  if (opp.isRiichi) return 1;
  const meldCount = opp.melds.length;
  if (meldCount === 0) {
    // 門前で黙っている相手は分からないので、終盤だけ少し警戒する
    return state.wall.liveWall.length <= 8 ? 0.3 : 0;
  }
  const meldTiles = opp.melds.flatMap((m) => m.tiles);
  const dora = countDoraTiles(meldTiles, state.wall.revealedDoraIndicators);
  let threat = meldCount >= 3 ? 0.8 : meldCount === 2 ? 0.55 : 0.3;
  if (dora >= 2) threat += 0.2;
  else if (dora === 1) threat += 0.1;
  if (state.wall.liveWall.length <= 10) threat += 0.1;
  return Math.min(1, threat);
}

/** 自分の手の打点の目安(翻数くらいの値)。value.ts の handValue(ドラ・役牌・染め手・対々和・断么九・門前)を使う */
export function estimateHandValue(state: GameState, seat: Seat, tiles: Tile[]): number {
  return handValue(state, seat, toCounts(tiles), state.players[seat].melds);
}

/** (旧)ドラ・門前・役牌刻子だけの簡易な見積もり。参考として残す */
export function estimateHandValueSimple(state: GameState, seat: Seat, tiles: Tile[]): number {
  const player = state.players[seat];
  const allTiles = [...tiles, ...player.melds.flatMap((m) => m.tiles)];
  let value = countDoraTiles(allTiles, state.wall.revealedDoraIndicators);
  const isMenzen = player.melds.every((m) => m.type === "kan_closed");
  if (isMenzen) value += 1; // リーチ(+ツモ)の分
  // 役牌の刻子(手牌・副露)
  const counts = new Map<string, number>();
  for (const t of allTiles) counts.set(tileKindKey(t.kind), (counts.get(tileKindKey(t.kind)) ?? 0) + 1);
  const seatWind: string = seatWindOf(state, seat);
  for (const [key, n] of counts) {
    if (n < 3 || !key.startsWith("honor:")) continue;
    const h = key.slice("honor:".length);
    if (h === "white" || h === "green" || h === "red") value += 1;
    if (h === state.roundWind) value += 1;
    if (h === seatWind) value += 1;
  }
  return value;
}
