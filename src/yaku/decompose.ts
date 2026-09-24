import { Tile, TileKind, tileKindKey } from "../types/tile";

export type SuitCategory = "man" | "pin" | "sou" | "honor";

export function suitCategoryOf(kind: TileKind): SuitCategory {
  if (kind.kind === "honor") return "honor";
  return kind.suit;
}

export interface TileGroup {
  type: "sequence" | "triplet" | "pair";
  tiles: Tile[]; // sequence/triplet = 3枚、pair = 2枚
}

interface KindBucket {
  kind: TileKind;
  tiles: Tile[];
}

/** 牌の種類ごとにグルーピングする */
export function bucketize(tiles: Tile[]): Map<string, KindBucket> {
  const map = new Map<string, KindBucket>();
  for (const t of tiles) {
    const key = tileKindKey(t.kind);
    if (!map.has(key)) {
      map.set(key, { kind: t.kind, tiles: [] });
    }
    map.get(key)!.tiles.push(t);
  }
  return map;
}

function splitBySuit(tiles: Tile[]): Record<SuitCategory, Tile[]> {
  const result: Record<SuitCategory, Tile[]> = {
    man: [],
    pin: [],
    sou: [],
    honor: [],
  };
  for (const t of tiles) {
    result[suitCategoryOf(t.kind)].push(t);
  }
  return result;
}

/**
 * 順子を許可しないスート(筒子・索子・字牌)の面子分解。
 * このルールでは筒子・索子は1と9しかなく、順子は成立し得ないため、
 * 各種類の枚数がすべて3の倍数であれば刻子の組み合わせは一意に決まる。
 */
function decomposeNoSequenceSuit(tiles: Tile[]): TileGroup[][] {
  if (tiles.length === 0) return [[]];
  if (tiles.length % 3 !== 0) return [];

  const buckets = bucketize(tiles);
  const groups: TileGroup[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.tiles.length % 3 !== 0) return [];
    for (let i = 0; i < bucket.tiles.length; i += 3) {
      groups.push({ type: "triplet", tiles: bucket.tiles.slice(i, i + 3) });
    }
  }
  return [groups];
}

/** 萬子(1-9)の面子分解。刻子・順子の両方を試す再帰的な探索。 */
function decomposeManSuit(tiles: Tile[]): TileGroup[][] {
  if (tiles.length === 0) return [[]];
  if (tiles.length % 3 !== 0) return [];

  const byRank: Tile[][] = Array.from({ length: 10 }, () => []); // index 1-9使用
  for (const t of tiles) {
    if (t.kind.kind === "number" && t.kind.suit === "man") {
      byRank[t.kind.rank].push(t);
    }
  }

  const results: TileGroup[][] = [];

  function backtrack(current: TileGroup[]) {
    let rank = -1;
    for (let r = 1; r <= 9; r++) {
      if (byRank[r].length > 0) {
        rank = r;
        break;
      }
    }
    if (rank === -1) {
      results.push([...current]);
      return;
    }

    // 刻子を試す
    if (byRank[rank].length >= 3) {
      const used = byRank[rank].splice(0, 3);
      current.push({ type: "triplet", tiles: used });
      backtrack(current);
      current.pop();
      byRank[rank].unshift(...used);
    }

    // 順子を試す(rank, rank+1, rank+2)
    if (rank <= 7 && byRank[rank + 1].length > 0 && byRank[rank + 2].length > 0) {
      const t1 = byRank[rank].pop()!;
      const t2 = byRank[rank + 1].pop()!;
      const t3 = byRank[rank + 2].pop()!;
      current.push({ type: "sequence", tiles: [t1, t2, t3] });
      backtrack(current);
      current.pop();
      byRank[rank].push(t1);
      byRank[rank + 1].push(t2);
      byRank[rank + 2].push(t3);
    }
  }

  backtrack([]);

  // 牌の個体差(同じ種類のどのインスタンスを使ったか)による重複を除去する
  const seen = new Set<string>();
  const deduped: TileGroup[][] = [];
  for (const decomp of results) {
    const sig = decomp
      .map((g) => `${g.type}:${g.tiles.map((t) => tileKindKey(t.kind)).sort().join(",")}`)
      .sort()
      .join("|");
    if (!seen.has(sig)) {
      seen.add(sig);
      deduped.push(decomp);
    }
  }
  return deduped;
}

/**
 * 濃縮牌(門前部分。鳴き・カンで独立させた面子は含まない)を、
 * 指定した面子数 + 雀頭1つに分解できるすべてのパターンを返す。
 * 分解できない場合は空配列を返す。
 */
export function decomposeConcealedHand(
  concealedTiles: Tile[],
  requiredSets: number
): TileGroup[][] {
  const bySuit = splitBySuit(concealedTiles);
  const kindBuckets = bucketize(concealedTiles);
  const results: TileGroup[][] = [];

  for (const bucket of kindBuckets.values()) {
    if (bucket.tiles.length < 2) continue;

    const pairTiles = bucket.tiles.slice(0, 2);
    const pairGroup: TileGroup = { type: "pair", tiles: pairTiles };
    const cat = suitCategoryOf(bucket.kind);

    const remaining: Record<SuitCategory, Tile[]> = {
      man: [...bySuit.man],
      pin: [...bySuit.pin],
      sou: [...bySuit.sou],
      honor: [...bySuit.honor],
    };
    for (const pt of pairTiles) {
      const idx = remaining[cat].findIndex((t) => t.id === pt.id);
      remaining[cat].splice(idx, 1);
    }

    const manOptions = decomposeManSuit(remaining.man);
    const pinOptions = decomposeNoSequenceSuit(remaining.pin);
    const souOptions = decomposeNoSequenceSuit(remaining.sou);
    const honorOptions = decomposeNoSequenceSuit(remaining.honor);

    if (manOptions.length === 0) continue;
    if (pinOptions.length === 0) continue;
    if (souOptions.length === 0) continue;
    if (honorOptions.length === 0) continue;

    for (const m of manOptions) {
      for (const p of pinOptions) {
        for (const s of souOptions) {
          for (const h of honorOptions) {
            const combined = [...m, ...p, ...s, ...h];
            if (combined.length === requiredSets) {
              results.push([...combined, pairGroup]);
            }
          }
        }
      }
    }
  }

  return results;
}
