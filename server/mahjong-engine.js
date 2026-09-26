"use strict";
const __engineHost = {};
// 自動生成: TypeScriptソースをコンパイルし、ブラウザ向けに束ねたものです。手編集しないでください。
(function(global){
  var modules = {};
  var cache = {};
  function resolvePath(fromId, relId) {
    if (relId[0] !== '.') return relId;
    var base = fromId.split('/'); base.pop();
    var parts = relId.split('/');
    for (var i=0;i<parts.length;i++) {
      var p = parts[i];
      if (p === '.' || p === '') continue;
      if (p === '..') base.pop(); else base.push(p);
    }
    return base.join('/');
  }
  function requireModule(id) {
    if (cache[id]) return cache[id].exports;
    var mod = { exports: {} };
    cache[id] = mod;
    if (!modules[id]) throw new Error('module not found: ' + id);
    modules[id](mod, mod.exports, function(rel) { return requireModule(resolvePath(id, rel)); });
    return mod.exports;
  }
  modules["types/game"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBusted = isBusted;
/** プレイヤーの持ち点がマイナスかどうか(トビ判定) */
function isBusted(state) {
    for (const seat of Object.keys(state.players)) {
        if (state.players[seat].score < 0) {
            return seat;
        }
    }
    return null;
}

  };
  modules["types/index"] = function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./tile"), exports);
__exportStar(require("./wall"), exports);
__exportStar(require("./meld"), exports);
__exportStar(require("./player"), exports);
__exportStar(require("./game"), exports);

  };
  modules["types/meld"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

  };
  modules["types/player"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialPlayerState = createInitialPlayerState;
/** 新規プレイヤー状態を作るヘルパー */
function createInitialPlayerState(seat, score) {
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

  };
  modules["types/tile"] = function(module, exports, require) {
"use strict";
/**
 * 牌(パイ)関連の型定義
 *
 * 使用牌(全80枚):
 *  - 萬子 1〜9 各4枚 = 36枚
 *  - 筒子 1・9    各4枚 = 8枚
 *  - 索子 1・9    各4枚 = 8枚
 *  - 字牌 7種      各4枚 = 28枚
 *  合計 80枚
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tileKindKey = tileKindKey;
exports.allTileKinds = allTileKinds;
/** 2枚の牌が「同じ種類」かどうかを判定するためのキー文字列を作る */
function tileKindKey(kind) {
    if (kind.kind === "number") {
        return `number:${kind.suit}:${kind.rank}`;
    }
    return `honor:${kind.honor}`;
}
/** すべての牌の種類(重複なし)を列挙する。牌山生成の元データに使う。 */
function allTileKinds() {
    const kinds = [];
    // 萬子 1-9
    for (let rank = 1; rank <= 9; rank++) {
        kinds.push({ kind: "number", suit: "man", rank: rank });
    }
    // 筒子 1・9
    for (const rank of [1, 9]) {
        kinds.push({ kind: "number", suit: "pin", rank });
    }
    // 索子 1・9
    for (const rank of [1, 9]) {
        kinds.push({ kind: "number", suit: "sou", rank });
    }
    // 字牌 7種
    const honors = [
        "east",
        "south",
        "west",
        "north",
        "white",
        "green",
        "red",
    ];
    for (const honor of honors) {
        kinds.push({ kind: "honor", honor });
    }
    return kinds;
}

  };
  modules["types/wall"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remainingDrawCount = remainingDrawCount;
exports.activeUraDoraIndicators = activeUraDoraIndicators;
/** 山から自摸(ツモ)できるかどうかの残り枚数チェック用 */
function remainingDrawCount(wall) {
    return wall.liveWall.length;
}
/**
 * 現在有効な裏ドラ表示牌(表をめくった枚数と同じ枚数分)。
 * リーチ和了時のドラ計算でのみ使う。
 */
function activeUraDoraIndicators(wall) {
    return wall.uraDoraIndicatorTiles.slice(0, wall.revealedDoraIndicators.length);
}

  };
  modules["wall/index"] = function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./rng"), exports);
__exportStar(require("./wallGenerator"), exports);

  };
  modules["wall/rng"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSeededRng = createSeededRng;
exports.generateRandomSeed = generateRandomSeed;
function createSeededRng(seed) {
    let state = seed >>> 0;
    return function mulberry32() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * 対局開始時に使うランダムなシード値を作る。
 * ブラウザ・Node.js どちらでも動くよう crypto を優先し、
 * 使えない環境では Math.random() にフォールバックする。
 */
function generateRandomSeed() {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj?.getRandomValues) {
        const arr = new Uint32Array(1);
        cryptoObj.getRandomValues(arr);
        return arr[0];
    }
    return Math.floor(Math.random() * 0xffffffff);
}

  };
  modules["wall/wallGenerator"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEAL_ROUNDS = void 0;
exports.createFullTileSet = createFullTileSet;
exports.shuffleTiles = shuffleTiles;
exports.buildWall = buildWall;
exports.revealNextDoraIndicator = revealNextDoraIndicator;
exports.dealInitialHands = dealInitialHands;
const tile_1 = require("../types/tile");
const rng_1 = require("./rng");
/** 何も混ぜていない、80枚(20種×4枚)の牌一式を作る */
function createFullTileSet() {
    const kinds = (0, tile_1.allTileKinds)();
    const tiles = [];
    for (const kind of kinds) {
        const key = (0, tile_1.tileKindKey)(kind);
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
function shuffleTiles(tiles, rng) {
    const result = [...tiles];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
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
function buildWall(seed) {
    if (typeof seed === "function") {
        return { wall: layoutWall(shuffleTiles(createFullTileSet(), seed)), seed: null };
    }
    const usedSeed = seed ?? (0, rng_1.generateRandomSeed)();
    return { wall: layoutWall(shuffleTiles(createFullTileSet(), (0, rng_1.createSeededRng)(usedSeed))), seed: usedSeed };
}
/** シャッフル済みの80枚を王牌・自摸山に分ける */
function layoutWall(shuffled) {
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
function revealNextDoraIndicator(wall) {
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
/**
 * 配牌の取り方。実際の卓と同じく、東家→南家の順に交互に、4枚・4枚・4枚・1枚ずつ取る
 * (4枚を3巡、最後に1枚ずつで計13枚)。
 */
exports.DEAL_ROUNDS = [4, 4, 4, 1];
/**
 * 配牌を行う。seats の順(東家→南家)に交互に、DEAL_ROUNDS の枚数ずつ自摸山の先頭から配る
 * (東家4枚→南家4枚→東家4枚→南家4枚→東家4枚→南家4枚→東家1枚→南家1枚)。
 * 配った分は自摸山から取り除いた新しい Wall を返す(元のオブジェクトは変更しない)。
 */
function dealInitialHands(wall, seats) {
    const handSize = exports.DEAL_ROUNDS.reduce((sum, n) => sum + n, 0); // 13
    const requiredTiles = handSize * seats.length;
    if (wall.liveWall.length < requiredTiles) {
        throw new Error(`配牌に必要な牌が足りません(必要:${requiredTiles}枚、残り:${wall.liveWall.length}枚)`);
    }
    const hands = {};
    for (const seat of seats)
        hands[seat] = [];
    let cursor = 0;
    for (const count of exports.DEAL_ROUNDS) {
        for (const seat of seats) {
            hands[seat].push(...wall.liveWall.slice(cursor, cursor + count));
            cursor += count;
        }
    }
    return {
        wall: {
            ...wall,
            liveWall: wall.liveWall.slice(cursor),
        },
        hands: hands,
    };
}

  };
  modules["yaku/context"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

  };
  modules["yaku/decompose"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.suitCategoryOf = suitCategoryOf;
exports.bucketize = bucketize;
exports.decomposeConcealedHand = decomposeConcealedHand;
const tile_1 = require("../types/tile");
function suitCategoryOf(kind) {
    if (kind.kind === "honor")
        return "honor";
    return kind.suit;
}
/** 牌の種類ごとにグルーピングする */
function bucketize(tiles) {
    const map = new Map();
    for (const t of tiles) {
        const key = (0, tile_1.tileKindKey)(t.kind);
        if (!map.has(key)) {
            map.set(key, { kind: t.kind, tiles: [] });
        }
        map.get(key).tiles.push(t);
    }
    return map;
}
function splitBySuit(tiles) {
    const result = {
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
function decomposeNoSequenceSuit(tiles) {
    if (tiles.length === 0)
        return [[]];
    if (tiles.length % 3 !== 0)
        return [];
    const buckets = bucketize(tiles);
    const groups = [];
    for (const bucket of buckets.values()) {
        if (bucket.tiles.length % 3 !== 0)
            return [];
        for (let i = 0; i < bucket.tiles.length; i += 3) {
            groups.push({ type: "triplet", tiles: bucket.tiles.slice(i, i + 3) });
        }
    }
    return [groups];
}
/** 萬子(1-9)の面子分解。刻子・順子の両方を試す再帰的な探索。 */
function decomposeManSuit(tiles) {
    if (tiles.length === 0)
        return [[]];
    if (tiles.length % 3 !== 0)
        return [];
    const byRank = Array.from({ length: 10 }, () => []); // index 1-9使用
    for (const t of tiles) {
        if (t.kind.kind === "number" && t.kind.suit === "man") {
            byRank[t.kind.rank].push(t);
        }
    }
    const results = [];
    function backtrack(current) {
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
            const t1 = byRank[rank].pop();
            const t2 = byRank[rank + 1].pop();
            const t3 = byRank[rank + 2].pop();
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
    const seen = new Set();
    const deduped = [];
    for (const decomp of results) {
        const sig = decomp
            .map((g) => `${g.type}:${g.tiles.map((t) => (0, tile_1.tileKindKey)(t.kind)).sort().join(",")}`)
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
function decomposeConcealedHand(concealedTiles, requiredSets) {
    const bySuit = splitBySuit(concealedTiles);
    const kindBuckets = bucketize(concealedTiles);
    const results = [];
    for (const bucket of kindBuckets.values()) {
        if (bucket.tiles.length < 2)
            continue;
        const pairTiles = bucket.tiles.slice(0, 2);
        const pairGroup = { type: "pair", tiles: pairTiles };
        const cat = suitCategoryOf(bucket.kind);
        const remaining = {
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
        if (manOptions.length === 0)
            continue;
        if (pinOptions.length === 0)
            continue;
        if (souOptions.length === 0)
            continue;
        if (honorOptions.length === 0)
            continue;
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

  };
  modules["yaku/dora"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doraFromIndicator = doraFromIndicator;
exports.allTilesOfHand = allTilesOfHand;
exports.countDoraTiles = countDoraTiles;
exports.countDoraForHand = countDoraForHand;
const tile_1 = require("../types/tile");
const wall_1 = require("../types/wall");
/**
 * ドラ表示牌から、実際のドラとなる牌の種類を求める。
 *
 * このルールは使用牌が特殊なため、循環は「実際に存在する牌だけ」で閉じる:
 *  - 萬子: 1→2→…→9→1(通常通り)
 *  - 筒子・索子: 1と9しかないため 1→9、9→1
 *  - 風牌: 東→南→西→北→東
 *  - 三元牌: 白→發→中→白
 */
function doraFromIndicator(indicator) {
    if (indicator.kind === "number") {
        if (indicator.suit === "man") {
            const next = indicator.rank === 9 ? 1 : (indicator.rank + 1);
            return { kind: "number", suit: "man", rank: next };
        }
        // 筒子・索子は1と9のみなので、その2枚で循環する
        const next = indicator.rank === 1 ? 9 : 1;
        return { kind: "number", suit: indicator.suit, rank: next };
    }
    const WIND_CYCLE = ["east", "south", "west", "north"];
    const DRAGON_CYCLE = ["white", "green", "red"];
    const windIndex = WIND_CYCLE.indexOf(indicator.honor);
    if (windIndex >= 0) {
        return { kind: "honor", honor: WIND_CYCLE[(windIndex + 1) % WIND_CYCLE.length] };
    }
    const dragonIndex = DRAGON_CYCLE.indexOf(indicator.honor);
    return { kind: "honor", honor: DRAGON_CYCLE[(dragonIndex + 1) % DRAGON_CYCLE.length] };
}
/** 和了手に含まれるすべての牌(濃縮手牌+鳴き・カンした面子)を平坦に並べる */
function allTilesOfHand(hand) {
    return [...hand.concealedTiles, ...hand.melds.flatMap((m) => m.tiles)];
}
/** 指定したドラ表示牌の一覧に対して、手牌に含まれるドラの枚数(=翻数)を数える */
function countDoraTiles(tiles, indicators) {
    if (indicators.length === 0)
        return 0;
    const doraKeys = indicators.map((ind) => (0, tile_1.tileKindKey)(doraFromIndicator(ind.kind)));
    let count = 0;
    for (const tile of tiles) {
        const key = (0, tile_1.tileKindKey)(tile.kind);
        for (const doraKey of doraKeys) {
            if (key === doraKey)
                count++;
        }
    }
    return count;
}
/**
 * 和了手のドラ翻数を計算する。
 * 裏ドラはリーチして和了した場合のみ適用される(カン裏あり)。
 */
function countDoraForHand(hand, wall, isRiichi) {
    const tiles = allTilesOfHand(hand);
    const dora = countDoraTiles(tiles, wall.revealedDoraIndicators);
    const uraDora = isRiichi ? countDoraTiles(tiles, (0, wall_1.activeUraDoraIndicators)(wall)) : 0;
    return { dora, uraDora, total: dora + uraDora };
}

  };
  modules["yaku/evaluate"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateYaku = evaluateYaku;
const decompose_1 = require("./decompose");
const specialHands_1 = require("./specialHands");
const waitPattern_1 = require("./waitPattern");
const standardYaku_1 = require("./standardYaku");
const fu_1 = require("./fu");
const tile_1 = require("../types/tile");
/**
 * 役満・ダブル役満は、他の役満・ダブル役満とは複合するが、それ以外の通常役(n翻役)とは
 * 複合しない(実際の点数計算(resolveTier)でも通常役側は無視されるため、判定結果の一覧
 * 自体もそれに合わせて絞り込む)。役満が1つも無ければ何もしない。
 */
function excludeNonYakumanIfYakumanPresent(yakuList) {
    if (!yakuList.some((y) => y.isYakuman))
        return yakuList;
    return yakuList.filter((y) => y.isYakuman);
}
/** 複数の役判定候補(手牌の解釈違い)から、最も点数が高くなるものを選ぶための比較値 */
function scoreForComparison(yakuList, fu) {
    let yakumanTotal = 0;
    let hanTotal = 0;
    for (const y of yakuList) {
        if (y.isYakuman) {
            yakumanTotal += y.yakumanMultiplier ?? 1;
        }
        else {
            hanTotal += y.han ?? 0;
        }
    }
    if (yakumanTotal > 0) {
        // 役満が成立している場合、通常役の翻数は点数(比較値)に影響させない
        return yakumanTotal * 1000000;
    }
    // 翻数が同じ場合は符の高さで実際の点数が変わるため、僅かな重みとして加味する
    return hanTotal * 100 + fu;
}
function buildKokushiYaku(isThirteenWait) {
    if (isThirteenWait) {
        return { id: "kokushi_13", name: "純正国士無双", isYakuman: true, yakumanMultiplier: 1, combinable: false };
    }
    return { id: "kokushi_other", name: "国士無双", isYakuman: false, han: 8, combinable: true };
}
/**
 * 七対子系の役一覧を組み立てる。
 *
 * 大七星・大数隣は専用の役満のため、それ以外の役(混一色・清一色・混老頭、および
 * リーチ・一発・門前清自摸和などの状況役)とは複合させない(役満は他の役満とのみ複合)。
 * 通常の七対子はこれらすべてと複合し得るため、手牌の形に基づく役・状況役を合わせて判定する。
 * 最終的な役満の絞り込みは呼び出し側(evaluateYaku)の excludeNonYakumanIfYakumanPresent で行う。
 */
function buildChiitoitsuYaku(result, context) {
    const base = result.isDaichiishin
        ? [{ id: "daichiishin", name: "大七星", isYakuman: true, yakumanMultiplier: 1, combinable: false }]
        : result.isDaisuurin
            ? [{ id: "daisuurin", name: "大数隣", isYakuman: true, yakumanMultiplier: 1, combinable: false }]
            : [{ id: "chiitoitsu", name: "七対子", isYakuman: false, han: 2, combinable: true }];
    const shapeYaku = result.isDaichiishin || result.isDaisuurin ? [] : (0, standardYaku_1.evaluateChiitoitsuShapeYaku)(result.kinds);
    // 七対子は常に門前(鳴きなしが前提の特殊形)なので isMenzen は常に true。
    const situationalYaku = (0, standardYaku_1.evaluateSituationalYaku)(context, true);
    return excludeNonYakumanIfYakumanPresent([...base, ...shapeYaku, ...situationalYaku]);
}
function buildChuurenYaku(isNineSidedWait) {
    if (isNineSidedWait) {
        return { id: "chuuren_9men", name: "純正九蓮宝燈", isYakuman: true, yakumanMultiplier: 2, combinable: false };
    }
    return { id: "chuuren", name: "九蓮宝燈", isYakuman: true, yakumanMultiplier: 1, combinable: false };
}
/**
 * 和了した手牌から成立する役を判定する。
 *
 * NOTE: フリテン判定(国士無双13面・九蓮宝燈9面待ちの「フリテンなし」条件)は
 * 捨て牌履歴を必要とするため、この関数の外部で判定し context.isFuriten に
 * 結果を渡してもらう想定。ここでは isFuriten をそのまま反映するだけ。
 */
function evaluateYaku(hand, context) {
    if (context.isTenhou) {
        // 天和: 和了牌(ツモ牌)は14枚のうち最も点数が高くなる牌とみなす。
        // 手牌に含まれる牌の種類ごとにその牌を和了牌として判定し、最良の結果を採用する
        // (四暗刻単騎・純正九蓮宝燈・純正国士無双などとの複合が可能になる)。
        const baseContext = { ...context, isTenhou: false, isChiihou: false };
        const seen = new Set();
        let best = null;
        let bestScore = -1;
        for (const t of hand.concealedTiles) {
            const key = (0, tile_1.tileKindKey)(t.kind);
            if (seen.has(key))
                continue;
            seen.add(key);
            const r = evaluateYakuCore(hand, { ...baseContext, winningTile: t });
            if (!r.isWin)
                continue;
            const score = scoreForComparison(r.yaku, r.fu);
            if (score > bestScore) {
                bestScore = score;
                best = r;
            }
        }
        if (!best)
            return { isWin: false, yaku: [], fu: 0 };
        return { isWin: true, yaku: excludeNonYakumanIfYakumanPresent([TENHOU, ...best.yaku]), fu: best.fu };
    }
    const result = evaluateYakuCore(hand, context);
    if (context.isChiihou && result.isWin) {
        return { ...result, yaku: excludeNonYakumanIfYakumanPresent([CHIIHOU, ...result.yaku]) };
    }
    return result;
}
const TENHOU = { id: "tenhou", name: "天和", isYakuman: true, yakumanMultiplier: 1, combinable: false };
const CHIIHOU = { id: "chiihou", name: "地和", isYakuman: true, yakumanMultiplier: 1, combinable: false };
function evaluateYakuCore(hand, context) {
    const isMenzen = hand.melds.every((m) => !m.isOpen);
    // ---- 特殊形(門前限定): 国士無双、七対子系 ----
    // 七対子形(同じ種類の牌がちょうど2枚ずつ×7組)は、同じ牌構成のまま
    // 標準形(4面子+雀頭)としても解釈できてしまう場合がある
    // (例: 同一順子を2回ずつ使う二盃口の形は、必ず七対子としても成立する)。
    // そのため七対子は即座に確定させず、点数の高い方を採用する候補として保持する
    // (国士無双は牌構成上、標準形との併存が起こり得ないためそのまま確定させてよい)。
    let chiitoitsuCandidate = null;
    if (hand.melds.length === 0) {
        const kokushi = (0, specialHands_1.analyzeKokushi)(hand.concealedTiles, context.winningTile);
        if (kokushi?.isKokushi) {
            const isThirteenWait = kokushi.isThirteenWait && !context.isFuriten;
            if (isThirteenWait) {
                // 純正国士無双(13面待ち)は役満のため、他の役満以外とは複合しない。
                return { isWin: true, yaku: [buildKokushiYaku(true)], fu: 0 };
            }
            // 国士無双(非13面待ち、8翻)は役満ではない通常役のため、
            // 立直・一発・門前清自摸和・海底摸月・河底撈魚などの状況役と複合する
            // (国士無双は常に門前かつ標準形との併存が起こり得ないため、そのまま確定させてよい)。
            const situationalYaku = (0, standardYaku_1.evaluateSituationalYaku)(context, true);
            return { isWin: true, yaku: [buildKokushiYaku(false), ...situationalYaku], fu: 0 };
        }
        const chiitoitsu = (0, specialHands_1.analyzeChiitoitsu)(hand.concealedTiles);
        if (chiitoitsu?.isChiitoitsu) {
            chiitoitsuCandidate = { yaku: buildChiitoitsuYaku(chiitoitsu, context), fu: fu_1.CHIITOITSU_FU };
            if (chiitoitsu.isDaichiishin) {
                // 大七星と字一色(標準形)の複合は認めず、大七星を優先する。
                // 両条件を満たし得る手牌であっても、他の解釈(標準形分解)とは比較せず
                // 大七星をそのまま確定させる。
                return { isWin: true, yaku: chiitoitsuCandidate.yaku, fu: chiitoitsuCandidate.fu };
            }
        }
    }
    // ---- 通常形(4面子+雀頭) ----
    const requiredSets = 4 - hand.melds.length;
    const decompositions = (0, decompose_1.decomposeConcealedHand)(hand.concealedTiles, requiredSets);
    if (decompositions.length === 0) {
        if (chiitoitsuCandidate) {
            return { isWin: true, yaku: chiitoitsuCandidate.yaku, fu: chiitoitsuCandidate.fu };
        }
        return { isWin: false, yaku: [], fu: 0 };
    }
    // 九蓮宝燈は解釈(面子分解)に依らず、生の牌構成だけで判定できる
    let chuurenYaku = null;
    if (isMenzen && hand.melds.length === 0) {
        const chuuren = (0, specialHands_1.analyzeChuuren)(hand.concealedTiles, context.winningTile);
        if (chuuren?.isChuuren) {
            const isNineSidedWait = chuuren.isNineSidedWait && !context.isFuriten;
            chuurenYaku = buildChuurenYaku(isNineSidedWait);
        }
    }
    let best = null;
    let bestFu = 0;
    let bestScore = -1;
    if (chiitoitsuCandidate) {
        best = chiitoitsuCandidate.yaku;
        bestFu = chiitoitsuCandidate.fu;
        bestScore = scoreForComparison(chiitoitsuCandidate.yaku, chiitoitsuCandidate.fu);
    }
    for (const decomposition of decompositions) {
        const groups = (0, waitPattern_1.toWinningGroups)(decomposition, hand.melds);
        const yakuList = (0, standardYaku_1.evaluateStandardYaku)(groups, isMenzen, context);
        if (chuurenYaku) {
            yakuList.push(chuurenYaku);
        }
        const wait = (0, waitPattern_1.determineWaitPattern)(groups, context.winningTile);
        const hasPinfu = yakuList.some((y) => y.id === "pinfu");
        const fu = (0, fu_1.calculateFu)(groups, isMenzen, context.isTsumo, wait, context, hasPinfu);
        // 役満・ダブル役満が成立していれば、他の通常役(n翻役)は判定結果からも除く。
        const finalYakuList = excludeNonYakumanIfYakumanPresent(yakuList);
        const score = scoreForComparison(finalYakuList, fu);
        if (score > bestScore) {
            bestScore = score;
            best = finalYakuList;
            bestFu = fu;
        }
    }
    return { isWin: true, yaku: best ?? [], fu: bestFu };
}

  };
  modules["yaku/fu"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHIITOITSU_FU = void 0;
exports.calculateFu = calculateFu;
const standardYaku_1 = require("./standardYaku");
/** 七対子は符計算を行わず、常に25符固定として扱う */
exports.CHIITOITSU_FU = 25;
/**
 * 通常形(4面子+雀頭)の符を計算する。
 * 平和(ツモ20符固定・ロン30符固定)の場合は hasPinfu=true を渡す。
 */
function calculateFu(groups, isMenzen, isTsumo, wait, context, hasPinfu) {
    if (hasPinfu)
        return isTsumo ? 20 : 30;
    let fu = 20; // 副底
    if (isMenzen && !isTsumo) {
        fu += 10; // 門前加符(門前ロン)
    }
    if (isTsumo) {
        fu += 2; // ツモ符(嶺上開花もツモ扱いのためここに含まれる)
    }
    if (wait === "kanchan" || wait === "penchan" || wait === "tanki") {
        fu += 2;
    }
    const pair = groups.find((g) => g.type === "pair");
    if ((0, standardYaku_1.isDragonKind)(pair.kind)) {
        fu += 2;
    }
    else if ((0, standardYaku_1.isWindKind)(pair.kind) && pair.kind.kind === "honor") {
        const isSeat = pair.kind.honor === context.seatWind;
        const isRound = pair.kind.honor === context.roundWind;
        if (isSeat && isRound) {
            fu += 4; // 連風牌(ダブ東など)
        }
        else if (isSeat || isRound) {
            fu += 2;
        }
    }
    for (const g of groups) {
        if (g.type !== "triplet" && g.type !== "kan")
            continue;
        // ロンでシャンポン完成した面子は、実際には手の中にあった刻子でも
        // 符計算上は「明刻」として扱う(標準ルール)。
        const isOpenForFu = g.isOpen || (g.type === "triplet" && !(0, standardYaku_1.isRealAnkou)(g, context));
        const isYaochu = (0, standardYaku_1.isTerminalOrHonor)(g.kind);
        if (g.type === "triplet") {
            fu += isOpenForFu ? (isYaochu ? 4 : 2) : isYaochu ? 8 : 4;
        }
        else {
            // 槓子はロンによる完成という概念がないため isOpen(鳴きによる明槓か暗槓か)のみで判定
            fu += g.isOpen ? (isYaochu ? 16 : 8) : isYaochu ? 32 : 16;
        }
    }
    return Math.ceil(fu / 10) * 10;
}

  };
  modules["yaku/furiten"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPermanentFuriten = isPermanentFuriten;
exports.isMissedRonFuriten = isMissedRonFuriten;
const tile_1 = require("../types/tile");
const tenpai_1 = require("./tenpai");
/**
 * 永続フリテン: 自分の捨て牌の中に、現在の待ち牌と同じ種類が含まれていればフリテン。
 * 聴牌していない場合はフリテンの概念自体が無意味なので false を返す。
 *
 * NOTE: 同巡内の一時的フリテン(相手の捨てた和了牌を見逃した場合、
 * 次に自分が打牌するまでの間だけロン不可になるもの)はここでは扱わない。
 * ゲーム進行側(このゲームでは1手番1相手なので、直前の相手の捨て牌に対して
 * ロンしなかった場合のフラグ)で別途管理する想定。
 */
function isPermanentFuriten(concealedTiles, melds, ownDiscards) {
    const winningKinds = (0, tenpai_1.getWinningTileKinds)(concealedTiles, melds);
    if (winningKinds.length === 0)
        return false;
    const winningKeys = new Set(winningKinds.map(tile_1.tileKindKey));
    return ownDiscards.some((t) => winningKeys.has((0, tile_1.tileKindKey)(t.kind)));
}
/**
 * ロンの見逃しによってフリテンになっているか。
 *
 * - 同巡内の一時的フリテン(isTemporaryFuriten): 自分が次に打牌するまでロン不可。
 * - リーチ後の見逃し(isRiichiMissedFuriten): その局が終わるまでロン不可。
 *
 * 2種類のフリテンを判定し忘れないよう、ロン可否を見る箇所では必ずこの関数を通す。
 */
function isMissedRonFuriten(player) {
    return player.isTemporaryFuriten || player.isRiichiMissedFuriten;
}

  };
  modules["yaku/index"] = function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./decompose"), exports);
__exportStar(require("./specialHands"), exports);
__exportStar(require("./context"), exports);
__exportStar(require("./waitPattern"), exports);
__exportStar(require("./fu"), exports);
__exportStar(require("./standardYaku"), exports);
__exportStar(require("./evaluate"), exports);
__exportStar(require("./tenpai"), exports);
__exportStar(require("./furiten"), exports);
__exportStar(require("./dora"), exports);

  };
  modules["yaku/specialHands"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeKokushi = analyzeKokushi;
exports.analyzeChiitoitsu = analyzeChiitoitsu;
exports.analyzeChuuren = analyzeChuuren;
const tile_1 = require("../types/tile");
const decompose_1 = require("./decompose");
// ---------------- 国士無双 ----------------
const KOKUSHI_KINDS = [
    { kind: "number", suit: "man", rank: 1 },
    { kind: "number", suit: "man", rank: 9 },
    { kind: "number", suit: "pin", rank: 1 },
    { kind: "number", suit: "pin", rank: 9 },
    { kind: "number", suit: "sou", rank: 1 },
    { kind: "number", suit: "sou", rank: 9 },
    { kind: "honor", honor: "east" },
    { kind: "honor", honor: "south" },
    { kind: "honor", honor: "west" },
    { kind: "honor", honor: "north" },
    { kind: "honor", honor: "white" },
    { kind: "honor", honor: "green" },
    { kind: "honor", honor: "red" },
];
const KOKUSHI_KEY_SET = new Set(KOKUSHI_KINDS.map(tile_1.tileKindKey));
/** 国士無双が成立しているか判定する。門前(鳴きなし)が前提。 */
function analyzeKokushi(concealedTiles, winningTile) {
    if (concealedTiles.length !== 14)
        return null;
    const buckets = (0, decompose_1.bucketize)(concealedTiles);
    for (const key of buckets.keys()) {
        if (!KOKUSHI_KEY_SET.has(key))
            return null;
    }
    if (buckets.size !== 13)
        return null;
    let pairCount = 0;
    for (const bucket of buckets.values()) {
        if (bucket.tiles.length === 2) {
            pairCount++;
        }
        else if (bucket.tiles.length !== 1) {
            return null;
        }
    }
    if (pairCount !== 1)
        return null;
    // 和了牌を除いた13枚が「13種すべて1枚ずつ」であれば13面待ち
    const preWin = [...concealedTiles];
    const idx = preWin.findIndex((t) => t.id === winningTile.id);
    preWin.splice(idx, 1);
    const preWinBuckets = (0, decompose_1.bucketize)(preWin);
    const isThirteenWait = preWinBuckets.size === 13 &&
        Array.from(preWinBuckets.values()).every((b) => b.tiles.length === 1);
    return { isKokushi: true, isThirteenWait };
}
function analyzeChiitoitsu(concealedTiles) {
    if (concealedTiles.length !== 14)
        return null;
    const buckets = (0, decompose_1.bucketize)(concealedTiles);
    if (buckets.size !== 7)
        return null;
    for (const b of buckets.values()) {
        if (b.tiles.length !== 2)
            return null;
    }
    const kinds = Array.from(buckets.values()).map((b) => b.kind);
    const isDaichiishin = kinds.every((k) => k.kind === "honor");
    const isDaisuurin = kinds.every((k) => k.kind === "number" && k.suit === "man" && k.rank >= 2 && k.rank <= 8);
    return { isChiitoitsu: true, isDaichiishin, isDaisuurin, kinds };
}
/**
 * 九蓮宝燈は門前・清一色(萬子)限定。
 * 判定条件: 萬子のみ14枚で、ランク1が3枚以上、ランク9が3枚以上、
 * ランク2〜8が1枚以上ずつ存在し、かつ全体が有効な(4面子+雀頭に分解できる)手であること。
 */
function analyzeChuuren(concealedTiles, winningTile) {
    if (concealedTiles.length !== 14)
        return null;
    if (!concealedTiles.every((t) => t.kind.kind === "number" && t.kind.suit === "man")) {
        return null;
    }
    const counts = new Array(10).fill(0);
    for (const t of concealedTiles) {
        if (t.kind.kind === "number" && t.kind.suit === "man") {
            counts[t.kind.rank]++;
        }
    }
    const basicShapeOk = counts[1] >= 3 && counts[9] >= 3 && [2, 3, 4, 5, 6, 7, 8].every((r) => counts[r] >= 1);
    if (!basicShapeOk)
        return null;
    // 実際に4面子+雀頭へ分解できることを確認(=正式に和了形になっているか)
    const decompositions = (0, decompose_1.decomposeConcealedHand)(concealedTiles, 4);
    if (decompositions.length === 0)
        return null;
    // 和了前の13枚が純正形(1,1,1,2,3,4,5,6,7,8,9,9,9)かどうかで9面待ちを判定
    const preWinCounts = [...counts];
    if (winningTile.kind.kind === "number" && winningTile.kind.suit === "man") {
        preWinCounts[winningTile.kind.rank]--;
    }
    const isPureThirteen = preWinCounts[1] === 3 &&
        preWinCounts[9] === 3 &&
        [2, 3, 4, 5, 6, 7, 8].every((r) => preWinCounts[r] === 1) &&
        preWinCounts.reduce((a, b) => a + b, 0) === 13;
    return { isChuuren: true, isNineSidedWait: isPureThirteen };
}

  };
  modules["yaku/standardYaku"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTerminalOrHonor = isTerminalOrHonor;
exports.isDragonKind = isDragonKind;
exports.isWindKind = isWindKind;
exports.isRealAnkou = isRealAnkou;
exports.evaluateSituationalYaku = evaluateSituationalYaku;
exports.evaluateChiitoitsuShapeYaku = evaluateChiitoitsuShapeYaku;
exports.evaluateStandardYaku = evaluateStandardYaku;
const tile_1 = require("../types/tile");
const waitPattern_1 = require("./waitPattern");
function isTerminalOrHonor(kind) {
    if (kind.kind === "honor")
        return true;
    return kind.rank === 1 || kind.rank === 9;
}
function isTerminalNumber(kind) {
    return kind.kind === "number" && (kind.rank === 1 || kind.rank === 9);
}
function isDragonKind(kind) {
    return kind.kind === "honor" && (kind.honor === "white" || kind.honor === "green" || kind.honor === "red");
}
function isWindKind(kind) {
    return (kind.kind === "honor" &&
        (kind.honor === "east" || kind.honor === "south" || kind.honor === "west" || kind.honor === "north"));
}
function suitsUsed(groups) {
    const s = new Set();
    for (const g of groups) {
        s.add(g.kind.kind === "honor" ? "honor" : g.kind.suit);
    }
    return s;
}
function groupContainsTerminalOrHonor(g) {
    return g.tiles.some((t) => isTerminalOrHonor(t.kind));
}
function hasManSequenceStartingAt(sets, startRank) {
    return sets.some((g) => g.type === "sequence" && g.kind.kind === "number" && g.kind.suit === "man" && g.kind.rank === startRank);
}
/**
 * 和了牌によってこの面子(刻子・槓子)が完成した場合、
 * ツモなら暗刻のまま、ロンなら明刻扱いとする(標準ルール)。
 * 四暗刻(このルールでの改定版)はこの区別を使わず、
 * 待ちの形(シャンポン/単騎)だけで判定する点に注意。
 */
function isRealAnkou(g, context) {
    if (g.type !== "triplet" && g.type !== "kan")
        return false;
    if (g.isOpen)
        return false;
    const containsWinningTile = g.tiles.some((t) => t.id === context.winningTile.id);
    if (!containsWinningTile)
        return true;
    return context.isTsumo;
}
/**
 * 状況役(立直・一発・門前清自摸和・海底摸月・河底撈魚・嶺上開花)。
 * 手牌の形(標準形か七対子か等)に関係なく、和了時の状況だけで決まるため、
 * 標準形(evaluateStandardYaku)・七対子のどちらの判定からも共通で呼び出す。
 */
function evaluateSituationalYaku(context, isMenzen) {
    const results = [];
    const add = (y) => results.push(y);
    if (context.isDoubleRiichi) {
        add({ id: "double_riichi", name: "ダブル立直", isYakuman: false, han: 2, combinable: true });
    }
    else if (context.isRiichi) {
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
function evaluateChiitoitsuShapeYaku(pairKinds) {
    const results = [];
    const add = (y) => results.push(y);
    const suits = new Set();
    for (const k of pairKinds)
        suits.add(k.kind === "honor" ? "honor" : k.suit);
    const nonHonorSuits = Array.from(suits).filter((s) => s !== "honor");
    if (nonHonorSuits.length === 1) {
        if (suits.has("honor")) {
            // 七対子は常に門前
            add({ id: "honitsu", name: "混一色", isYakuman: false, han: 3, combinable: true });
        }
        else {
            add({ id: "chinitsu", name: "清一色", isYakuman: false, han: 6, combinable: true });
        }
    }
    if (pairKinds.every((k) => isTerminalOrHonor(k))) {
        add({ id: "honroutou", name: "混老頭", isYakuman: false, han: 2, combinable: true });
    }
    return results;
}
function evaluateStandardYaku(groups, isMenzen, context) {
    const results = [];
    const add = (y) => results.push(y);
    const pair = groups.find((g) => g.type === "pair");
    const sets = groups.filter((g) => g.type !== "pair");
    const wait = (0, waitPattern_1.determineWaitPattern)(groups, context.winningTile);
    const allTiles = groups.flatMap((g) => g.tiles);
    const suits = suitsUsed(groups);
    const allSequences = sets.every((g) => g.type === "sequence");
    const allTripletsOrKans = sets.every((g) => g.type === "triplet" || g.type === "kan");
    const kanCount = sets.filter((g) => g.type === "kan").length;
    const concealedTripletOrKanCount = sets.filter((g) => (g.type === "triplet" || g.type === "kan") && !g.isOpen).length;
    // ---------------- 状況役 ----------------
    results.push(...evaluateSituationalYaku(context, isMenzen));
    // ---------------- 平和 ----------------
    const pairIsYakuhai = isDragonKind(pair.kind) ||
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
    const dragonNames = { white: "白", green: "發", red: "中" };
    for (const g of sets) {
        if (g.type !== "triplet" && g.type !== "kan")
            continue;
        if (g.kind.kind !== "honor")
            continue;
        if (isDragonKind(g.kind) && g.kind.kind === "honor" && g.kind.honor !== "east" && g.kind.honor !== "south" && g.kind.honor !== "west" && g.kind.honor !== "north") {
            add({
                id: `yakuhai_${g.kind.honor}`,
                name: `役牌(${dragonNames[g.kind.honor]})`,
                isYakuman: false,
                han: 1,
                combinable: true,
            });
        }
        else if (isWindKind(g.kind)) {
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
        const seqCounts = new Map();
        for (const g of sets) {
            if (g.type !== "sequence")
                continue;
            const key = (0, tile_1.tileKindKey)(g.kind);
            seqCounts.set(key, (seqCounts.get(key) ?? 0) + 1);
        }
        const pairSetKinds = Array.from(seqCounts.values()).filter((c) => c >= 2).length;
        if (pairSetKinds === 1) {
            add({ id: "iipeiko", name: "一盃口", isYakuman: false, han: 1, combinable: true });
        }
        else if (pairSetKinds >= 2) {
            add({ id: "ryanpeikou", name: "二盃口", isYakuman: false, han: 3, combinable: true });
        }
    }
    // ---------------- 一気通貫(萬子のみで成立し得る) ----------------
    if (hasManSequenceStartingAt(sets, 1) && hasManSequenceStartingAt(sets, 4) && hasManSequenceStartingAt(sets, 7)) {
        add({ id: "ittsuu", name: "一気通貫", isYakuman: false, han: isMenzen ? 2 : 1, combinable: true });
    }
    // ---------------- 三色同刻(筒子・索子は1・9しかないため、1か9の刻子が3色に揃うケース) ----------------
    const tripletRanksBySuit = {};
    for (const g of sets) {
        if ((g.type === "triplet" || g.type === "kan") && g.kind.kind === "number") {
            const suit = g.kind.suit;
            if (!tripletRanksBySuit[suit])
                tripletRanksBySuit[suit] = new Set();
            tripletRanksBySuit[suit].add(g.kind.rank);
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
        }
        else {
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
        }
        else {
            // 萬子の清一色だけは、牌の合計値によって百万石・加賀百万石(役満)に化けることがある。
            // それ以外(百万石系に該当しない萬子清一色、および筒子・索子の清一色)は、
            // 清一色の判定・加算を1箇所にまとめて行う。
            let isHyakumangoku = false;
            if (suit === "man") {
                const sum = allTiles.reduce((total, t) => total + (t.kind.kind === "number" ? t.kind.rank : 0), 0);
                if (sum === 100) {
                    add({ id: "kaga_hyakumangoku", name: "加賀百万石", isYakuman: true, yakumanMultiplier: 2, combinable: false });
                    isHyakumangoku = true;
                }
                else if (sum > 100) {
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
    const windTripletHonors = new Set(sets
        .filter((g) => (g.type === "triplet" || g.type === "kan") && isWindKind(g.kind))
        .map((g) => g.kind.honor));
    if (windTripletHonors.size === 4) {
        add({ id: "daisuushi", name: "大四喜", isYakuman: true, yakumanMultiplier: 2, combinable: false });
    }
    else if (windTripletHonors.size === 3 && isWindKind(pair.kind)) {
        add({ id: "shousuushi", name: "小四喜", isYakuman: true, yakumanMultiplier: 1, combinable: false });
    }
    // ---------------- 小三元・大三元(改定) ----------------
    const dragonTripletHonors = new Set(sets
        .filter((g) => (g.type === "triplet" || g.type === "kan") && isDragonKind(g.kind))
        .map((g) => g.kind.honor));
    if (dragonTripletHonors.size === 3) {
        if (isMenzen) {
            add({ id: "daisangen", name: "大三元", isYakuman: true, yakumanMultiplier: 1, combinable: false });
        }
        else {
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
    }
    else if (dragonTripletHonors.size === 2 && isDragonKind(pair.kind)) {
        add({ id: "shousangen", name: "小三元", isYakuman: false, han: 2, combinable: true });
    }
    // ---------------- 字一色・清老頭 ----------------
    // (混老頭との複合禁止は上の混老頭セクション側で処理済み)
    if (isTsuuiisou) {
        add({ id: "tsuuiisou", name: "字一色", isYakuman: true, yakumanMultiplier: 1, combinable: false });
    }
    else if (isChinroutou) {
        add({ id: "chinroutou", name: "清老頭", isYakuman: true, yakumanMultiplier: 1, combinable: false });
    }
    // ---------------- 三槓子・四槓子(改定) ----------------
    if (kanCount === 4) {
        add({ id: "suukantsu", name: "四槓子", isYakuman: true, yakumanMultiplier: 2, combinable: false });
    }
    else if (kanCount === 3) {
        add({ id: "sankantsu", name: "三槓子", isYakuman: false, han: 11, combinable: true });
    }
    // ---------------- 三暗刻・四暗刻(改定) ----------------
    // 単騎待ちは役満。シャンポン待ちは「ツモり四暗刻」の場合のみ倍満で複合可。
    // シャンポン待ちをロンで完成した場合、その面子は明刻扱い(isRealAnkouがfalseを返す)となり
    // 四暗刻自体が不成立になる(=下のelse節で三暗刻や対々和として通常通り評価される)。
    const realAnkouCount = sets.filter((g) => isRealAnkou(g, context)).length;
    if (allTripletsOrKans && concealedTripletOrKanCount === 4 && realAnkouCount === 4 && wait === "tanki") {
        add({ id: "suuankou_tanki", name: "四暗刻単騎", isYakuman: true, yakumanMultiplier: 1, combinable: false });
    }
    else if (allTripletsOrKans &&
        concealedTripletOrKanCount === 4 &&
        realAnkouCount === 4 &&
        wait === "shanpon" &&
        context.isTsumo) {
        add({ id: "suuankou_tsumo_shanpon", name: "四暗刻", isYakuman: false, han: 8, combinable: true });
    }
    else if (realAnkouCount === 3) {
        add({ id: "sanankou", name: "三暗刻", isYakuman: false, han: 2, combinable: true });
    }
    return results;
}

  };
  modules["yaku/tenpai"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWinningTileKinds = getWinningTileKinds;
exports.isTenpai = isTenpai;
exports.sameWinningKinds = sameWinningKinds;
const tile_1 = require("../types/tile");
const decompose_1 = require("./decompose");
const specialHands_1 = require("./specialHands");
let dummyIdCounter = 0;
function makeDummyTile(kind) {
    dummyIdCounter++;
    return { id: `dummy#${dummyIdCounter}`, kind, isRedDora: false };
}
function countKindInTiles(tiles, kind) {
    const key = (0, tile_1.tileKindKey)(kind);
    return tiles.filter((t) => (0, tile_1.tileKindKey)(t.kind) === key).length;
}
function countKindInMelds(melds, kind) {
    const key = (0, tile_1.tileKindKey)(kind);
    let count = 0;
    for (const m of melds) {
        count += m.tiles.filter((t) => (0, tile_1.tileKindKey)(t.kind) === key).length;
    }
    return count;
}
/** 与えられた牌(濃縮手牌+鳴き)が、その牌を加えることで和了形になるかどうか */
function isCompleteHand(hypotheticalConcealed, melds, winningTile) {
    if (melds.length === 0) {
        const kokushi = (0, specialHands_1.analyzeKokushi)(hypotheticalConcealed, winningTile);
        if (kokushi?.isKokushi)
            return true;
        const chiitoitsu = (0, specialHands_1.analyzeChiitoitsu)(hypotheticalConcealed);
        if (chiitoitsu?.isChiitoitsu)
            return true;
    }
    const requiredSets = 4 - melds.length;
    return (0, decompose_1.decomposeConcealedHand)(hypotheticalConcealed, requiredSets).length > 0;
}
/**
 * 聴牌時に和了牌となり得る牌の種類を、全20種類を総当たりして求める。
 * このルールは牌の種類が20種類しかないため、力任せに試しても十分高速。
 *
 * NOTE: 「すでに場に4枚見えている牌は引けない」という可視牌の考慮は、
 * 手牌・鳴きの中にある分しかここでは見ていない(捨て牌や相手の手牌までは
 * 参照しない、待ちの理論上の広さを求めるための判定)。
 */
function getWinningTileKinds(concealedTiles, melds) {
    const winners = [];
    for (const kind of (0, tile_1.allTileKinds)()) {
        const usedCount = countKindInTiles(concealedTiles, kind) + countKindInMelds(melds, kind);
        if (usedCount >= 4)
            continue;
        const dummy = makeDummyTile(kind);
        const hypothetical = [...concealedTiles, dummy];
        if (isCompleteHand(hypothetical, melds, dummy)) {
            winners.push(kind);
        }
    }
    return winners;
}
/** 聴牌しているか(和了牌が1種類以上あるか) */
function isTenpai(concealedTiles, melds) {
    return getWinningTileKinds(concealedTiles, melds).length > 0;
}
/** 2つの和了牌集合が(種類として)完全に同じかどうか。リーチ後の暗槓可否判定に使う。 */
function sameWinningKinds(a, b) {
    if (a.length !== b.length)
        return false;
    const aKeys = new Set(a.map(tile_1.tileKindKey));
    for (const k of b) {
        if (!aKeys.has((0, tile_1.tileKindKey)(k)))
            return false;
    }
    return true;
}

  };
  modules["yaku/waitPattern"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toWinningGroups = toWinningGroups;
exports.determineWaitPattern = determineWaitPattern;
function representativeKind(type, tiles) {
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
function meldToWinningGroup(meld) {
    const type = meld.type === "kan_open" || meld.type === "kan_closed"
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
function tileGroupToWinningGroup(group) {
    return {
        type: group.type,
        isOpen: false,
        tiles: group.tiles,
        kind: representativeKind(group.type, group.tiles),
    };
}
/** 門前部分の分解結果と既存の鳴き・カンを合わせて、和了時の面子構成をひとつにまとめる */
function toWinningGroups(decomposition, melds) {
    return [...melds.map(meldToWinningGroup), ...decomposition.map(tileGroupToWinningGroup)];
}
/**
 * 和了牌がどの面子・雀頭に収まって、どんな待ちの形だったかを判定する。
 * groups は toWinningGroups() で作った和了時点の全面子(鳴き含む)。
 */
function determineWaitPattern(groups, winningTile) {
    const group = groups.find((g) => g.tiles.some((t) => t.id === winningTile.id));
    if (!group) {
        throw new Error("和了牌がどの面子にも含まれていません(内部エラー)");
    }
    if (group.type === "pair")
        return "tanki";
    if (group.type === "triplet" || group.type === "kan")
        return "shanpon";
    if (winningTile.kind.kind !== "number") {
        throw new Error("順子の和了牌が数牌ではありません(内部エラー)");
    }
    const ranks = group.tiles
        .map((t) => (t.kind.kind === "number" ? t.kind.rank : -1))
        .sort((a, b) => a - b);
    const winRank = winningTile.kind.rank;
    const position = ranks.indexOf(winRank);
    if (position === 1)
        return "kanchan";
    if (position === 0 && ranks[0] === 7)
        return "penchan";
    if (position === 2 && ranks[0] === 1)
        return "penchan";
    return "ryanmen";
}

  };
  modules["scoring/index"] = function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./tier"), exports);
__exportStar(require("./score"), exports);

  };
  modules["scoring/score"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateScore = calculateScore;
const evaluate_1 = require("../yaku/evaluate");
const tier_1 = require("./tier");
/** 子(非親)の総取得点(ロン基準)を求める */
function childTotalPoints(tier) {
    if (tier.kind === "yakuman") {
        return tier_1.YAKUMAN_CHILD_POINTS * tier.multiplier;
    }
    if (tier.kind === "fixed") {
        return tier_1.FIXED_CHILD_POINTS[tier.tier];
    }
    // 基本点 = 符 × 2^(2+翻)、子のロンは基本点の4倍
    const kihonten = tier.fu * Math.pow(2, 2 + tier.han);
    return kihonten * 4;
}
/**
 * 和了点を計算する。
 *
 * @param isDealer 和了者が親(東家)かどうか
 * @param doraHan 表ドラ・裏ドラの合計翻数(役満・単独扱いの固定帯が確定した場合は無視される)
 */
function calculateScore(hand, context, isDealer, doraHan) {
    const evaluation = (0, evaluate_1.evaluateYaku)(hand, context);
    if (!evaluation.isWin || evaluation.yaku.length === 0) {
        return { isWin: false, tier: null, points: 0, yaku: [], fu: 0 };
    }
    const tier = (0, tier_1.resolveTier)(evaluation.yaku, evaluation.fu, doraHan);
    let total = childTotalPoints(tier);
    if (isDealer) {
        total *= 1.5;
    }
    if (context.isTsumo) {
        // ツモ和了時は和了点(ロン基準の総額)を4分の3にしてから端数処理する独自ルール
        total *= 3 / 4;
    }
    total = Math.ceil(total / 1000) * 1000;
    // 翻数で点数帯が決まったケース(=役満が成立していない)のみ、合計翻数を表示用に持たせる
    const decidedByHan = !evaluation.yaku.some((y) => y.isYakuman);
    const totalHan = decidedByHan ? (0, tier_1.totalHanOf)(evaluation.yaku, doraHan) : undefined;
    return { isWin: true, tier, points: total, yaku: evaluation.yaku, fu: evaluation.fu, totalHan };
}

  };
  modules["scoring/tier"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YAKUMAN_CHILD_POINTS = exports.FIXED_CHILD_POINTS = void 0;
exports.totalHanOf = totalHanOf;
exports.resolveTier = resolveTier;
/** 子の点数(ロン時の総取得点)。親はこれの1.5倍。 */
exports.FIXED_CHILD_POINTS = {
    mangan: 8000,
    haneman: 12000,
    baiman: 16000,
    sanbaiman: 24000,
};
exports.YAKUMAN_CHILD_POINTS = 32000;
/**
 * 役判定結果(YakuResult[])と符、ドラ翻数から、最終的な点数帯を決定する。
 *
 * 優先順位:
 * 1. 役満(isYakuman)が1つでもあれば、役満同士の翻数(倍率)を合算する
 *    (数え役満を除く役満同士の複合ありというルールに対応)。この時点で通常役
 *    (n翻役)は evaluateYaku 側で既に判定結果から除かれているため、ここでは
 *    役満同士の合算だけを考えればよい。
 * 2. それ以外は、通常役の翻数 + ドラ翻数を合計し、その合計翻数から帯を決定する
 *    (13翻以上は数え役満、切り上げ満貫の判定も含む)。三槓子(11翻)・大三元(鳴き)
 *    (8翻)・四暗刻シャンポン(8翻)・国士無双非13面(8翻)のような、実際の麻雀では
 *    符に依存しない固定帯として扱われる役も、単なる高翻数の通常役として
 *    ここで合算されることで、結果的に同じ点数帯(倍満・三倍満)に落ち着く。
 */
/** 通常役・ドラを合算した翻数(役満が確定している場合はそもそも使わない)。 */
function totalHanOf(yakuList, doraHan) {
    let hanTotal = doraHan;
    for (const y of yakuList) {
        hanTotal += y.han ?? 0;
    }
    return hanTotal;
}
function resolveTier(yakuList, fu, doraHan) {
    const yakumanEntries = yakuList.filter((y) => y.isYakuman);
    if (yakumanEntries.length > 0) {
        const multiplier = yakumanEntries.reduce((sum, y) => sum + (y.yakumanMultiplier ?? 1), 0);
        return { kind: "yakuman", multiplier };
    }
    const hanTotal = totalHanOf(yakuList, doraHan);
    if (hanTotal >= 13)
        return { kind: "yakuman", multiplier: 1 }; // 数え役満
    if (hanTotal >= 11)
        return { kind: "fixed", tier: "sanbaiman" };
    if (hanTotal >= 8)
        return { kind: "fixed", tier: "baiman" };
    if (hanTotal >= 6)
        return { kind: "fixed", tier: "haneman" };
    if (hanTotal === 5)
        return { kind: "fixed", tier: "mangan" };
    // 切り上げ満貫
    if ((hanTotal === 4 && fu === 30) || (hanTotal === 3 && fu === 60)) {
        return { kind: "fixed", tier: "mangan" };
    }
    const kihonten = fu * Math.pow(2, 2 + hanTotal);
    if (kihonten >= 2000) {
        return { kind: "fixed", tier: "mangan" };
    }
    return { kind: "points", han: hanTotal, fu };
}

  };
  modules["game/actions"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.otherSeat = otherSeat;
exports.seatWindOf = seatWindOf;
exports.buildWinContext = buildWinContext;
exports.drawTile = drawTile;
exports.discardTile = discardTile;
exports.passDiscard = passDiscard;
exports.markMissedRon = markMissedRon;
exports.callPon = callPon;
exports.performKakan = performKakan;
exports.performAnkan = performAnkan;
exports.performMinkan = performMinkan;
exports.declareRon = declareRon;
exports.declareTsumo = declareTsumo;
exports.resolveExhaustiveDraw = resolveExhaustiveDraw;
const tile_1 = require("../types/tile");
const tenpai_1 = require("../yaku/tenpai");
const furiten_1 = require("../yaku/furiten");
const dora_1 = require("../yaku/dora");
const score_1 = require("../scoring/score");
const tier_1 = require("../scoring/tier");
const wallGenerator_1 = require("../wall/wallGenerator");
function otherSeat(seat) {
    return seat === "east" ? "south" : "east";
}
/**
 * 親であるプレイヤーが東家、子であるプレイヤーが南家となる(2人麻雀の自風ルール)。
 * Seat型自体("east"/"south")は単なる固定のプレイヤー識別子であり、
 * 実際の自風(東家/南家)は毎局の親交代によって変わるため、
 * 表示・役判定など「自風」を扱う箇所は必ずこの関数を経由すること。
 */
function seatWindOf(state, seat) {
    return seat === state.dealer ? "east" : "south";
}
function clearAllIppatsu(players) {
    const east = { ...players.east, hasIppatsuChance: false };
    const south = { ...players.south, hasIppatsuChance: false };
    return { east, south };
}
function buildWinContext(state, seat, winningTile, isTsumo, extra = {}) {
    const player = state.players[seat];
    // 天和・地和: その局でまだ誰も鳴き・カン(暗槓含む)をしておらず、和了者自身が
    // 一度も打牌していない状態(=その局の最初のツモ)でのツモ和了。局は親の自摸から
    // 始まる(配牌は13枚ずつ)ため、親の最初のツモ=天和、子の最初のツモ=地和となる。
    // カンをすれば面子が残るため、嶺上牌でのツモもここで除外される。
    const isFirstUninterruptedDraw = isTsumo &&
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
function drawTile(state) {
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
function discardTile(state, tile, declareRiichi) {
    const seat = state.currentTurn;
    const player = state.players[seat];
    // リーチ後は手出し不可。ツモ切り(ツモった牌をそのまま打牌)のみ許される。
    if (player.isRiichi && (!player.drawnTile || player.drawnTile.id !== tile.id)) {
        throw new Error("リーチ後は手出しできません(ツモった牌のみ打牌可能です)");
    }
    // 喰い替え禁止: ポンした直後(実際に打牌するまで)は、そのポンで使った牌と
    // 同じ種類の牌を打牌できない(例: 3萬をポン→3萬を打牌、は不可)。
    if (player.forbiddenDiscardKind && (0, tile_1.tileKindKey)(tile.kind) === (0, tile_1.tileKindKey)(player.forbiddenDiscardKind)) {
        throw new Error("ポンした牌と同じ牌は打牌できません(喰い替え)");
    }
    const handWithDraw = player.drawnTile ? [...player.hand, player.drawnTile] : player.hand;
    const remainingHand = handWithDraw.filter((t) => t.id !== tile.id);
    const isRiichiDeclaration = declareRiichi && !player.isRiichi;
    const isFirstDiscardEver = player.discards.length === 0;
    const seq = state.players.east.discards.length + state.players.south.discards.length;
    const discardEntry = { tile, isRiichiDeclaration, isCalled: false, seq };
    const updatedPlayer = {
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
function commitPendingRiichiStick(state) {
    const discard = state.lastDiscard;
    if (!discard || !discard.isRiichiDeclaration)
        return state;
    const seat = discard.from;
    const player = state.players[seat];
    return {
        ...state,
        players: { ...state.players, [seat]: { ...player, score: player.score - 1000 } },
        riichiSticks: state.riichiSticks + 1,
    };
}
/** 相手の捨て牌に対してロン・ポン・カンいずれも行わなかった場合、手番を進める */
function passDiscard(state) {
    const discardedSeat = state.lastDiscard?.from;
    if (!discardedSeat)
        return state;
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
function markMissedRon(state, seat) {
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
function callPon(state, callingSeat, tilesUsed) {
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
    const discard = state.lastDiscard;
    const fromSeat = discard.from;
    const player = state.players[callingSeat];
    const meld = {
        type: "triplet",
        tiles: [...tilesUsed, discard.tile],
        calledTile: discard.tile,
        calledFrom: "opponent",
        isOpen: true,
    };
    const usedIds = new Set(tilesUsed.map((t) => t.id));
    const updatedCaller = {
        ...player,
        hand: player.hand.filter((t) => !usedIds.has(t.id)),
        melds: [...player.melds, meld],
        hasIppatsuChance: false,
        // 喰い替え禁止: このポンで使った牌と同じ種類は、実際に打牌するまで打てない。
        forbiddenDiscardKind: discard.tile.kind,
    };
    const fromPlayer = state.players[fromSeat];
    const updatedFromDiscards = fromPlayer.discards.map((d, idx) => idx === fromPlayer.discards.length - 1 ? { ...d, isCalled: true } : d);
    const updatedFromPlayer = {
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
function drawRinshanAndRevealDora(state) {
    const wallAfterReveal = (0, wallGenerator_1.revealNextDoraIndicator)(state.wall);
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
function countKanMelds(melds) {
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
function finishKan(state, seat, updatedPlayer) {
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
    const finalPlayer = { ...updatedPlayer, drawnTile: rinshanTile, hasIppatsuChance: false };
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
function performKakan(state, kind) {
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
    const key = (0, tile_1.tileKindKey)(kind);
    const addedTile = handWithDraw.find((t) => (0, tile_1.tileKindKey)(t.kind) === key);
    if (!addedTile) {
        throw new Error("加槓対象の牌が手牌にありません(内部エラー)");
    }
    const remaining = handWithDraw.filter((t) => t.id !== addedTile.id);
    const melds = player.melds.map((m) => m.type === "triplet" && m.isOpen && (0, tile_1.tileKindKey)(m.tiles[0].kind) === key
        ? { ...m, type: "kan_open", tiles: [...m.tiles, addedTile], viaKakan: true }
        : m);
    const updatedPlayer = { ...player, hand: remaining, melds };
    return finishKan(state, seat, updatedPlayer);
}
/** 暗槓(自分のツモ番、手牌に4枚揃っている牌をカンする) */
function performAnkan(state, kind) {
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
    const key = (0, tile_1.tileKindKey)(kind);
    const kanTiles = [];
    const remaining = [];
    for (const t of handWithDraw) {
        if ((0, tile_1.tileKindKey)(t.kind) === key && kanTiles.length < 4) {
            kanTiles.push(t);
        }
        else {
            remaining.push(t);
        }
    }
    const meld = { type: "kan_closed", tiles: kanTiles, isOpen: false };
    const updatedPlayer = { ...player, hand: remaining, melds: [...player.melds, meld] };
    return finishKan(state, seat, updatedPlayer);
}
/** 大明槓(相手の捨て牌をカンする) */
function performMinkan(state, callingSeat, tilesUsed) {
    // 4回目のカンが成立した後は、その局ではもうカンできない
    // (4回目のカンの打牌自体は fourKanAbortivePending 側で処理するため、ここに到達するのは
    // それ以前の通常のカン、または保険的なガード)。
    if (state.kanCount >= 4) {
        throw new Error("この局ではもうカンできません(4回目のカンが成立済みです)");
    }
    // ロンされず大明槓で決着したので、リーチ宣言牌であればここでリーチ棒を供託する。
    state = commitPendingRiichiStick(state);
    const discard = state.lastDiscard;
    const fromSeat = discard.from;
    const player = state.players[callingSeat];
    const meld = {
        type: "kan_open",
        tiles: [...tilesUsed, discard.tile],
        calledTile: discard.tile,
        calledFrom: "opponent",
        isOpen: true,
    };
    const usedIds = new Set(tilesUsed.map((t) => t.id));
    const updatedCaller = {
        ...player,
        hand: player.hand.filter((t) => !usedIds.has(t.id)),
        melds: [...player.melds, meld],
    };
    const fromPlayer = state.players[fromSeat];
    const updatedFromDiscards = fromPlayer.discards.map((d, idx) => idx === fromPlayer.discards.length - 1 ? { ...d, isCalled: true } : d);
    const stateWithFromPlayerUpdated = {
        ...state,
        players: { ...state.players, [fromSeat]: { ...fromPlayer, discards: updatedFromDiscards } },
        currentTurn: callingSeat,
    };
    return finishKan(stateWithFromPlayerUpdated, callingSeat, updatedCaller);
}
function declareRon(state, winner, wonTile) {
    const loser = state.lastDiscard.from;
    const player = state.players[winner];
    const context = buildWinContext(state, winner, wonTile, false, {
        isHoutei: state.wall.liveWall.length === 0,
        isFuriten: false,
    });
    const hand = { concealedTiles: [...player.hand, wonTile], melds: player.melds };
    const isDealer = winner === state.dealer;
    const dora = (0, dora_1.countDoraForHand)(hand, state.wall, player.isRiichi);
    const scoreResult = (0, score_1.calculateScore)(hand, context, isDealer, dora.total);
    const riichiBonus = state.riichiSticks * 1000;
    const totalGain = scoreResult.points + riichiBonus;
    const players = {
        ...state.players,
        [winner]: { ...state.players[winner], score: state.players[winner].score + totalGain },
        [loser]: { ...state.players[loser], score: state.players[loser].score - scoreResult.points },
    };
    const newState = {
        ...state,
        players,
        riichiSticks: 0,
        phase: "round_end",
        roundEndReason: { type: "ron", winner, loser },
    };
    return { state: newState, scoreResult, dora };
}
function declareTsumo(state, winner) {
    const player = state.players[winner];
    const winningTile = player.drawnTile;
    const opponent = otherSeat(winner);
    // ツモはフリテンでも和了できるが、国士無双13面待ち・九蓮宝燈9面待ちの
    // 「フリテンなし」で純正扱いとする条件のために、実際のフリテン状態を判定して渡す
    // (渡さないと常に false 扱いになり、フリテンでも純正のまま判定されてしまう)。
    const isFuriten = (0, furiten_1.isMissedRonFuriten)(player) ||
        (0, furiten_1.isPermanentFuriten)(player.hand, player.melds, player.discards.map((d) => d.tile));
    const context = buildWinContext(state, winner, winningTile, true, {
        // 嶺上牌でのツモは海底摸月にならない(標準ルール)
        isHaitei: state.wall.liveWall.length === 0 && state.phase !== "kan_replacement",
        isFuriten,
    });
    const hand = { concealedTiles: [...player.hand, winningTile], melds: player.melds };
    const isDealer = winner === state.dealer;
    const dora = (0, dora_1.countDoraForHand)(hand, state.wall, player.isRiichi);
    const scoreResult = (0, score_1.calculateScore)(hand, context, isDealer, dora.total);
    const riichiBonus = state.riichiSticks * 1000;
    const totalGain = scoreResult.points + riichiBonus;
    const players = {
        ...state.players,
        [winner]: { ...state.players[winner], score: state.players[winner].score + totalGain },
        [opponent]: {
            ...state.players[opponent],
            score: state.players[opponent].score - scoreResult.points,
        },
    };
    const newState = {
        ...state,
        players,
        riichiSticks: 0,
        phase: "round_end",
        roundEndReason: { type: "tsumo", winner },
    };
    return { state: newState, scoreResult, dora };
}
// ---------------- 流局 ----------------
function isNagashiYakumanDiscards(discards) {
    if (discards.length === 0)
        return false;
    return discards.every((d) => {
        if (d.isCalled)
            return false;
        const k = d.tile.kind;
        return k.kind === "number" && k.suit === "man" && k.rank >= 2 && k.rank <= 8;
    });
}
/** 流局処理(牌山が尽きた場合)。ノーテン罰符と流し役満を反映する。 */
function resolveExhaustiveDraw(state) {
    const seats = ["east", "south"];
    const tenpaiSeats = seats.filter((s) => {
        const p = state.players[s];
        const handWithDraw = p.drawnTile ? [...p.hand, p.drawnTile] : p.hand;
        return (0, tenpai_1.isTenpai)(handWithDraw, p.melds);
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
        const points = isDealer ? tier_1.YAKUMAN_CHILD_POINTS * 1.5 : tier_1.YAKUMAN_CHILD_POINTS;
        players = {
            ...players,
            [s]: { ...players[s], score: players[s].score + points },
            [opponent]: { ...players[opponent], score: players[opponent].score - points },
        };
    }
    const newState = {
        ...state,
        players,
        phase: "round_end",
        roundEndReason: { type: "exhaustive_draw" },
    };
    return { state: newState, tenpaiSeats, nagashiYakumanSeats };
}

  };
  modules["game/index"] = function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./riichiAnkan"), exports);
__exportStar(require("./legalActions"), exports);
__exportStar(require("./actions"), exports);
__exportStar(require("./roundTransition"), exports);

  };
  modules["game/legalActions"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canDeclareTsumo = canDeclareTsumo;
exports.canDeclareRon = canDeclareRon;
exports.canDeclarePon = canDeclarePon;
exports.canDeclareMinkan = canDeclareMinkan;
exports.getDrawActionOptions = getDrawActionOptions;
const tile_1 = require("../types/tile");
const decompose_1 = require("../yaku/decompose");
const tenpai_1 = require("../yaku/tenpai");
const furiten_1 = require("../yaku/furiten");
const evaluate_1 = require("../yaku/evaluate");
const riichiAnkan_1 = require("./riichiAnkan");
/**
 * ツモ和了できるか(役の有無まで確認する)。
 *
 * ポンの直後は牌を引いていない(=打牌が必要なだけでツモってはいない)ため
 * winningTile が存在しない(暗槓・大明槓・加槓は他のカンと同様、直後に嶺上牌を
 * 1枚ツモるので winningTile は存在する)。そのような自摸のない局面でツモ和了は
 * 成立しえないので、ここで先に弾いておく(弾かないと、和了牌が存在しない前提の
 * 待ち判定が壊れてクラッシュする)。
 */
function canDeclareTsumo(concealedWithDraw, melds, context) {
    if (!context.winningTile)
        return false;
    const hand = { concealedTiles: concealedWithDraw, melds };
    const result = (0, evaluate_1.evaluateYaku)(hand, context);
    return result.isWin && result.yaku.length > 0;
}
/** ロン和了できるか(役の有無・フリテンまで確認する) */
function canDeclareRon(concealedBeforeRon, melds, ownDiscards, 
/** 見逃しによるフリテン中か(同巡内フリテン・リーチ後の局中フリテンのいずれか)。
 *  呼び出し側は isMissedRonFuriten(player) の結果をそのまま渡すこと。 */
ownMissedRonFuriten, discardedTile, context) {
    if (ownMissedRonFuriten)
        return false;
    if ((0, furiten_1.isPermanentFuriten)(concealedBeforeRon, melds, ownDiscards))
        return false;
    const hand = {
        concealedTiles: [...concealedBeforeRon, discardedTile],
        melds,
    };
    const result = (0, evaluate_1.evaluateYaku)(hand, context);
    return result.isWin && result.yaku.length > 0;
}
/**
 * ポンできるか。
 *
 * リーチ後はポンで手牌が変化する(=待ちが変わりうる)ことを認めないため、
 * リーチ済みなら常に不可とする。また、河底(自摸山が尽きた後の最後の捨て牌)に
 * 対してはポンできない(鳴くと局が終わらなくなってしまうため)。
 */
function canDeclarePon(concealedTiles, discardedTile, isRiichi, liveWallRemaining, 
/**
 * 4回目のカン(四槓子の場合を除く)の嶺上牌を打牌した、その1回だけ。
 * この打牌はロン以外では受けられない(ポン・カンいずれも不可)。
 */
isFourKanAbortivePending = false) {
    if (isRiichi)
        return false;
    if (liveWallRemaining === 0)
        return false; // 河底
    if (isFourKanAbortivePending)
        return false;
    const key = (0, tile_1.tileKindKey)(discardedTile.kind);
    const count = concealedTiles.filter((t) => (0, tile_1.tileKindKey)(t.kind) === key).length;
    return count >= 2;
}
/**
 * 大明槓(相手の捨て牌でのカン)できるか。
 *
 * リーチ後に取りうる行動はツモ切り・暗槓(待ちを変えない場合のみ)・ツモ和了・ロン和了に限られるため、
 * リーチ済みなら常に不可とする。また、河底に対してはポンと同様に大明槓もできない。
 */
function canDeclareMinkan(concealedTiles, discardedTile, isRiichi, liveWallRemaining, 
/** 4回目のカンが成立した後は、その局ではもうカンできない。 */
kanCount = 0) {
    if (isRiichi)
        return false;
    if (liveWallRemaining === 0)
        return false; // 河底
    if (kanCount >= 4)
        return false;
    const key = (0, tile_1.tileKindKey)(discardedTile.kind);
    const count = concealedTiles.filter((t) => (0, tile_1.tileKindKey)(t.kind) === key).length;
    return count === 3;
}
/**
 * 自摸直後に取りうる行動をまとめて計算する。
 *
 * @param concealedBeforeDraw リーチ後の暗槓可否判定に使う、ツモ前の13枚(リーチしていなければ未使用)
 */
function getDrawActionOptions(concealedWithDraw, melds, playerScore, liveWallRemaining, isRiichi, concealedBeforeDraw, context, 
/**
 * ポンした直後、まだ実際に打牌していない状態かどうか。
 * この状態では(喰い替え禁止と同様の趣旨で)暗槓・加槓のいずれもできない
 * 「ポンの後は、打牌するまでカンを禁止」というルールのため。
 */
hasPendingPonDiscard = false, 
/** これまでに成立したカンの総数(二人合計)。4回に到達したらもうカンできない。 */
kanCount = 0) {
    const canTsumo = canDeclareTsumo(concealedWithDraw, melds, context);
    const riichiDiscardOptions = getRiichiDiscardOptions(concealedWithDraw, melds, playerScore, liveWallRemaining, isRiichi);
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
function getRiichiDiscardOptions(concealedWithDraw, melds, playerScore, liveWallRemaining, isRiichi) {
    if (isRiichi)
        return []; // 既にリーチ済みなら再度のリーチ宣言はない
    if (melds.some((m) => m.isOpen))
        return []; // 副露があれば門前でないためリーチ不可
    if (playerScore < 1000)
        return [];
    if (liveWallRemaining < 1)
        return []; // 山残り1枚まではリーチ可能(0枚、つまり海底ならリーチ不可)
    // 同じ種類の牌はどれを切っても結果(残りの手牌)は同じなので、聴牌判定は種類ごとに
    // 1回だけ行い、リーチできると分かったらその種類の牌をすべて選択肢に入れる
    // (例: 3萬を3枚持っていて3萬を切ればリーチできる場合、3枚のどれでも選べるようにする)。
    const options = [];
    const checkedKinds = new Set();
    for (const candidate of concealedWithDraw) {
        const key = (0, tile_1.tileKindKey)(candidate.kind);
        if (checkedKinds.has(key))
            continue;
        checkedKinds.add(key);
        const remaining = concealedWithDraw.filter((t) => t.id !== candidate.id);
        if ((0, tenpai_1.isTenpai)(remaining, melds)) {
            options.push(...concealedWithDraw.filter((t) => (0, tile_1.tileKindKey)(t.kind) === key));
        }
    }
    return options;
}
function getAnkanKinds(concealedWithDraw, melds, isRiichi, concealedBeforeDraw) {
    const buckets = (0, decompose_1.bucketize)(concealedWithDraw);
    const candidates = [];
    for (const bucket of buckets.values()) {
        if (bucket.tiles.length === 4)
            candidates.push(bucket.kind);
    }
    if (!isRiichi)
        return candidates;
    return candidates.filter((kind) => (0, riichiAnkan_1.canAnkanDuringRiichi)(concealedBeforeDraw, concealedWithDraw, melds, kind));
}
function getKakanKinds(concealedWithDraw, melds) {
    const result = [];
    for (const m of melds) {
        if (m.type !== "triplet" || !m.isOpen)
            continue;
        const key = (0, tile_1.tileKindKey)(m.tiles[0].kind);
        if (concealedWithDraw.some((t) => (0, tile_1.tileKindKey)(t.kind) === key)) {
            result.push(m.tiles[0].kind);
        }
    }
    return result;
}

  };
  modules["game/riichiAnkan"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canAnkanDuringRiichi = canAnkanDuringRiichi;
const tile_1 = require("../types/tile");
const tenpai_1 = require("../yaku/tenpai");
const decompose_1 = require("../yaku/decompose");
/**
 * リーチ後の暗槓が許されるかどうかを判定する。次のすべてを満たす場合だけ可能:
 *   1. 今ツモってきた牌で4枚目が揃った(手の中の3枚+ツモ)。すでに4枚持っていた牌をカンする
 *      「送り槓」は不可。
 *   2. 待ち牌が変わらない(例: 4445 は 3・5・6 待ちだが、4をカンすると5単騎になるので不可)。
 *   3. 牌の構成・待ちの形が変わらない: カンする前の聴牌形で、どの待ち牌で和了した場合の
 *      どの面子の取り方でも、その3枚が常に刻子になっている。
 *      (例: 11123444 の1・4、1113444 の1 は、雀頭や嵌張の一部としても取れるので不可)
 *
 * @param concealedBeforeDraw リーチ宣言時に確定していた13枚の手牌
 * @param concealedAfterDraw  今回ツモした後の14枚の手牌(暗槓対象の4枚を含む)
 * @param melds 既存の副露・槓
 * @param kind 暗槓しようとしている牌の種類
 */
function canAnkanDuringRiichi(concealedBeforeDraw, concealedAfterDraw, melds, kind) {
    const beforeWaits = (0, tenpai_1.getWinningTileKinds)(concealedBeforeDraw, melds);
    const kindKey = (0, tile_1.tileKindKey)(kind);
    // 1. ツモ牌がその種類であること(送り槓の禁止)
    const beforeIds = new Set(concealedBeforeDraw.map((t) => t.id));
    const drawn = concealedAfterDraw.filter((t) => !beforeIds.has(t.id));
    if (drawn.length !== 1 || (0, tile_1.tileKindKey)(drawn[0].kind) !== kindKey)
        return false;
    // 3. どの和了形・面子の取り方でも、その3枚が刻子であること
    if (beforeWaits.length === 0)
        return false;
    const requiredSets = 4 - melds.length;
    for (const w of beforeWaits) {
        const winTile = { id: `riichi-ankan-check-${(0, tile_1.tileKindKey)(w)}`, kind: w, isRedDora: false };
        const decompositions = (0, decompose_1.decomposeConcealedHand)([...concealedBeforeDraw, winTile], requiredSets);
        if (decompositions.length === 0)
            return false; // 七対子・国士無双などの特殊形では刻子にならない
        for (const groups of decompositions) {
            const isTriplet = groups.some((g) => g.type === "triplet" && (0, tile_1.tileKindKey)(g.tiles[0].kind) === kindKey);
            if (!isTriplet)
                return false;
        }
    }
    const kanTiles = [];
    const afterTiles = [];
    for (const t of concealedAfterDraw) {
        if ((0, tile_1.tileKindKey)(t.kind) === kindKey && kanTiles.length < 4) {
            kanTiles.push(t);
        }
        else {
            afterTiles.push(t);
        }
    }
    if (kanTiles.length !== 4) {
        // そもそも4枚揃っていなければ暗槓自体ができない
        return false;
    }
    const kanMeld = { type: "kan_closed", tiles: kanTiles, isOpen: false };
    const afterWaits = (0, tenpai_1.getWinningTileKinds)(afterTiles, [...melds, kanMeld]);
    return (0, tenpai_1.sameWinningKinds)(beforeWaits, afterWaits);
}

  };
  modules["game/roundTransition"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.determineDealerContinuation = determineDealerContinuation;
exports.advanceRound = advanceRound;
const game_1 = require("../types/game");
const player_1 = require("../types/player");
const wallGenerator_1 = require("../wall/wallGenerator");
const actions_1 = require("./actions");
const WIND_ORDER = ["east", "south", "west", "north"];
/**
 * 局が終わった理由と(流局の場合の)聴牌者一覧から、親が続投(連荘)するかどうかを判定する。
 *
 * - ロン・ツモ: 親自身が和了した場合のみ連荘
 * - 四開槓などの途中流局: 常に連荘扱い
 * - 通常の流局: 親が聴牌していれば連荘
 */
function determineDealerContinuation(state, tenpaiSeats = []) {
    const reason = state.roundEndReason;
    if (!reason) {
        throw new Error("局が終了していないため連荘判定できません(内部エラー)");
    }
    switch (reason.type) {
        case "ron":
        case "tsumo":
            return reason.winner === state.dealer;
        case "abortive_draw":
            return true;
        case "exhaustive_draw":
            return tenpaiSeats.includes(state.dealer);
        default:
            return false;
    }
}
/**
 * 局を終えて次の局(または連荘による同じ局のやり直し、あるいは対局終了)へ進める。
 *
 * @param dealerContinues determineDealerContinuation() の結果
 * @param seed 次の牌山のシャッフルに使うシード値、または乱数関数(省略時はランダム。buildWall 参照)
 */
function advanceRound(state, dealerContinues, seed) {
    const busted = (0, game_1.isBusted)(state);
    if (busted) {
        // トビ終了時に場に残っている供託は、トばなかった側(勝者)が受け取る。
        const winner = (0, actions_1.otherSeat)(busted);
        const bonus = state.riichiSticks * 1000;
        const players = bonus > 0
            ? { ...state.players, [winner]: { ...state.players[winner], score: state.players[winner].score + bonus } }
            : state.players;
        return {
            ...state,
            players,
            riichiSticks: 0,
            phase: "game_end",
            gameEndReason: bonus > 0
                ? { type: "bust", bustedPlayer: busted, riichiBonus: { seat: winner, points: bonus } }
                : { type: "bust", bustedPlayer: busted },
        };
    }
    let dealer = state.dealer;
    let roundWind = state.roundWind;
    let roundNumber = state.roundNumber;
    let overallRoundIndex = state.overallRoundIndex;
    if (!dealerContinues) {
        dealer = (0, actions_1.otherSeat)(dealer);
        if (roundNumber === 1) {
            roundNumber = 2;
        }
        else {
            const windIndex = WIND_ORDER.indexOf(roundWind);
            if (windIndex === WIND_ORDER.length - 1) {
                // 北2局(8局目)が終わった場合、対局終了。
                // オーラス時点で供託されたままのリーチ棒は起家が受け取る。
                const startingDealer = state.startingDealer;
                const bonus = state.riichiSticks * 1000;
                const players = bonus > 0
                    ? {
                        ...state.players,
                        [startingDealer]: {
                            ...state.players[startingDealer],
                            score: state.players[startingDealer].score + bonus,
                        },
                    }
                    : state.players;
                return {
                    ...state,
                    players,
                    riichiSticks: 0,
                    phase: "game_end",
                    gameEndReason: bonus > 0
                        ? { type: "all_rounds_complete", riichiBonus: { seat: startingDealer, points: bonus } }
                        : { type: "all_rounds_complete" },
                };
            }
            roundWind = WIND_ORDER[windIndex + 1];
            roundNumber = 1;
        }
        overallRoundIndex += 1;
    }
    const { wall } = (0, wallGenerator_1.buildWall)(seed);
    const wallWithDora = (0, wallGenerator_1.revealNextDoraIndicator)(wall);
    // 配牌は親(その局の東家)から順に配る
    const { wall: dealtWall, hands } = (0, wallGenerator_1.dealInitialHands)(wallWithDora, [dealer, (0, actions_1.otherSeat)(dealer)]);
    return {
        ...state,
        dealer,
        roundWind,
        roundNumber,
        overallRoundIndex,
        kanCount: 0,
        fourKanAbortivePending: false,
        wall: dealtWall,
        players: {
            east: { ...(0, player_1.createInitialPlayerState)("east", state.players.east.score), hand: hands.east },
            south: { ...(0, player_1.createInitialPlayerState)("south", state.players.south.score), hand: hands.south },
        },
        currentTurn: dealer,
        lastDiscard: null,
        roundEndReason: null,
        phase: "draw",
    };
}

  };
  modules["ai/cpu"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEAK_CPU = void 0;
exports.visibleCounts = visibleCounts;
exports.countUkeire = countUkeire;
exports.evaluateDiscards = evaluateDiscards;
exports.chooseDiscard = chooseDiscard;
exports.chooseDiscardWithDefense = chooseDiscardWithDefense;
exports.decideTurnAction = decideTurnAction;
exports.isYakuhai = isYakuhai;
exports.decideCall = decideCall;
exports.shouldPon = shouldPon;
exports.shouldMinkan = shouldMinkan;
exports.decideTurnActionWeak = decideTurnActionWeak;
exports.decideCallWeak = decideCallWeak;
const tile_1 = require("../types/tile");
const actions_1 = require("../game/actions");
const legalActions_1 = require("../game/legalActions");
const furiten_1 = require("../yaku/furiten");
const shanten_1 = require("./shanten");
const defense_1 = require("./defense");
const value_1 = require("./value");
const wait_1 = require("./wait");
function handWithDraw(state, seat) {
    const p = state.players[seat];
    return p.drawnTile ? [...p.hand, p.drawnTile] : p.hand.slice();
}
/**
 * seat から見えている牌の枚数(種類ごと)。自分の手牌・両者の河(鳴かれた牌は副露側で数える)・
 * 両者の副露・表示済みのドラ表示牌。
 */
function visibleCounts(state, seat) {
    const counts = (0, shanten_1.toCounts)(handWithDraw(state, seat));
    const add = (t) => counts[(0, shanten_1.kindIndex)(t.kind)]++;
    for (const s of ["east", "south"]) {
        const p = state.players[s];
        for (const d of p.discards)
            if (!d.isCalled)
                add(d.tile);
        for (const m of p.melds)
            for (const t of m.tiles)
                add(t);
    }
    for (const t of state.wall.revealedDoraIndicators)
        add(t);
    return counts;
}
/** 受け入れ枚数: 加えると向聴数が下がる牌の、見えていない残り枚数の合計 */
function countUkeire(counts, meldCount, visible) {
    const base = (0, shanten_1.shantenFromCounts)(counts, meldCount);
    let total = 0;
    for (let k = 0; k < shanten_1.KIND_COUNT; k++) {
        if (counts[k] >= 4)
            continue;
        const remaining = Math.max(0, 4 - visible[k]);
        if (remaining === 0)
            continue;
        counts[k]++;
        if ((0, shanten_1.shantenFromCounts)(counts, meldCount) < base)
            total += remaining;
        counts[k]--;
    }
    return total;
}
/**
 * 孤立度(打牌の優先度)。孤立した字牌 > 孤立した么九牌 > 孤立した中張牌 > それ以外。
 * 萬子は前後2つ以内に牌があれば孤立ではない。
 */
function isolationScore(counts, idx) {
    if (counts[idx] >= 2)
        return 0;
    const kind = shanten_1.KIND_LIST[idx];
    if (kind.kind === "honor")
        return 3;
    if (kind.suit !== "man")
        return 2; // 筒子・索子は1と9しかなく順子にならない
    for (let d = -2; d <= 2; d++) {
        if (d === 0)
            continue;
        const j = idx + d;
        if (j >= 0 && j <= 8 && counts[j] > 0)
            return 0;
    }
    return kind.rank === 1 || kind.rank === 9 ? 2 : 1;
}
/** 打牌候補(同じ種類は1回だけ)を評価する */
function evaluateDiscards(state, seat) {
    const player = state.players[seat];
    const tiles = handWithDraw(state, seat);
    const counts = (0, shanten_1.toCounts)(tiles);
    const visible = visibleCounts(state, seat);
    const meldCount = player.melds.length;
    const forbiddenKey = player.forbiddenDiscardKind ? (0, tile_1.tileKindKey)(player.forbiddenDiscardKind) : null;
    const results = [];
    const seen = new Set();
    // ツモ牌を先に見ることで、同じ種類ならツモ切りを選ぶ
    const ordered = player.drawnTile ? [player.drawnTile, ...player.hand] : player.hand;
    for (const tile of ordered) {
        const key = (0, tile_1.tileKindKey)(tile.kind);
        if (seen.has(key) || key === forbiddenKey)
            continue;
        seen.add(key);
        const idx = (0, shanten_1.kindIndex)(tile.kind);
        const iso = isolationScore(counts, idx);
        counts[idx]--;
        const shanten = (0, shanten_1.shantenFromCounts)(counts, meldCount);
        const ukeire = countUkeire(counts, meldCount, visible);
        counts[idx]++;
        results.push({ tile, shanten, ukeire, isolationScore: iso });
    }
    return results;
}
/** 向聴数最小 → 受け入れ最大 → 孤立度最大 の順で打牌を選ぶ */
function chooseDiscard(state, seat) {
    const player = state.players[seat];
    if (player.isRiichi && player.drawnTile) {
        return { tile: player.drawnTile, shanten: 0, ukeire: 0, isolationScore: 0 };
    }
    const evals = evaluateDiscards(state, seat);
    if (evals.length === 0)
        throw new Error("打牌できる牌がありません");
    let best = evals[0];
    for (const e of evals.slice(1)) {
        if (e.shanten < best.shanten ||
            (e.shanten === best.shanten && e.ukeire > best.ukeire) ||
            (e.shanten === best.shanten && e.ukeire === best.ukeire && e.isolationScore > best.isolationScore)) {
            best = e;
        }
    }
    return best;
}
function drawOptions(state, seat) {
    const player = state.players[seat];
    const context = (0, actions_1.buildWinContext)(state, seat, player.drawnTile, true);
    return (0, legalActions_1.getDrawActionOptions)(handWithDraw(state, seat), player.melds, player.score, state.wall.liveWall.length, player.isRiichi, player.hand, context, !!player.forbiddenDiscardKind, state.kanCount);
}
/** 暗槓しても向聴数が悪化しないか */
function ankanKeepsShanten(state, seat, kind) {
    const player = state.players[seat];
    const counts = (0, shanten_1.toCounts)(handWithDraw(state, seat));
    const before = (0, shanten_1.shantenFromCounts)(counts, player.melds.length);
    const idx = (0, shanten_1.kindIndex)(kind);
    counts[idx] -= 4;
    const after = (0, shanten_1.shantenFromCounts)(counts, player.melds.length + 1);
    return after <= before;
}
/**
 * 守備ありの打牌選択(押し引き)。
 *   - 相手の脅威度が低い間は普段通り(向聴数・受け入れ優先)。ただし効率が同じくらいなら危険な牌を避ける。
 *   - 脅威度が高い(リーチ・高そうな鳴き)とき、自分の手が遠い・安い・待ちが悪いなら降りる
 *     (危険度の低い牌 = 現物・筋・見えている字牌 から切る)。
 */
function chooseDiscardWithDefense(state, seat, profile) {
    const player = state.players[seat];
    if (player.isRiichi && player.drawnTile) {
        return { tile: player.drawnTile, shanten: 0, ukeire: 0, isolationScore: 0 };
    }
    const evals = evaluateDiscards(state, seat);
    if (evals.length === 0)
        throw new Error("打牌できる牌がありません");
    const visible = visibleCounts(state, seat);
    const threat = (0, defense_1.opponentThreat)(state, seat);
    const danger = new Map(evals.map((e) => [e, (0, defense_1.tileDanger)(state, seat, e.tile.kind, visible)]));
    const bestShanten = Math.min(...evals.map((e) => e.shanten));
    const bestUkeire = Math.max(...evals.filter((e) => e.shanten === bestShanten).map((e) => e.ukeire));
    // 打点: 各候補を切った後の手の翻数の目安(ドラ・役牌・染め手・対々和・断么九)
    const counts = (0, shanten_1.toCounts)(handWithDraw(state, seat));
    const value = new Map(evals.map((e) => {
        const idx = (0, shanten_1.kindIndex)(e.tile.kind);
        counts[idx]--;
        const v = (0, value_1.handValue)(state, seat, counts, player.melds);
        counts[idx]++;
        return [e, v];
    }));
    const bestValueAtBest = Math.max(...evals.filter((e) => e.shanten === bestShanten).map((e) => value.get(e)));
    // 待ちの質: 聴牌する打牌について、残り枚数・役の有無・フリテン・出やすさを評価する
    const waits = new Map();
    for (const e of evals) {
        if (e.shanten !== 0)
            continue;
        const idx = (0, shanten_1.kindIndex)(e.tile.kind);
        counts[idx]--;
        waits.set(e, (0, wait_1.evaluateWait)(state, seat, counts, visible));
        counts[idx]++;
    }
    // 聴牌時の「受け入れ」は、待ちの良さの点数に置き換える(和了れない待ちは大きく減点)
    const efficiency = (e) => {
        const w = waits.get(e);
        if (!w)
            return e.ukeire;
        return w.remaining === 0 ? -30 : profile.waitWeight * w.score;
    };
    // 攻める場合: 向聴数を落とさない牌の中から、受け入れ・打点・危険度のバランスで選ぶ。
    // 序盤(2向聴以上)は、1向聴遅れても打点が大きく上がるなら(ドラ・役牌・染め手を残す)そちらも候補にする。
    const attack = () => {
        const candidates = evals.filter((e) => e.shanten === bestShanten ||
            (bestShanten >= 2 && e.shanten === bestShanten + 1 && value.get(e) - bestValueAtBest >= profile.valueTradeoffHan));
        const score = (e) => efficiency(e) +
            profile.valueWeight * 4 * value.get(e) -
            (e.shanten - bestShanten) * 20 -
            profile.dangerWeight * threat * 3 * danger.get(e);
        let best = candidates[0];
        for (const e of candidates.slice(1)) {
            const d = score(e) - score(best);
            if (d > 0 || (d === 0 && e.isolationScore > best.isolationScore))
                best = e;
        }
        return best;
    };
    if (threat < profile.threatThreshold)
        return attack();
    // 押し引きに使う自分の打点: 向聴数を保つ打牌の中で最も高くなる形の見積もり
    const handVal = bestValueAtBest;
    const push = (bestShanten === 0 &&
        (threat < profile.foldWhenTenpaiThreat || handVal >= profile.tenpaiPushValue || bestUkeire >= profile.tenpaiPushWait)) ||
        (bestShanten === 1 && threat < 1 && handVal >= profile.pushOneShantenValue) ||
        (bestShanten === 2 && threat < 1 && handVal >= profile.pushTwoShantenValue);
    if (push)
        return attack();
    // 降りる: 危険度の低い牌 → 向聴数を保てる牌 → 受け入れの多い牌
    let best = evals[0];
    for (const e of evals.slice(1)) {
        const dd = danger.get(e) - danger.get(best);
        if (dd < 0 ||
            (dd === 0 && e.shanten < best.shanten) ||
            (dd === 0 && e.shanten === best.shanten && e.ukeire > best.ukeire)) {
            best = e;
        }
    }
    return { ...best, folding: true };
}
/** 打牌後の手の待ち(聴牌していなければ残り0) */
function waitAfterDiscard(state, seat, tile) {
    const counts = (0, shanten_1.toCounts)(handWithDraw(state, seat));
    counts[(0, shanten_1.kindIndex)(tile.kind)]--;
    return (0, wait_1.evaluateWait)(state, seat, counts, visibleCounts(state, seat));
}
/**
 * 自分の手番(打牌フェーズ)の行動を決める。
 * profile を渡すと守備(押し引き・ベタオリ)ありで判断する。省略時は従来通りの牌効率だけのCPU。
 */
function decideTurnAction(state, seat, profile) {
    const player = state.players[seat];
    const options = drawOptions(state, seat);
    if (options.canTsumo)
        return { type: "tsumo" };
    for (const kind of options.ankanKinds) {
        // リーチ中の暗槓はエンジン側で「待ちが変わらない」場合に限られている
        if (player.isRiichi || ankanKeepsShanten(state, seat, kind)) {
            return { type: "ankan", kind };
        }
    }
    // 強化版: 加槓(相手の脅威が低く、加える牌を切るのと比べて手が悪くならない場合)
    if (profile && profile.extendedCalls && (0, defense_1.opponentThreat)(state, seat) < profile.threatThreshold) {
        for (const kind of options.kakanKinds) {
            if (kakanKeepsShanten(state, seat, kind))
                return { type: "kakan", kind };
        }
    }
    const choice = profile ? chooseDiscardWithDefense(state, seat, profile) : chooseDiscard(state, seat);
    const declareRiichi = !player.isRiichi &&
        !choice.folding &&
        // 強化版: 和了れる待ち牌が残っていない(空聴)ならリーチしない
        (!profile || waitAfterDiscard(state, seat, choice.tile).remaining > 0) &&
        choice.shanten === 0 &&
        options.riichiDiscardOptions.some((t) => t.id === choice.tile.id);
    return { type: "discard", tile: choice.tile, declareRiichi };
}
/** 役牌(三元牌・自風・場風)かどうか */
function isYakuhai(state, seat, kind) {
    if (kind.kind !== "honor")
        return false;
    if (kind.honor === "white" || kind.honor === "green" || kind.honor === "red")
        return true;
    return kind.honor === (0, actions_1.seatWindOf)(state, seat) || kind.honor === state.roundWind;
}
/**
 * 相手の捨て牌(call_window)に対する行動を決める。
 * profile を渡した場合、相手の脅威度が高く自分の手が遠い(1向聴以上)ときはポンしない(降りる手を崩さない)。
 */
function decideCall(state, seat, profile) {
    const discard = state.lastDiscard;
    if (!discard || discard.from === seat)
        return "pass";
    const player = state.players[seat];
    const context = (0, actions_1.buildWinContext)(state, seat, discard.tile, false);
    const ron = (0, legalActions_1.canDeclareRon)(player.hand, player.melds, player.discards.map((d) => d.tile), (0, furiten_1.isMissedRonFuriten)(player), discard.tile, context);
    if (ron)
        return "ron";
    const pon = (0, legalActions_1.canDeclarePon)(player.hand, discard.tile, player.isRiichi, state.wall.liveWall.length, state.fourKanAbortivePending);
    const threatened = !!profile && (0, defense_1.opponentThreat)(state, seat) >= profile.threatThreshold;
    const currentShanten = (0, shanten_1.shantenFromCounts)((0, shanten_1.toCounts)(player.hand), player.melds.length);
    // 相手の脅威が高く自分の手が遠いときは、鳴いて手を崩さない
    if (threatened && currentShanten >= 2)
        return "pass";
    if (pon && isYakuhai(state, seat, discard.tile.kind))
        return "pon";
    if (profile && profile.extendedCalls) {
        const canKan = (0, legalActions_1.canDeclareMinkan)(player.hand, discard.tile, player.isRiichi, state.wall.liveWall.length, state.kanCount);
        if (canKan && !threatened && shouldMinkan(state, seat, discard.tile.kind))
            return "minkan";
        if (pon && shouldPon(state, seat, discard.tile.kind))
            return "pon";
    }
    return "pass";
}
const dummyTiles = (kind, n, tag) => Array.from({ length: n }, (_, i) => ({ id: `cpu-${tag}-${i}`, kind, isRedDora: false }));
/**
 * 強化版: 役牌以外のポンをするか。
 *   - ポンして1枚切った後の向聴数が、今より進む(下がる)こと
 *   - 鳴いた後も役がつく見込みがあること(役牌の刻子・混一色/清一色・対々和・断么九のいずれか)
 *   - 門前で既に聴牌している手は、リーチを捨ててまで鳴かない
 */
function shouldPon(state, seat, kind) {
    const player = state.players[seat];
    const counts = (0, shanten_1.toCounts)(player.hand);
    const before = (0, shanten_1.shantenFromCounts)(counts, player.melds.length);
    const isMenzen = player.melds.every((m) => m.type === "kan_closed");
    if (isMenzen && before === 0)
        return false;
    const idx = (0, shanten_1.kindIndex)(kind);
    counts[idx] -= 2;
    const melds = [...player.melds, { type: "triplet", tiles: dummyTiles(kind, 3, "pon"), isOpen: true }];
    // ポン後の打牌(喰い替えになる同じ牌は切れない)の中で最も良い形
    let bestAfter = Infinity;
    let bestCounts = null;
    for (let i = 0; i < shanten_1.KIND_COUNT; i++) {
        if (counts[i] === 0 || i === idx)
            continue;
        counts[i]--;
        const s = (0, shanten_1.shantenFromCounts)(counts, melds.length);
        if (s < bestAfter) {
            bestAfter = s;
            bestCounts = counts.slice();
        }
        counts[i]++;
    }
    if (!bestCounts || bestAfter >= before)
        return false;
    const b = (0, value_1.handValueBreakdown)(state, seat, bestCounts, melds);
    const hasYakuPath = b.yakuhai >= 1 || b.flush >= 1 || b.toitoi >= 1 || b.tanyao >= 1;
    return hasYakuPath;
}
/**
 * 強化版: 大明槓するか。すでに鳴いている手(門前を崩さない)か役牌の刻子で、
 * カンしても向聴数が悪くならない場合だけ(ドラが増え、嶺上牌も引ける)。
 */
function shouldMinkan(state, seat, kind) {
    const player = state.players[seat];
    const isMenzen = player.melds.every((m) => m.type === "kan_closed");
    if (isMenzen && !isYakuhai(state, seat, kind))
        return false;
    const counts = (0, shanten_1.toCounts)(player.hand);
    const before = (0, shanten_1.shantenFromCounts)(counts, player.melds.length);
    counts[(0, shanten_1.kindIndex)(kind)] -= 3;
    const after = (0, shanten_1.shantenFromCounts)(counts, player.melds.length + 1);
    return after <= before;
}
/** 加槓しても、加える牌を普通に切った場合より向聴数が悪くならないか */
function kakanKeepsShanten(state, seat, kind) {
    const player = state.players[seat];
    const counts = (0, shanten_1.toCounts)(handWithDraw(state, seat));
    const idx = (0, shanten_1.kindIndex)(kind);
    counts[idx]--;
    // 加槓後は面子数が変わらない(刻子→槓子)ので、手牌から1枚減った状態の向聴数を比べる
    const after = (0, shanten_1.shantenFromCounts)(counts, player.melds.length);
    counts[idx]++;
    let bestDiscard = Infinity;
    for (let i = 0; i < shanten_1.KIND_COUNT; i++) {
        if (counts[i] === 0)
            continue;
        counts[i]--;
        bestDiscard = Math.min(bestDiscard, (0, shanten_1.shantenFromCounts)(counts, player.melds.length));
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
exports.WEAK_CPU = {
    /** 和了できるのに見逃す確率(ポンコツ型でも和了できる場合は必ず和了する) */
    missWinRate: 0,
    /** 牌効率を無視して適当な牌を切る確率 */
    randomDiscardRate: 0.35,
    /** リーチできるのにしない確率 */
    skipRiichiRate: 0.5,
    /** 役牌以外でも、鳴けるならポンしてしまう確率(役が無くなって和了れなくなることもある) */
    pointlessPonRate: 0.3,
};
function decideTurnActionWeak(state, seat, random = Math.random) {
    const player = state.players[seat];
    const base = decideTurnAction(state, seat);
    if (base.type === "tsumo") {
        if (random() >= exports.WEAK_CPU.missWinRate)
            return base;
        // 見逃した場合は、下の打牌選択へ
    }
    else if (base.type !== "discard") {
        return base; // 暗槓はそのまま
    }
    if (player.isRiichi && player.drawnTile) {
        return { type: "discard", tile: player.drawnTile, declareRiichi: false };
    }
    let tile = base.type === "discard" ? base.tile : chooseDiscard(state, seat).tile;
    let declareRiichi = base.type === "discard" ? base.declareRiichi : false;
    if (random() < exports.WEAK_CPU.randomDiscardRate) {
        const forbiddenKey = player.forbiddenDiscardKind ? (0, tile_1.tileKindKey)(player.forbiddenDiscardKind) : null;
        const pool = handWithDraw(state, seat).filter((t) => (0, tile_1.tileKindKey)(t.kind) !== forbiddenKey);
        if (pool.length > 0) {
            tile = pool[Math.floor(random() * pool.length) % pool.length];
            declareRiichi = false;
        }
    }
    if (declareRiichi && random() < exports.WEAK_CPU.skipRiichiRate)
        declareRiichi = false;
    return { type: "discard", tile, declareRiichi };
}
function decideCallWeak(state, seat, random = Math.random) {
    const base = decideCall(state, seat);
    if (base === "ron")
        return random() < exports.WEAK_CPU.missWinRate ? "pass" : "ron";
    if (base !== "pass")
        return base;
    const discard = state.lastDiscard;
    if (!discard)
        return "pass";
    const player = state.players[seat];
    const pon = (0, legalActions_1.canDeclarePon)(player.hand, discard.tile, player.isRiichi, state.wall.liveWall.length, state.fourKanAbortivePending);
    return pon && random() < exports.WEAK_CPU.pointlessPonRate ? "pon" : "pass";
}

  };
  modules["ai/defense"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFENSE_PROFILES = void 0;
exports.safeKindKeys = safeKindKeys;
exports.tileDanger = tileDanger;
exports.opponentThreat = opponentThreat;
exports.estimateHandValue = estimateHandValue;
exports.estimateHandValueSimple = estimateHandValueSimple;
const tile_1 = require("../types/tile");
const actions_1 = require("../game/actions");
const dora_1 = require("../yaku/dora");
const shanten_1 = require("./shanten");
const value_1 = require("./value");
exports.DEFENSE_PROFILES = {
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
function safeKindKeys(state, seat) {
    const opponent = (0, actions_1.otherSeat)(seat);
    const opp = state.players[opponent];
    const keys = new Set(opp.discards.map((d) => (0, tile_1.tileKindKey)(d.tile.kind)));
    const riichiDecl = opp.discards.find((d) => d.isRiichiDeclaration);
    if (opp.isRiichi && riichiDecl && riichiDecl.seq != null) {
        for (const d of state.players[seat].discards) {
            if (d.seq != null && d.seq > riichiDecl.seq)
                keys.add((0, tile_1.tileKindKey)(d.tile.kind));
        }
    }
    return keys;
}
/**
 * 牌の種類ごとの危険度(0〜おおむね6)。seat(自分)から見て、相手 otherSeat(seat) に当たる度合い。
 * visible は自分から見えている枚数(visibleCounts)。
 */
function tileDanger(state, seat, kind, visible) {
    // 相手の手牌・フリテン状態(見逃し等)は相手にしか分からないので使わない
    const genbutsu = safeKindKeys(state, seat);
    if (genbutsu.has((0, tile_1.tileKindKey)(kind)))
        return 0;
    const unseen = Math.max(0, 4 - visible[(0, shanten_1.kindIndex)(kind)]);
    // 単騎・双碰だけで当たる牌(字牌・筒子/索子): 残り枚数が少ないほど安全
    const pairWaitDanger = unseen <= 0 ? 0 : unseen === 1 ? 1 : unseen === 2 ? 2.5 : 3.5;
    if (kind.kind === "honor" || kind.suit !== "man")
        return pairWaitDanger;
    // 萬子: 両面・嵌張・辺張の待ちもある。筋(3つ離れた牌が現物)なら両面には当たらない
    const r = kind.rank;
    const isGen = (rank) => rank >= 1 && rank <= 9 && genbutsu.has(`number:man:${rank}`);
    // 両面待ちで r に当たりうる形: (r-2,r-1) は r-3 と、(r+1,r+2) は r+3 と同時待ち
    const lowSide = r >= 4; // (r-2, r-1) の両面(r-3 も待ち)
    const highSide = r <= 6; // (r+1, r+2) の両面(r+3 も待ち)
    let ryanmenOpen = 0;
    if (lowSide && !isGen(r - 3))
        ryanmenOpen++;
    if (highSide && !isGen(r + 3))
        ryanmenOpen++;
    // 嵌張・辺張・単騎・双碰のぶん
    const edgeBonus = r === 1 || r === 9 ? 0.5 : r === 2 || r === 8 ? 1 : 1.5;
    return pairWaitDanger * 0.6 + edgeBonus + ryanmenOpen * 1.5;
}
/**
 * 相手の脅威度(0〜1)。リーチなら1。鳴いている場合は副露数とドラ・残り巡目から見積もる。
 */
function opponentThreat(state, seat) {
    const opp = state.players[(0, actions_1.otherSeat)(seat)];
    if (opp.isRiichi)
        return 1;
    const meldCount = opp.melds.length;
    if (meldCount === 0) {
        // 門前で黙っている相手は分からないので、終盤だけ少し警戒する
        return state.wall.liveWall.length <= 8 ? 0.3 : 0;
    }
    const meldTiles = opp.melds.flatMap((m) => m.tiles);
    const dora = (0, dora_1.countDoraTiles)(meldTiles, state.wall.revealedDoraIndicators);
    let threat = meldCount >= 3 ? 0.8 : meldCount === 2 ? 0.55 : 0.3;
    if (dora >= 2)
        threat += 0.2;
    else if (dora === 1)
        threat += 0.1;
    if (state.wall.liveWall.length <= 10)
        threat += 0.1;
    return Math.min(1, threat);
}
/** 自分の手の打点の目安(翻数くらいの値)。value.ts の handValue(ドラ・役牌・染め手・対々和・断么九・門前)を使う */
function estimateHandValue(state, seat, tiles) {
    return (0, value_1.handValue)(state, seat, (0, shanten_1.toCounts)(tiles), state.players[seat].melds);
}
/** (旧)ドラ・門前・役牌刻子だけの簡易な見積もり。参考として残す */
function estimateHandValueSimple(state, seat, tiles) {
    const player = state.players[seat];
    const allTiles = [...tiles, ...player.melds.flatMap((m) => m.tiles)];
    let value = (0, dora_1.countDoraTiles)(allTiles, state.wall.revealedDoraIndicators);
    const isMenzen = player.melds.every((m) => m.type === "kan_closed");
    if (isMenzen)
        value += 1; // リーチ(+ツモ)の分
    // 役牌の刻子(手牌・副露)
    const counts = new Map();
    for (const t of allTiles)
        counts.set((0, tile_1.tileKindKey)(t.kind), (counts.get((0, tile_1.tileKindKey)(t.kind)) ?? 0) + 1);
    const seatWind = (0, actions_1.seatWindOf)(state, seat);
    for (const [key, n] of counts) {
        if (n < 3 || !key.startsWith("honor:"))
            continue;
        const h = key.slice("honor:".length);
        if (h === "white" || h === "green" || h === "red")
            value += 1;
        if (h === state.roundWind)
            value += 1;
        if (h === seatWind)
            value += 1;
    }
    return value;
}

  };
  modules["ai/index"] = function(module, exports, require) {
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
__exportStar(require("./shanten"), exports);
__exportStar(require("./cpu"), exports);
__exportStar(require("./defense"), exports);
__exportStar(require("./value"), exports);
__exportStar(require("./wait"), exports);

  };
  modules["ai/shanten"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KIND_COUNT = exports.KIND_LIST = void 0;
exports.kindIndex = kindIndex;
exports.toCounts = toCounts;
exports.standardShanten = standardShanten;
exports.chiitoitsuShanten = chiitoitsuShanten;
exports.kokushiShanten = kokushiShanten;
exports.shantenFromCounts = shantenFromCounts;
exports.calculateShanten = calculateShanten;
const tile_1 = require("../types/tile");
/**
 * 向聴数(シャンテン数)の計算。このルールの80枚構成(萬子1-9・筒子/索子の1と9・字牌7種)に合わせてある。
 * 筒子・索子には1と9しかないため、順子(と両面・嵌張・辺張などの順子の塔子)は萬子にしか存在しない。
 *
 * 戻り値: -1 = 和了形、0 = 聴牌、1 以上 = n向聴。
 */
/** 全20種の牌の種類(インデックス順: 萬1-9=0..8, 筒1,9=9,10, 索1,9=11,12, 字牌=13..19) */
exports.KIND_LIST = (0, tile_1.allTileKinds)();
const KIND_INDEX = new Map(exports.KIND_LIST.map((k, i) => [(0, tile_1.tileKindKey)(k), i]));
exports.KIND_COUNT = exports.KIND_LIST.length; // 20
/** 萬子(順子を作れる唯一のスート)のインデックス範囲 [0, 8] */
const MAN_LAST = 8;
function kindIndex(kind) {
    const idx = KIND_INDEX.get((0, tile_1.tileKindKey)(kind));
    if (idx === undefined)
        throw new Error(`unknown tile kind: ${(0, tile_1.tileKindKey)(kind)}`);
    return idx;
}
/** 牌の配列を種類ごとの枚数配列(長さ20)にする */
function toCounts(tiles) {
    const counts = new Array(exports.KIND_COUNT).fill(0);
    for (const t of tiles)
        counts[kindIndex(t.kind)]++;
    return counts;
}
/** 么九牌(国士無双の対象)のインデックス */
const YAOCHU_INDICES = [0, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
/**
 * 一般形(4面子1雀頭)の向聴数。meldCount は既に副露・槓で確定している面子の数。
 * 公式: 8 - 2*面子 - 塔子 - 雀頭(面子+塔子 は 4 まで)。
 */
function standardShanten(counts, meldCount) {
    const c = counts.slice();
    let best = 8;
    const evaluate = (sets, partials, pair) => {
        const totalSets = sets + meldCount;
        const usablePartials = Math.min(partials, 4 - totalSets);
        const s = 8 - 2 * totalSets - usablePartials - pair;
        if (s < best)
            best = s;
    };
    // 面子を抜き出す段階(i から先を走査)。面子を取り尽くしたら塔子の段階へ移る。
    const extractSets = (i, sets, pair) => {
        while (i < exports.KIND_COUNT && c[i] === 0)
            i++;
        if (i >= exports.KIND_COUNT) {
            extractPartials(0, sets, 0, pair);
            return;
        }
        // 刻子
        if (c[i] >= 3) {
            c[i] -= 3;
            extractSets(i, sets + 1, pair);
            c[i] += 3;
        }
        // 順子(萬子のみ)
        if (i + 2 <= MAN_LAST && c[i + 1] > 0 && c[i + 2] > 0) {
            c[i]--;
            c[i + 1]--;
            c[i + 2]--;
            extractSets(i, sets + 1, pair);
            c[i]++;
            c[i + 1]++;
            c[i + 2]++;
        }
        // この種類ではもう面子を取らない
        extractSets(i + 1, sets, pair);
    };
    const extractPartials = (i, sets, partials, pair) => {
        while (i < exports.KIND_COUNT && c[i] === 0)
            i++;
        if (i >= exports.KIND_COUNT) {
            evaluate(sets, partials, pair);
            return;
        }
        if (c[i] >= 2) {
            c[i] -= 2;
            // 雀頭として
            if (pair === 0)
                extractPartials(i, sets, partials, 1);
            // 対子(刻子の塔子)として
            extractPartials(i, sets, partials + 1, pair);
            c[i] += 2;
        }
        if (i <= MAN_LAST) {
            if (i + 1 <= MAN_LAST && c[i + 1] > 0) {
                c[i]--;
                c[i + 1]--;
                extractPartials(i, sets, partials + 1, pair);
                c[i]++;
                c[i + 1]++;
            }
            if (i + 2 <= MAN_LAST && c[i + 2] > 0) {
                c[i]--;
                c[i + 2]--;
                extractPartials(i, sets, partials + 1, pair);
                c[i]++;
                c[i + 2]++;
            }
        }
        // 孤立牌として捨て置く
        const saved = c[i];
        c[i] = 0;
        extractPartials(i + 1, sets, partials, pair);
        c[i] = saved;
    };
    extractSets(0, 0, 0);
    return best;
}
/** 七対子の向聴数(副露があれば成立しないので Infinity) */
function chiitoitsuShanten(counts, meldCount) {
    if (meldCount > 0)
        return Infinity;
    let pairs = 0;
    let kinds = 0;
    for (const n of counts) {
        if (n > 0)
            kinds++;
        if (n >= 2)
            pairs++;
    }
    return 6 - pairs + Math.max(0, 7 - kinds);
}
/** 国士無双の向聴数(副露があれば成立しないので Infinity) */
function kokushiShanten(counts, meldCount) {
    if (meldCount > 0)
        return Infinity;
    let kinds = 0;
    let hasPair = false;
    for (const i of YAOCHU_INDICES) {
        if (counts[i] > 0)
            kinds++;
        if (counts[i] >= 2)
            hasPair = true;
    }
    return 13 - kinds - (hasPair ? 1 : 0);
}
/** 枚数配列に対する向聴数(一般形・七対子・国士無双の最小値) */
function shantenFromCounts(counts, meldCount) {
    return Math.min(standardShanten(counts, meldCount), chiitoitsuShanten(counts, meldCount), kokushiShanten(counts, meldCount));
}
/**
 * 手牌(門前部分)と副露・槓の数から向聴数を求める。
 * concealed は 3n+1 枚(打牌後)または 3n+2 枚(ツモ直後)のどちらでもよい。
 */
function calculateShanten(concealed, meldCount) {
    return shantenFromCounts(toCounts(concealed), meldCount);
}

  };
  modules["ai/value"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handValueBreakdown = handValueBreakdown;
exports.handValue = handValue;
const actions_1 = require("../game/actions");
const dora_1 = require("../yaku/dora");
const shanten_1 = require("./shanten");
const MAN_LAST = 8; // 萬子のインデックスは 0..8
const HONOR_FIRST = 13; // 字牌のインデックスは 13..19
function isHonorIdx(i) {
    return i >= HONOR_FIRST;
}
function isManIdx(i) {
    return i <= MAN_LAST;
}
/** 役牌(三元牌・場風・自風)のインデックス集合。場風と自風が同じ牌なら2回数える(連風牌) */
function yakuhaiWeights(state, seat) {
    const w = new Array(shanten_1.KIND_COUNT).fill(0);
    const seatWind = (0, actions_1.seatWindOf)(state, seat);
    shanten_1.KIND_LIST.forEach((k, i) => {
        if (k.kind !== "honor")
            return;
        if (k.honor === "white" || k.honor === "green" || k.honor === "red")
            w[i] += 1;
        if (k.honor === state.roundWind)
            w[i] += 1;
        if (k.honor === seatWind)
            w[i] += 1;
    });
    return w;
}
/**
 * 手の打点の目安(翻数くらいの値)。counts は門前部分(ツモ牌を含めてもよい)の種類ごとの枚数。
 */
function handValueBreakdown(state, seat, counts, melds) {
    // 副露も含めた全体の枚数
    const all = counts.slice();
    for (const m of melds)
        for (const t of m.tiles)
            all[(0, shanten_1.kindIndex)(t.kind)]++;
    const isMenzen = melds.every((m) => m.type === "kan_closed");
    // ドラ(持っているだけ翻数になる)
    let dora = 0;
    for (const ind of state.wall.revealedDoraIndicators)
        dora += all[(0, shanten_1.kindIndex)((0, dora_1.doraFromIndicator)(ind.kind))];
    // 役牌: 刻子なら確定、対子なら刻子になる見込みの分だけ
    const yw = yakuhaiWeights(state, seat);
    let yakuhai = 0;
    for (let i = HONOR_FIRST; i < shanten_1.KIND_COUNT; i++) {
        if (yw[i] === 0)
            continue;
        if (all[i] >= 3)
            yakuhai += yw[i];
        else if (all[i] === 2)
            yakuhai += yw[i] * 0.4;
    }
    // 染め手: 萬子と字牌だけでどれだけ構成されているか(筒子・索子の1・9が混ざるほど遠い)
    let man = 0;
    let honor = 0;
    let other = 0;
    for (let i = 0; i < shanten_1.KIND_COUNT; i++) {
        if (isManIdx(i))
            man += all[i];
        else if (isHonorIdx(i))
            honor += all[i];
        else
            other += all[i];
    }
    let flush = 0;
    if (man >= 7 && other <= 2) {
        const honitsuHan = isMenzen ? 3 : 2;
        const chinitsuHan = isMenzen ? 6 : 5;
        const closeness = other === 0 ? 1 : other === 1 ? 0.6 : 0.3; // 筒子・索子の残り枚数で見込みを下げる
        flush = (honor === 0 && man >= 11 ? chinitsuHan : honitsuHan) * closeness;
    }
    // 対々和: 対子・刻子(と副露の刻子・槓子)が多いほど見込みあり。筒子・索子の1・9はこれに向く
    let pairsOrSets = melds.length;
    for (let i = 0; i < shanten_1.KIND_COUNT; i++)
        if (counts[i] >= 2)
            pairsOrSets++;
    const toitoi = pairsOrSets >= 5 ? 2 : pairsOrSets === 4 ? 1 : 0;
    // 断么九: 萬子の2〜8だけで構成されていそうなら
    let terminalsOrHonors = 0;
    for (let i = 0; i < shanten_1.KIND_COUNT; i++) {
        if (all[i] === 0)
            continue;
        const k = shanten_1.KIND_LIST[i];
        if (k.kind === "honor" || k.rank === 1 || k.rank === 9)
            terminalsOrHonors += all[i];
    }
    const tanyao = terminalsOrHonors === 0 ? 1 : terminalsOrHonors === 1 ? 0.4 : 0;
    // 門前ならリーチ・ツモの分
    const menzenBonus = isMenzen ? 1 : 0;
    const total = dora + yakuhai + flush + toitoi + tanyao + menzenBonus;
    return { dora, yakuhai, flush, toitoi, tanyao, total };
}
function handValue(state, seat, counts, melds) {
    return handValueBreakdown(state, seat, counts, melds).total;
}

  };
  modules["ai/wait"] = function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateWait = evaluateWait;
exports.evaluateWaitOfTiles = evaluateWaitOfTiles;
const tile_1 = require("../types/tile");
const actions_1 = require("../game/actions");
const evaluate_1 = require("../yaku/evaluate");
const shanten_1 = require("./shanten");
const dummy = (i) => ({ id: `wait-check-${i}`, kind: shanten_1.KIND_LIST[i], isRedDora: false });
/**
 * counts: 打牌後(13枚相当)の門前部分の種類ごとの枚数。visible: 自分から見えている枚数(visibleCounts)。
 * 聴牌していなければ remaining = 0 を返す。
 */
function evaluateWait(state, seat, counts, visible) {
    const player = state.players[seat];
    const meldCount = player.melds.length;
    const empty = { kinds: [], remaining: 0, score: 0, furiten: false };
    if ((0, shanten_1.shantenFromCounts)(counts, meldCount) !== 0)
        return empty;
    const isMenzen = player.melds.every((m) => m.type === "kan_closed");
    const myDiscardKeys = new Set(player.discards.map((d) => (0, tile_1.tileKindKey)(d.tile.kind)));
    const opp = state.players[(0, actions_1.otherSeat)(seat)];
    const oppDiscardKeys = new Set(opp.discards.map((d) => (0, tile_1.tileKindKey)(d.tile.kind)));
    // 門前部分の牌(役判定用のダミー)
    const concealed = [];
    counts.forEach((n, i) => {
        for (let c = 0; c < n; c++)
            concealed.push({ id: `wait-hand-${i}-${c}`, kind: shanten_1.KIND_LIST[i], isRedDora: false });
    });
    const kinds = [];
    let remaining = 0;
    let weighted = 0;
    let furiten = false;
    for (let i = 0; i < shanten_1.KIND_COUNT; i++) {
        if (counts[i] >= 4)
            continue;
        counts[i]++;
        const wins = (0, shanten_1.shantenFromCounts)(counts, meldCount) === -1;
        counts[i]--;
        if (!wins)
            continue;
        const key = (0, tile_1.tileKindKey)(shanten_1.KIND_LIST[i]);
        // 副露していて役が無い待ちは和了れない(門前ならリーチで役が付くので数える)
        if (!isMenzen) {
            const tile = dummy(i);
            const ctx = (0, actions_1.buildWinContext)(state, seat, tile, false);
            const r = (0, evaluate_1.evaluateYaku)({ concealedTiles: [...concealed, tile], melds: player.melds }, ctx);
            if (!(r.isWin && r.yaku.length > 0))
                continue;
        }
        if (myDiscardKeys.has(key))
            furiten = true;
        const left = Math.max(0, 4 - visible[i]);
        kinds.push(key);
        remaining += left;
        // 出やすさの補正(1枚あたりの倍率)
        let ease = 1;
        const k = shanten_1.KIND_LIST[i];
        if (k.kind === "number" && k.suit === "man") {
            const suji = (r) => r >= 1 && r <= 9 && myDiscardKeys.has(`number:man:${r}`);
            if (suji(k.rank - 3) || suji(k.rank + 3))
                ease += 0.4; // 自分の捨て牌の筋 = 相手から安全そうに見える
            const near = (r) => r >= 1 && r <= 9 && oppDiscardKeys.has(`number:man:${r}`);
            if (near(k.rank - 1) || near(k.rank + 1) || near(k.rank - 2) || near(k.rank + 2))
                ease += 0.2;
        }
        else if (visible[i] - counts[i] >= 1) {
            ease += 0.3; // 字牌・1・9は場に見えていると相手が切りやすい
        }
        if (oppDiscardKeys.has(key))
            ease += 0.3; // 相手が既に切っている牌は要らない牌
        weighted += left * ease;
    }
    const score = furiten ? weighted * 0.4 : weighted;
    return { kinds, remaining, score, furiten };
}
/** 手牌(Tile配列、13枚)から待ちの質を求める */
function evaluateWaitOfTiles(state, seat, tiles, visible) {
    return evaluateWait(state, seat, (0, shanten_1.toCounts)(tiles), visible);
}

  };
  global.MahjongEngine = Object.assign(
    {},
    requireModule('types/index'),
    requireModule('wall/index'),
    requireModule('yaku/index'),
    requireModule('scoring/index'),
    requireModule('game/index'),
    requireModule('ai/index')
  );
})(__engineHost);
module.exports = __engineHost.MahjongEngine;
