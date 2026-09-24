import { Tile, TileKind } from "../types/tile";
import { Meld } from "../types/meld";
import { TileGroup } from "./decompose";

export type WinningGroupType = "sequence" | "triplet" | "kan" | "pair";

export interface WinningGroup {
  type: WinningGroupType;
  isOpen: boolean;
  tiles: Tile[];
  /** グループを代表する牌の種類(刻子・槓子・雀頭はその牌、順子は最も若い牌) */
  kind: TileKind;
}

function representativeKind(type: WinningGroupType, tiles: Tile[]): TileKind {
  if (type === "sequence") {
    const sorted = [...tiles].sort((a, b) => {
      const ra = a.kind.kind === "number" ? a.kind.rank : 0;
      const rb = b.kind.kind === "number" ? b.kind.rank : 0;
      return ra - rb;
    });
    return sorted[0].kind;
  }
  return tiles[0].kind;
}

function meldToWinningGroup(meld: Meld): WinningGroup {
  const type: WinningGroupType =
    meld.type === "kan_open" || meld.type === "kan_closed"
      ? "kan"
      : meld.type === "triplet"
        ? "triplet"
        : "sequence";
  return {
    type,
    isOpen: meld.isOpen,
    tiles: meld.tiles,
    kind: representativeKind(type, meld.tiles),
  };
}

function tileGroupToWinningGroup(group: TileGroup): WinningGroup {
  return {
    type: group.type,
    isOpen: false,
    tiles: group.tiles,
    kind: representativeKind(group.type, group.tiles),
  };
}

/** 門前部分の分解結果と既存の鳴き・カンを合わせて、和了時の面子構成をひとつにまとめる */
export function toWinningGroups(decomposition: TileGroup[], melds: Meld[]): WinningGroup[] {
  return [...melds.map(meldToWinningGroup), ...decomposition.map(tileGroupToWinningGroup)];
}

export type WaitPattern = "ryanmen" | "kanchan" | "penchan" | "tanki" | "shanpon";

/**
 * 和了牌がどの面子・雀頭に収まって、どんな待ちの形だったかを判定する。
 * groups は toWinningGroups() で作った和了時点の全面子(鳴き含む)。
 */
export function determineWaitPattern(groups: WinningGroup[], winningTile: Tile): WaitPattern {
  const group = groups.find((g) => g.tiles.some((t) => t.id === winningTile.id));
  if (!group) {
    throw new Error("和了牌がどの面子にも含まれていません(内部エラー)");
  }

  if (group.type === "pair") return "tanki";
  if (group.type === "triplet" || group.type === "kan") return "shanpon";

  if (winningTile.kind.kind !== "number") {
    throw new Error("順子の和了牌が数牌ではありません(内部エラー)");
  }
  const ranks = group.tiles
    .map((t) => (t.kind.kind === "number" ? t.kind.rank : -1))
    .sort((a, b) => a - b);
  const winRank = winningTile.kind.rank;
  const position = ranks.indexOf(winRank);

  if (position === 1) return "kanchan";
  if (position === 0 && ranks[0] === 7) return "penchan";
  if (position === 2 && ranks[0] === 1) return "penchan";
  return "ryanmen";
}
