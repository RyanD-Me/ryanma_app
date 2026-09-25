"use strict";

/* global MahjongApp, MahjongEngine */

/**
 * オンライン対戦の共通コントローラ(通信方式に依存しない部分)。
 *
 * 対局の「真実」は、通信方式(Claude Artifactの`db` capabilityでも、WebRTCのデータ
 * チャネルでも)を問わず、既存のローカル対戦(ホットシート)版 MahjongApp が使っているのと
 * 全く同じ形の `state` オブジェクト(牌山・両者の手牌を含む)に、
 * lastWin・ログなど画面表示に必要な付随情報を足した1つの `game` オブジェクトとして
 * やり取りする。
 *
 * 「相手の手牌を覗けてしまう」という情報秘匿の限界は受け入れる(通常の描画では常に
 * 相手の手牌を伏せて表示するので、見た目上は問題にならない。通信内容を直接覗けば
 * 分かってしまう、という技術的な限界があるだけ)。
 *
 * 書き込み(送信)競合を避けるため、「今その局面を進める権利を持つSeat」の画面だけが
 * 相手に送信する。これは canAct(kind, seat) フックで判定する(自分のSeatと一致する時だけ
 * true を返す)。次局送り・新規対局の開始のように乱数(牌山シャッフル)を伴う操作は、
 * ホスト側だけが行う。
 *
 * このクラスは `roomController` に以下のダックタイピングされたインターフェースだけを
 * 要求する(具体的な実装は online.js の RoomController(db方式) や p2p.js の
 * PeerRoomController(WebRTC方式)が提供する):
 *   - .latest: 直近の room ドキュメント相当のオブジェクト({seats, game, code?})
 *   - .onUpdate: (doc) => void を外部からセットされるコールバック(相手からの更新を受信した時に呼ぶ)
 *   - .onError: (err) => void を外部からセットされるコールバック
 *   - .publishGame(game): Promise<void> — game を相手に届ける
 *   - .stop(): 接続や購読を終了する
 *   - .code: 表示用の合言葉/ルームコード相当の文字列(無ければ null でよい)
 *   - .room: { presence, peers, onPeers } という room capability 相当のインターフェース
 *     (相手が「今つながっているか」の表示にのみ使う。無ければ null でよい)
 */

const OnlineEngine = MahjongEngine;

class OnlineMahjongApp extends MahjongApp {
  /**
   * @param {HTMLElement} root
   * @param {{roomController: object, mySeat: "east"|"south", hostSeat: "east"|"south", onExit?: Function,
   *   dealerChoice?: "self"|"opponent"|"random"}} opts
   *   dealerChoice: 起家の決め方(ホスト=ルーム作成者から見て。既定 "self" = ホストが起家)
   */
  constructor(root, { roomController, mySeat, hostSeat, onExit, timeControl, isMatch, dealerChoice }) {
    // 持ち時間はホスト(ルーム作成者)の設定を使う。ゲスト側の値は、対局データが届いた時点で
    // ホストの設定に置き換わる(_onRoomDoc)。
    super(root, { autoStart: false, onExit, timeControl });
    this.roomController = roomController;
    this.mySeat = mySeat;
    this.hostSeat = hostSeat;
    /** 起家の決め方(ホストの設定)。対局データと一緒に配るので、再接続後の再戦でも引き継がれる */
    this.dealerChoice = ["self", "opponent", "random"].includes(dealerChoice) ? dealerChoice : "self";
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
    // 再接続中・対局終了後は、操作も自動進行(自動ツモ・自動ツモ切り・自動和了・次局送り)も
    // 一切行わない。サーバーに届かない進行を自分の画面だけで進めてしまうと相手とずれるため。
    if (!this._isConnected() || this.connectionEndedMessage) return false;
    if (kind === "nextRound" || kind === "newGame") {
      // 牌山のシャッフルを伴う進行は、送信が二重に走らないようホスト側だけが行う。
      return this.mySeat === this.hostSeat;
    }
    return seat === this.mySeat;
  }

  /** 自分の操作で状態が変わった後、相手に送信する。 */
  publish() {
    // まず自分の画面には即座に反映する(体感速度のため。送信完了を待たない)。
    // render() の中で autoAdvance() が更に状態を進めた場合は afterAutoAdvance() 経由で
    // 送信されるので、ここでの送信と合わせて二重送信にならないよう _sendToNetwork 側で
    // 内容が変わっていない送信は自動的に間引く。
    this.render();
    this._sendToNetwork();
  }

  /**
   * autoAdvance()(自動ツモ・自動スルー)が実際に自分の側で状態を進めた時に呼ばれる。
   * これを配信し忘れると、相手の画面には「自動で進むはずの手番」がいつまでも
   * 届かず対局が止まってしまうため、publish() からの明示的な送信と並ぶもう1つの
   * 送信経路として必須。
   */
  afterAutoAdvance() {
    this._sendToNetwork();
  }

  /** 今の自分の状態一式を相手へ送信する(直前に送った内容と同じなら送らない)。 */
  _sendToNetwork() {
    const game = {
      state: this.state,
      lastWin: this.lastWin,
      // ポン・カン・リーチの大きな表示は、鳴かれた/宣言された側にこそ知らせたいので、
      // 和了表示(lastWin)と同じように相手の画面へも配信する。
      lastCall: this.lastCall,
      revealUraDora: this.revealUraDora,
      lastExhaustiveOutcome: this.lastExhaustiveOutcome || null,
      roundConfirmations: this.roundConfirmations,
      roundScoreChange: this.roundScoreChange || null,
      rematchVotes: this.rematchVotes,
      // 持ち時間の設定(ホストの設定)。null は持ち時間なし
      timeControl: this.timeControl,
      // 起家の決め方(ホストの設定)
      dealerChoice: this.dealerChoice,
      log: this.log,
    };
    const json = JSON.stringify(game);
    if (json === this._lastSentJson) return;
    this._lastSentJson = json;
    this.roomController.publishGame(game).catch(() => {
      // 送れなかった分は、再接続時にサーバーの最新データへ合わせ直してからやり直す
      // (_onReconnected で _lastSentJson をリセットする)。表示は接続状態の表示で十分なのでログは残さない。
      this._lastSentJson = null;
    });
  }

  /** 新しい対局(最初の対局・再戦)の起家。ルーム作成時の設定で決める(ランダムは対局ごとに選び直す) */
  chooseStartingDealer() {
    const guestSeat = OnlineEngine.otherSeat(this.hostSeat);
    if (this.dealerChoice === "opponent") return guestSeat;
    if (this.dealerChoice === "random") return Math.random() < 0.5 ? this.hostSeat : guestSeat;
    return this.hostSeat;
  }

  /** ホスト側: 両者の着席(接続)が揃った時点で対局を初期化して配信する。 */
  startGameAsHost() {
    const { wall } = OnlineEngine.buildWall();
    const revealed = OnlineEngine.revealNextDoraIndicator(wall);
    const dealer = this.chooseStartingDealer();
    // 配牌は親(東家)から順に配る
    const { wall: dealtWall, hands } = OnlineEngine.dealInitialHands(revealed, [dealer, OnlineEngine.otherSeat(dealer)]);

    this.state = {
      gameId: this.roomController.code || "online",
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
        east: Object.assign({}, OnlineEngine.createInitialPlayerState("east", 45000), { hand: hands.east }),
        south: Object.assign({}, OnlineEngine.createInitialPlayerState("south", 45000), { hand: hands.south }),
      },
      currentTurn: dealer,
      lastDiscard: null,
      roundEndReason: null,
      totalRounds: 8,
      startingScore: 45000,
      gameEndReason: null,
    };
    this.setLastWin(null);
    this.setLastCall(null);
    this.revealUraDora = false;
    this.setExhaustiveDrawOutcome(null);
    // 「鳴き無し」「ツモ切り」は対局開始時にもオフへ戻す(次局判定用のインデックスも合わせておく)。
    this.noCall = false;
    this.autoTsumogiri = false;
    this._roundTogglesResetIndex = this.roundKey();
    this._timerRoundKey = null;
    this.log = [];
    this.addLog(`オンライン対戦を開始しました(起家: ${this.playerName(dealer)})`);
    this.publish();
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
  detectTedashiDiscard(oldState, newState) {
    if (!oldState || !newState) return null;
    for (const seat of ["east", "south"]) {
      const op = oldState.players[seat];
      const np = newState.players[seat];
      if (!op || !np) continue;
      if (np.discards.length !== op.discards.length + 1) continue;
      const oldCount = op.hand.length + (op.drawnTile ? 1 : 0);
      const newCount = np.hand.length + (np.drawnTile ? 1 : 0);
      if (newCount !== oldCount - 1) continue;
      const added = np.discards[np.discards.length - 1];
      const isTedashi = !op.drawnTile || op.drawnTile.id !== added.tile.id;
      if (isTedashi) return { seat, oldHandLength: op.hand.length };
      return null;
    }
    return null;
  }

  _onRoomDoc(doc) {
    if (doc.names) this.playerNames = doc.names;
    if (!doc.game) {
      const bothSeated = doc.seats && doc.seats.east && doc.seats.south;
      if (bothSeated && this.mySeat === this.hostSeat) {
        this.startGameAsHost();
      } else {
        this._renderWaitingScreen(doc);
      }
      return;
    }
    const g = doc.game;
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
      // 持ち時間はホストの設定に合わせる(古いデータで項目が無い場合は手元の値のまま)
      if (g.timeControl !== undefined) this.timeControl = g.timeControl;
      if (g.dealerChoice !== undefined) this.dealerChoice = g.dealerChoice;
      // 結果画面の間、同じ流局結果が何度も届いても再表示タイマーをやり直さないよう、
      // lastWin と同様に内容が変わった時だけ反映する。
      const incomingExhaustive = g.lastExhaustiveOutcome || null;
      if (JSON.stringify(incomingExhaustive) !== JSON.stringify(this.lastExhaustiveOutcome)) {
        this.setExhaustiveDrawOutcome(incomingExhaustive);
      }
      this.log = g.log || [];
      // 結果画面の確認は両家が同時に送り合うことがあるため、同じ結果画面の間は OR で合成する
      // (相手の送信が自分の確認を上書きして消さないように)。結果画面以外ではリセット。
      const incomingConf = g.roundConfirmations || { east: false, south: false };
      if (newState.phase === "round_end" && oldState && oldState.phase === "round_end") {
        const mine = this.roundConfirmations || {};
        this.roundConfirmations = { east: !!(incomingConf.east || mine.east), south: !!(incomingConf.south || mine.south) };
      } else {
        this.roundConfirmations = { east: !!incomingConf.east, south: !!incomingConf.south };
      }
      // 対局終了画面の「新しい対局を始める」も、両家が同時に送り合うことがあるので OR で合成する
      const incomingVotes = g.rematchVotes || { east: false, south: false };
      if (newState.phase === "game_end" && oldState && oldState.phase === "game_end") {
        const mineV = this.rematchVotes || {};
        this.rematchVotes = { east: !!(incomingVotes.east || mineV.east), south: !!(incomingVotes.south || mineV.south) };
      } else {
        this.rematchVotes = { east: !!incomingVotes.east, south: !!incomingVotes.south };
      }
      if (this._destroyed) return;
      this.render();
      // 次局送りの担当(ホスト)は、相手の確認が届いた時点で揃っていれば進める
      this.maybeAdvanceRound();
      this.maybeStartRematch();
    };

    // 相手がちょうど1回、手出しを行ったという変化であれば、この受信側でも
    // 「相手視点にヒントする一瞬の空白」を再生してから、実際の新しい状態を反映する。
    const tedashi = this._tedashiTimer ? null : this.detectTedashiDiscard(oldState, newState);
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
    // 以前送った内容との比較を捨て、この後の変化は必ず送り直す
    this._lastSentJson = null;
    if (!doc.game && this.state) {
      // サーバーに対局データが届いていなかった(開始直後に切れた等)場合は、自分の状態を送り直す
      this._sendToNetwork();
      this.render();
      return;
    }
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
      if (this.mySeat === this.hostSeat) {
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
    super(root, { roomController, mySeat: "east", hostSeat: "east", onExit, isMatch: false });
    this.isSpectator = true;
  }

  kifuMode() {
    return "spectate";
  }

  // 観戦者は何も操作しない(打牌・鳴き・次局送り・自動進行・持ち時間の計測もしない)
  canAct() {
    return false;
  }

  // 対局を始めるのは対局者(ホスト)だけ。観戦者の画面が東家=ホスト扱いで始めてしまわないように。
  startGameAsHost() {
    this._renderWaitingScreen();
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
    return count > 0 ? `観戦中(${count}人)` : "観戦中";
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
    if (this.onExit) wrap.appendChild(this.button("ロビーに戻る", () => this.exitGame()));
    this.root.appendChild(wrap);
  }
}
