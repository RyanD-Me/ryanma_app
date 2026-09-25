"use strict";

/* global MahjongApp, MahjongEngine */

/**
 * オンライン対戦の画面(サーバー主導)。
 *
 * 対局はサーバーが進める(server/gameSession.js)。この画面は、サーバーから届く対局データ
 * (`game`: その家が見てよい情報だけの局面 + 和了表示などの付随情報)を表示し、打牌・鳴き・和了・
 * 結果画面の確認などの操作を `action` としてサーバーへ送るだけ。局面を自分で進めたり、相手へ
 * 局面を送ったりはしない。相手の手牌・牌山はサーバーから中身の無い伏せ牌として届くため、
 * ページを書き換えても見えず、合法でない操作はサーバーが受け付けない。
 *
 * `roomController`(ws.js の WsRoomController)に求めるもの:
 *   - .latest: 直近の room ドキュメント相当のオブジェクト({seats, names, game})
 *   - .onUpdate / .onError / .onConnectionChange / .onReconnected / .onPeerLeft / .onFatal: コールバック
 *   - .sendAction(action): 操作をサーバーへ送る(送れなければ false)
 *   - .stop(): 接続を終了する
 *   - .code: ルームコード
 *   - .room: { presence, peers, onPeers }(相手が「今つながっているか」の表示用)
 */

const OnlineEngine = MahjongEngine;

/** 時間の表示(例: 180000 → 「3分」、95000 → 「1分35秒」、20000 → 「20秒」) */
function formatDuration(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m === 0) return `${sec}秒`;
  return sec === 0 ? `${m}分` : `${m}分${sec}秒`;
}

class OnlineMahjongApp extends MahjongApp {
  /**
   * @param {HTMLElement} root
   * @param {{roomController: object, mySeat: "east"|"south", onExit?: Function,
   *   dealerChoice?: "self"|"opponent"|"random"}} opts
   *   timeControl・dealerChoice はルーム作成時の設定(待機画面の表示用。実際の値はサーバーから届く)
   */
  constructor(root, { roomController, mySeat, onExit, timeControl, isMatch, dealerChoice }) {
    super(root, { autoStart: false, onExit, timeControl });
    this.roomController = roomController;
    this.mySeat = mySeat;
    this.dealerChoice = ["self", "opponent", "random"].includes(dealerChoice) ? dealerChoice : "self";
    /** 最後に反映した対局データの版(古いデータが後から届いても使わない) */
    this._version = -1;
    /** 操作を送って、その結果(新しい版)が届くのを待っている間は、同じ局面で二重に送らない */
    this._awaitingVersion = null;
    this.onExit = onExit;
    /** 自動マッチングで組まれた対局か(ルームコードは内部用なので待機画面に出さない) */
    this.isMatch = !!isMatch;
    // 相手は本物の対戦相手なので、「相手の手牌を表示(確認用)」トグルは出さない。
    this.allowPeekToggle = false;
    this.opponentOnline = false;
    this._peersUnsubscribe = null;
    // ルーム入室時に入力されたプレイヤー名。相手からまだ届いていない間の初期値として、
    // ロビー側のデフォルト名(Player1/Player2)と同じ規則にしておく。
    this.playerNames = { east: "Player1", south: "Player2" };

    /** 牌譜の記録(kifu.js)。観戦画面では mode が "spectate" になる */
    this.kifuRecorder =
      typeof KifuRecorder === "function" ? new KifuRecorder({ mode: this.kifuMode(), roomCode: roomController.code || null }) : null;

    /** 対局を続けられなくなった理由(相手の退出・再接続の失敗)。null なら続行中 */
    this.connectionEndedMessage = null;

    roomController.onUpdate = (doc) => this._onRoomDoc(doc);
    roomController.onActionRejected = () => this._onActionRejected();
    roomController.onError = (err) => {
      this.addLog(`通信エラーが発生しました(${(err && (err.message || err.code)) || err})。`);
      this._refresh();
    };
    // 接続状態(自分の再接続中/相手の切断)が変わったら表示を更新する
    roomController.onConnectionChange = () => this._refresh();
    // 再接続できたら、サーバーが保持していた最新の対局データに合わせる
    // (切断中に相手が進めた分を取り込み、自分の側で送れなかった進行は破棄してやり直す)。
    roomController.onReconnected = (doc) => this._onReconnected(doc);
    roomController.onPeerLeft = (reason) => {
      this.connectionEndedMessage =
        reason === "timeout"
          ? "対戦相手が時間内に再接続しなかったため、対局を終了しました。"
          : "対戦相手が退室しました。";
      this._refresh();
    };
    roomController.onFatal = (message) => {
      this.connectionEndedMessage = message;
      this._refresh();
    };

    this._setupPresence();

    if (roomController.latest) {
      this._onRoomDoc(roomController.latest);
    } else {
      this._renderWaitingScreen();
    }
  }

  _setupPresence() {
    const room = this.roomController.room;
    if (!room) return;
    room.presence({ seat: this.mySeat }).catch(() => {});
    const updateFromPeers = () => {
      const opponentSeat = this.opponentSeat();
      this.opponentOnline = room
        .peers()
        .some((p) => !p.isMe && p.presence && p.presence.seat === opponentSeat);
    };
    updateFromPeers();
    this._peersUnsubscribe = room.onPeers(() => {
      updateFromPeers();
      // 対局がまだ始まっていない(this.state が未設定の)段階でも presence の変化通知は
      // 届き得る。その場合に render() を呼ぶと autoAdvance() が this.state.phase を
      // 読もうとしてクラッシュするため、対局開始前は待機画面の再描画にとどめる。
      if (this.state) {
        this.render();
      } else {
        this._renderWaitingScreen();
      }
    });
  }

  /** 牌譜の種類 */
  kifuMode() {
    return "online";
  }

  destroy() {
    this._destroyed = true;
    if (this.kifuRecorder) this.kifuRecorder.stop();
    this.clearResultTimers();
    this.stopTurnTimer();
    for (const key of ["_autoTsumogiriTimer", "_autoWinTimer", "_winBannerTimer", "_callBannerTimer", "_exhaustiveDrawTimer"]) {
      if (this[key]) {
        clearTimeout(this[key]);
        this[key] = null;
      }
    }
    if (this._peersUnsubscribe) this._peersUnsubscribe();
  }

  // ---- MahjongApp のフックのオーバーライド ----

  selfSeat() {
    return this.mySeat;
  }

  opponentSeat() {
    return OnlineEngine.otherSeat(this.mySeat);
  }

  hiddenSeatFor() {
    // 同一画面ホットシートと違い、常に「本物の対戦相手」の手牌だけを伏せる。
    return OnlineEngine.otherSeat(this.mySeat);
  }

  /** 得点表示などに使うプレイヤー名。ルームコントローラから届いた実際の名前を返す。 */
  playerName(seat) {
    return (this.playerNames && this.playerNames[seat]) || (seat === "east" ? "Player1" : "Player2");
  }

  canAct(kind, seat) {
    // 再接続中・対局終了後は操作しない。ツモ・見送りの自動進行・次局送り・新しい対局の開始は
    // サーバーが行うので、この画面では行わない。
    if (!this._isConnected() || this.connectionEndedMessage) return false;
    if (kind === "nextRound" || kind === "newGame" || kind === "autoAdvance") return false;
    return seat === this.mySeat;
  }

  /** 状態の反映は、サーバーから届いた時だけ行う(自分では局面を進めない) */
  publish() {
    this.armedTileId = null;
    this.render();
  }

  // ---- 操作はサーバーへ送るだけ(結果はサーバーから届く局面で反映する) ----

  /** 操作をサーバーへ送る。同じ局面で二重に送らない */
  _sendAction(action) {
    if (!this._isConnected() || this.connectionEndedMessage) return;
    if (this._awaitingVersion === this._version) return;
    const sent = this.roomController.sendAction(action);
    if (sent === false) return;
    this._awaitingVersion = this._version;
    this.armedTileId = null;
  }

  doDiscard(tile) {
    const riichi = !!this.pendingRiichi;
    this.pendingRiichi = false;
    this._sendAction({ type: "discard", tileId: tile.id, riichi });
    this.render();
  }

  doTsumo() {
    this._sendAction({ type: "tsumo" });
  }

  doRon() {
    this._sendAction({ type: "ron" });
  }

  doPass() {
    this._sendAction({ type: "pass" });
  }

  doPon() {
    this._sendAction({ type: "pon" });
  }

  doMinkan() {
    this._sendAction({ type: "minkan" });
  }

  doAnkan(kind) {
    this._sendAction({ type: "ankan", kind });
  }

  doKakan(kind) {
    this._sendAction({ type: "kakan", kind });
  }

  confirmRound(seat) {
    if (!this.state || this.state.phase !== "round_end" || this.roundConfirmations[seat]) return;
    // 押したことはすぐ画面に出す(サーバーからの確認済みの反映を待たない)
    this.roundConfirmations = Object.assign({}, this.roundConfirmations, { [seat]: true });
    this.roomController.sendAction({ type: "confirm" });
    this.render();
  }

  voteRematch(seat) {
    if (!this.state || this.state.phase !== "game_end" || this.rematchVotes[seat]) return;
    this.rematchVotes = Object.assign({}, this.rematchVotes, { [seat]: true });
    this.roomController.sendAction({ type: "rematch" });
    this.render();
  }

  /** 操作が受け付けられなかった(タイミングのずれなど)。最新の局面がすぐ届くので、送れる状態に戻す */
  _onActionRejected() {
    this._awaitingVersion = null;
  }

  /**
   * oldState → newState の差分が「相手がちょうど1回、手出し(ツモ切りでない打牌)を
   * 行った」という変化かどうかを調べる。手出しを相手視点にヒントする一瞬の空白演出
   * (app.js の doDiscard 参照)を、受信側(この関数の呼び出し元)でも再生するために使う。
   * それ以外の変化(ツモ・ツモ切り・ポン・カン・和了・流局・次局送りや、複数手番分が
   * まとめて届いた場合など)は null を返し、呼び出し側は即座に反映する。
   *
   * @returns {null | {seat: "east"|"south", oldHandLength: number}}
   */
  detectTedashiDiscard(oldState, newState, lastAction) {
    if (!oldState || !newState || !lastAction || lastAction.type !== "discard" || lastAction.tsumogiri) return null;
    const seat = lastAction.seat;
    if (seat !== this.hiddenSeatFor()) return null;
    const op = oldState.players[seat];
    const np = newState.players[seat];
    if (!op || !np || np.discards.length !== op.discards.length + 1) return null;
    // 相手の手牌は伏せ牌で届くので、手出しかどうかはサーバーが付けた lastAction で判断する
    return { seat, oldHandLength: op.hand.length };
  }

  _onRoomDoc(doc) {
    if (doc.names) this.playerNames = doc.names;
    if (!doc.game) {
      // 対局はサーバーが始める。届くまでは待機画面
      if (!this.state) this._renderWaitingScreen(doc);
      return;
    }
    const g = doc.game;
    // 形の正しくないデータは使わない(画面を壊されないように)
    if (!isValidGamePayload(g)) {
      if (!this._invalidNoticeShown) {
        this._invalidNoticeShown = true;
        this.addLog("正しくない対局データが届いたため、無視しました。");
      }
      return;
    }
    // 古い対局データ(再接続の前後で順番が入れ替わった等)は使わない
    const version = Number.isInteger(g.version) ? g.version : this._version + 1;
    if (version < this._version) return;
    this._version = version;
    this._awaitingVersion = null;
    const oldState = this.state;
    const newState = g.state;

    const applyAll = () => {
      this.state = newState;
      // 結果画面の点数の増減は、結果を確定させた側が計算したものに合わせる
      // (途中の局面をまとめて受け取った場合でも、正しい「直前の点数」との差になるように)。
      const inResult = newState.phase === "round_end" || newState.phase === "game_end";
      if (!inResult) {
        this._preResultScores = { east: newState.players.east.score, south: newState.players.south.score };
        this.roundScoreChange = null;
      } else if (g.roundScoreChange) {
        this.roundScoreChange = g.roundScoreChange;
      }
      // 結果画面の間も(相手の「確認」などで)同じ和了内容が何度も届くため、内容が変わった時だけ
      // 反映する。毎回反映するとツモ/ロンの大きい文字の表示タイマーが最初からやり直しになり、
      // 消えたはずの文字が再表示されてしまう。
      const incomingWin = g.lastWin || null;
      if (JSON.stringify(incomingWin) !== JSON.stringify(this.lastWin)) this.setLastWin(incomingWin);
      // 同じポン/カン/リーチを何度も表示し直さないよう、通し番号が変わった時だけ反映する。
      const incomingCall = g.lastCall || null;
      const incomingSeq = incomingCall ? incomingCall.seq : null;
      const currentSeq = this.lastCall ? this.lastCall.seq : null;
      if (incomingSeq !== currentSeq) this.setLastCall(incomingCall);
      this.revealUraDora = !!g.revealUraDora;
      // 持ち時間・起家の決め方はサーバーが持つ設定に合わせる
      if (g.timeControl !== undefined) this.timeControl = g.timeControl;
      if (g.dealerChoice !== undefined) this.dealerChoice = g.dealerChoice;
      // 結果画面の間、同じ流局結果が何度も届いても再表示タイマーをやり直さないよう、
      // lastWin と同様に内容が変わった時だけ反映する。
      const incomingExhaustive = g.lastExhaustiveOutcome || null;
      if (JSON.stringify(incomingExhaustive) !== JSON.stringify(this.lastExhaustiveOutcome)) {
        this.setExhaustiveDrawOutcome(incomingExhaustive);
      }
      this.log = g.log || [];
      // 結果画面の確認・再戦の希望はサーバーが持つ(自分が押した分は、届くまで押した表示のまま)
      const incomingConf = g.roundConfirmations || { east: false, south: false };
      const keepMine = newState.phase === "round_end" && oldState && oldState.phase === "round_end";
      const mine = keepMine ? this.roundConfirmations || {} : {};
      this.roundConfirmations = { east: !!(incomingConf.east || mine.east), south: !!(incomingConf.south || mine.south) };
      const incomingVotes = g.rematchVotes || { east: false, south: false };
      const keepVotes = newState.phase === "game_end" && oldState && oldState.phase === "game_end";
      const mineV = keepVotes ? this.rematchVotes || {} : {};
      this.rematchVotes = { east: !!(incomingVotes.east || mineV.east), south: !!(incomingVotes.south || mineV.south) };
      if (this._destroyed) return;
      this.render();
    };

    // 相手がちょうど1回、手出しを行ったという変化であれば、この受信側でも
    // 「相手視点にヒントする一瞬の空白」を再生してから、実際の新しい状態を反映する。
    const tedashi = this._tedashiTimer ? null : this.detectTedashiDiscard(oldState, newState, g.lastAction);
    if (tedashi) {
      this._tedashiGap = { seat: tedashi.seat, index: Math.floor(Math.random() * tedashi.oldHandLength) };
      this.render();
      this._tedashiTimer = setTimeout(() => {
        this._tedashiTimer = null;
        this._tedashiGap = null;
        applyAll();
      }, TEDASHI_GAP_MS);
      return;
    }

    applyAll();
  }

  /** 自分がサーバーに接続できているか(再接続中は操作・自動進行をすべて止める) */
  _isConnected() {
    const rc = this.roomController;
    return !rc || typeof rc.isConnected !== "function" || rc.isConnected();
  }

  /** 状態に応じて対局画面か待機画面を描き直す */
  _refresh() {
    if (this._destroyed) return;
    if (this.state) this.render();
    else this._renderWaitingScreen();
  }

  /** 再接続に成功したとき: サーバーの最新データを正として取り込む */
  _onReconnected(doc) {
    if (this._destroyed) return;
    if (doc.names) this.playerNames = doc.names;
    // 送った操作の結果を待っていた場合も、サーバーの最新の局面に合わせ直す
    this._awaitingVersion = null;
    if (doc.game) {
      // 手出しの空白演出の途中なら打ち切ってから反映する
      if (this._tedashiTimer) {
        clearTimeout(this._tedashiTimer);
        this._tedashiTimer = null;
        this._tedashiGap = null;
      }
    }
    this._onRoomDoc(doc);
  }

  render() {
    super.render();
    this._renderSpectatorBadge();
    this._renderConnectionOverlay();
    // 退室の確認ダイアログは接続状態の表示より前面に出す
    this.appendExitConfirm();
  }

  /** 観戦者がいれば、卓の左上に「観戦 n人」と小さく表示する */
  _renderSpectatorBadge() {
    const count = (this.roomController && this.roomController.spectatorCount) || 0;
    const text = this.spectatorBadgeText(count);
    if (!text) return;
    const badge = document.createElement("div");
    badge.className = "spectator-badge";
    badge.textContent = text;
    this.root.appendChild(badge);
  }

  spectatorBadgeText(count) {
    return count > 0 ? `観戦 ${count}人` : "";
  }

  exitConfirmNote() {
    return "退室すると対局は終了し、対戦相手にも退室したことが伝わります。";
  }

  /** 退室: サーバーに leave を送って(相手に通知・ルーム破棄)からロビーへ戻る */
  exitGame() {
    this.confirmingExit = false;
    this.destroy();
    this.roomController.stop();
    if (this.onExit) this.onExit();
  }

  /**
   * 接続状態の表示。
   * - 自分が再接続中: 画面全体を覆って操作できないようにする(送れない操作で相手とずれないように)
   * - 相手が切断中: 卓の上部に小さく「再接続待ち」を出す(自分の手番の操作は続けられる)
   * - 対局終了(相手の退出・再接続失敗): 理由とロビーへ戻るボタン
   */
  _renderConnectionOverlay() {
    const rc = this.roomController;
    if (this.connectionEndedMessage) {
      this.root.appendChild(this._connectionPanel(this.connectionEndedMessage, true));
      return;
    }
    if (rc && rc.status === "reconnecting") {
      const tries = rc.reconnectAttempts > 0 ? `(${rc.reconnectAttempts}回目)` : "";
      this.root.appendChild(
        this._connectionPanel(`サーバーとの接続が切れました。再接続しています…${tries}`, false)
      );
      return;
    }
    if (this.state && !this.opponentOnline) {
      const banner = document.createElement("div");
      banner.className = "connection-banner";
      banner.textContent = "対戦相手の接続が切れています。再接続を待っています…";
      this.root.appendChild(banner);
    }
  }

  _connectionPanel(message, ended) {
    const overlay = document.createElement("div");
    overlay.className = "connection-overlay";
    const box = document.createElement("div");
    box.className = "connection-overlay-box";
    const p = document.createElement("p");
    p.textContent = message;
    box.appendChild(p);
    if (!ended) {
      const spinner = document.createElement("div");
      spinner.className = "connection-spinner";
      box.appendChild(spinner);
    }
    if (this.onExit) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn";
      btn.textContent = ended ? "ロビーに戻る" : "退室";
      btn.addEventListener("click", () => {
        if (ended) {
          this.exitGame();
        } else {
          // 再接続中の退室も、押し間違い防止のため確認を挟む
          this.confirmingExit = true;
          this._refresh();
        }
      });
      box.appendChild(btn);
    }
    overlay.appendChild(box);
    return overlay;
  }

  _renderWaitingScreen() {
    this.root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "lobby-waiting";

    if (this.roomController.code && !this.isMatch) {
      const label = document.createElement("p");
      label.textContent = "ルームコード";
      wrap.appendChild(label);

      const code = document.createElement("div");
      code.className = "lobby-room-code";
      code.textContent = this.roomController.code;
      wrap.appendChild(code);

      const hint = document.createElement("p");
      hint.textContent = "このコードを対戦相手に伝えてください。相手が参加すると自動的に対局が始まります。";
      wrap.appendChild(hint);
      if (this.mySeat === "east") {
        // ルームの作成者(east 席)にだけ、自分で決めた設定を表示する
        const tc = document.createElement("p");
        tc.className = "lobby-peer-status";
        tc.textContent = `持ち時間: ${timeControlLabel(this.timeControl)}`;
        wrap.appendChild(tc);
        const dc = document.createElement("p");
        dc.className = "lobby-peer-status";
        dc.textContent = `起家: ${{ self: "自分", opponent: "相手", random: "ランダム" }[this.dealerChoice]}`;
        wrap.appendChild(dc);
      }
    } else {
      const hint = document.createElement("p");
      hint.textContent = this.isMatch ? "対戦相手が見つかりました。対局を準備しています…" : "対戦相手との接続を待っています…";
      wrap.appendChild(hint);
    }

    const status = document.createElement("p");
    status.className = "lobby-peer-status " + (this.opponentOnline ? "online" : "offline");
    status.textContent = this.opponentOnline ? "対戦相手: 接続中" : "対戦相手の参加を待っています…";
    // 自動マッチングでは相手はすでに見つかっているので「参加を待っています」は出さない
    if (!this.isMatch) wrap.appendChild(status);
    if (this.roomController.status === "reconnecting") {
      const rc = document.createElement("p");
      rc.className = "lobby-error";
      rc.textContent = "サーバーとの接続が切れました。再接続しています…";
      wrap.appendChild(rc);
    }
    if (this.connectionEndedMessage) {
      const endP = document.createElement("p");
      endP.className = "lobby-error";
      endP.textContent = this.connectionEndedMessage;
      wrap.appendChild(endP);
    }

    if (this.onExit) {
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "btn";
      backBtn.textContent = "やめる";
      backBtn.addEventListener("click", () => {
        this.destroy();
        this.roomController.stop();
        this.onExit();
      });
      wrap.appendChild(backBtn);
    }

    this.root.appendChild(wrap);
  }
}

/**
 * 観戦用の画面。対局者から中継される対局データ(OnlineMahjongApp と同じ形)を受け取って
 * 表示するだけで、操作・自動進行・送信は一切行わない。両者の手牌を公開して表示する
 * (自分の画面側=下側に東家、上側に南家)。
 */
class SpectatorMahjongApp extends OnlineMahjongApp {
  constructor(root, { roomController, onExit }) {
    super(root, { roomController, mySeat: "east", onExit, isMatch: false });
    this.isSpectator = true;
  }

  kifuMode() {
    return "spectate";
  }

  // 観戦者は何も操作しない(打牌・鳴き・次局送り・自動進行・持ち時間の計測もしない)
  canAct() {
    return false;
  }

  // 両者の手牌を公開する
  hiddenSeatFor() {
    return null;
  }

  // 手出しの「一瞬の空白」演出は、伏せた手牌で手出しを示すためのもの。手牌が見えている
  // 観戦では不要(公開した手牌に空白が出ると紛らわしい)。
  detectTedashiDiscard() {
    return null;
  }

  // 「自動理牌」「鳴き無し」などの設定は観戦には関係ないので出さない(退室ボタンだけ残る)
  renderToggles() {
    const toggles = document.createElement("div");
    toggles.className = "toggle-row";
    return toggles;
  }

  // 観戦は確認なしですぐやめられる
  renderExitButton() {
    // 横向きは右列が狭く、音のボタンと並ぶと2行に折り返してしまうため短い表記にする
    const exitBtn = this.button(this._landscape ? "観戦終了" : "観戦をやめる", () => this.exitGame());
    exitBtn.classList.add("exit-btn");
    return exitBtn;
  }

  gameEndExitLabel() {
    return "観戦をやめる";
  }

  // 結果画面の「相手: 確認待ち」などは対局者向けの表示なので出さない
  waitingHint(text) {
    if (typeof text === "string" && text.startsWith("相手")) return document.createElement("span");
    return super.waitingHint(text);
  }

  spectatorBadgeText(count) {
    const delay = this._delayLabel();
    return count > 0 ? `観戦中${delay}(${count}人)` : `観戦中${delay}`;
  }

  /** 観戦の遅れの表示(例: 「・3分遅れ」)。遅れが無ければ空 */
  _delayLabel() {
    const ms = (this.roomController && this.roomController.delayMs) || 0;
    return ms > 0 ? `・${formatDuration(ms)}遅れ` : "";
  }

  render() {
    super.render();
    this._enableViewSwitch();
  }

  /**
   * 上側(向かい側)の手牌を押すと、そのプレイヤーが下側に来るよう視点を切り替える。
   * 観戦者の mySeat は「下側に表示する家」としてだけ使っている(操作・送信の判定は
   * すべて上書き済み)ので、これを入れ替えて描き直せばよい。
   */
  _enableViewSwitch() {
    if (!this.state) return;
    const row = this.root.querySelector(".hand-row-opponent");
    if (!row) return;
    row.classList.add("spectator-view-switch");
    row.title = `タップで${this.playerName(this.opponentSeat())}の視点に切り替え`;
    row.addEventListener("click", () => {
      if (this._destroyed) return;
      this.mySeat = this.opponentSeat();
      this.render();
    });
  }

  _renderConnectionOverlay() {
    const rc = this.roomController;
    if (this.connectionEndedMessage) {
      this.root.appendChild(this._connectionPanel(this.connectionEndedMessage, true));
      return;
    }
    if (rc && rc.status === "reconnecting") {
      const banner = document.createElement("div");
      banner.className = "connection-banner";
      banner.textContent = "サーバーとの接続が切れました。再接続しています…";
      this.root.appendChild(banner);
    }
  }

  _renderWaitingScreen() {
    this.root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "lobby-waiting";
    const p = document.createElement("p");
    p.textContent = this.connectionEndedMessage || "観戦の準備をしています…";
    wrap.appendChild(p);
    // 観戦は3分遅れで届くため、対局開始から3分経つまでは表示が始まらない。残り時間を知らせる
    const rc = this.roomController;
    if (!this.connectionEndedMessage && rc && rc.delayMs > 0 && rc.startsAt) {
      const hint = document.createElement("p");
      hint.className = "lobby-peer-status";
      const update = () => {
        const rest = Math.max(0, rc.startsAt - Date.now());
        const delay = formatDuration(rc.delayMs);
        hint.textContent =
          rest >= 1000
            ? `観戦は${delay}遅れで表示されます。あと約${formatDuration(rest)}で表示が始まります。`
            : `観戦は${delay}遅れで表示されます。まもなく表示が始まります。`;
      };
      update();
      wrap.appendChild(hint);
      clearInterval(this._waitCountdown);
      this._waitCountdown = setInterval(() => {
        if (this._destroyed || this.state || !hint.isConnected) {
          clearInterval(this._waitCountdown);
          return;
        }
        update();
      }, 1000);
    }
    if (this.onExit) wrap.appendChild(this.button("ロビーに戻る", () => this.exitGame()));
    this.root.appendChild(wrap);
  }
}
