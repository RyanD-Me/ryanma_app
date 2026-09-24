import { Tile, TileKind, tileKindKey } from "../types/tile";
import { WinningGroup, determineWaitPattern } from "./waitPattern";
import { WinContext, YakuResult } from "./context";

export function isTerminalOrHonor(kind: TileKind): boolean {
  if (kind.kind === "honor") return true;
  return kind.rank === 1 || kind.rank === 9;
}

function isTerminalNumber(kind: TileKind): boolean {
  return kind.kind === "number" && (kind.rank === 1 || kind.rank === 9);
}

export function isDragonKind(kind: TileKind): boolean {
  return kind.kind === "honor" && (kind.honor === "white" || kind.honor === "green" || kind.honor === "red");
}

export function isWindKind(kind: TileKind): boolean {
  return (
    kind.kind === "honor" &&
    (kind.honor === "east" || kind.honor === "south" || kind.honor === "west" || kind.honor === "north")
  );
}

function suitsUsed(groups: WinningGroup[]): Set<"man" | "pin" | "sou" | "honor"> {
  const s = new Set<"man" | "pin" | "sou" | "honor">();
  for (const g of groups) {
    s.add(g.kind.kind === "honor" ? "honor" : g.kind.suit);
  }
  return s;
}

function groupContainsTerminalOrHonor(g: WinningGroup): boolean {
  return g.tiles.some((t) => isTerminalOrHonor(t.kind));
}

function hasManSequenceStartingAt(sets: WinningGroup[], startRank: number): boolean {
  return sets.some(
    (g) => g.type === "sequence" && g.kind.kind === "number" && g.kind.suit === "man" && g.kind.rank === startRank
  );
}

/**
 * 和了牌によってこの面子(刻子・槓子)が完成した場合、
 * ツモなら暗刻のまま、ロンなら明刻扱いとする(標準ルール)。
 * 四暗刻(このルールでの改定版)はこの区別を使わず、
 * 待ちの形(シャンポン/単騎)だけで判定する点に注意。
 */
export function isRealAnkou(g: WinningGroup, context: WinContext): boolean {
  if (g.type !== "triplet" && g.type !== "kan") return false;
  if (g.isOpen) return false;
  const containsWinningTile = g.tiles.some((t) => t.id === context.winningTile.id);
  if (!containsWinningTile) return true;
  return context.isTsumo;
}

/**
 * 状況役(立直・一発・門前清自摸和・海底摸月・河底撈魚・嶺上開花)。
 * 手牌の形(標準形か七対子か等)に関係なく、和了時の状況だけで決まるため、
 * 標準形(evaluateStandardYaku)・七対子のどちらの判定からも共通で呼び出す。
 */
export function evaluateSituationalYaku(context: WinContext, isMenzen: boolean): YakuResult[] {
  const results: YakuResult[] = [];
  const add = (y: YakuResult) => results.push(y);

  if (context.isDoubleRiichi) {
    add({ id: "double_riichi", name: "ダブル立直", isYakuman: false, han: 2, combinable: true });
  } else if (context.isRiichi) {
    add({ id: "riichi", name: "立直", isYakuman: false, han: 1, combinable: true });
  }
  if (context.isIppatsu) {
    add({ id: "ippatsu", name: "一発", isYakuman: false, han: 1, combinable: true });
  }
  if (context.isTsumo && isMenzen) {
    add({ id: "menzen_tsumo", name: "門前清自摸和", isYakuman: false, han: 1, combinable: true });
  }
  if (context.isHaitei) {
    add({ id: "haitei", name: "海底摸月", isYakuman: false, han: 1, combinable: true });
  }
  if (context.isHoutei) {
    add({ id: "houtei", name: "河底撈魚", isYakuman: false, han: 1, combinable: true });
  }
  if (context.isRinshan) {
    add({ id: "rinshan", name: "嶺上開花", isYakuman: false, han: 1, combinable: true });
  }

  return results;
}

/**
 * 七対子(通常の七対子。大七星・大数隣は専用の役満のためここでは対象外)と複合する
 * 手牌の形に基づく役(混一色・清一色・混老頭)。
 *
 * この改定ルールでは筒子・索子が1・9(老頭牌)しか無いため、七対子で断幺九が成立するのは
 * 萬子2〜8の7種だけを使う場合に限られるが、それは必ず大数隣(役満)と一致するため、
 * 七対子側で断幺九を別途判定する必要はない。同様に清老頭(老頭牌のみ)は老頭牌が
 * 6種(萬1・9、筒1・9、索1・9)しかなく7組を作れないため成立し得ない。
 */
export function evaluateChiitoitsuShapeYaku(pairKinds: TileKind[]): YakuResult[] {
  const results: YakuResult[] = [];
  const add = (y: YakuResult) => results.push(y);

  const suits = new Set<"man" | "pin" | "sou" | "honor">();
  for (const k of pairKinds) suits.add(k.kind === "honor" ? "honor" : k.suit);
  const nonHonorSuits = Array.from(suits).filter((s) => s !== "honor");

  if (nonHonorSuits.length === 1) {
    if (suits.has("honor")) {
      // 七対子は常に門前
      add({ id: "honitsu", name: "混一色", isYakuman: false, han: 3, combinable: true });
    } else {
      add({ id: "chinitsu", name: "清一色", isYakuman: false, han: 6, combinable: true });
    }
  }

  if (pairKinds.every((k) => isTerminalOrHonor(k))) {
    add({ id: "honroutou", name: "混老頭", isYakuman: false, han: 2, combinable: true });
  }

  return results;
}

export function evaluateStandardYaku(groups: WinningGroup[], isMenzen: boolean, context: WinContext): YakuResult[] {
  const results: YakuResult[] = [];
  const add = (y: YakuResult) => results.push(y);

  const pair = groups.find((g) => g.type === "pair")!;
  const sets = groups.filter((g) => g.type !== "pair");
  const wait = determineWaitPattern(groups, context.winningTile);
  const allTiles: Tile[] = groups.flatMap((g) => g.tiles);
  const suits = suitsUsed(groups);

  const allSequences = sets.every((g) => g.type === "sequence");
  const allTripletsOrKans = sets.every((g) => g.type === "triplet" || g.type === "kan");
  const kanCount = sets.filter((g) => g.type === "kan").length;
  const concealedTripletOrKanCount = sets.filter((g) => (g.type === "triplet" || g.type === "kan") && !g.isOpen).length;

  // ---------------- 状況役 ----------------
  results.push(...evaluateSituationalYaku(context, isMenzen));

  // ---------------- 平和 ----------------
  const pairIsYakuhai =
    isDragonKind(pair.kind) ||
    (isWindKind(pair.kind) &&
      pair.kind.kind === "honor" &&
      (pair.kind.honor === context.seatWind || pair.kind.honor === context.roundWind));
  if (isMenzen && allSequences && wait === "ryanmen" && !pairIsYakuhai) {
    add({ id: "pinfu", name: "平和", isYakuman: false, han: 1, combinable: true });
  }

  // ---------------- 断幺九 ----------------
  if (allTiles.every((t) => !isTerminalOrHonor(t.kind))) {
    add({ id: "tanyao", name: "断幺九", isYakuman: false, han: 1, combinable: true });
  }

  // ---------------- 役牌(自風・場風・三元牌) ----------------
  const dragonNames = { white: "白", green: "發", red: "中" } as const;
  for (const g of sets) {
    if (g.type !== "triplet" && g.type !== "kan") continue;
    if (g.kind.kind !== "honor") continue;
    if (isDragonKind(g.kind) && g.kind.kind === "honor" && g.kind.honor !== "east" && g.kind.honor !== "south" && g.kind.honor !== "west" && g.kind.honor !== "north") {
      add({
        id: `yakuhai_${g.kind.honor}`,
        name: `役牌(${dragonNames[g.kind.honor as "white" | "green" | "red"]})`,
        isYakuman: false,
        han: 1,
        combinable: true,
      });
    } else if (isWindKind(g.kind)) {
      if (g.kind.honor === context.seatWind) {
        add({ id: "yakuhai_seat", name: "役牌(自風)", isYakuman: false, han: 1, combinable: true });
      }
      if (g.kind.honor === context.roundWind) {
        add({ id: "yakuhai_round", name: "役牌(場風)", isYakuman: false, han: 1, combinable: true });
      }
    }
  }

  // ---------------- 一盃口・二盃口(門前限定) ----------------
  if (isMenzen) {
    const seqCounts = new Map<string, number>();
    for (const g of sets) {
      if (g.type !== "sequence") continue;
      const key = tileKindKey(g.kind);
      seqCounts.set(key, (seqCounts.get(key) ?? 0) + 1);
    }
    const pairSetKinds = Array.from(seqCounts.values()).filter((c) => c >= 2).length;
    if (pairSetKinds === 1) {
      add({ id: "iipeiko", name: "一盃口", isYakuman: false, han: 1, combinable: true });
    } else if (pairSetKinds >= 2) {
      add({ id: "ryanpeikou", name: "二盃口", isYakuman: false, han: 3, combinable: true });
    }
  }

  // ---------------- 一気通貫(萬子のみで成立し得る) ----------------
  if (hasManSequenceStartingAt(sets, 1) && hasManSequenceStartingAt(sets, 4) && hasManSequenceStartingAt(sets, 7)) {
    add({ id: "ittsuu", name: "一気通貫", isYakuman: false, han: isMenzen ? 2 : 1, combinable: true });
  }

  // ---------------- 三色同刻(筒子・索子は1・9しかないため、1か9の刻子が3色に揃うケース) ----------------
  const tripletRanksBySuit: Partial<Record<"man" | "pin" | "sou", Set<number>>> = {};
  for (const g of sets) {
    if ((g.type === "triplet" || g.type === "kan") && g.kind.kind === "number") {
      const suit = g.kind.suit;
      if (!tripletRanksBySuit[suit]) tripletRanksBySuit[suit] = new Set();
      tripletRanksBySuit[suit]!.add(g.kind.rank);
    }
  }
  if (tripletRanksBySuit.man && tripletRanksBySuit.pin && tripletRanksBySuit.sou) {
    for (const r of tripletRanksBySuit.man) {
      if (tripletRanksBySuit.pin.has(r) && tripletRanksBySuit.sou.has(r)) {
        add({ id: "sanshoku_doukou", name: "三色同刻", isYakuman: false, han: 2, combinable: true });
        break;
      }
    }
  }

  // ---------------- 対々和 ----------------
  if (allTripletsOrKans) {
    add({ id: "toitoi", name: "対々和", isYakuman: false, han: 2, combinable: true });
  }

  // ---------------- 混老頭 ----------------
  // 混老頭(全ての牌が么九牌)は、どの面子・雀頭も必ず么九牌を含む形になるため、
  // 何もしなければ混全帯幺九・純全帯幺九の条件も同時に満たしてしまう。
  // また、全て字牌(字一色)・全て老頭牌(清老頭)の場合も混老頭の条件を包含してしまう。
  // 実際の四人麻雀と同様、混老頭とチャンタ系・字一色・清老頭は複合させない
  // (字一色・清老頭は役満のため優先、それ以外は混老頭を優先する)。
  const isHonroutou = allTiles.every((t) => isTerminalOrHonor(t.kind));
  const isTsuuiisou = allTiles.every((t) => t.kind.kind === "honor");
  const isChinroutou = allTiles.every((t) => isTerminalNumber(t.kind));
  if (isHonroutou && !isTsuuiisou && !isChinroutou) {
    add({ id: "honroutou", name: "混老頭", isYakuman: false, han: 2, combinable: true });
  }

  // ---------------- 混全帯幺九・純全帯幺九 ----------------
  if (!isHonroutou && groups.every(groupContainsTerminalOrHonor)) {
    const hasHonorTile = allTiles.some((t) => t.kind.kind === "honor");
    if (hasHonorTile) {
      add({ id: "chanta", name: "混全帯幺九", isYakuman: false, han: isMenzen ? 2 : 1, combinable: true });
    } else {
      add({ id: "junchan", name: "純全帯幺九", isYakuman: false, han: isMenzen ? 3 : 2, combinable: true });
    }
  }

  // ---------------- 混一色・清一色(萬子は合計値で百万石/加賀百万石に分岐) ----------------
  const nonHonorSuits = Array.from(suits).filter((s) => s !== "honor");
  if (nonHonorSuits.length === 1) {
    const suit = nonHonorSuits[0];
    const hasHonor = suits.has("honor");
    if (hasHonor) {
      add({ id: "honitsu", name: "混一色", isYakuman: false, han: isMenzen ? 3 : 2, combinable: true });
    } else {
      // 萬子の清一色だけは、牌の合計値によって百万石・加賀百万石(役満)に化けることがある。
      // それ以外(百万石系に該当しない萬子清一色、および筒子・索子の清一色)は、
      // 清一色の判定・加算を1箇所にまとめて行う。
      let isHyakumangoku = false;
      if (suit === "man") {
        const sum = allTiles.reduce((total, t) => total + (t.kind.kind === "number" ? t.kind.rank : 0), 0);
        if (sum === 100) {
          add({ id: "kaga_hyakumangoku", name: "加賀百万石", isYakuman: true, yakumanMultiplier: 2, combinable: false });
          isHyakumangoku = true;
        } else if (sum > 100) {
          add({ id: "hyakumangoku", name: "百万石", isYakuman: true, yakumanMultiplier: 1, combinable: false });
          isHyakumangoku = true;
        }
      }
      if (!isHyakumangoku) {
        add({ id: "chinitsu", name: "清一色", isYakuman: false, han: isMenzen ? 6 : 5, combinable: true });
      }
    }
  }

  // ---------------- 小四喜・大四喜(改定) ----------------
  const windTripletHonors = new Set(
    sets
      .filter((g) => (g.type === "triplet" || g.type === "kan") && isWindKind(g.kind))
      .map((g) => (g.kind as { kind: "honor"; honor: string }).honor)
  );
  if (windTripletHonors.size === 4) {
    add({ id: "daisuushi", name: "大四喜", isYakuman: true, yakumanMultiplier: 2, combinable: false });
  } else if (windTripletHonors.size === 3 && isWindKind(pair.kind)) {
    add({ id: "shousuushi", name: "小四喜", isYakuman: true, yakumanMultiplier: 1, combinable: false });
  }

  // ---------------- 小三元・大三元(改定) ----------------
  const dragonTripletHonors = new Set(
    sets
      .filter((g) => (g.type === "triplet" || g.type === "kan") && isDragonKind(g.kind))
      .map((g) => (g.kind as { kind: "honor"; honor: string }).honor)
  );
  if (dragonTripletHonors.size === 3) {
    if (isMenzen) {
      add({ id: "daisangen", name: "大三元", isYakuman: true, yakumanMultiplier: 1, combinable: false });
    } else {
      // 大三元(鳴き)は、白・發・中それぞれの刻子から上の役牌ループで個別に加算された
      // 役牌(白)・役牌(發)・役牌(中)と複合させない(3つの三元牌刻子がまとめて
      // 大三元1つとして評価されるべきで、内訳の役牌と二重に計上しない)。
      for (let i = results.length - 1; i >= 0; i--) {
        const id = results[i].id;
        if (id === "yakuhai_white" || id === "yakuhai_green" || id === "yakuhai_red") {
          results.splice(i, 1);
        }
      }
      add({ id: "daisangen_open", name: "大三元(鳴き)", isYakuman: false, han: 8, combinable: true });
    }
  } else if (dragonTripletHonors.size === 2 && isDragonKind(pair.kind)) {
    add({ id: "shousangen", name: "小三元", isYakuman: false, han: 2, combinable: true });
  }

  // ---------------- 字一色・清老頭 ----------------
  // (混老頭との複合禁止は上の混老頭セクション側で処理済み)
  if (isTsuuiisou) {
    add({ id: "tsuuiisou", name: "字一色", isYakuman: true, yakumanMultiplier: 1, combinable: false });
  } else if (isChinroutou) {
    add({ id: "chinroutou", name: "清老頭", isYakuman: true, yakumanMultiplier: 1, combinable: false });
  }

  // ---------------- 三槓子・四槓子(改定) ----------------
  if (kanCount === 4) {
    add({ id: "suukantsu", name: "四槓子", isYakuman: true, yakumanMultiplier: 2, combinable: false });
  } else if (kanCount === 3) {
    add({ id: "sankantsu", name: "三槓子", isYakuman: false, han: 11, combinable: true });
  }

  // ---------------- 三暗刻・四暗刻(改定) ----------------
  // 単騎待ちは役満。シャンポン待ちは「ツモり四暗刻」の場合のみ倍満で複合可。
  // シャンポン待ちをロンで完成した場合、その面子は明刻扱い(isRealAnkouがfalseを返す)となり
  // 四暗刻自体が不成立になる(=下のelse節で三暗刻や対々和として通常通り評価される)。
  const realAnkouCount = sets.filter((g) => isRealAnkou(g, context)).length;
  if (allTripletsOrKans && concealedTripletOrKanCount === 4 && realAnkouCount === 4 && wait === "tanki") {
    add({ id: "suuankou_tanki", name: "四暗刻単騎", isYakuman: true, yakumanMultiplier: 1, combinable: false });
  } else if (
    allTripletsOrKans &&
    concealedTripletOrKanCount === 4 &&
    realAnkouCount === 4 &&
    wait === "shanpon" &&
    context.isTsumo
  ) {
    add({ id: "suuankou_tsumo_shanpon", name: "四暗刻", isYakuman: false, han: 8, combinable: true });
  } else if (realAnkouCount === 3) {
    add({ id: "sanankou", name: "三暗刻", isYakuman: false, han: 2, combinable: true });
  }

  return results;
}
