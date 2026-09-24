import { Tile, TileKind } from "./tile";
import { Meld } from "./meld";

/** 二人麻雀なので座席は2つ */
export type Seat = "east" | "south";

export interface DiscardedTile {
  tile: Tile;
  /** この牌でリーチ宣言したか(横向きに表示するため) */
  isRiichiDeclaration: boolean;
  /** 他家に鳴かれて場に残っていないか */
  isCalled: boolean;
  /**
   * その局で何番目の打牌か(両家通しの0始まり)。どちらの打牌が先かを比べるために使う
   * (例: 相手のリーチ宣言より後に自分が切った牌か)。古いデータには無い場合がある。
   */
  seq?: number;
}

export interface PlayerState {
  seat: Seat;
  /** 現在の手牌(鳴いた牌は含まない、伏せられた状態のもの) */
  hand: Tile[];
  /** 副露(鳴き)した面子 */
  melds: Meld[];
  /** 河(捨て牌の履歴) */
  discards: DiscardedTile[];
  /** 持ち点 */
  score: number;
  /** リーチ済みかどうか */
  isRiichi: boolean;
  /** ダブルリーチかどうか(配牌時点でのリーチ) */
  isDoubleRiichi: boolean;
  /** 一発の権利がまだ残っているか(自分の直後の1巡以内かつ鳴きが入っていない) */
  hasIppatsuChance: boolean;
  /** 現在のツモ牌(自摸直後、まだ捨てていない場合のみ存在) */
  drawnTile: Tile | null;
  /**
   * 同巡内の一時的フリテン。相手の捨てた和了牌を見逃した場合に立ち、
   * 自分が次に打牌するまでロン不可になる(永続フリテンは捨て牌履歴から都度判定するため
   * ここでは持たない)。
   */
  isTemporaryFuriten: boolean;
  /**
   * リーチ後の見逃しによるフリテン。リーチ後にロンできる牌を見逃した場合、
   * 同巡内だけでなくその局が終わるまでロンできなくなる(リーチ中は手牌を変えられず
   * 待ちも変わらないため、一時的フリテンのように打牌で解消されない)。
   * 局が変われば新しい手牌になるため、次局には引き継がれない。
   */
  isRiichiMissedFuriten: boolean;
  /**
   * 喰い替え禁止: ポンした直後は、そのポンで使った牌と同じ種類の牌を
   * 打牌できない(例: 3萬をポン→3萬を打牌、は不可)。ポン成立時にポンした牌の
   * 種類をここに記録し、実際に打牌が行われた時点で null に戻す
   * (暗槓・加槓を挟んでも、実際に打牌するまでは制限が続く)。
   */
  forbiddenDiscardKind: TileKind | null;
}

/** 新規プレイヤー状態を作るヘルパー */
export function createInitialPlayerState(seat: Seat, score: number): PlayerState {
  return {
    seat,
    hand: [],
    melds: [],
    discards: [],
    score,
    isRiichi: false,
    isDoubleRiichi: false,
    hasIppatsuChance: false,
    drawnTile: null,
    isTemporaryFuriten: false,
    isRiichiMissedFuriten: false,
    forbiddenDiscardKind: null,
  };
}
