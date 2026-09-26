import { Tile, TileKind, allTileKinds, tileKindKey } from "../types/tile";
import { Wall } from "../types/wall";
import { Seat } from "../types/player";
import { Rng, createSeededRng, generateRandomSeed } from "./rng";

/** 何も混ぜていない、80枚(20種×4枚)の牌一式を作る */
export function createFullTileSet(): Tile[] {
  const kinds: TileKind[] = allTileKinds();
  const tiles: Tile[] = [];

  for (const kind of kinds) {
    const key = tileKindKey(kind);
    for (let copyIndex = 0; copyIndex < 4; copyIndex++) {
      tiles.push({
        id: `${key}#${copyIndex}`,
        kind,
        // TODO: 赤ドラを採用する場合はここで特定の1枚に isRedDora: true を立てる
        isRedDora: false,
      });
    }
  }

  return tiles;
}

/** Fisher-Yates シャッフル。渡した配列は変更せず、新しい配列を返す。 */
export function shuffleTiles(tiles: Tile[], rng: Rng): Tile[] {
  const result = [...tiles];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface BuiltWall {
  wall: Wall;
  /** このシャッフルに使ったシード値(検証・再現用に対局記録へ残す)。乱数関数を渡した場合は null */
  seed: number | null;
}

/**
 * 牌山を作る(配牌前の状態)。
 *
 * 内訳(全80枚):
 *  - 王牌14枚
 *      - 嶺上牌(カン用)  4枚
 *      - 表ドラ表示牌     5枚(最初に1枚、カンのたびに1枚ずつめくる)
 *      - 裏ドラ表示牌     5枚(表と同じ位置が対応。カン裏あり)
 *  - 残り66枚が自摸山(liveWall)。ここから配牌13枚×2人=26枚を
 *    引いた後、実際に自摸で減っていくのは40枚。
 *
 * seed を渡すとその値から決定的にシャッフルする(再現・検証用)。
 * 渡さない場合はランダムなシードを都度生成する。
 * 乱数関数(0以上1未満を返す)を渡すと、それでシャッフルする。オンライン対戦のサーバーは、
 * 配牌から逆算されないよう暗号用の乱数を渡す(シード値は32ビットしかなく、自分の配牌13枚と
 * ドラ表示牌から総当たりで牌山全体を割り出せてしまうため)。
 */
export function buildWall(seed?: number | Rng): BuiltWall {
  if (typeof seed === "function") {
    return { wall: layoutWall(shuffleTiles(createFullTileSet(), seed)), seed: null };
  }
  const usedSeed = seed ?? generateRandomSeed();
  return { wall: layoutWall(shuffleTiles(createFullTileSet(), createSeededRng(usedSeed))), seed: usedSeed };
}

/** シャッフル済みの80枚を王牌・自摸山に分ける */
function layoutWall(shuffled: Tile[]): Wall {
  const deadWallSize = 14;
  const rinshanSize = 4;
  const doraStackSize = 5;

  const deadWall = shuffled.slice(0, deadWallSize);
  const liveWall = shuffled.slice(deadWallSize);

  const deadWallDraws = deadWall.slice(0, rinshanSize);
  const doraIndicatorTiles = deadWall.slice(rinshanSize, rinshanSize + doraStackSize);
  const uraDoraIndicatorTiles = deadWall.slice(rinshanSize + doraStackSize);

  return {
    liveWall,
    doraIndicatorTiles,
    revealedDoraIndicators: [],
    uraDoraIndicatorTiles,
    deadWallDraws,
  };
}

/** 王牌からドラ表示牌を1枚めくる(対局開始時、およびカン成立時に呼ぶ) */
export function revealNextDoraIndicator(wall: Wall): Wall {
  if (wall.doraIndicatorTiles.length === 0) {
    throw new Error("めくれるドラ表示牌が残っていません");
  }
  const [next, ...rest] = wall.doraIndicatorTiles;
  return {
    ...wall,
    doraIndicatorTiles: rest,
    revealedDoraIndicators: [...wall.revealedDoraIndicators, next],
  };
}

export interface DealResult {
  wall: Wall;
  hands: Record<Seat, Tile[]>;
}

/**
 * 配牌の取り方。実際の卓と同じく、東家→南家の順に交互に、4枚・4枚・4枚・1枚ずつ取る
 * (4枚を3巡、最後に1枚ずつで計13枚)。
 */
export const DEAL_ROUNDS: readonly number[] = [4, 4, 4, 1];

/**
 * 配牌を行う。seats の順(東家→南家)に交互に、DEAL_ROUNDS の枚数ずつ自摸山の先頭から配る
 * (東家4枚→南家4枚→東家4枚→南家4枚→東家4枚→南家4枚→東家1枚→南家1枚)。
 * 配った分は自摸山から取り除いた新しい Wall を返す(元のオブジェクトは変更しない)。
 */
export function dealInitialHands(wall: Wall, seats: Seat[]): DealResult {
  const handSize = DEAL_ROUNDS.reduce((sum, n) => sum + n, 0); // 13
  const requiredTiles = handSize * seats.length;

  if (wall.liveWall.length < requiredTiles) {
    throw new Error(
      `配牌に必要な牌が足りません(必要:${requiredTiles}枚、残り:${wall.liveWall.length}枚)`
    );
  }

  const hands: Partial<Record<Seat, Tile[]>> = {};
  for (const seat of seats) hands[seat] = [];
  let cursor = 0;

  for (const count of DEAL_ROUNDS) {
    for (const seat of seats) {
      (hands[seat] as Tile[]).push(...wall.liveWall.slice(cursor, cursor + count));
      cursor += count;
    }
  }

  return {
    wall: {
      ...wall,
      liveWall: wall.liveWall.slice(cursor),
    },
    hands: hands as Record<Seat, Tile[]>,
  };
}
