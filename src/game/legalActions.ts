import { Tile, TileKind, tileKindKey } from "../types/tile";
import { Meld } from "../types/meld";
import { bucketize } from "../yaku/decompose";
import { isTenpai } from "../yaku/tenpai";
import { isPermanentFuriten } from "../yaku/furiten";
import { evaluateYaku } from "../yaku/evaluate";
import { HandForEvaluation, WinContext } from "../yaku/context";
import { canAnkanDuringRiichi } from "./riichiAnkan";

/**
 * ツモ和了できるか(役の有無まで確認する)。
 *
 * ポンの直後は牌を引いていない(=打牌が必要なだけでツモってはいない)ため
 * winningTile が存在しない(暗槓・大明槓・加槓は他のカンと同様、直後に嶺上牌を
 * 1枚ツモるので winningTile は存在する)。そのような自摸のない局面でツモ和了は
 * 成立しえないので、ここで先に弾いておく(弾かないと、和了牌が存在しない前提の
 * 待ち判定が壊れてクラッシュする)。
 */
export function canDeclareTsumo(
  concealedWithDraw: Tile[],
  melds: Meld[],
  context: WinContext
): boolean {
  if (!context.winningTile) return false;
  const hand: HandForEvaluation = { concealedTiles: concealedWithDraw, melds };
  const result = evaluateYaku(hand, context);
  return result.isWin && result.yaku.length > 0;
}

/** ロン和了できるか(役の有無・フリテンまで確認する) */
export function canDeclareRon(
  concealedBeforeRon: Tile[],
  melds: Meld[],
  ownDiscards: Tile[],
  /** 見逃しによるフリテン中か(同巡内フリテン・リーチ後の局中フリテンのいずれか)。
   *  呼び出し側は isMissedRonFuriten(player) の結果をそのまま渡すこと。 */
  ownMissedRonFuriten: boolean,
  discardedTile: Tile,
  context: WinContext
): boolean {
  if (ownMissedRonFuriten) return false;
  if (isPermanentFuriten(concealedBeforeRon, melds, ownDiscards)) return false;

  const hand: HandForEvaluation = {
    concealedTiles: [...concealedBeforeRon, discardedTile],
    melds,
  };
  const result = evaluateYaku(hand, context);
  return result.isWin && result.yaku.length > 0;
}

/**
 * ポンできるか。
 *
 * リーチ後はポンで手牌が変化する(=待ちが変わりうる)ことを認めないため、
 * リーチ済みなら常に不可とする。また、河底(自摸山が尽きた後の最後の捨て牌)に
 * 対してはポンできない(鳴くと局が終わらなくなってしまうため)。
 */
export function canDeclarePon(
  concealedTiles: Tile[],
  discardedTile: Tile,
  isRiichi: boolean,
  liveWallRemaining: number,
  /**
   * 4回目のカン(四槓子の場合を除く)の嶺上牌を打牌した、その1回だけ。
   * この打牌はロン以外では受けられない(ポン・カンいずれも不可)。
   */
  isFourKanAbortivePending: boolean = false
): boolean {
  if (isRiichi) return false;
  if (liveWallRemaining === 0) return false; // 河底
  if (isFourKanAbortivePending) return false;
  const key = tileKindKey(discardedTile.kind);
  const count = concealedTiles.filter((t) => tileKindKey(t.kind) === key).length;
  return count >= 2;
}

/**
 * 大明槓(相手の捨て牌でのカン)できるか。
 *
 * リーチ後に取りうる行動はツモ切り・暗槓(待ちを変えない場合のみ)・ツモ和了・ロン和了に限られるため、
 * リーチ済みなら常に不可とする。また、河底に対してはポンと同様に大明槓もできない。
 */
export function canDeclareMinkan(
  concealedTiles: Tile[],
  discardedTile: Tile,
  isRiichi: boolean,
  liveWallRemaining: number,
  /** 4回目のカンが成立した後は、その局ではもうカンできない。 */
  kanCount: number = 0
): boolean {
  if (isRiichi) return false;
  if (liveWallRemaining === 0) return false; // 河底
  if (kanCount >= 4) return false;
  const key = tileKindKey(discardedTile.kind);
  const count = concealedTiles.filter((t) => tileKindKey(t.kind) === key).length;
  return count === 3;
}

export interface DrawActionOptions {
  /** ツモ和了できるか */
  canTsumo: boolean;
  /** リーチ宣言とともに打てる牌の一覧(これ以外の牌を切るとリーチにはならない) */
  riichiDiscardOptions: Tile[];
  /** 暗槓できる牌の種類 */
  ankanKinds: TileKind[];
  /** 加槓できる牌の種類(リーチ中は不可) */
  kakanKinds: TileKind[];
}

/**
 * 自摸直後に取りうる行動をまとめて計算する。
 *
 * @param concealedBeforeDraw リーチ後の暗槓可否判定に使う、ツモ前の13枚(リーチしていなければ未使用)
 */
export function getDrawActionOptions(
  concealedWithDraw: Tile[],
  melds: Meld[],
  playerScore: number,
  liveWallRemaining: number,
  isRiichi: boolean,
  concealedBeforeDraw: Tile[],
  context: WinContext,
  /**
   * ポンした直後、まだ実際に打牌していない状態かどうか。
   * この状態では(喰い替え禁止と同様の趣旨で)暗槓・加槓のいずれもできない
   * 「ポンの後は、打牌するまでカンを禁止」というルールのため。
   */
  hasPendingPonDiscard: boolean = false,
  /** これまでに成立したカンの総数(二人合計)。4回に到達したらもうカンできない。 */
  kanCount: number = 0
): DrawActionOptions {
  const canTsumo = canDeclareTsumo(concealedWithDraw, melds, context);

  const riichiDiscardOptions = getRiichiDiscardOptions(
    concealedWithDraw,
    melds,
    playerScore,
    liveWallRemaining,
    isRiichi
  );

  // 海底(自摸山が尽きた後の最後の自摸)では、嶺上牌を補充するための
  // 自摸山がもう残っていないため、暗槓・加槓のいずれもできない。
  // また、ポンした直後で、まだ実際に打牌していない間や、4回目のカンが成立した
  // 後(その局ではもうカンできない)もカンはできない。
  const noWallLeftForKan = liveWallRemaining === 0 || hasPendingPonDiscard || kanCount >= 4;
  const ankanKinds = noWallLeftForKan
    ? []
    : getAnkanKinds(concealedWithDraw, melds, isRiichi, concealedBeforeDraw);
  const kakanKinds = noWallLeftForKan || isRiichi ? [] : getKakanKinds(concealedWithDraw, melds);

  return { canTsumo, riichiDiscardOptions, ankanKinds, kakanKinds };
}

function getRiichiDiscardOptions(
  concealedWithDraw: Tile[],
  melds: Meld[],
  playerScore: number,
  liveWallRemaining: number,
  isRiichi: boolean
): Tile[] {
  if (isRiichi) return []; // 既にリーチ済みなら再度のリーチ宣言はない
  if (melds.some((m) => m.isOpen)) return []; // 副露があれば門前でないためリーチ不可
  if (playerScore < 1000) return [];
  if (liveWallRemaining < 1) return []; // 山残り1枚まではリーチ可能(0枚、つまり海底ならリーチ不可)

  // 同じ種類の牌はどれを切っても結果(残りの手牌)は同じなので、聴牌判定は種類ごとに
  // 1回だけ行い、リーチできると分かったらその種類の牌をすべて選択肢に入れる
  // (例: 3萬を3枚持っていて3萬を切ればリーチできる場合、3枚のどれでも選べるようにする)。
  const options: Tile[] = [];
  const checkedKinds = new Set<string>();
  for (const candidate of concealedWithDraw) {
    const key = tileKindKey(candidate.kind);
    if (checkedKinds.has(key)) continue;
    checkedKinds.add(key);

    const remaining = concealedWithDraw.filter((t) => t.id !== candidate.id);
    if (isTenpai(remaining, melds)) {
      options.push(...concealedWithDraw.filter((t) => tileKindKey(t.kind) === key));
    }
  }
  return options;
}

function getAnkanKinds(
  concealedWithDraw: Tile[],
  melds: Meld[],
  isRiichi: boolean,
  concealedBeforeDraw: Tile[]
): TileKind[] {
  const buckets = bucketize(concealedWithDraw);
  const candidates: TileKind[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.tiles.length === 4) candidates.push(bucket.kind);
  }
  if (!isRiichi) return candidates;
  return candidates.filter((kind) =>
    canAnkanDuringRiichi(concealedBeforeDraw, concealedWithDraw, melds, kind)
  );
}

function getKakanKinds(concealedWithDraw: Tile[], melds: Meld[]): TileKind[] {
  const result: TileKind[] = [];
  for (const m of melds) {
    if (m.type !== "triplet" || !m.isOpen) continue;
    const key = tileKindKey(m.tiles[0].kind);
    if (concealedWithDraw.some((t) => tileKindKey(t.kind) === key)) {
      result.push(m.tiles[0].kind);
    }
  }
  return result;
}
