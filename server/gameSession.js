"use strict";

/**
 * サーバーが持つ1ルーム分の対局(サーバー主導の対局進行)。
 *
 * クライアントからは「打牌」「ポン」などの操作だけを受け取り、その操作がその時点で合法か
 * (その家の手番か・手牌にある牌か・リーチ/鳴き/和了の条件を満たすか)をエンジンで確かめてから
 * 局面を進める。クライアントには、その家が見てよい情報だけにした局面(相手の手牌・牌山・
 * 裏ドラなどを伏せ牌にしたもの)を配る。
 *
 * これにより、ページ(HTML/JavaScript)を書き換えても
 *   - 相手の手牌や次にツモる牌は見えない(ブラウザにそもそも届かない)
 *   - 手牌に無い牌を切る・点数を書き換える・勝手に和了する、などはサーバーが受け付けない
 * ようになる。
 *
 * 局面の進め方は、ブラウザ側の MahjongApp(frontend/app.js)の doDiscard / doTsumo / doRon /
 * doPon / doMinkan / doAnkan / doKakan / doPass / autoAdvance / nextRound と同じ手順にしてある
 * (どちらもエンジンの同じ関数を呼ぶ)。進め方を変えるときは両方を直すこと。
 */

const crypto = require("crypto");
const E = require("./mahjong-engine");

const SEATS = ["east", "south"];
/** 配牌の演出(フロントの DEAL_STEP_MS × (配る回数 8 + 理牌 + 最初のツモ))の間は、最初のツモを待つ */
const DEAL_ANIMATION_MS = 300 * 10;
/** 結果画面の自動送り(フロントの RESULT_AUTO_ADVANCE_MS 15秒 + 和了表示 1.5秒 + 余裕) */
const RESULT_AUTO_ADVANCE_MS = 18000;
/** 持ち時間を過ぎても操作が届かない場合に、サーバーが代わりに進めるまでの余裕(通信の遅れを見込む) */
const TIMEOUT_GRACE_MS = 5000;
/** 持ち時間なしの対局でも、1つの判断にこれ以上かかったらサーバーが代わりに進める(放置で止まらないように) */
const MAX_DECISION_MS = 10 * 60 * 1000;

function otherSeat(seat) {
  return seat === "east" ? "south" : "east";
}

function kindKey(kind) {
  return E.tileKindKey(kind);
}

/** 持ち時間の設定を正規化する({perAction, bank}(秒)または null=なし)。不正値は既定の 5+20秒 */
function normalizeTimeControl(tc) {
  if (tc === null) return null;
  if (tc && Number.isInteger(tc.perAction) && Number.isInteger(tc.bank) && tc.perAction >= 1 && tc.perAction <= 600 && tc.bank >= 0 && tc.bank <= 3600) {
    return { perAction: tc.perAction, bank: tc.bank };
  }
  return { perAction: 5, bank: 20 };
}

class GameSession {
  /**
   * @param {{timeControl?: object|null, dealerChoice?: "self"|"opponent"|"random", random?: Function,
   *          setTimer?: Function, clearTimer?: Function, onUpdate?: Function, gameId?: string}} options
   *   dealerChoice は east 席(ルーム作成者)から見た起家の決め方。onUpdate はタイマーで局面が進んだ時に呼ぶ。
   */
  constructor(options = {}) {
    this.timeControl = normalizeTimeControl(options.timeControl === undefined ? { perAction: 5, bank: 20 } : options.timeControl);
    this.dealerChoice = ["self", "opponent", "random"].includes(options.dealerChoice) ? options.dealerChoice : "self";
    this.random = options.random || Math.random;
    this.setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer || ((t) => clearTimeout(t));
    this.onUpdate = options.onUpdate || (() => {});
    this.gameId = options.gameId || "online";
    this.state = null;
    this.lastWin = null;
    this.lastCall = null;
    this.lastExhaustiveOutcome = null;
    this.revealUraDora = false;
    this.roundConfirmations = { east: false, south: false };
    this.rematchVotes = { east: false, south: false };
    this.roundScoreChange = null;
    this._preResultScores = null;
    /** 直前の操作 {seat, type, tsumogiri?}(相手の手出し/ツモ切りの演出に使う) */
    this.lastAction = null;
    /** 配る局面の通し番号(クライアントが古い局面を捨てるため) */
    this.version = 0;
    this._callSeq = 0;
    this._dealPending = false;
    this._timers = { deal: null, decision: null, result: null };
    this._decisionKey = null;
    this.destroyed = false;
  }

  // ---------------- 対局の開始・局の進行 ----------------

  chooseStartingDealer() {
    if (this.dealerChoice === "opponent") return "south";
    if (this.dealerChoice === "random") return this.random() < 0.5 ? "east" : "south";
    return "east";
  }

  /** 新しい対局(最初の対局・再戦)を始める */
  start() {
    const dealer = this.chooseStartingDealer();
    const { wall } = E.buildWall(crypto.randomInt(0, 2 ** 31 - 1));
    const revealed = E.revealNextDoraIndicator(wall);
    const { wall: dealtWall, hands } = E.dealInitialHands(revealed, [dealer, otherSeat(dealer)]);
    this.state = {
      gameId: this.gameId,
      phase: "draw",
      roundWind: "east",
      roundNumber: 1,
      overallRoundIndex: 1,
      roundSerial: 1,
      riichiSticks: 0,
      startingDealer: dealer,
      dealer,
      kanCount: 0,
      fourKanAbortivePending: false,
      wall: dealtWall,
      players: {
        east: Object.assign({}, E.createInitialPlayerState("east", 45000), { hand: hands.east }),
        south: Object.assign({}, E.createInitialPlayerState("south", 45000), { hand: hands.south }),
      },
      currentTurn: dealer,
      lastDiscard: null,
      roundEndReason: null,
      totalRounds: 8,
      startingScore: 45000,
      gameEndReason: null,
    };
    this.lastWin = null;
    this.lastCall = null;
    this.lastExhaustiveOutcome = null;
    this.revealUraDora = false;
    this.roundConfirmations = { east: false, south: false };
    this.rematchVotes = { east: false, south: false };
    this.roundScoreChange = null;
    this._preResultScores = null;
    this.lastAction = null;
    this._afterChange({ newDeal: true });
  }

  /** 結果画面から次の局へ(両者の確認か、一定時間経過で呼ぶ) */
  nextRound() {
    if (!this.state || this.state.phase !== "round_end") return;
    this.roundConfirmations = { east: false, south: false };
    let tenpaiSeats = [];
    if (this.state.roundEndReason && this.state.roundEndReason.type === "exhaustive_draw" && this.lastExhaustiveOutcome) {
      tenpaiSeats = this.lastExhaustiveOutcome.tenpaiSeats;
    }
    const continues = E.determineDealerContinuation(this.state, tenpaiSeats);
    const prevSerial = this.state.roundSerial || 0;
    this.state = Object.assign({}, E.advanceRound(this.state, continues, crypto.randomInt(0, 2 ** 31 - 1)), {
      roundSerial: prevSerial + 1,
    });
    this.revealUraDora = false;
    this.lastWin = null;
    this.lastCall = null;
    this.lastExhaustiveOutcome = null;
    this.lastAction = null;
    this._afterChange({ newDeal: this.state.phase === "draw" });
  }

  // ---------------- 合法手 ----------------

  handWithDraw(seat) {
    const p = this.state.players[seat];
    return p.drawnTile ? p.hand.concat([p.drawnTile]) : p.hand.slice();
  }

  /** 相手の捨て牌に対してロン・ポン・カンができるか(MahjongApp#computeCallOptions と同じ判定) */
  callOptions(seat) {
    const s = this.state;
    const discardTile = s.lastDiscard.tile;
    const player = s.players[seat];
    const context = E.buildWinContext(s, seat, discardTile, false);
    return {
      canRon: E.canDeclareRon(player.hand, player.melds, player.discards.map((d) => d.tile), E.isMissedRonFuriten(player), discardTile, context),
      canPon: E.canDeclarePon(player.hand, discardTile, player.isRiichi, s.wall.liveWall.length, s.fourKanAbortivePending),
      canMinkan: E.canDeclareMinkan(player.hand, discardTile, player.isRiichi, s.wall.liveWall.length, s.kanCount),
    };
  }

  /** ツモ直後に取れる行動(MahjongApp#drawActionOptionsFor と同じ判定) */
  drawOptions(seat) {
    const s = this.state;
    const player = s.players[seat];
    const context = E.buildWinContext(s, seat, player.drawnTile, true);
    return E.getDrawActionOptions(
      this.handWithDraw(seat),
      player.melds,
      player.score,
      s.wall.liveWall.length,
      player.isRiichi,
      player.hand,
      context,
      !!player.forbiddenDiscardKind,
      s.kanCount
    );
  }

  /** いま判断を求められている家と、その種類({seat, kind: "discard"|"call"})。無ければ null */
  pendingDecision() {
    const s = this.state;
    if (!s || this._dealPending) return null;
    if (s.phase === "discard" || s.phase === "kan_replacement") return { seat: s.currentTurn, kind: "discard" };
    if (s.phase === "call_window" && s.lastDiscard) return { seat: otherSeat(s.lastDiscard.from), kind: "call" };
    return null;
  }

  // ---------------- 操作 ----------------

  /**
   * seat の家の操作を検査して適用する。合法でなければ Error を投げる(局面は変わらない)。
   * action: {type: "discard", tileId, riichi} | {type: "tsumo"} | {type: "ankan", kind} | {type: "kakan", kind} |
   *         {type: "ron"} | {type: "pon"} | {type: "minkan"} | {type: "pass"} | {type: "confirm"} | {type: "rematch"}
   */
  apply(seat, action) {
    if (this.destroyed || !this.state) throw new Error("対局が始まっていません。");
    if (!SEATS.includes(seat) || !action || typeof action.type !== "string") throw new Error("不正な操作です。");
    const s = this.state;
    const type = action.type;

    if (type === "confirm") {
      if (s.phase !== "round_end") throw new Error("結果画面ではありません。");
      if (this.roundConfirmations[seat]) return;
      this.roundConfirmations = Object.assign({}, this.roundConfirmations, { [seat]: true });
      if (this.roundConfirmations.east && this.roundConfirmations.south) this.nextRound();
      else this._afterChange();
      return;
    }
    if (type === "rematch") {
      if (s.phase !== "game_end") throw new Error("対局は終わっていません。");
      if (this.rematchVotes[seat]) return;
      this.rematchVotes = Object.assign({}, this.rematchVotes, { [seat]: true });
      if (this.rematchVotes.east && this.rematchVotes.south) this.start();
      else this._afterChange();
      return;
    }

    const decision = this.pendingDecision();
    if (!decision || decision.seat !== seat) throw new Error("今はその操作はできません(相手の手番です)。");

    if (decision.kind === "discard") {
      const player = s.players[seat];
      if (type === "discard") {
        const tile = this.handWithDraw(seat).find((t) => t.id === action.tileId);
        if (!tile) throw new Error("手牌に無い牌は打牌できません。");
        const riichi = !!action.riichi;
        if (riichi && !this.drawOptions(seat).riichiDiscardOptions.some((t) => t.id === tile.id)) {
          throw new Error("その牌ではリーチできません。");
        }
        const tsumogiri = !!player.drawnTile && player.drawnTile.id === tile.id;
        this.state = E.discardTile(s, tile, riichi); // リーチ後の手出し・喰い替えはエンジンが拒否する
        if (riichi) this._setCall(seat, "リーチ");
        this.lastAction = { seat, type: "discard", tsumogiri };
        this._afterChange();
        return;
      }
      if (type === "tsumo") {
        if (!player.drawnTile || !this.drawOptions(seat).canTsumo) throw new Error("ツモ和了できません。");
        const wasRiichi = player.isRiichi;
        this._snapshotPreResultScores();
        const { state, scoreResult, dora } = E.declareTsumo(s, seat);
        this.state = state;
        this.revealUraDora = wasRiichi;
        this.lastWin = { seat, kind: "ツモ和了", scoreResult, dora };
        this.lastAction = { seat, type: "tsumo" };
        this._afterChange();
        return;
      }
      if (type === "ankan" || type === "kakan") {
        const key = action.kind && typeof action.kind === "object" ? safeKindKey(action.kind) : null;
        const opts = this.drawOptions(seat);
        const list = type === "ankan" ? opts.ankanKinds : opts.kakanKinds;
        const kind = key && list.find((k) => kindKey(k) === key);
        if (!kind) throw new Error("そのカンはできません。");
        this.state = type === "ankan" ? E.performAnkan(s, kind) : E.performKakan(s, kind);
        this._setCall(seat, "カン");
        this.lastAction = { seat, type };
        this._afterChange();
        return;
      }
      throw new Error("今はその操作はできません。");
    }

    // 相手の捨て牌に対する判断
    const discard = s.lastDiscard;
    const opts = this.callOptions(seat);
    if (type === "ron") {
      if (!opts.canRon) throw new Error("ロンできません。");
      const wasRiichi = s.players[seat].isRiichi;
      this._snapshotPreResultScores();
      const { state, scoreResult, dora } = E.declareRon(s, seat, discard.tile);
      this.state = state;
      this.revealUraDora = wasRiichi;
      this.lastWin = { seat, kind: "ロン和了", scoreResult, dora };
      this.lastAction = { seat, type: "ron" };
      this._afterChange();
      return;
    }
    if (type === "pon" || type === "minkan") {
      if (type === "pon" ? !opts.canPon : !opts.canMinkan) throw new Error(type === "pon" ? "ポンできません。" : "カンできません。");
      const key = kindKey(discard.tile.kind);
      const matches = s.players[seat].hand.filter((t) => kindKey(t.kind) === key);
      if (type === "pon") {
        const wasFourKanPending = s.fourKanAbortivePending;
        this.state = E.callPon(s, seat, [matches[0], matches[1]]);
        if (!wasFourKanPending) this._setCall(seat, "ポン");
      } else {
        this.state = E.performMinkan(s, seat, [matches[0], matches[1], matches[2]]);
        this._setCall(seat, "カン");
      }
      this.lastAction = { seat, type };
      this._afterChange();
      return;
    }
    if (type === "pass") {
      if (opts.canRon) this.state = E.markMissedRon(this.state, seat);
      this.state = E.passDiscard(this.state);
      this.lastAction = { seat, type: "pass" };
      this._afterChange();
      return;
    }
    throw new Error("今はその操作はできません。");
  }

  _setCall(seat, kind) {
    this._callSeq += 1;
    this.lastCall = { seat, kind, seq: this._callSeq };
  }

  _snapshotPreResultScores() {
    this._preResultScores = { east: this.state.players.east.score, south: this.state.players.south.score };
    this.roundScoreChange = null;
  }

  /** 人の判断が要らない進行(ツモ・鳴けない捨て牌の見送り・流局)を進める(MahjongApp#autoAdvance と同じ) */
  _autoAdvance() {
    while (this.state && !this._dealPending) {
      const s = this.state;
      if (s.phase === "draw") {
        if (s.wall.liveWall.length === 0) {
          this._snapshotPreResultScores();
          const outcome = E.resolveExhaustiveDraw(s);
          this.state = outcome.state;
          // 画面に要るのは聴牌者・流し役満だけ(局面そのものは state として別に配る)
          this.lastExhaustiveOutcome = Object.assign({}, outcome, { state: undefined });
          delete this.lastExhaustiveOutcome.state;
          break;
        }
        this.state = E.drawTile(s);
        continue;
      }
      if (s.phase === "call_window") {
        const { canRon, canPon, canMinkan } = this.callOptions(otherSeat(s.lastDiscard.from));
        if (canRon || canPon || canMinkan) break;
        this.state = E.passDiscard(s);
        continue;
      }
      break;
    }
  }

  /** 結果画面での点数の増減(MahjongApp#trackRoundScoreChange と同じ) */
  _trackRoundScoreChange() {
    const s = this.state;
    const scores = { east: s.players.east.score, south: s.players.south.score };
    if (s.phase !== "round_end" && s.phase !== "game_end") {
      this._preResultScores = scores;
      this.roundScoreChange = null;
      return;
    }
    if (!this.roundScoreChange && this._preResultScores) {
      this.roundScoreChange = { east: scores.east - this._preResultScores.east, south: scores.south - this._preResultScores.south };
    }
  }

  /** 局面が変わった後の共通処理: 自動進行・タイマーの張り直し・版数の更新 */
  _afterChange({ newDeal = false } = {}) {
    if (newDeal) {
      // 配牌の演出の間は最初のツモを待つ(クライアントは配牌直後の局面を見て演出を始める)
      this._dealPending = true;
      this._clearTimer("deal");
      this._timers.deal = this.setTimer(() => {
        this._timers.deal = null;
        if (this.destroyed) return;
        this._dealPending = false;
        this._afterChange();
        this.onUpdate();
      }, DEAL_ANIMATION_MS);
    }
    this._autoAdvance();
    this._trackRoundScoreChange();
    this.version += 1;
    this._syncTimers();
  }

  // ---------------- 時間切れ・結果画面の自動送り ----------------

  _clearTimer(name) {
    if (this._timers[name]) this.clearTimer(this._timers[name]);
    this._timers[name] = null;
  }

  _syncTimers() {
    const s = this.state;
    // 結果画面: 両者が確認しなくても一定時間で次の局へ
    if (s.phase === "round_end") {
      if (!this._timers.result) {
        this._timers.result = this.setTimer(() => {
          this._timers.result = null;
          if (this.destroyed || !this.state || this.state.phase !== "round_end") return;
          this.nextRound();
          this.onUpdate();
        }, RESULT_AUTO_ADVANCE_MS);
      }
    } else {
      this._clearTimer("result");
    }
    // 判断待ち: 持ち時間を大きく過ぎても操作が届かなければ、サーバーが代わりに進める
    // (改造したクライアントが操作を送らずに対局を止め続けられないように)。通常はクライアント側の
    // 持ち時間の処理が先に操作を送ってくるので、これが働くのは操作が届かない場合だけ。
    const d = this.pendingDecision();
    if (!d) {
      this._clearTimer("decision");
      this._decisionKey = null;
      return;
    }
    const sameDecision =
      this._decisionKey && this._decisionKey.seat === d.seat && this._decisionKey.kind === d.kind && this._decisionKey.round === s.roundSerial && this._decisionKey.turn === this._turnMarker();
    if (sameDecision) return;
    this._clearTimer("decision");
    this._decisionKey = { seat: d.seat, kind: d.kind, round: s.roundSerial, turn: this._turnMarker() };
    const tc = this.timeControl;
    const ms = tc ? (tc.perAction + tc.bank) * 1000 + TIMEOUT_GRACE_MS : MAX_DECISION_MS;
    this._timers.decision = this.setTimer(() => {
      this._timers.decision = null;
      if (this.destroyed) return;
      this.forceTimeout();
      this.onUpdate();
    }, ms);
  }

  /** 判断の区切り(打牌・鳴きの回数と手番)。同じ判断の間はタイマーを張り直さない */
  _turnMarker() {
    const s = this.state;
    const p = (seat) => `${s.players[seat].discards.length}/${s.players[seat].melds.length}/${s.players[seat].drawnTile ? 1 : 0}`;
    return `${s.phase}:${s.currentTurn}:${p("east")}:${p("south")}`;
  }

  /** 時間切れ: 和了できれば和了、できなければツモ切り(ツモ牌が無ければ切れる牌)・見送り(クライアントの時間切れと同じ) */
  forceTimeout() {
    const d = this.pendingDecision();
    if (!d) return;
    try {
      if (d.kind === "call") {
        this.apply(d.seat, { type: this.callOptions(d.seat).canRon ? "ron" : "pass" });
        return;
      }
      const player = this.state.players[d.seat];
      if (player.drawnTile && this.drawOptions(d.seat).canTsumo) {
        this.apply(d.seat, { type: "tsumo" });
        return;
      }
      let tile = player.drawnTile;
      if (!tile) {
        const forbidden = player.forbiddenDiscardKind ? kindKey(player.forbiddenDiscardKind) : null;
        tile = player.hand.slice().reverse().find((t) => kindKey(t.kind) !== forbidden) || player.hand[player.hand.length - 1];
      }
      this.apply(d.seat, { type: "discard", tileId: tile.id, riichi: false });
    } catch (e) {
      /* 念のため(進められなければ何もしない) */
    }
  }

  // ---------------- 配信する局面 ----------------

  /**
   * seat の家に配る対局データ(seat が null なら観戦者向け)。相手の手牌(局の途中)・牌山・
   * まだめくっていないドラ表示牌・嶺上牌・裏ドラ(公開前)は、中身の無い伏せ牌にする。
   * 牌のIDも牌の種類を含むため、伏せ牌には意味の無いIDを付ける。
   */
  viewFor(seat) {
    const s = this.state;
    if (!s) return null;
    const inResult = s.phase === "round_end" || s.phase === "game_end";
    const hidden = (prefix) => (_, i) => ({ id: `${prefix}${i}`, kind: null, isRedDora: false });
    const hideList = (list, prefix) => list.map(hidden(prefix));
    const wall = {
      liveWall: hideList(s.wall.liveWall, "w"),
      doraIndicatorTiles: hideList(s.wall.doraIndicatorTiles, "d"),
      revealedDoraIndicators: s.wall.revealedDoraIndicators,
      uraDoraIndicatorTiles: inResult && this.revealUraDora ? s.wall.uraDoraIndicatorTiles : hideList(s.wall.uraDoraIndicatorTiles, "u"),
      deadWallDraws: hideList(s.wall.deadWallDraws, "r"),
    };
    const players = {};
    for (const p of SEATS) {
      const pl = s.players[p];
      const hideHand = seat !== null && p !== seat && !inResult;
      players[p] = hideHand
        ? Object.assign({}, pl, {
            hand: hideList(pl.hand, "h"),
            drawnTile: pl.drawnTile ? { id: "hd", kind: null, isRedDora: false } : null,
            isTemporaryFuriten: false,
            isRiichiMissedFuriten: false,
          })
        : pl;
    }
    return {
      state: Object.assign({}, s, { wall, players }),
      lastWin: this.lastWin,
      lastCall: this.lastCall,
      revealUraDora: this.revealUraDora,
      lastExhaustiveOutcome: this.lastExhaustiveOutcome,
      roundConfirmations: this.roundConfirmations,
      roundScoreChange: this.roundScoreChange,
      rematchVotes: this.rematchVotes,
      timeControl: this.timeControl,
      dealerChoice: this.dealerChoice,
      lastAction: this.lastAction,
      version: this.version,
      serverAuthoritative: true,
      log: [],
    };
  }

  /** 観戦一覧用の要約 */
  summary() {
    const s = this.state;
    if (!s) return null;
    return {
      roundWind: s.roundWind,
      roundNumber: s.roundNumber,
      scores: { east: s.players.east.score, south: s.players.south.score },
      ended: s.phase === "game_end",
    };
  }

  destroy() {
    this.destroyed = true;
    for (const name of Object.keys(this._timers)) this._clearTimer(name);
  }
}

/** クライアントから届いた牌の種類を検査してキーにする(不正なら null) */
function safeKindKey(kind) {
  try {
    if (kind.kind === "honor" && ["east", "south", "west", "north", "white", "green", "red"].includes(kind.honor)) return kindKey(kind);
    if (kind.kind === "number" && ["man", "pin", "sou"].includes(kind.suit) && Number.isInteger(kind.rank)) return kindKey(kind);
  } catch (e) {
    /* ignore */
  }
  return null;
}

module.exports = { GameSession, normalizeTimeControl, DEAL_ANIMATION_MS, RESULT_AUTO_ADVANCE_MS };
