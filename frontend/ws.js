"use strict";

/* global MahjongApp, CpuMahjongApp, OnlineMahjongApp */

/**
 * オンライン対戦(自前サーバー方式)。
 *
 * Claude Artifactの `db`/`room`/`user` capability(同一組織アカウント限定)でも、
 * WebRTC P2P(接続確立時にコードの手動やり取りが必要)でもなく、自分で用意した
 * 中継サーバー(server/server.js)にWebSocketで接続する方式。サーバーはルームコードの
 * 発行・マッチングと、対局データの中継(サーバーは麻雀のルールを一切知らない)だけを行う。
 * 実際のゲーム進行ロジックは online-shared.js の OnlineMahjongApp にすべて共通化してあり、
 * ここは「サーバーとの接続」と「ルームコードによるマッチング画面」だけを担当する。
 *
 * アカウントは一切不要。両者が同じ中継サーバーのURLにさえ接続できればよい
 * (サーバーの用意・公開は利用者側で行う。server/README.md 参照)。
 */

// ---------------- WebSocket接続を OnlineMahjongApp 向けの roomController として包む ----------------

/** 再接続のために保存しておく、直近のオンライン対局の情報(ページを再読み込みしても戻れるように) */
const WS_SESSION_STORAGE_KEY = "mahjong_ws_session";
/** サーバーとの通信方式の版(2: 対局をサーバーが進める方式、3: 接続の最初に hello で名乗る)。server/protocol.js の PROTOCOL_VERSION と合わせる */
const WS_PROTOCOL_VERSION = 3;
/** サーバー側で座席が予約される時間(server/roomRegistry.js の DEFAULT_RECONNECT_GRACE_MS)と揃える */
const WS_RECONNECT_GRACE_MS = 5 * 60 * 1000;
/** 再接続を試みる間隔(回数ごとに伸ばし、最大 WS_RECONNECT_MAX_DELAY_MS) */
const WS_RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000];
const WS_RECONNECT_MAX_DELAY_MS = 8000;
/** 生存確認(ping)を送る間隔と、何も受信しないまま経過したら切断とみなす時間 */
const WS_PING_INTERVAL_MS = 10000;
const WS_SILENCE_TIMEOUT_MS = 25000;
/** ロビー画面を何も操作せず放置した場合に、オンライン人数表示用の接続を切るまでの時間(通信量削減のため) */
const LOBBY_IDLE_DISCONNECT_MS = 5 * 60 * 1000;
/** 自動マッチングの相手待ちを続ける最大時間。これを超えたら諦めてロビーに戻る */
const MATCH_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

// ---------------- ロビー画面「ルール確認」に表示するルール文面 ----------------
// あくまで表示用のテキストであり、実際のゲームロジック(役・点数計算等)には一切影響しない。
const SIMPLE_RULES_TEXT = `・東〜北各2局の計8局または東・南各2局の計4局
・持ち点45,000点
・トビ終了あり(0点は続行、リーチ不可)
・チーなし
・ツモ和了は点数を4分の3とする
・1,000点未満切り上げ
・ノーテン罰符5,000点、形式テンパイあり
・オーラスの親のテンパイ止め・アガリ止めなし
・一部役の翻数変更、追加役あり
　(詳細ルールを参照)`;

// ---------------- プライバシーポリシー(ユーザー登録の画面・アカウントの画面から表示) ----------------
const PRIVACY_POLICY_TEXT = `二麻オンライン プライバシーポリシー

1. 取得する情報
・ユーザー登録するとき: ユーザー名、メールアドレス
・遊ぶとき: 対局の結果・成績、接続元のIPアドレス(不正防止・混雑対策のために一時的に使い、保存しません)
・端末に保存する情報: 自動ログインのための情報、設定、端末ごとのID(ゲスト番号・自動マッチングに使います)、牌譜

2. 利用目的
・ログインのため(登録したメールアドレスにログイン用のメールを送ります)
・ゲーム内での名前・成績の表示、フレンドなどの機能のため
・不正行為の防止と、サービスの運営のため

3. 外部のサービスの利用
情報の保存とメールの送信に、Google の Firebase を利用しています(情報は Google のサーバーに保存されます)。

4. 他のプレイヤーに表示される情報
ユーザー名・成績は他のプレイヤーに表示されます。メールアドレスは他のプレイヤーには表示されません。

5. 第三者への提供
法令に基づく場合を除き、本人の同意なく第三者に提供しません。

6. 削除
「ユーザー登録・ログイン」(ログイン中は「アカウント」)→「アカウントを削除」から、いつでも登録情報を削除できます。

7. 変更
この内容を変更するときは、このページでお知らせします。`;

const DETAILED_RULES_TEXT = `【使用牌種】
萬子の1〜9
索子の1,9
筒子の1,9
字牌全て
計20種80枚

【基本ルール】
・一荘戦(東〜北各2局の計8局)または半荘戦(東・南各2局の計4局)
・親を東家、子を南家とする
・持ち点45,000点、45,000点返し
・トビ終了あり(0点は続行、リーチ不可)
・赤ドラなし
・抜きドラなし
・西・北は通常の風牌として扱う(場風のみ適用)
　※東場・南場は客風牌(オタ風)となる
・喰いタン・後付けあり
・チーなし
・喰い替えなし(例:ポン3m→打3m)
・1翻縛り
・槓ドラ・裏ドラあり(槓ドラの裏も含む)
・槓ドラは全て先めくりとする
・槓発生時は海底から1枚王牌に補充する
・ツモは王牌の直前までとし、ツモ山の最後のツモ牌を海底牌とする(嶺上牌は海底牌にならない)
・海底牌の槓は不可
・途中流局は四開槓のみあり
・四開槓は4回目の槓の後打牌した時点でどちらも和了でなければ成立
※1人で4回槓した場合に限り四開槓不成立(四槓子採用のため)
・5回目の槓は不可
・親のアガリ・テンパイは連荘
(オーラスのアガリ止め・テンパイ止めなし)
・連荘時の積み棒なし
・八連荘は不採用
・ノーテン罰符5,000点、形式テンパイあり
・オーラス終了時の供託(立直料)は起家取り
・ツモ番なしリーチあり
・嶺上開花はツモ和了とし、ツモ2符を認める
・連風牌の雀頭は4符とする
・13翻以上は数え役満とする
・役満の複合あり(数え役満は除く)
・和了時は、1,000点未満を切り上げとする
　例:子の40符3翻5,200点 ロンの場合
　　　5,200 → 6,000
・ツモ和了時は、和了点を4分の3とする
(点数計算後1,000点未満切り上げ)
　例:子の40符3翻5,200点 ツモの場合
　　　5,200 × 3/4 = 3,900 → 4,000
・流し役満は祝儀として扱う(詳細は後述)

【一部役の条件・点数について】
・三槓子
　三倍満とする

・四暗刻
　シャンポン待ち(ツモり四暗刻)の場合、倍満(8翻)とし、三暗刻・役満を除く他の役やドラとの複合あり
　単騎待ち(四暗刻単騎)の場合、役満とする

・四槓子
　ダブル役満とする

・字一色
　役満とする

・清老頭
　役満とする

・小四喜
　役満とする

・大四喜
　ダブル役満とする
　小四喜との複合はなし

・九蓮宝燈
　役満とする
　9面待ち(純正九蓮宝燈)の場合、ダブル役満とする
　なお、フリテンの場合は役満とする

・国士無双
　単騎待ちの場合、倍満とし、役満を除く他の役やドラとの複合あり
　13面待ちの場合、役満とする
　なお、フリテンの場合は倍満とする

・大三元
　門前の場合、役満とする
　※門前であれば白發中いずれかのロンでも役満とする
　副露した場合(白・發・中以外の副露も含む)、
　倍満(8翻)とし、白・發・中・小三元・役満を除く他の役やドラとの複合あり
　例1:(門前)大三元・字一色 [發ロン] →ダブル役満
　　2:(副露)大三元・字一色 →字一色のみ適用 →役満
　　3:(副露)大三元・混一色・ドラ1
　　　→8翻+2翻+1翻=11翻 →三倍満

【祝儀】
・流し役満
　捨て牌が2〜8の萬子のみかつ相手に捨て牌を鳴かれていない状態で流局すると成立
　成立者に役満分の点数を支払う
　祝儀扱いのため、その局は通常の流局と同様に扱う(ノーテン罰符あり、供託はそのまま、親がテンパイしていれば連荘、ノーテンなら親流れ※オーラス(一荘戦は北2局、半荘戦は南2局)ならゲーム終了)

【追加役】
・大七星(だいちーしん)
　字牌をそれぞれ2枚ずつ、計14枚で成立
　要するに字一色・七対子
　役満とする
　なお、字一色との複合はなし

・大数隣(だいすうりん)
　2〜8の萬子をそれぞれ2枚ずつ、計14枚で成立
　役満とする

・百万石(ひゃくまんごく)
　萬子の清一色かつ数字の合計が100を超えると成立
　副露あり
　役満とする

・加賀百万石(かがひゃくまんごく)
　萬子の清一色かつ数字の合計がちょうど100のとき成立
　副露あり
　ダブル役満とする`;

function loadWsSession() {
  try {
    const raw = localStorage.getItem(WS_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.serverUrl || !s.code || !s.token) return null;
    // savedAt は「最後に接続できていた時刻」(接続中は定期的に更新している)。サーバーが切断に
    // 気付くのは少し後なので、猶予時間に1分の余裕を足して判定する(期限切れならサーバーが断る)。
    if (Date.now() - (s.savedAt || 0) > WS_RECONNECT_GRACE_MS + 60000) {
      clearWsSession();
      return null;
    }
    return s;
  } catch (e) {
    return null;
  }
}
function saveWsSession(session) {
  try {
    localStorage.setItem(WS_SESSION_STORAGE_KEY, JSON.stringify(Object.assign({}, session, { savedAt: Date.now() })));
  } catch (e) {
    /* ignore */
  }
}
function clearWsSession() {
  try {
    localStorage.removeItem(WS_SESSION_STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}

/**
 * 自動マッチングの待ち行列で「自分自身」を判定するための、この端末・ブラウザに
 * 固定されたID(一度作ったら localStorage に保存し、以後はずっと同じ値を使い回す)。
 *
 * 相手待ち中に電波切れ等で接続が切れると、サーバー側がそれに気付く(pingの
 * タイムアウト)より先に、こちらが新しい接続で自動マッチングをやり直してしまう
 * ことがある。そうすると、サーバーの待ち行列にまだ残っている「切れる前の自分」と
 * 新しい接続がマッチングしてしまい、自分自身と対局が始まってしまう。
 * このIDを毎回の match リクエストに含めて送ることで、サーバー側が
 * 「待ち行列にいるのが同じ端末からの新しい接続だ」と気付けるようにする。
 */
const WS_CLIENT_ID_STORAGE_KEY = "mahjong_ws_client_id";
let cachedClientId = null;
function getOrCreateClientId() {
  if (cachedClientId) return cachedClientId;
  try {
    const existing = localStorage.getItem(WS_CLIENT_ID_STORAGE_KEY);
    if (existing) {
      cachedClientId = existing;
      return cachedClientId;
    }
  } catch (e) {
    /* ignore (プライベートブラウジング等で localStorage が使えない場合) */
  }
  const id =
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    localStorage.setItem(WS_CLIENT_ID_STORAGE_KEY, id);
  } catch (e) {
    /* localStorage に保存できなくても、このページを開いている間だけは使い回せる */
  }
  cachedClientId = id;
  return cachedClientId;
}

// ---------------- アカウント(docs/account-spec.md) ----------------
/**
 * ログイン状態と、アカウント関係のサーバーとのやり取り。
 * - 自動ログインのトークンは localStorage(SESSION_TOKEN_KEY)。トークンがあれば「ログイン中」とみなす
 *   (サーバーで無効と分かったら消す)。
 * - 名前(ログイン中のアカウント名/ゲストの名前「○○(ゲスト)」)は、サーバーに名乗った結果(hello-ok)を覚えておく。
 *   サーバーが起動に時間がかかる間も表示できるよう localStorage(IDENTITY_KEY)にも残す。
 * - アカウントの操作は、必要な時だけ開く専用の接続で行い、使い終わったら数秒で閉じる。
 */
const MahjongAccount = (() => {
  const SESSION_TOKEN_KEY = "mahjong_session_token";
  const IDENTITY_KEY = "mahjong_identity";
  const PENDING_KEY = "mahjong_auth_pending";
  /** ゲストが自分で決めた名前(「(ゲスト)」を付ける前のもの)。名乗りのときに送る */
  const GUEST_NAME_KEY = "mahjong_guest_name";
  const REQUEST_TIMEOUT_MS = 90000; // サーバーが寝ている(起動に約1分)ときのために長め
  const IDLE_CLOSE_MS = 1000;
  let serverUrlFn = () => null;
  const listeners = new Set();

  function jstToday() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function write(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }
  function readJson(key) {
    try {
      return JSON.parse(read(key) || "null");
    } catch (e) {
      return null;
    }
  }

  function token() {
    const t = read(SESSION_TOKEN_KEY);
    return typeof t === "string" && t.length >= 20 ? t : null;
  }

  function identity() {
    const id = readJson(IDENTITY_KEY);
    if (!id || typeof id.name !== "string") return null;
    // ゲストの番号は日付ごとなので、別の日の番号は使わない。ログイン状態と食い違うものも使わない
    if (id.guest && id.date !== jstToday()) return null;
    if (!!token() === !!id.guest) return null;
    return id;
  }

  function emit() {
    for (const cb of listeners) {
      try {
        cb();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /** サーバーの hello-ok を反映する(どの接続で受け取ったものでもよい) */
  function applyHello(msg) {
    if (!msg || typeof msg.name !== "string") return;
    if (msg.sessionInvalid) write(SESSION_TOKEN_KEY, null);
    // 覚えていたゲストの名前が使えなくなっていた(規則が変わった等)
    if (msg.guestNameError) write(GUEST_NAME_KEY, null);
    write(IDENTITY_KEY, JSON.stringify({ guest: !!msg.guest, name: msg.name, date: jstToday() }));
    emit();
  }

  /** 接続の最初に送る名乗り */
  function helloMessage(reqId) {
    const m = { type: "hello", protocol: WS_PROTOCOL_VERSION, clientId: getOrCreateClientId() };
    const t = token();
    if (t) m.sessionToken = t;
    else {
      const g = read(GUEST_NAME_KEY);
      if (g) m.guestName = g;
    }
    if (reqId !== undefined) m.reqId = reqId;
    return m;
  }

  /** ゲストの名前を覚える(サーバーが確かめた名前 baseName と、表示する名前 name) */
  function setGuestName(baseName, name) {
    write(GUEST_NAME_KEY, baseName || null);
    if (name) {
      write(IDENTITY_KEY, JSON.stringify({ guest: true, name, date: jstToday() }));
    } else {
      // 既定の名前に戻す: 名乗り直して「Playern(ゲスト)」を受け取る(次の操作で接続を開き直す)
      write(IDENTITY_KEY, null);
      closeSocket();
    }
    emit();
  }

  function setSession(newToken, name) {
    const changed = newToken !== token();
    write(SESSION_TOKEN_KEY, newToken);
    write(IDENTITY_KEY, JSON.stringify({ guest: false, name, date: jstToday() }));
    // ログイン状態が変わったら、アカウント用の接続は名乗り直す(次の操作で開き直す)
    if (changed) setTimeout(closeSocket, 0);
    emit();
  }

  function clearSession() {
    write(SESSION_TOKEN_KEY, null);
    write(IDENTITY_KEY, null);
    setTimeout(closeSocket, 0);
    emit();
  }

  // ---- アカウントの操作用の接続 ----
  let ws = null;
  let readyPromise = null;
  let seq = 0;
  const waiting = new Map(); // reqId -> {resolve, reject, timer}
  let idleTimer = null;

  function closeSocket() {
    clearTimeout(idleTimer);
    const old = ws;
    ws = null;
    readyPromise = null;
    if (old) {
      try {
        old.close();
      } catch (e) {
        /* ignore */
      }
    }
  }

  function scheduleIdleClose() {
    clearTimeout(idleTimer);
    if (waiting.size === 0) idleTimer = setTimeout(closeSocket, IDLE_CLOSE_MS);
  }

  function failAll(message) {
    for (const [id, w] of waiting) {
      clearTimeout(w.timer);
      w.reject(new Error(message));
      waiting.delete(id);
    }
  }

  /** 接続して名乗るまで(名乗りの返事 hello-ok が届くまで)待つ */
  function ensureOpen() {
    if (readyPromise) return readyPromise;
    readyPromise = new Promise((resolve, reject) => {
      const url = serverUrlFn();
      let sock;
      try {
        sock = new WebSocket(url);
      } catch (e) {
        readyPromise = null;
        reject(new Error("サーバーに接続できませんでした。"));
        return;
      }
      ws = sock;
      const helloId = ++seq;
      const timer = setTimeout(() => {
        if (ws === sock) closeSocket();
        reject(new Error("サーバーに接続できませんでした(時間切れ)。"));
      }, REQUEST_TIMEOUT_MS);
      sock.addEventListener("open", () => sock.send(JSON.stringify(helloMessage(helloId))));
      sock.addEventListener("message", (ev) => {
        if (ws !== sock) return;
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        if (!msg || typeof msg.type !== "string") return;
        if (msg.reqId === helloId) {
          clearTimeout(timer);
          if (msg.type === "hello-ok") {
            applyHello(msg);
            resolve();
          } else {
            reject(new Error(msg.message || "サーバーに接続できませんでした。"));
          }
          return;
        }
        const w = msg.reqId !== undefined ? waiting.get(msg.reqId) : null;
        if (!w) return;
        waiting.delete(msg.reqId);
        clearTimeout(w.timer);
        if (msg.type === "account-error" || msg.type === "error") {
          const err = new Error(msg.message || "エラーが起きました。");
          err.reason = msg.reason || null;
          w.reject(err);
        } else {
          w.resolve(msg);
        }
        scheduleIdleClose();
      });
      const lost = () => {
        if (ws !== sock) return;
        clearTimeout(timer);
        ws = null;
        readyPromise = null;
        reject(new Error("サーバーとの接続が切れました。"));
        failAll("サーバーとの接続が切れました。もう一度お試しください。");
      };
      sock.addEventListener("close", lost);
      sock.addEventListener("error", lost);
    });
    return readyPromise;
  }

  /** サーバーにアカウントの操作を頼み、返事を待つ(失敗は例外。message は利用者に見せてよい文言) */
  async function request(msg) {
    clearTimeout(idleTimer);
    await ensureOpen();
    const reqId = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(reqId);
        reject(new Error("サーバーから返事がありませんでした。"));
        scheduleIdleClose();
      }, REQUEST_TIMEOUT_MS);
      waiting.set(reqId, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify(Object.assign({}, msg, { reqId })));
      } catch (e) {
        waiting.delete(reqId);
        clearTimeout(timer);
        reject(new Error("サーバーに送れませんでした。"));
      }
    });
  }

  /** いまの名前をサーバーに確かめる(自動ログインの確認・ゲスト番号の取得) */
  async function refresh() {
    await ensureOpen();
    scheduleIdleClose();
    return identity();
  }

  // ---- 認証の途中(メールのリンクを押して戻ってくるまで)の受付 ----
  function savePending(p) {
    write(PENDING_KEY, p ? JSON.stringify(Object.assign({ savedAt: Date.now() }, p)) : null);
  }
  function loadPending() {
    const p = readJson(PENDING_KEY);
    if (!p || typeof p.rid !== "string" || typeof p.secret !== "string") return null;
    if (Date.now() - (p.savedAt || 0) > 30 * 60 * 1000) {
      savePending(null);
      return null;
    }
    return p;
  }

  return {
    configure(fn) {
      serverUrlFn = fn;
    },
    token,
    /** ログインしているか(自動ログインのトークンがあるか) */
    isLoggedIn: () => !!token(),
    isGuest: () => !token(),
    /** 表示する名前(まだ分からなければ null) */
    displayName: () => {
      const id = identity();
      return id ? id.name : null;
    },
    applyHello,
    helloMessage,
    setGuestName,
    /** ゲストが自分で決めた名前(「(ゲスト)」の前の部分。決めていなければ null) */
    guestName: () => read(GUEST_NAME_KEY),
    setSession,
    clearSession,
    request,
    refresh,
    savePending,
    loadPending,
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
})();
window.MahjongAccount = MahjongAccount;

/**
 * 中継サーバーとの WebSocket 接続を管理する。接続が切れた場合は自動で再接続し、
 * 発行済みのトークンで同じ座席に戻る(サーバー側は切断から5分間、座席を予約している)。
 *
 * status: "connecting"(初回接続中) | "connected" | "reconnecting" | "closed"
 *
 * OnlineMahjongApp が差し替えるコールバック:
 *   onUpdate(doc)          相手からの更新・着席完了
 *   onReconnected(doc)     再接続に成功した(doc.game はサーバーが保持していた最新の対局データ)
 *   onConnectionChange()   自分の接続状態・相手の在席状態が変わった
 *   onPeerLeft()           相手が退出した、または相手の再接続の猶予時間が切れた
 *   onFatal(message)       再接続を諦めた(猶予切れ・ルーム消滅など)
 *   onError(err)           その他の通信エラー
 */
class WsRoomController {
  /**
   * @param {{serverUrl: string, name?: string|null, allowSpectate?: boolean, timeControl?: object|null,
   *          dealerChoice?: string, gameLength?: string}} opts  allowSpectate・timeControl・dealerChoice はルーム作成時だけ、
   *          gameLength(一荘戦 "full" / 半荘戦 "half")はルーム作成と自動マッチングで使う
   */
  constructor({ serverUrl, name, allowSpectate, timeControl, dealerChoice, gameLength }) {
    this.serverUrl = serverUrl;
    this.myName = name || null;
    /** ルーム作成時に、観戦を許可するか(参加・自動マッチングでは使わない) */
    this.allowSpectate = allowSpectate !== false;
    /** ルーム作成時の持ち時間・起家の決め方(対局はサーバーがこの設定で進める) */
    this.timeControl = timeControl === undefined ? DEFAULT_TIME_CONTROL : timeControl;
    this.dealerChoice = dealerChoice || "self";
    /** 対局の長さ(ルーム作成・自動マッチングで送る) */
    this.gameLength = gameLength === "half" ? "half" : "full";
    /** この対局を観戦している人数(サーバーから通知される) */
    this.spectatorCount = 0;
    /** サーバーに接続中の人数(この接続自身も含む。サーバーから通知される)。未受信は null */
    this.onlineCount = null;
    this._onlineCountListeners = new Set();
    this.code = null;
    this.mySeat = null;
    this.token = null;
    this.latest = null;
    this.ws = null;
    this.status = "connecting";
    this.peerConnected = false;
    this.reconnectAttempts = 0;
    this._peersCb = null;
    this._stopped = false;
    this._ended = false;
    this._socketGen = 0;
    this._pending = null; // 初回の create/join/rejoin の応答待ち {resolve, reject}
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._lastMessageAt = 0;
    this._disconnectedAt = null;

    this.onUpdate = null;
    this.onReconnected = null;
    this.onConnectionChange = null;
    this.onPeerLeft = null;
    this.onFatal = null;
    this.onError = null;
    this.onMatchWaiting = null;
    /** 送った操作をサーバーが受け付けなかった */
    this.onActionRejected = null;

    /** OnlineMahjongApp が使う room capability 相当のダックタイピング(相手の在席表示用) */
    this.room = {
      presence: async () => {},
      peers: () => (this.peerConnected ? [{ isMe: false, presence: { seat: this._opponentSeat() } }] : []),
      onPeers: (cb) => {
        this._peersCb = cb;
        return () => {
          this._peersCb = null;
        };
      },
    };

    this._onOnline = () => this._reconnectNowIfNeeded();
    this._onVisible = () => {
      if (document.visibilityState === "visible") this._checkAliveNow();
      else this._touchSession(); // バックグラウンドに回る直前の時刻を残す
    };
    this._onPageHide = () => this._touchSession();
    window.addEventListener("online", this._onOnline);
    document.addEventListener("visibilitychange", this._onVisible);
    window.addEventListener("pagehide", this._onPageHide);
  }

  _opponentSeat() {
    return this.mySeat === "east" ? "south" : "east";
  }

  isConnected() {
    return this.status === "connected";
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (this.onConnectionChange) this.onConnectionChange();
  }

  _setPeerConnected(v) {
    this.peerConnected = v;
    if (this._peersCb) this._peersCb({ peers: this.room.peers(), joined: [], left: [], updated: [] });
    if (this.onConnectionChange) this.onConnectionChange();
  }

  /** 接続中であれば、保存しているセッションの「最後に接続できていた時刻」を更新する */
  _touchSession() {
    if (this.status !== "connected" || this._stopped || this._ended) return;
    this._saveSession();
  }

  _saveSession() {
    if (!this.code || !this.token) return;
    saveWsSession({ serverUrl: this.serverUrl, code: this.code, token: this.token, seat: this.mySeat, name: this.myName });
  }

  // ---- ソケットの開閉 ----

  /** 新しいソケットを開き、開いたら firstMessage を送る。古いソケットのイベントは世代番号で無視する。 */
  _openSocket(firstMessage) {
    const gen = ++this._socketGen;
    let ws;
    try {
      ws = new WebSocket(this.serverUrl);
    } catch (e) {
      this._onSocketLost(gen, "サーバーに接続できませんでした: " + ((e && e.message) || e));
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (gen !== this._socketGen) return;
      this._lastMessageAt = Date.now();
      // 最初に名乗り(ログイン中のアカウント/ゲスト)、その返事が届いてから本来の要求を送る
      // (ルームでの名前はサーバーが名乗りから決めるため)
      this._afterHello = firstMessage;
      ws.send(JSON.stringify(MahjongAccount.helloMessage("hello")));
      this._startPing();
    });
    ws.addEventListener("message", (ev) => {
      if (gen !== this._socketGen) return;
      this._lastMessageAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      this._handleMessage(msg);
    });
    ws.addEventListener("close", () => this._onSocketLost(gen));
    ws.addEventListener("error", () => this._onSocketLost(gen));
  }

  _dropSocket() {
    this._socketGen++; // 古いソケットから遅れて届くイベントを無視する
    this._stopPing();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        /* ignore */
      }
    }
    this.ws = null;
  }

  _onSocketLost(gen, message) {
    if (gen !== this._socketGen) return;
    this._dropSocket();
    if (this._stopped || this._ended) return;

    // まだ座席を持っていない(初回の create/join が完了していない)なら、単に失敗として返す
    if (!this.token) {
      this._rejectPending(new Error(message || "サーバーに接続できませんでした。URLをご確認ください: " + this.serverUrl));
      this._setStatus("closed");
      return;
    }

    if (this._disconnectedAt === null) this._disconnectedAt = Date.now();
    this._setStatus("reconnecting");
    if (Date.now() - this._disconnectedAt > WS_RECONNECT_GRACE_MS) {
      this._giveUp("サーバーに再接続できませんでした(時間切れ)。");
      return;
    }
    const delay =
      this.reconnectAttempts < WS_RECONNECT_DELAYS_MS.length
        ? WS_RECONNECT_DELAYS_MS[this.reconnectAttempts]
        : WS_RECONNECT_MAX_DELAY_MS;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._attemptRejoin(), delay);
  }

  _attemptRejoin() {
    this._reconnectTimer = null;
    if (this._stopped || this._ended) return;
    this.reconnectAttempts++;
    if (this.onConnectionChange) this.onConnectionChange();
    this._openSocket({ type: "rejoin", protocol: WS_PROTOCOL_VERSION, code: this.code, token: this.token });
  }

  /** 回線の復帰やアプリへの復帰を検知したら、待たずにすぐ再接続する */
  _reconnectNowIfNeeded() {
    if (this.status !== "reconnecting" || this._stopped || this._ended) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    clearTimeout(this._reconnectTimer);
    this._attemptRejoin();
  }

  /** スマホでアプリに戻ってきた直後などは、接続が死んでいないか ping ですぐ確かめる */
  _checkAliveNow() {
    if (this.status === "reconnecting") {
      this._reconnectNowIfNeeded();
      return;
    }
    if (this.status !== "connected" || !this.ws) return;
    if (Date.now() - this._lastMessageAt > WS_SILENCE_TIMEOUT_MS) {
      this._onSocketLost(this._socketGen);
      return;
    }
    try {
      this.ws.send(JSON.stringify({ type: "ping" }));
    } catch (e) {
      this._onSocketLost(this._socketGen);
    }
  }

  _startPing() {
    this._stopPing();
    const gen = this._socketGen;
    this._pingTimer = setInterval(() => {
      if (gen !== this._socketGen || !this.ws) return;
      // 一定時間なにも受信していない = 電波切れなどで close が届かないまま死んでいる接続
      if (Date.now() - this._lastMessageAt > WS_SILENCE_TIMEOUT_MS) {
        this._onSocketLost(gen);
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch (e) {
          /* close イベントで処理される */
        }
      }
      // ページを閉じた・アプリを切り替えた後でもロビーから戻れるよう、接続できている間は
      // 保存しているセッションの時刻を更新し続ける(対局開始時刻のままだと、5分を超える対局で
      // 期限切れと誤判定されてしまう)。
      this._touchSession();
    }, WS_PING_INTERVAL_MS);
  }

  _stopPing() {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
  }

  _giveUp(message) {
    this._ended = true;
    this._dropSocket();
    clearTimeout(this._reconnectTimer);
    clearWsSession();
    this._setStatus("closed");
    this._rejectPending(new Error(message));
    if (this.onFatal) this.onFatal(message);
  }

  _resolvePending(value) {
    if (this._pending) {
      const p = this._pending;
      this._pending = null;
      p.resolve(value);
    }
  }
  _rejectPending(err) {
    if (this._pending) {
      const p = this._pending;
      this._pending = null;
      p.reject(err);
    }
  }

  // ---- 受信 ----

  _handleMessage(msg) {
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "pong") return;

    // 名乗りの返事が届いたら、待たせていた本来の要求を送る
    if (this._afterHello && (msg.type === "hello-ok" || (msg.type === "account-error" && msg.op === "hello"))) {
      if (msg.type === "hello-ok") MahjongAccount.applyHello(msg);
      const first = this._afterHello;
      this._afterHello = null;
      if (first && this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(first));
      return;
    }
    // 名乗りに対応していない古いサーバー
    if (this._afterHello && msg.type === "error") {
      this._afterHello = null;
      msg = { type: "error", message: "サーバーが古いバージョンのため対戦できません(サーバーの更新が必要です)。" };
    }

    if (msg.type === "match-waiting") {
      if (this.onMatchWaiting) this.onMatchWaiting();
      return;
    }
    if (msg.type === "match-cancelled") return;

    // 対局をサーバーが進める方式(protocol 2)に対応していない古いサーバーとは対戦しない
    if (["created", "joined", "matched", "rejoined"].includes(msg.type) && !(msg.protocol >= WS_PROTOCOL_VERSION)) {
      const err = new Error("サーバーが古いバージョンのため対戦できません(サーバーの更新が必要です)。");
      if (this._pending) {
        this._rejectPending(err);
        this._stopped = true;
        this._dropSocket();
        this._setStatus("closed");
      } else {
        this._giveUp(err.message);
      }
      return;
    }

    if (msg.type === "action-rejected") {
      if (this.onActionRejected) this.onActionRejected(msg.message);
      return;
    }

    if (msg.type === "created" || msg.type === "joined" || msg.type === "matched") {
      this.code = msg.code;
      this.mySeat = msg.seat;
      this.token = msg.token;
      this.latest =
        msg.type === "created"
          ? { seats: { east: "me", south: null }, game: null }
          : msg.seat === "east"
          ? { seats: { east: "me", south: "peer" }, game: null }
          : { seats: { east: "peer", south: "me" }, game: null };
      this.peerConnected = msg.type !== "created";
      this._saveSession();
      this._setStatus("connected");
      this._resolvePending({ code: msg.code, mySeat: msg.seat });
      return;
    }
    if (msg.type === "rejoined") {
      this.code = msg.code;
      this.mySeat = msg.seat;
      this.token = msg.token || this.token;
      this.reconnectAttempts = 0;
      this._disconnectedAt = null;
      this.spectatorCount = typeof msg.spectators === "number" ? msg.spectators : 0;
      this.latest = {
        seats: msg.bothSeated ? { east: "peer", south: "peer" } : { east: this.mySeat === "east" ? "me" : null, south: this.mySeat === "south" ? "me" : null },
        names: msg.names || { east: "Player1", south: "Player2" },
        game: msg.game || null,
      };
      this._saveSession();
      this.peerConnected = !!msg.peerConnected;
      this._setStatus("connected");
      if (this._pending) {
        this._resolvePending({ code: msg.code, mySeat: msg.seat });
      } else if (this.onReconnected) {
        this.onReconnected(this.latest);
      }
      this._setPeerConnected(!!msg.peerConnected);
      return;
    }
    if (msg.type === "rejoin-failed") {
      if (msg.reason === "peer-left") {
        // 自分の切断中に相手が退室していた
        this._handlePeerLeft("left");
        this._rejectPending(new Error("対戦相手が退室しました。"));
        return;
      }
      this._giveUp(msg.message || "再接続できませんでした。");
      return;
    }
    if (msg.type === "error") {
      if (this._pending) {
        this._rejectPending(new Error(msg.message || "サーバーがエラーを返しました。"));
        this._stopped = true;
        this._dropSocket();
        this._setStatus("closed");
      } else if (this.onError) {
        this.onError({ code: "server", message: msg.message });
      }
      return;
    }
    if (msg.type === "ready") {
      this.latest = Object.assign({}, this.latest, {
        seats: { east: "peer", south: "peer" },
        names: msg.names || { east: "Player1", south: "Player2" },
      });
      this._setPeerConnected(true);
      if (this.onUpdate) this.onUpdate(this.latest);
      return;
    }
    if (msg.type === "game") {
      this.latest = Object.assign({}, this.latest, { game: msg.payload });
      if (this.onUpdate) this.onUpdate(this.latest);
      return;
    }
    if (msg.type === "peer-offline") {
      this._setPeerConnected(false);
      return;
    }
    if (msg.type === "peer-online") {
      this._setPeerConnected(true);
      return;
    }
    if (msg.type === "peer-left") {
      this._handlePeerLeft(msg.reason === "timeout" ? "timeout" : "left");
      return;
    }
    if (msg.type === "spectators") {
      this.spectatorCount = typeof msg.count === "number" ? msg.count : 0;
      if (this.onConnectionChange) this.onConnectionChange();
      return;
    }
    if (msg.type === "online-count") {
      this.onlineCount = typeof msg.count === "number" ? msg.count : null;
      for (const cb of this._onlineCountListeners) cb(this.onlineCount);
      return;
    }
  }

  /**
   * この接続に届くオンライン人数を購読する(自動マッチングの待機画面用)。すぐに1回、
   * 以後は変わるたびに cb が呼ばれる。人数表示のためだけに別の接続を張ると、自分が
   * 2人分として数えられてしまうため、待機中はこの接続に届く人数を使う。
   * @returns {() => void} 購読解除
   */
  watchOnlineCount(cb) {
    this._onlineCountListeners.add(cb);
    cb(this.onlineCount);
    return () => this._onlineCountListeners.delete(cb);
  }

  /** 相手の退室(reason "left")・再接続の猶予切れ("timeout")で対局を終える */
  _handlePeerLeft(reason) {
    this._ended = true;
    clearWsSession();
    this._dropSocket();
    clearTimeout(this._reconnectTimer);
    this.peerConnected = false;
    this._setStatus("closed");
    if (!this._pending && this.onPeerLeft) this.onPeerLeft(reason);
  }

  // ---- 外部から呼ぶ操作 ----

  _request(firstMessage) {
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject };
      this._openSocket(firstMessage);
    });
  }

  /** ルームを作成する(自分が east 家)。 */
  createRoom() {
    return this._request({
      type: "create",
      protocol: WS_PROTOCOL_VERSION,
      name: this.myName,
      allowSpectate: this.allowSpectate,
      timeControl: this.timeControl,
      dealerChoice: this.dealerChoice,
      gameLength: this.gameLength,
    });
  }

  /** 既存のルームに参加する。 */
  joinRoom(code) {
    return this._request({ type: "join", protocol: WS_PROTOCOL_VERSION, code, name: this.myName });
  }

  /**
   * 自動マッチング。相手待ちの間は onMatchWaiting が呼ばれ、相手が見つかったら
   * (created/joined と同じく)座席が決まった時点で解決する。
   */
  findMatch() {
    return this._request({ type: "match", protocol: WS_PROTOCOL_VERSION, name: this.myName, clientId: getOrCreateClientId(),
      gameLength: this.gameLength,
    });
  }

  /** 自動マッチングの相手待ちをやめる(サーバーの待ち行列から外れて接続を閉じる) */
  cancelMatch() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.token) {
      try {
        this.ws.send(JSON.stringify({ type: "cancel-match" }));
      } catch (e) {
        /* ignore */
      }
    }
    this._pending = null;
    this.stop();
  }

  /** 保存しておいた前回の対局(ページの再読み込み前など)に戻る。 */
  resume(session) {
    this.code = session.code;
    this.token = session.token;
    this.mySeat = session.seat || null;
    this._disconnectedAt = Date.now();
    return this._request({ type: "rejoin", protocol: WS_PROTOCOL_VERSION, code: session.code, token: session.token });
  }

  /** 操作(打牌・鳴き・和了・確認など)をサーバーへ送る。接続が切れていて送れなければ false */
  sendAction(action) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== "connected") return false;
    try {
      this.ws.send(JSON.stringify({ type: "action", action }));
      return true;
    } catch (e) {
      return false;
    }
  }

  _sendLeaveViaFreshSocket() {
    let ws;
    try {
      ws = new WebSocket(this.serverUrl);
    } catch (e) {
      return;
    }
    const giveUp = setTimeout(() => {
      try {
        ws.close();
      } catch (e) {
        /* ignore */
      }
    }, 10000);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "rejoin", code: this.code, token: this.token }));
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg.type === "rejoined") ws.send(JSON.stringify({ type: "leave" }));
      if (msg.type === "rejoined" || msg.type === "rejoin-failed") {
        clearTimeout(giveUp);
        setTimeout(() => {
          try {
            ws.close();
          } catch (e) {
            /* ignore */
          }
        }, 300);
      }
    });
    ws.addEventListener("error", () => clearTimeout(giveUp));
  }

  /** 自分から対局をやめる(再接続の予約を残さず、相手にも退出を伝える)。 */
  stop() {
    this._stopped = true;
    clearTimeout(this._reconnectTimer);
    clearWsSession();
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.status === "connected") {
      try {
        this.ws.send(JSON.stringify({ type: "leave" }));
      } catch (e) {
        /* ignore */
      }
    } else if (this.token && this.code && !this._ended) {
      // 再接続中に退室した場合も相手に伝わるよう、一度だけ戻って leave を送る(結果は待たない)
      this._sendLeaveViaFreshSocket();
    }
    this._dropSocket();
    this.status = "closed";
    window.removeEventListener("online", this._onOnline);
    document.removeEventListener("visibilitychange", this._onVisible);
    window.removeEventListener("pagehide", this._onPageHide);
  }
}

// ---------------- 観戦 ----------------

/** 観戦の接続が切れたとき、同じ対局の観戦に戻ろうとし続ける最大時間 */
const SPECTATE_RECONNECT_GIVE_UP_MS = 60 * 1000;

/**
 * 観戦できる対局の一覧をサーバーに1回だけ問い合わせる(問い合わせ専用の短い接続)。
 * @returns {Promise<Array<{code: string, names: object, spectators: number, round: object|null}>>}
 */
function fetchSpectatableGames(serverUrl) {
  return new Promise((resolve, reject) => {
    let ws;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch (e) {
        /* ignore */
      }
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("サーバーから応答がありませんでした。")), 10000);
    try {
      ws = new WebSocket(serverUrl);
    } catch (e) {
      clearTimeout(timer);
      reject(new Error("サーバーに接続できませんでした: " + ((e && e.message) || e)));
      return;
    }
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "list-games" })));
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg && msg.type === "games") finish(resolve, Array.isArray(msg.list) ? msg.list : []);
    });
    const fail = () => finish(reject, new Error("サーバーに接続できませんでした。URLをご確認ください: " + serverUrl));
    ws.addEventListener("error", fail);
    ws.addEventListener("close", fail);
  });
}

/**
 * 観戦用の接続。対局データを受け取るだけで、送信は一切しない。
 * OnlineMahjongApp(を継承した SpectatorMahjongApp)が要求するのと同じ形のインターフェースを持つ。
 * 接続が切れた場合は、同じ対局の観戦に自動で戻ろうとする(対局者と違い座席の予約は無いので、
 * 戻れなければ観戦終了として扱う)。
 *
 * status: "connecting" | "connected" | "reconnecting" | "closed"
 */
class SpectatorController {
  constructor({ serverUrl }) {
    this.serverUrl = serverUrl;
    this.code = null;
    this.latest = null;
    this.ws = null;
    this.status = "connecting";
    this.spectatorCount = 0;
    this.reconnectAttempts = 0;
    /** 観戦者には対戦相手の在席表示は不要 */
    this.room = null;
    this._stopped = false;
    this._ended = false;
    this._socketGen = 0;
    this._pending = null;
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._lastMessageAt = 0;
    this._disconnectedAt = null;

    this.onUpdate = null;
    this.onReconnected = null;
    this.onConnectionChange = null;
    this.onPeerLeft = null;
    this.onFatal = null;
    this.onError = null;

    this._onOnline = () => this._reconnectNowIfNeeded();
    this._onVisible = () => {
      if (document.visibilityState === "visible") this._reconnectNowIfNeeded();
    };
    window.addEventListener("online", this._onOnline);
    document.addEventListener("visibilitychange", this._onVisible);
  }

  isConnected() {
    return this.status === "connected";
  }

  _setStatus(status) {
    if (this.status === status) return;
    this.status = status;
    if (this.onConnectionChange) this.onConnectionChange();
  }

  /** 観戦を始める。対局データを受け取れたら解決する。 */
  start(code) {
    this.code = code;
    return new Promise((resolve, reject) => {
      this._pending = { resolve, reject };
      this._openSocket();
    });
  }

  _openSocket() {
    const gen = ++this._socketGen;
    let ws;
    try {
      ws = new WebSocket(this.serverUrl);
    } catch (e) {
      this._onSocketLost(gen, "サーバーに接続できませんでした: " + ((e && e.message) || e));
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (gen !== this._socketGen) return;
      this._lastMessageAt = Date.now();
      ws.send(JSON.stringify({ type: "spectate", code: this.code }));
      this._startPing(gen);
    });
    ws.addEventListener("message", (ev) => {
      if (gen !== this._socketGen) return;
      this._lastMessageAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      this._handleMessage(msg);
    });
    ws.addEventListener("close", () => this._onSocketLost(gen));
    ws.addEventListener("error", () => this._onSocketLost(gen));
  }

  _dropSocket() {
    this._socketGen++;
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        /* ignore */
      }
    }
    this.ws = null;
  }

  _startPing(gen) {
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (gen !== this._socketGen || !this.ws) return;
      if (Date.now() - this._lastMessageAt > WS_SILENCE_TIMEOUT_MS) {
        this._onSocketLost(gen);
        return;
      }
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch (e) {
          /* close イベントで処理される */
        }
      }
    }, WS_PING_INTERVAL_MS);
  }

  _onSocketLost(gen, message) {
    if (gen !== this._socketGen) return;
    this._dropSocket();
    if (this._stopped || this._ended) return;
    if (this._pending) {
      // まだ観戦を始められていない: 単に失敗として返す
      this._fail(message || "サーバーに接続できませんでした。URLをご確認ください: " + this.serverUrl);
      return;
    }
    if (this._disconnectedAt === null) this._disconnectedAt = Date.now();
    if (Date.now() - this._disconnectedAt > SPECTATE_RECONNECT_GIVE_UP_MS) {
      this._end("サーバーとの接続が切れたため、観戦を終了しました。");
      return;
    }
    this._setStatus("reconnecting");
    const delay =
      this.reconnectAttempts < WS_RECONNECT_DELAYS_MS.length ? WS_RECONNECT_DELAYS_MS[this.reconnectAttempts] : WS_RECONNECT_MAX_DELAY_MS;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._attemptReconnect(), delay);
  }

  _attemptReconnect() {
    this._reconnectTimer = null;
    if (this._stopped || this._ended) return;
    this.reconnectAttempts++;
    if (this.onConnectionChange) this.onConnectionChange();
    this._openSocket();
  }

  _reconnectNowIfNeeded() {
    if (this.status !== "reconnecting" || this._stopped || this._ended) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;
    clearTimeout(this._reconnectTimer);
    this._attemptReconnect();
  }

  _fail(message) {
    this._stopped = true;
    this._dropSocket();
    this._setStatus("closed");
    const p = this._pending;
    this._pending = null;
    if (p) p.reject(new Error(message));
  }

  /** 観戦を続けられなくなった(対局終了・再接続失敗) */
  _end(message) {
    this._ended = true;
    this._dropSocket();
    clearTimeout(this._reconnectTimer);
    this._setStatus("closed");
    if (this.onFatal) this.onFatal(message);
  }

  _handleMessage(msg) {
    if (!msg || typeof msg.type !== "string" || msg.type === "pong") return;
    if (msg.type === "spectating") {
      this.code = msg.code || this.code;
      // 観戦はサーバー側で遅らせて届く(既定3分)。最初の対局データが届く予定の時刻を覚えておく
      this.delayMs = typeof msg.delayMs === "number" ? msg.delayMs : 0;
      this.startsAt = Date.now() + (typeof msg.startsInMs === "number" ? msg.startsInMs : 0);
      this.spectatorCount = typeof msg.spectators === "number" ? msg.spectators : this.spectatorCount;
      this.latest = { seats: { east: "peer", south: "peer" }, names: msg.names, game: msg.game || null };
      const wasReconnecting = this._disconnectedAt !== null;
      this.reconnectAttempts = 0;
      this._disconnectedAt = null;
      this._setStatus("connected");
      if (this._pending) {
        const p = this._pending;
        this._pending = null;
        p.resolve({ code: this.code });
      } else if (wasReconnecting && this.onReconnected) {
        this.onReconnected(this.latest);
      }
      return;
    }
    if (msg.type === "spectate-failed") {
      if (this._pending) this._fail(msg.message || "観戦できませんでした。");
      else this._end(msg.message || "観戦を続けられなくなりました。");
      return;
    }
    if (msg.type === "spectate-ended") {
      this._end(msg.message || "対局が終了しました。");
      return;
    }
    if (msg.type === "game") {
      this.latest = Object.assign({}, this.latest, { game: msg.payload });
      if (this.onUpdate) this.onUpdate(this.latest);
      return;
    }
    if (msg.type === "spectators") {
      this.spectatorCount = typeof msg.count === "number" ? msg.count : 0;
      if (this.onConnectionChange) this.onConnectionChange();
    }
  }

  /** 観戦者は対局データを送らない(呼ばれても何もしない) */
  /** 観戦者は操作しない */
  sendAction() {
    return false;
  }

  /** 観戦をやめる */
  stop() {
    this._stopped = true;
    clearTimeout(this._reconnectTimer);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "stop-spectate" }));
      } catch (e) {
        /* ignore */
      }
    }
    this._dropSocket();
    this.status = "closed";
    window.removeEventListener("online", this._onOnline);
    document.removeEventListener("visibilitychange", this._onVisible);
  }
}

// ---------------- ロビー(メニュー・各設定画面・ルームコード入力) ----------------

const MahjongLobby = (function () {
  const SERVER_URL_STORAGE_KEY = "mahjong_ws_server_url";
  const PLAYER_NAME_STORAGE_KEY = "mahjong_ws_player_name";
  const TIME_CONTROL_STORAGE_KEY = "mahjong_ws_time_control";

  /** ルーム作成時に選べる持ち時間(秒、打牌ごと+局ごと)。null は持ち時間なし */
  const TIME_CONTROL_PRESETS = [
    { perAction: 5, bank: 20 },
    { perAction: 5, bank: 10 },
    { perAction: 3, bank: 5 },
    { perAction: 20, bank: 0 },
    { perAction: 60, bank: 0 },
    { perAction: 300, bank: 0 },
    null,
  ];
  /** 直接入力で受け付ける上限(秒) */
  const TIME_CONTROL_MAX_SEC = 3600;

  function loadLastTimeControl() {
    try {
      const raw = localStorage.getItem(TIME_CONTROL_STORAGE_KEY);
      if (!raw) return DEFAULT_TIME_CONTROL;
      const v = JSON.parse(raw);
      if (v === null) return null;
      if (v && Number.isFinite(v.perAction) && Number.isFinite(v.bank)) return { perAction: v.perAction, bank: v.bank };
    } catch (e) {
      /* ignore */
    }
    return DEFAULT_TIME_CONTROL;
  }
  function saveLastTimeControl(tc) {
    try {
      localStorage.setItem(TIME_CONTROL_STORAGE_KEY, JSON.stringify(tc));
    } catch (e) {
      /* ignore */
    }
  }
  const ALLOW_SPECTATE_STORAGE_KEY = "mahjong_ws_allow_spectate";
  /** 前回ルーム作成時に選んだ「観戦を許可するか」(既定は許可) */
  function loadAllowSpectate() {
    try {
      return localStorage.getItem(ALLOW_SPECTATE_STORAGE_KEY) !== "no";
    } catch (e) {
      return true;
    }
  }
  function saveAllowSpectate(allow) {
    try {
      localStorage.setItem(ALLOW_SPECTATE_STORAGE_KEY, allow ? "yes" : "no");
    } catch (e) {
      /* ignore */
    }
  }
  const ROOM_DEALER_STORAGE_KEY = "mahjong_room_dealer";
  /** 前回ルーム作成時に選んだ起家の決め方("self" | "opponent" | "random"。既定 "self") */
  function loadRoomDealer() {
    try {
      const v = localStorage.getItem(ROOM_DEALER_STORAGE_KEY);
      return ["self", "opponent", "random"].includes(v) ? v : "self";
    } catch (e) {
      return "self";
    }
  }
  function saveRoomDealer(v) {
    try {
      localStorage.setItem(ROOM_DEALER_STORAGE_KEY, v);
    } catch (e) {
      /* ignore */
    }
  }
  const ROOM_GAME_LENGTH_STORAGE_KEY = "mahjong_room_game_length";
  /** 前回ルーム作成時に選んだ対局の長さ("full" = 一荘戦 | "half" = 半荘戦。既定 "full") */
  function loadRoomGameLength() {
    try {
      return localStorage.getItem(ROOM_GAME_LENGTH_STORAGE_KEY) === "half" ? "half" : "full";
    } catch (e) {
      return "full";
    }
  }
  function saveRoomGameLength(v) {
    try {
      localStorage.setItem(ROOM_GAME_LENGTH_STORAGE_KEY, v);
    } catch (e) {
      /* ignore */
    }
  }
  const TEST_PLAY_OPTIONS_STORAGE_KEY = "mahjong_testplay_options";
  /** 前回のテストプレイの設定 { cpuType, timeControl, dealer, gameLength }(無ければ既定値) */
  function loadTestPlayOptions() {
    const def = { cpuType: "weak", timeControl: DEFAULT_TIME_CONTROL, dealer: "self", gameLength: "full" };
    try {
      const v = JSON.parse(localStorage.getItem(TEST_PLAY_OPTIONS_STORAGE_KEY) || "null");
      if (!v || typeof v !== "object") return def;
      const tc = v.timeControl === null ? null : v.timeControl && Number.isFinite(v.timeControl.perAction) && Number.isFinite(v.timeControl.bank) ? v.timeControl : def.timeControl;
      return {
        cpuType:
          v.cpuType === "defense"
            ? "balanced"
            : ["tsumogiri", "balanced", "defensive", "offensive"].includes(v.cpuType)
              ? v.cpuType
              : "weak",
        timeControl: tc,
        dealer: ["self", "cpu", "random"].includes(v.dealer) ? v.dealer : "self",
        gameLength: v.gameLength === "half" ? "half" : "full",
      };
    } catch (e) {
      return def;
    }
  }
  function saveTestPlayOptions(opts) {
    try {
      localStorage.setItem(TEST_PLAY_OPTIONS_STORAGE_KEY, JSON.stringify(opts));
    } catch (e) {
      /* ignore */
    }
  }

  function sameTimeControl(a, b) {
    if (!a || !b) return a === b;
    return a.perAction === b.perAction && a.bank === b.bank;
  }

  function el(tag, props) {
    const e = document.createElement(tag);
    if (props) Object.assign(e, props);
    return e;
  }

  /** 中継サーバー(画面からは変更できない) */
  const DEFAULT_SERVER_URL = "wss://ryanma.onrender.com";

  /**
   * 接続するサーバー。常に DEFAULT_SERVER_URL(以前オプションで別のURLを保存していても使わない)。
   * 動作確認用に、localStorage(SERVER_URL_STORAGE_KEY)に自分の端末のサーバー(ws://localhost 等)が
   * 入っているときだけ、そちらにつなぐ。
   */
  function loadLastServerUrl() {
    try {
      const v = localStorage.getItem(SERVER_URL_STORAGE_KEY);
      if (v && /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(v)) return v;
    } catch (e) {
      /* ignore */
    }
    return DEFAULT_SERVER_URL;
  }

  function loadLastPlayerName() {
    try {
      return localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || "";
    } catch (e) {
      return "";
    }
  }
  function saveLastPlayerName(name) {
    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    } catch (e) {
      /* ignore */
    }
  }

  // ---------------- オンライン人数のリアルタイム表示 ----------------
  // ロビー・オプション・自動マッチングの待機画面など、対局が始まる前のどの画面でも
  // 「今サーバーに何人つながっているか(対局中の人も含む)」を表示できるよう、対局用の接続
  // (WsRoomController、実際に create/join/match するまで開かない)とは別に、表示専用の
  // 軽い接続を1本だけ、このロビー画面を開いている間ずっと張っておく。サーバーは接続数が
  // 変わるたびに { type: "online-count", count } を全員へ送ってくるので、こちら側からは
  // 何も送信せず受信するだけでよい。対局用の接続の再接続ロジック(トークンでの座席復帰等)を
  // 複雑にしないための分離。
  /** 直近に受け取ったオンライン人数。まだ受け取っていない・切断中は null(=表示しない)。 */
  let onlineCountValue = null;
  /**
   * 直近に受け取ったルールごとの対局中・相手待ちの人数 {full, half}(自動マッチングのルール選択画面の
   * 「接続数」)。まだ受け取っていない・切断中・古いサーバーで送られてこない場合は null。
   */
  let ruleCountsValue = null;
  const onlineCountListeners = new Set();
  let onlineCountWs = null;
  let onlineCountRetryTimer = null;
  const ONLINE_COUNT_RETRY_MS = 8000;

  function notifyOnlineCount(value, byRule) {
    onlineCountValue = value;
    ruleCountsValue = byRule || null;
    for (const cb of onlineCountListeners) cb(value, ruleCountsValue);
  }

  function connectOnlineCountSocket() {
    onlineCountRetryTimer = null;
    if (typeof WebSocket === "undefined") return;
    let ws;
    try {
      ws = new WebSocket(loadLastServerUrl());
    } catch (e) {
      scheduleOnlineCountRetry();
      return;
    }
    onlineCountWs = ws;
    ws.addEventListener("message", (ev) => {
      if (onlineCountWs !== ws) return; // 閉じ終わる前の古い接続に届いた人数は使わない
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (msg && msg.type === "online-count" && typeof msg.count === "number") {
        const b = msg.byRule;
        const byRule =
          b && typeof b === "object" && Number.isFinite(b.full) && Number.isFinite(b.half) ? { full: b.full, half: b.half } : null;
        notifyOnlineCount(msg.count, byRule);
      }
    });
    ws.addEventListener("close", () => {
      // 画面の切り替えで自分から閉じた古い接続の close は無視する。回線が遅いと、閉じ終わる前に次の画面が
      // 新しい接続を張っていることがあり、ここで人数を消したり再接続を予約したりすると、表示が「-」に
      // なったうえ、8秒後にもう1本接続を張って前の接続が閉じられないまま残ってしまう(自分が2人と数えられる)。
      if (onlineCountWs !== ws) return;
      onlineCountWs = null;
      notifyOnlineCount(null);
      scheduleOnlineCountRetry();
    });
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch (e) {
        /* ignore(上の close ハンドラに任せる) */
      }
    });
  }

  function scheduleOnlineCountRetry() {
    if (onlineCountRetryTimer || onlineCountListeners.size === 0) return;
    onlineCountRetryTimer = setTimeout(connectOnlineCountSocket, ONLINE_COUNT_RETRY_MS);
  }

  /**
   * オンライン人数の表示を購読する。呼んだ直後に(まだ値が無ければ null で)1回、
   * 以後は値が変わるたびに cb(人数, ルールごとの人数 {full, half} | null) が呼ばれる。
   * 表示用の接続がまだ無ければここで張る。
   * @returns {() => void} 購読解除(このリスナーが最後の1つなら接続も閉じる)
   */
  function watchOnlineCount(cb) {
    onlineCountListeners.add(cb);
    if (!onlineCountWs && !onlineCountRetryTimer) connectOnlineCountSocket();
    cb(onlineCountValue, ruleCountsValue);
    return () => {
      onlineCountListeners.delete(cb);
      if (onlineCountListeners.size > 0) return;
      clearTimeout(onlineCountRetryTimer);
      onlineCountRetryTimer = null;
      if (onlineCountWs) {
        try {
          onlineCountWs.close();
        } catch (e) {
          /* ignore */
        }
        onlineCountWs = null;
      }
    };
  }

  /** オンライン人数を表示する小さな行のDOMを作る(値はまだ無ければ「-」)。以後は自動で更新される。 */
  function buildOnlineCountRow(source) {
    const row = el("p", { className: "online-count" });
    const label = document.createTextNode("オンライン: ");
    const value = el("span", { className: "online-count-value", textContent: "-" });
    row.appendChild(label);
    row.appendChild(value);
    row.appendChild(document.createTextNode("人"));
    // source: 人数の購読元(省略時は人数表示専用の接続)。自動マッチングの待機中は、
    // マッチング用の接続に届く人数を使う(専用の接続を別に張ると自分が2人分数えられるため)
    const subscribe = source || watchOnlineCount;
    const unsubscribe = subscribe((count) => {
      value.textContent = count == null ? "-" : String(count);
    });
    // この行がDOMから外れたら(画面遷移で root.innerHTML が書き換わったら)購読も止める。
    new MutationObserver((mutations, observer) => {
      if (!document.body.contains(row)) {
        unsubscribe();
        observer.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });
    return row;
  }

  /**
   * ロビー画面用のオンライン人数表示。通信量削減のため、この画面に
   * LOBBY_IDLE_DISCONNECT_MS(5分)以上とどまった場合は表示専用の接続を切る
   * (「-」表示に戻る)。自動マッチング・ルーム作成・ルーム参加は、押した時点で
   * それぞれ別に新しい接続を張るため、この切断とは無関係にいつでも押せる。
   */
  function buildLobbyOnlineCountRow() {
    const row = el("p", { className: "online-count" });
    const label = document.createTextNode("オンライン: ");
    const value = el("span", { className: "online-count-value", textContent: "-" });
    row.appendChild(label);
    row.appendChild(value);
    row.appendChild(document.createTextNode("人"));
    const unsubscribe = watchOnlineCount((count) => {
      value.textContent = count == null ? "-" : String(count);
    });
    let idleDisconnected = false;
    const idleTimer = setTimeout(() => {
      idleDisconnected = true;
      unsubscribe();
      value.textContent = "-";
    }, LOBBY_IDLE_DISCONNECT_MS);
    new MutationObserver((mutations, observer) => {
      if (!document.body.contains(row)) {
        clearTimeout(idleTimer);
        if (!idleDisconnected) unsubscribe();
        observer.disconnect();
      }
    }).observe(document.body, { childList: true, subtree: true });
    return row;
  }

  function mount(root) {
    let currentApp = null;

    // BGM: 対局の卓が出ていない間(ロビー・オプション・待機画面など)は流し続け、卓が出たら止める。
    // 画面を切り替えても同じ曲をそのまま流し続けるので、対局が始まるまで途切れない。
    const syncBgm = () => MahjongSound.setBgmWanted(!root.querySelector(".table"));
    new MutationObserver(syncBgm).observe(root, { childList: true, subtree: true });
    syncBgm();

    function cleanup() {
      if (currentApp && typeof currentApp.destroy === "function") currentApp.destroy();
      currentApp = null;
    }

    function showLobby() {
      cleanup();
      root.innerHTML = "";

      // lobby-main: スマホ横向きでは、ボタンを2列に並べて画面の高さに収める専用の配置になる
      const wrap = el("div", { className: "lobby lobby-main" });

      // 前回のオンライン対局の途中でページを閉じた・再読み込みした場合は、同じ座席に戻れる
      // (サーバー側で切断から5分間、座席が予約されている)。
      const session = loadWsSession();
      if (session) {
        const resumeBox = el("div", { className: "lobby-resume" });
        resumeBox.appendChild(
          el("p", { textContent: `前回のオンライン対局(ルーム ${session.code})に戻れます。` })
        );
        const resumeRow = el("div", { className: "lobby-join-row" });
        const resumeBtn = el("button", { type: "button", className: "btn btn-primary", textContent: "対局に戻る" });
        resumeBtn.addEventListener("click", () => resumeOnline(session));
        const discardBtn = el("button", { type: "button", className: "btn", textContent: "破棄する" });
        discardBtn.addEventListener("click", () => {
          clearWsSession();
          showLobby();
        });
        resumeRow.appendChild(resumeBtn);
        resumeRow.appendChild(discardBtn);
        resumeBox.appendChild(resumeRow);
        wrap.appendChild(resumeBox);
      }

      // メニュー: 自動マッチング / ルームを作成 / ルームに参加 / CPU対戦 / オプション
      // (プレイヤー名は「オプション」で設定する。接続先は常に既定のサーバー)
      const onlineSection = el("div", { className: "lobby-online" });
      const menuBtn = (text, onClick, primary) => {
        const b = el("button", { type: "button", className: "btn" + (primary ? " btn-primary" : ""), textContent: text });
        b.addEventListener("click", onClick);
        onlineSection.appendChild(b);
        return b;
      };
      // 自動マッチング: 同じサーバーで相手を探している人と自動で組む
      menuBtn("自動マッチング", showMatchRuleSelect, true);
      // ゲスト(ログインなし)はルーム作成・牌譜を使えない(docs/account-spec.md)
      const loggedIn = MahjongAccount.isLoggedIn();
      // ルーム作成時は、先に持ち時間を決める画面を挟む
      if (loggedIn) menuBtn("ルームを作成", () => showRoomOptions(loadLastServerUrl(), loadLastPlayerName()));
      // ルームに参加: ルームコードは次の画面で入力する
      menuBtn("ルームに参加", showJoinRoom);
      // 観戦: 対局中の一覧から選ぶか、ルームコードを入力して観戦する
      menuBtn("観戦", showSpectateList);
      // CPU対戦は画面上側(相手側)をCPUが操作する。開始前にCPU・持ち時間・起家を選ぶ
      menuBtn("CPU対戦", showTestPlayOptions);
      if (loggedIn) menuBtn("牌譜", showKifuList);
      menuBtn(loggedIn ? "アカウント" : "ユーザー登録・ログイン", showAccount);
      menuBtn("オプション", showSettings);
      menuBtn("ルール確認", showRules);

      wrap.appendChild(onlineSection);

      // 現在のプレイヤー名(変更は「オプション」から)とオンライン人数
      const info = el("div", { className: "lobby-current" });
      const nameP = el("p", { className: "lobby-current-name", textContent: `プレイヤー名: ${accountLabel()}` });
      info.appendChild(nameP);
      // サーバーに名乗った結果(ゲスト番号・ログイン中の名前)が届いたら表示を更新する。ログインが切れていたら画面ごと描き直す
      const unsubscribeName = MahjongAccount.onChange(() => {
        if (!nameP.isConnected) {
          unsubscribeName();
          return;
        }
        if (MahjongAccount.isLoggedIn() !== loggedIn) showLobby();
        else nameP.textContent = `プレイヤー名: ${accountLabel()}`;
      });
      // ログアウト直後などで名前(ゲスト番号)がまだ分からなければ、サーバーに名乗って確かめる
      if (!MahjongAccount.displayName()) MahjongAccount.refresh().catch(() => {});
      info.appendChild(buildLobbyOnlineCountRow());
      wrap.appendChild(info);
      root.appendChild(wrap);
    }

    /**
     * 持ち時間(打牌ごと+局ごと)を選ぶ欄。決められた設定から選ぶか直接入力する。
     * 戻り値の read() は { value } か { error } を返す(value は {perAction, bank} か null=無限)。
     */
    function buildTimeControlField(initial) {
      const fieldset = el("fieldset", { className: "room-options-group room-options-time" });
      fieldset.appendChild(el("legend", { textContent: "持ち時間(打牌ごと+局ごと)" }));
      const name = "time-control-" + Math.random().toString(36).slice(2);
      const presetIndex = TIME_CONTROL_PRESETS.findIndex((p) => sameTimeControl(p, initial));
      const radios = [];
      const addOption = (labelText, value) => {
        const label = el("label", { className: "room-options-choice" });
        const radio = el("input", { type: "radio", name, value });
        label.appendChild(radio);
        label.appendChild(document.createTextNode(" " + labelText));
        fieldset.appendChild(label);
        radios.push(radio);
        return { label, radio };
      };
      TIME_CONTROL_PRESETS.forEach((p, i) => {
        const { radio } = addOption(p ? `${p.perAction}+${p.bank}秒` : "持ち時間なし(無限)", String(i));
        if (i === presetIndex) radio.checked = true;
      });
      // 直接入力
      const custom = addOption("直接入力", "custom");
      const customRow = el("div", { className: "room-options-custom" });
      const numProps = { type: "number", min: "0", max: String(TIME_CONTROL_MAX_SEC), step: "1", inputMode: "numeric", className: "lobby-code-input room-options-num" };
      const perInput = el("input", numProps);
      const bankInput = el("input", numProps);
      const base = initial || DEFAULT_TIME_CONTROL;
      perInput.value = String(base.perAction);
      bankInput.value = String(base.bank);
      customRow.appendChild(el("span", { textContent: "打牌ごと" }));
      customRow.appendChild(perInput);
      customRow.appendChild(el("span", { textContent: "秒 + 局ごと" }));
      customRow.appendChild(bankInput);
      customRow.appendChild(el("span", { textContent: "秒" }));
      customRow.appendChild(el("span", { className: "room-options-hint", textContent: "打牌ごとは1秒以上、局ごとは0秒以上。両方0秒で持ち時間なし(無限)" }));
      custom.label.appendChild(customRow);
      if (presetIndex < 0) custom.radio.checked = true;
      // 数字を触ったら直接入力を選んだことにする
      for (const input of [perInput, bankInput]) {
        input.addEventListener("focus", () => (custom.radio.checked = true));
        input.addEventListener("input", () => (custom.radio.checked = true));
      }
      function read() {
        const selected = radios.find((r) => r.checked);
        if (!selected) return { error: "持ち時間を選んでください。" };
        if (selected.value !== "custom") return { value: TIME_CONTROL_PRESETS[Number(selected.value)] };
        const valid = (input) => {
          const n = Number(input.value);
          return input.value !== "" && Number.isInteger(n) && n >= 0 && n <= TIME_CONTROL_MAX_SEC;
        };
        if (!valid(perInput) || !valid(bankInput)) {
          return { error: `持ち時間は0〜${TIME_CONTROL_MAX_SEC}秒の整数で入力してください。` };
        }
        const per = Number(perInput.value);
        const bank = Number(bankInput.value);
        // 打牌ごと0秒・局ごと0秒は「持ち時間なし(無限)」として扱う
        if (per === 0 && bank === 0) return { value: null };
        if (per < 1) return { error: "打牌ごとの時間は1秒以上にしてください(両方0秒にすると持ち時間なしになります)。" };
        return { value: { perAction: per, bank } };
      }
      return { fieldset, read };
    }

    /**
     * ラジオボタンの選択欄(CPUの種類・起家など)。read() は選ばれた value を返す。
     * options の各要素は [value, 表示名, 説明文(省略可。選択肢の下に小さく出す)]
     */
    function buildRadioField(legendText, options, initialValue) {
      const fieldset = el("fieldset", { className: "room-options-group" });
      fieldset.appendChild(el("legend", { textContent: legendText }));
      const name = "opt-" + Math.random().toString(36).slice(2);
      const radios = options.map(([value, text, note]) => {
        const label = el("label", { className: "room-options-choice" });
        const radio = el("input", { type: "radio", name, value });
        if (value === initialValue) radio.checked = true;
        label.appendChild(radio);
        label.appendChild(document.createTextNode(" " + text));
        if (note) label.appendChild(el("span", { className: "room-options-note", textContent: note }));
        fieldset.appendChild(label);
        return radio;
      });
      if (!radios.some((r) => r.checked)) radios[0].checked = true;
      return { fieldset, read: () => (radios.find((r) => r.checked) || radios[0]).value };
    }

    /** 一荘戦・半荘戦の説明文(自動マッチングのルール選択・ルーム作成・CPU対戦の設定で共通) */
    const GAME_LENGTH_NOTES = { full: "東〜北2局ずつの計8局", half: "東・南2局ずつの計4局" };

    /** 対局の長さ(一荘戦/半荘戦)の選択欄 */
    function buildGameLengthField(initialValue) {
      return buildRadioField(
        "対局",
        [
          ["full", "一荘戦", GAME_LENGTH_NOTES.full],
          ["half", "半荘戦", GAME_LENGTH_NOTES.half],
        ],
        initialValue
      );
    }

    /**
     * 自動マッチングのルール選択画面。一荘戦・半荘戦のボタンの下に、説明文と、今そのルールで
     * 対局中・相手待ちの人数(「接続数:n人」。サーバーの online-count の byRule)を出す。
     * 同じルールを選んだ人とだけ組まれる。
     */
    function showMatchRuleSelect() {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby room-options options-screen match-rule-screen" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: "自動マッチング" }));
      const fieldsBox = el("div", { className: "options-fields" });
      const countEls = {};
      for (const [value, text] of [
        ["full", "一荘戦"],
        ["half", "半荘戦"],
      ]) {
        const group = el("div", { className: "room-options-group match-rule-group" });
        const btn = el("button", { type: "button", className: "btn btn-primary match-rule-btn", textContent: text });
        btn.addEventListener("click", () =>
          startOnline("match", loadLastServerUrl(), null, loadLastPlayerName(), undefined, { gameLength: value })
        );
        group.appendChild(btn);
        group.appendChild(el("p", { className: "match-rule-note", textContent: GAME_LENGTH_NOTES[value] }));
        countEls[value] = el("p", { className: "online-count match-rule-count", textContent: "接続数:-人" });
        group.appendChild(countEls[value]);
        fieldsBox.appendChild(group);
      }
      wrap.appendChild(fieldsBox);
      const row = el("div", { className: "lobby-join-row" });
      const backBtn = el("button", { type: "button", className: "btn", textContent: "戻る" });
      backBtn.addEventListener("click", showLobby);
      row.appendChild(backBtn);
      wrap.appendChild(row);
      root.appendChild(wrap);

      const showCounts = (byRule) => {
        for (const k of ["full", "half"]) {
          countEls[k].textContent = `接続数:${byRule ? byRule[k] : "-"}人`;
        }
      };
      const unsubscribe = watchOnlineCount((count, byRule) => showCounts(byRule));
      // ロビーと同じく、この画面に5分以上とどまったら表示用の接続を切る(通信量削減。ボタンはいつでも押せる)
      let idleDisconnected = false;
      const idleTimer = setTimeout(() => {
        idleDisconnected = true;
        unsubscribe();
        showCounts(null);
      }, LOBBY_IDLE_DISCONNECT_MS);
      new MutationObserver((mutations, observer) => {
        if (!document.body.contains(wrap)) {
          clearTimeout(idleTimer);
          if (!idleDisconnected) unsubscribe();
          observer.disconnect();
        }
      }).observe(document.body, { childList: true, subtree: true });
    }

    /**
     * 対局(一荘戦/半荘戦)と起家の欄を1つの列にまとめる。スマホ横向きでは2つを縦に重ねて1列にし、
     * 持ち時間などの欄の幅を確保する。縦向き・PC では列を無いものとして扱い(display: contents)、
     * 対局・起家の順にほかの欄と同じく縦に並ぶ(styles.css の「一荘戦・半荘戦」)。showOptionsScreen の fields に渡せる形で返す。
     */
    function buildLengthDealerColumn(length, dealer) {
      const col = el("div", { className: "options-col" });
      dealer.fieldset.classList.add("room-options-dealer");
      col.appendChild(length.fieldset);
      col.appendChild(dealer.fieldset);
      return { fieldset: col };
    }

    /** 設定画面の共通の枠(タイトル・エラー表示・決定/戻るボタン) */
    function showOptionsScreen(title, fields, okText, onOk) {
      root.innerHTML = "";
      // options-screen: スマホ横向きでは、設定欄を横に並べて画面の高さに収める専用の配置になる
      // (styles.css の「スマートフォン横向き: 設定画面」参照)。
      const wrap = el("div", { className: "lobby room-options options-screen" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: title }));
      const fieldsBox = el("div", { className: "options-fields" });
      for (const f of fields) fieldsBox.appendChild(f.fieldset);
      wrap.appendChild(fieldsBox);
      const errorP = el("p", { className: "lobby-error" });
      wrap.appendChild(errorP);
      const row = el("div", { className: "lobby-join-row" });
      const okBtn = el("button", { type: "button", className: "btn btn-primary", textContent: okText });
      const backBtn = el("button", { type: "button", className: "btn", textContent: "戻る" });
      okBtn.addEventListener("click", () => {
        const error = onOk();
        errorP.textContent = error || "";
      });
      backBtn.addEventListener("click", showLobby);
      row.appendChild(okBtn);
      row.appendChild(backBtn);
      wrap.appendChild(row);
      root.appendChild(wrap);
    }

    /**
     * ルーム作成前のオプション画面。対局の長さ(一荘戦/半荘戦)・持ち時間(打牌ごと+局ごと)・観戦の許可・起家を決める。
     * 決めた設定はルーム作成者(ホスト)から対局データと一緒に相手へ配られる。
     */
    function showRoomOptions(serverUrl, name) {
      const time = buildTimeControlField(loadLastTimeControl());
      const spectate = buildRadioField(
        "観戦",
        [
          ["yes", "許可する"],
          ["no", "許可しない"],
        ],
        loadAllowSpectate() ? "yes" : "no"
      );
      const dealer = buildRadioField(
        "起家(最初の親)",
        [
          ["self", "自分"],
          ["opponent", "相手"],
          ["random", "ランダム"],
        ],
        loadRoomDealer()
      );
      const length = buildGameLengthField(loadRoomGameLength());
      showOptionsScreen("ルームの設定", [buildLengthDealerColumn(length, dealer), time, spectate], "ルームを作成する", () => {
        const r = time.read();
        if (r.error) return r.error;
        saveLastTimeControl(r.value);
        const allowSpectate = spectate.read() === "yes";
        saveAllowSpectate(allowSpectate);
        const dealerChoice = dealer.read();
        saveRoomDealer(dealerChoice);
        const gameLength = length.read();
        saveRoomGameLength(gameLength);
        startOnline("create", serverUrl, null, name, r.value, { allowSpectate, dealerChoice, gameLength });
        return null;
      });
    }

    /** テストプレイ(CPU戦)の開始前のオプション画面。対局の長さ・CPUの種類・持ち時間・起家を決める。 */
    function showTestPlayOptions() {
      const last = loadTestPlayOptions();
      const cpu = buildRadioField(
        "CPU",
        [
          ["weak", "ポンコツ型"],
          ["defensive", "守備型"],
          ["offensive", "攻撃型"],
          ["balanced", "バランス型"],
          ["tsumogiri", "ツモ切りのみ"],
        ],
        last.cpuType
      );
      const time = buildTimeControlField(last.timeControl);
      const dealer = buildRadioField(
        "起家(最初の親)",
        [
          ["self", "自分"],
          ["cpu", "CPU"],
          ["random", "ランダム"],
        ],
        last.dealer
      );
      const length = buildGameLengthField(last.gameLength);
      showOptionsScreen("CPU対戦の設定", [buildLengthDealerColumn(length, dealer), time, cpu], "開始する", () => {
        const t = time.read();
        if (t.error) return t.error;
        const opts = { cpuType: cpu.read(), timeControl: t.value, dealer: dealer.read(), gameLength: length.read() };
        saveTestPlayOptions(opts);
        const selfIsDealer = opts.dealer === "self" || (opts.dealer === "random" && Math.random() < 0.5);
        root.innerHTML = "";
        // 起家は常に east なので、自分が起家なら自分を east、CPUが起家なら自分を south にする
        currentApp = new CpuMahjongApp(root, {
          onExit: showLobby,
          cpuType: opts.cpuType,
          timeControl: opts.timeControl,
          gameLength: opts.gameLength,
          humanSeat: selfIsDealer ? "east" : "south",
        });
        return null;
      });
    }

    /** 「ルームに参加」: ルームコードを入力して参加する画面 */
    function showJoinRoom() {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby room-options" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: "ルームに参加" }));
      const codeInput = el("input", {
        type: "text",
        placeholder: "ルームコード",
        maxLength: 6,
        autocapitalize: "characters",
        className: "lobby-code-input",
      });
      wrap.appendChild(codeInput);
      const errorP = el("p", { className: "lobby-error" });
      wrap.appendChild(errorP);
      const row = el("div", { className: "lobby-join-row" });
      const okBtn = el("button", { type: "button", className: "btn btn-primary", textContent: "参加する" });
      const backBtn = el("button", { type: "button", className: "btn", textContent: "戻る" });
      const join = () => {
        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
          errorP.textContent = "ルームコードを入力してください。";
          return;
        }
        startOnline("join", loadLastServerUrl(), code, loadLastPlayerName());
      };
      okBtn.addEventListener("click", join);
      codeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") join();
      });
      backBtn.addEventListener("click", showLobby);
      row.appendChild(okBtn);
      row.appendChild(backBtn);
      wrap.appendChild(row);
      root.appendChild(wrap);
      codeInput.focus();
    }

    /** 「オプション」: プレイヤー名・牌譜・音の設定 */
    // ---------------- アカウント(docs/account-spec.md) ----------------

    /** ロビー・オプションに出す名前(ゲストの名前はサーバーが「(ゲスト)」を付けたもの。まだ分からなければ「確認中」) */
    function accountLabel() {
      const n = MahjongAccount.displayName();
      if (MahjongAccount.isLoggedIn()) return n || "(確認中)";
      return n || "ゲスト";
    }

    /** アカウントの画面の共通の枠。戻り値の error(text) で枠内にエラーを出す */
    function accountScreen(title) {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby room-options account-screen" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: title }));
      const errorP = el("p", { className: "lobby-error" });
      root.appendChild(wrap);
      return {
        wrap,
        text(t, className) {
          const p = el("p", { className: className || "account-text", textContent: t });
          wrap.appendChild(p);
          return p;
        },
        field(label, props) {
          const f = el("label", { className: "settings-field" });
          f.appendChild(el("span", { className: "settings-label", textContent: label }));
          const input = el("input", Object.assign({ type: "text", className: "lobby-code-input account-input" }, props));
          f.appendChild(input);
          wrap.appendChild(f);
          return input;
        },
        buttons(list) {
          const row = el("div", { className: "lobby-join-row account-buttons" });
          const made = list.map(([text, onClick, primary]) => {
            const b = el("button", { type: "button", className: "btn" + (primary ? " btn-primary" : ""), textContent: text });
            b.addEventListener("click", onClick);
            row.appendChild(b);
            return b;
          });
          wrap.appendChild(row);
          wrap.appendChild(errorP);
          return made;
        },
        error(t) {
          errorP.textContent = t || "";
          if (!errorP.isConnected) wrap.appendChild(errorP);
        },
      };
    }

    /** ボタンを押している間(サーバーの返事待ち)は押せなくする */
    async function busy(buttons, fn) {
      buttons.forEach((b) => (b.disabled = true));
      try {
        return await fn();
      } finally {
        buttons.forEach((b) => (b.disabled = false));
      }
    }

    function showMessage(title, text, next) {
      const sc = accountScreen(title);
      sc.text(text);
      sc.buttons([["OK", next || showLobby, true]]);
    }

    /** アカウントの画面(ゲストは登録・ログイン、ログイン中は名前変更など) */
    function showAccount() {
      if (!MahjongAccount.isLoggedIn()) {
        const sc = accountScreen("ユーザー登録・ログイン");
        sc.text(`いまの名前: ${accountLabel()}`);
        sc.text("ユーザー登録すると、名前を確保でき(「(ゲスト)」が付かなくなります)、ルーム作成・牌譜などの機能が使えます。登録にはメールアドレスが必要です(パスワードは不要)。");
        sc.buttons([
          ["新規登録", showRegister, true],
          ["名前を変更", showGuestRename],
          ["ログイン", showLogin],
          ["メールアドレスの変更", showEmailChange],
          ["プライバシーポリシー", () => showPrivacyPolicy(showAccount)],
          ["戻る", showLobby],
        ]);
        return;
      }
      const sc = accountScreen("アカウント");
      sc.text(`ユーザー名: ${accountLabel()}`);
      const mailP = sc.text("メールアドレス: 読み込み中…");
      const [renameBtn] = sc.buttons([
        ["名前を変更", showRename],
        ["引継ぎコードを発行", showTransferCode],
        ["ログアウト", confirmLogout],
        ["アカウントを削除", confirmDelete],
        ["プライバシーポリシー", () => showPrivacyPolicy(showAccount)],
        ["戻る", showLobby],
      ]);
      MahjongAccount.request({ type: "account-info" })
        .then((info) => {
          if (!mailP.isConnected) return;
          mailP.textContent = `メールアドレス: ${info.email}`;
          if (info.nameChangeAvailableAt && info.nameChangeAvailableAt > Date.now()) {
            const d = new Date(info.nameChangeAvailableAt);
            renameBtn.disabled = true;
            sc.text(`名前は ${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}時以降に変更できます。`, "account-note");
          }
        })
        .catch((err) => {
          if (!mailP.isConnected) return;
          mailP.textContent = "メールアドレス: -";
          if (err.reason === "account") {
            // 別の端末で削除・メールアドレス変更された等で、自動ログインが無効になっていた
            MahjongAccount.clearSession();
            showMessage("ログインが切れました", "もう一度ログインしてください。", showAccount);
            return;
          }
          sc.error(err.message);
        });
    }

    /** メールを送って、認証コードの入力画面へ進む */
    async function startAuth(sc, buttons, params) {
      sc.error("");
      try {
        const r = await busy(buttons, () => MahjongAccount.request(Object.assign({ type: "auth-start" }, params)));
        const pending = { rid: r.rid, secret: r.secret, mode: params.mode, email: r.email, resendAt: Date.now() + (r.resendAfterMs || 60000) };
        MahjongAccount.savePending(pending);
        showCodeEntry(pending);
      } catch (err) {
        sc.error(err.message);
      }
    }

    function showRegister() {
      const sc = accountScreen("新規登録");
      const nameInput = sc.field("ユーザー名(20文字まで。空白・見えない文字は使えません)", { maxLength: 40, autocomplete: "username" });
      const emailInput = sc.field("メールアドレス", { type: "email", maxLength: 254, autocomplete: "email", inputMode: "email" });
      const agree = el("label", { className: "room-options-choice account-agree" });
      const agreeCb = el("input", { type: "checkbox" });
      agree.appendChild(agreeCb);
      agree.appendChild(el("span", { textContent: " プライバシーポリシーに同意する" }));
      sc.wrap.appendChild(agree);
      const buttons = sc.buttons([
        [
          "確認メールを送る",
          () => {
            if (!agreeCb.checked) {
              sc.error("プライバシーポリシーに同意してください。");
              return;
            }
            startAuth(sc, buttons, { mode: "register", name: nameInput.value, email: emailInput.value });
          },
          true,
        ],
        ["プライバシーポリシー", () => showPrivacyPolicy(showRegister)],
        ["戻る", showAccount],
      ]);
    }

    function showLogin() {
      const sc = accountScreen("ログイン");
      sc.text("登録したユーザー名を入力してください。登録したメールアドレスにログイン用のメールが届きます。");
      const nameInput = sc.field("ユーザー名", { maxLength: 40, autocomplete: "username" });
      const buttons = sc.buttons([
        ["確認メールを送る", () => startAuth(sc, buttons, { mode: "login", name: nameInput.value }), true],
        ["戻る", showAccount],
      ]);
    }

    function showEmailChange() {
      const sc = accountScreen("メールアドレスの変更");
      sc.text("ログイン中の端末の「アカウント」→「引継ぎコードを発行」で出した引継ぎコードと、新しいメールアドレスを入力してください。新しいメールアドレスに確認メールが届きます。");
      const nameInput = sc.field("ユーザー名", { maxLength: 40, autocomplete: "username" });
      const codeInput = sc.field("引継ぎコード", { maxLength: 24, autocomplete: "off", autocapitalize: "characters" });
      const emailInput = sc.field("新しいメールアドレス", { type: "email", maxLength: 254, autocomplete: "email", inputMode: "email" });
      const buttons = sc.buttons([
        [
          "確認メールを送る",
          () => startAuth(sc, buttons, { mode: "email", name: nameInput.value, transferCode: codeInput.value, email: emailInput.value }),
          true,
        ],
        ["戻る", showAccount],
      ]);
    }

    const AUTH_MODE_TITLES = { register: "新規登録", login: "ログイン", email: "メールアドレスの変更", delete: "アカウントの削除" };

    /** 認証コードの入力画面(メールのリンクを押すと表示されるコードを入力する) */
    function showCodeEntry(pending) {
      const sc = accountScreen(AUTH_MODE_TITLES[pending.mode] || "認証コードの入力");
      sc.text(
        `${pending.email} にメールを送りました。メールのリンクを押し、開いたページの「続行」を押すと認証コード(6桁)が表示されます。そのコードを入力してください。`
      );
      sc.text("メールが届かない場合は、迷惑メールのフォルダも確認してください。", "account-note");
      const codeInput = sc.field("認証コード", { maxLength: 7, inputMode: "numeric", autocomplete: "one-time-code", className: "lobby-code-input account-input account-code-input" });
      let resendTimer = null;
      const buttons = sc.buttons([
        [
          "確定",
          async () => {
            sc.error("");
            try {
              const r = await busy(buttons, () =>
                MahjongAccount.request({ type: "auth-complete", rid: pending.rid, secret: pending.secret, code: codeInput.value })
              );
              clearInterval(resendTimer);
              MahjongAccount.savePending(null);
              if (r.deleted) {
                MahjongAccount.clearSession();
                showMessage("アカウントを削除しました", "ご利用ありがとうございました。これからはゲストとして遊べます。");
                return;
              }
              MahjongAccount.setSession(r.token, r.name);
              const doneText = { register: "登録しました", login: "ログインしました", email: "メールアドレスを変更しました" }[pending.mode] || "完了しました";
              showMessage(doneText, `ユーザー名: ${r.name}`);
            } catch (err) {
              sc.error(err.message);
              if (["expired", "attempts", "secret"].includes(err.reason)) MahjongAccount.savePending(null);
            }
          },
          true,
        ],
        [
          "メールを送り直す",
          async () => {
            sc.error("");
            try {
              const r = await busy(buttons, () => MahjongAccount.request({ type: "auth-resend", rid: pending.rid, secret: pending.secret }));
              pending.resendAt = Date.now() + (r.resendAfterMs || 60000);
              MahjongAccount.savePending(pending);
              sc.error("メールを送り直しました。");
              updateResend();
            } catch (err) {
              sc.error(err.message);
            }
          },
        ],
        [
          "やめる",
          () => {
            clearInterval(resendTimer);
            MahjongAccount.savePending(null);
            showAccount();
          },
        ],
      ]);
      const resendBtn = buttons[1];
      // 送り直しは1分おき(残り秒数をボタンに出す)
      const updateResend = () => {
        if (!resendBtn.isConnected) {
          clearInterval(resendTimer);
          return;
        }
        const rest = Math.ceil(((pending.resendAt || 0) - Date.now()) / 1000);
        resendBtn.disabled = rest > 0;
        resendBtn.textContent = rest > 0 ? `メールを送り直す(${rest}秒)` : "メールを送り直す";
      };
      updateResend();
      resendTimer = setInterval(updateResend, 1000);
    }

    /** メールのリンクから開いた確認ページ: 認証コードを表示する */
    function showVerifyPage(params) {
      // Firebase の標準のページの「続行」で戻ってきた場合は ?rid=…&v=…、アクション URL を公開ページにしている場合は
      // ?mode=verifyEmail&oobCode=…&continueUrl=(…?rid=…&v=…)
      let rid = params.get("rid");
      let v = params.get("v");
      const cont = params.get("continueUrl");
      if (cont) {
        try {
          const inner = new URL(cont).searchParams;
          rid = rid || inner.get("rid");
          v = v || inner.get("v");
        } catch (e) {
          /* ignore */
        }
      }
      const oobCode = params.get("oobCode");
      const sc = accountScreen("認証コード");
      const status = sc.text("確認しています…(サーバーの起動に1分ほどかかることがあります)");
      const toTop = () => location.replace(location.pathname);
      if (!rid || (!oobCode && !v)) {
        status.textContent = "リンクが正しくありません。";
        sc.buttons([["ゲームを開く", toTop, true]]);
        return;
      }
      MahjongAccount.request({ type: "auth-verify", rid, oobCode: oobCode || undefined, v: v || undefined })
        .then((r) => {
          // 読み込み直しでリンクを使い直さないよう、アドレスからリンクの情報を消す
          try {
            history.replaceState(null, "", location.pathname);
          } catch (e) {
            /* ignore */
          }
          status.textContent = "ゲームを開いている画面に戻って、次の認証コードを入力してください(10分間有効)。";
          sc.wrap.appendChild(el("div", { className: "account-code-display", textContent: r.code }));
          const d = new Date(r.requestedAt);
          sc.text(
            `受付: ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}(${AUTH_MODE_TITLES[r.mode] || ""})`,
            "account-note"
          );
          sc.text("このコードは誰にも教えないでください。心当たりがない場合は、このページを閉じてください。", "account-warning");
          sc.buttons([["ゲームを開く", toTop]]);
        })
        .catch((err) => {
          status.textContent = err.message;
          sc.buttons([["ゲームを開く", toTop, true]]);
        });
    }

    /** ゲストの名前の変更(後ろに「(ゲスト)」が付く。名前は確保されない) */
    function showGuestRename() {
      const sc = accountScreen("名前を変更");
      sc.text(`いまの名前: ${accountLabel()}`);
      sc.text("ゲストの名前の後ろには「(ゲスト)」が付きます。名前を確保したい場合はユーザー登録してください。", "account-note");
      const nameInput = sc.field("新しい名前(20文字まで。空白・見えない文字は使えません)", { maxLength: 40, autocomplete: "off" });
      const buttons = sc.buttons([
        [
          "変更する",
          async () => {
            sc.error("");
            try {
              const r = await busy(buttons, () => MahjongAccount.request({ type: "guest-rename", name: nameInput.value }));
              MahjongAccount.setGuestName(r.baseName, r.name);
              showMessage("名前を変更しました", `新しい名前: ${r.name}`, showAccount);
            } catch (err) {
              sc.error(err.message);
            }
          },
          true,
        ],
        ["戻る", showAccount],
      ]);
    }

    function showRename() {
      const sc = accountScreen("名前を変更");
      sc.text(`いまの名前: ${accountLabel()}`);
      sc.text("名前を変えると、その後30日間は変更できません。前の名前は5分後から他の人が使えるようになります。", "account-note");
      const nameInput = sc.field("新しいユーザー名", { maxLength: 40, autocomplete: "off" });
      const buttons = sc.buttons([
        [
          "変更する",
          async () => {
            sc.error("");
            try {
              const r = await busy(buttons, () => MahjongAccount.request({ type: "account-rename", name: nameInput.value }));
              MahjongAccount.setSession(MahjongAccount.token(), r.name);
              showMessage("名前を変更しました", `新しい名前: ${r.name}`, showAccount);
            } catch (err) {
              sc.error(err.message);
            }
          },
          true,
        ],
        ["戻る", showAccount],
      ]);
    }

    function showTransferCode() {
      const sc = accountScreen("引継ぎコード");
      sc.text("メールアドレスを変更するときに使うコードです。発行すると、前に発行したコードは使えなくなります(有効期限24時間・1回限り)。");
      const buttons = sc.buttons([
        [
          "発行する",
          async () => {
            sc.error("");
            try {
              const r = await busy(buttons, () => MahjongAccount.request({ type: "transfer-issue" }));
              const done = accountScreen("引継ぎコード");
              done.wrap.appendChild(el("div", { className: "account-code-display account-transfer-code", textContent: r.code }));
              const d = new Date(r.expiresAt);
              done.text(`有効期限: ${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
              done.text("「ユーザー登録・ログイン」→「メールアドレスの変更」で、このコードと新しいメールアドレスを入力してください。このコードは誰にも教えないでください。", "account-warning");
              done.buttons([["戻る", showAccount, true]]);
            } catch (err) {
              sc.error(err.message);
            }
          },
          true,
        ],
        ["戻る", showAccount],
      ]);
    }

    function confirmLogout() {
      const sc = accountScreen("ログアウト");
      sc.text("ログアウトしますか?もう一度ログインするには、ユーザー名を入力してメールの認証コードを入力します。");
      const buttons = sc.buttons([
        [
          "ログアウトする",
          async () => {
            try {
              await busy(buttons, () => MahjongAccount.request({ type: "logout", sessionToken: MahjongAccount.token() }));
            } catch (e) {
              /* サーバーに届かなくても、この端末ではログアウトする */
            }
            MahjongAccount.clearSession();
            showMessage("ログアウトしました", "これからはゲストとして遊べます。");
          },
          true,
        ],
        ["やめる", showAccount],
      ]);
    }

    function confirmDelete() {
      const sc = accountScreen("アカウントの削除");
      sc.text("アカウントを削除すると、名前・登録情報が消え、元に戻せません。本人確認のため、登録したメールアドレスに確認メールを送ります。");
      const buttons = sc.buttons([
        ["確認メールを送る", () => startAuth(sc, buttons, { mode: "delete" }), true],
        ["やめる", showAccount],
      ]);
    }

    function showPrivacyPolicy(back) {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby room-options rules-view" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: "プライバシーポリシー" }));
      const scroll = el("div", { className: "rules-scroll" });
      scroll.appendChild(el("pre", { className: "rules-text", textContent: PRIVACY_POLICY_TEXT }));
      wrap.appendChild(scroll);
      const backBtn = el("button", { type: "button", className: "btn rules-back-btn", textContent: "戻る" });
      backBtn.addEventListener("click", back || showLobby);
      wrap.appendChild(backBtn);
      root.appendChild(wrap);
    }

    function showSettings() {
      root.innerHTML = "";
      // options-screen: スマホ横向きでは CPU対戦・ルームの設定画面と同じく、欄を横に並べる配置になる
      const wrap = el("div", { className: "lobby room-options options-screen settings-screen" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: "オプション" }));
      // 左: プレイヤー名・牌譜 / 右: 音
      const fieldsBox = el("div", { className: "options-fields" });
      const basicCol = el("div", { className: "settings-col" });
      fieldsBox.appendChild(basicCol);
      wrap.appendChild(fieldsBox);

      // プレイヤー名: ログイン中はアカウントの名前(変更は「アカウント設定」から)。ゲストはここで直接変えられる
      // (後ろに「(ゲスト)」が付く。空欄にすると既定の「Playern(ゲスト)」に戻る)
      const loggedIn = MahjongAccount.isLoggedIn();
      const nameField = el("div", { className: "settings-field" });
      nameField.appendChild(el("span", { className: "settings-label", textContent: "プレイヤー名" }));
      let guestNameInput = null;
      if (loggedIn) {
        nameField.appendChild(el("span", { className: "settings-account-name", textContent: accountLabel() }));
      } else {
        const current = MahjongAccount.displayName() || "";
        guestNameInput = el("input", {
          type: "text",
          maxLength: 40,
          className: "lobby-code-input lobby-name-input",
          value: MahjongAccount.guestName() || "",
          placeholder: MahjongAccount.guestName() ? "" : current.replace(/\(ゲスト\)$/, "") || "Player",
        });
        nameField.appendChild(guestNameInput);
        nameField.appendChild(el("span", { className: "settings-hint", textContent: "後ろに「(ゲスト)」が付きます。空欄にすると既定の名前に戻ります。" }));
      }
      const accountBtn = el("button", {
        type: "button",
        className: "btn settings-reset-btn",
        textContent: MahjongAccount.isLoggedIn() ? "アカウント設定" : "ユーザー登録・ログイン",
      });
      accountBtn.addEventListener("click", showAccount);
      nameField.appendChild(accountBtn);
      basicCol.appendChild(nameField);

      // 牌譜を残すかどうか(オンライン対戦・CPU対戦ごと。観戦は残さない)
      const kifuSettings = typeof loadKifuSettings === "function" ? loadKifuSettings() : { online: true, cpu: true };
      const kifuGroup = el("fieldset", { className: "room-options-group settings-kifu" });
      kifuGroup.appendChild(el("legend", { textContent: "牌譜を残す" }));
      const kifuCheckbox = (text, checked) => {
        const label = el("label", { className: "room-options-choice" });
        const cb = el("input", { type: "checkbox" });
        cb.checked = checked;
        label.appendChild(cb);
        label.appendChild(el("span", { textContent: " " + text }));
        kifuGroup.appendChild(label);
        return cb;
      };
      const kifuOnlineCb = kifuCheckbox("オンライン対戦", kifuSettings.online);
      const kifuCpuCb = kifuCheckbox("CPU対戦", kifuSettings.cpu);
      // 牌譜はログイン中だけ使える
      if (MahjongAccount.isLoggedIn()) basicCol.appendChild(kifuGroup);

      // 効果音・発声(対局画面のスピーカーのボタンでも、すべての音をまとめて消せる)
      const sound = MahjongSound.getSettings();
      const soundGroup = el("fieldset", { className: "room-options-group" });
      soundGroup.appendChild(el("legend", { textContent: "音" }));
      // note は括弧書きの補足。スマホ横向きでは幅が足りないので隠す(styles.css)
      const checkbox = (text, note, checked) => {
        const label = el("label", { className: "room-options-choice" });
        const cb = el("input", { type: "checkbox" });
        cb.checked = checked;
        label.appendChild(cb);
        // 文字と補足は1つの塊にまとめる(別々だと縦向きで補足だけが次の行に回ってしまう)
        const textEl = el("span", { textContent: " " + text });
        if (note) textEl.appendChild(el("span", { className: "settings-note", textContent: note }));
        label.appendChild(textEl);
        soundGroup.appendChild(label);
        return cb;
      };
      const seCb = checkbox("効果音", "(打牌・ツモ・リーチ棒・鳴き・点棒・選択肢・ボタンなど)", sound.se);
      const voiceCb = checkbox("発声", "(ポン・カン・リーチ・ロン・ツモ)", sound.voice);
      const bgmCb = checkbox("BGM", "(ロビー・待機画面)", sound.bgm);
      const muteCb = checkbox("消音", "(すべての音を消す)", sound.muted);
      // 音量は SE(効果音)・ボイス(発声)・BGM をそれぞれ別に調整する
      const volLabel = el("span", { className: "settings-label", textContent: `SE音量: ${Math.round(sound.volume * 100)}` });
      const volInput = el("input", { type: "range", min: "0", max: "100", step: "5", className: "settings-volume" });
      volInput.value = String(Math.round(sound.volume * 100));
      volInput.addEventListener("input", () => (volLabel.textContent = `SE音量: ${volInput.value}`));
      soundGroup.appendChild(volLabel);
      soundGroup.appendChild(volInput);
      const voiceVolume = typeof sound.voiceVolume === "number" ? sound.voiceVolume : sound.volume;
      const voiceVolLabel = el("span", { className: "settings-label", textContent: `ボイス音量: ${Math.round(voiceVolume * 100)}` });
      const voiceVolInput = el("input", { type: "range", min: "0", max: "100", step: "5", className: "settings-volume" });
      voiceVolInput.value = String(Math.round(voiceVolume * 100));
      voiceVolInput.addEventListener("input", () => (voiceVolLabel.textContent = `ボイス音量: ${voiceVolInput.value}`));
      soundGroup.appendChild(voiceVolLabel);
      soundGroup.appendChild(voiceVolInput);
      const bgmVolLabel = el("span", { className: "settings-label", textContent: `BGM音量: ${Math.round(sound.bgmVolume * 100)}` });
      const bgmVolInput = el("input", { type: "range", min: "0", max: "100", step: "5", className: "settings-volume" });
      bgmVolInput.value = String(Math.round(sound.bgmVolume * 100));
      // BGM音量は動かしたその場で反映する(聴きながら調整できるように)
      bgmVolInput.addEventListener("input", () => {
        bgmVolLabel.textContent = `BGM音量: ${bgmVolInput.value}`;
        MahjongSound.update({ bgmVolume: Number(bgmVolInput.value) / 100 });
      });
      soundGroup.appendChild(bgmVolLabel);
      soundGroup.appendChild(bgmVolInput);
      const previewBtn = el("button", { type: "button", className: "btn settings-reset-btn", textContent: "試しに鳴らす" });
      previewBtn.addEventListener("click", () =>
        MahjongSound.preview({
          se: seCb.checked,
          voice: voiceCb.checked,
          volume: Number(volInput.value) / 100,
          voiceVolume: Number(voiceVolInput.value) / 100,
        })
      );
      soundGroup.appendChild(previewBtn);
      fieldsBox.appendChild(soundGroup);

      const msg = el("p", { className: "lobby-error" });
      wrap.appendChild(msg);
      const row = el("div", { className: "lobby-join-row" });
      const saveBtn = el("button", { type: "button", className: "btn btn-primary", textContent: "保存する" });
      const backBtn = el("button", { type: "button", className: "btn", textContent: "戻る" });
      saveBtn.addEventListener("click", async () => {
        // ゲストの名前(変わっていればサーバーで検査してから保存する。使えない名前なら画面に残って理由を出す)
        if (guestNameInput) {
          const next = guestNameInput.value.trim();
          const prev = MahjongAccount.guestName() || "";
          if (next !== prev) {
            if (!next) {
              MahjongAccount.setGuestName(null, null);
              MahjongAccount.refresh().catch(() => {});
            } else {
              try {
                saveBtn.disabled = true;
                const r = await MahjongAccount.request({ type: "guest-rename", name: next });
                MahjongAccount.setGuestName(r.baseName, r.name);
              } catch (err) {
                msg.textContent = err.message;
                return;
              } finally {
                saveBtn.disabled = false;
              }
            }
          }
        }
        if (MahjongAccount.isLoggedIn() && typeof saveKifuSettings === "function") saveKifuSettings({ online: kifuOnlineCb.checked, cpu: kifuCpuCb.checked });
        MahjongSound.update({
          se: seCb.checked,
          voice: voiceCb.checked,
          bgm: bgmCb.checked,
          bgmVolume: Number(bgmVolInput.value) / 100,
          muted: muteCb.checked,
          volume: Number(volInput.value) / 100,
          voiceVolume: Number(voiceVolInput.value) / 100,
        });
        showLobby();
      });
      backBtn.addEventListener("click", () => {
        // 保存せずに戻る場合は、その場で反映していたBGM音量を元に戻す
        MahjongSound.update({ bgmVolume: sound.bgmVolume });
        showLobby();
      });
      row.appendChild(saveBtn);
      row.appendChild(backBtn);
      wrap.appendChild(row);
      root.appendChild(wrap);
    }

    /** ロビーの「ルール確認」画面: 簡易ルールと詳細ルールを表示するだけの、表示専用画面。 */
    function showRules() {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby room-options rules-view" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: "ルール確認" }));

      // 文面だけをスクロールさせ、戻るボタンは常に下側に見えるようにする
      const scroll = el("div", { className: "rules-scroll" });
      scroll.appendChild(el("h3", { className: "rules-section-title", textContent: "簡易ルール" }));
      scroll.appendChild(el("pre", { className: "rules-text", textContent: SIMPLE_RULES_TEXT }));

      scroll.appendChild(el("h3", { className: "rules-section-title", textContent: "詳細ルール" }));
      scroll.appendChild(el("pre", { className: "rules-text", textContent: DETAILED_RULES_TEXT }));
      wrap.appendChild(scroll);

      const backBtn = el("button", { type: "button", className: "btn rules-back-btn", textContent: "戻る" });
      backBtn.addEventListener("click", showLobby);
      wrap.appendChild(backBtn);
      root.appendChild(wrap);
    }

    function showError(message) {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby" });
      wrap.appendChild(el("p", { className: "lobby-error", textContent: message }));
      const backBtn = el("button", { type: "button", className: "btn", textContent: "戻る" });
      backBtn.addEventListener("click", showLobby);
      wrap.appendChild(backBtn);
      root.appendChild(wrap);
    }

    /** メッセージをしばらく表示してから、自動的にロビー画面へ戻る(例: マッチング待機のタイムアウト)。 */
    function showAutoReturnMessage(message) {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby" });
      wrap.appendChild(el("p", { className: "lobby-error", textContent: message }));
      root.appendChild(wrap);
      setTimeout(showLobby, 2500);
    }

    /** 観戦一覧の1行に出す局の表示(例: 東2局)。情報が無ければ「対局中」 */
    function spectateRoundLabel(round) {
      if (!round) return "対局中";
      if (round.ended) return "対局終了";
      const winds = { east: "東", south: "南", west: "西", north: "北" };
      const w = winds[round.roundWind];
      return w && round.roundNumber ? `${w}${round.roundNumber}局` : "対局中";
    }

    function formatScore(n) {
      return typeof n === "number" ? n.toLocaleString("ja-JP") : "-";
    }

    /** 「観戦」: 対局中の一覧から選ぶか、ルームコードを入力して観戦する画面 */
    function showSpectateList() {
      root.innerHTML = "";
      const serverUrl = loadLastServerUrl();
      const wrap = el("div", { className: "lobby room-options spectate-view" });
      wrap.appendChild(el("h2", { className: "room-options-title", textContent: "観戦" }));
      wrap.appendChild(
        el("p", { className: "spectate-status", textContent: "観戦は3分遅れで表示されます(局・点数も3分前のものです)。" })
      );

      const listBox = el("div", { className: "spectate-list" });
      const status = el("p", { className: "spectate-status", textContent: "対局の一覧を読み込んでいます…" });
      listBox.appendChild(status);
      wrap.appendChild(listBox);

      const refreshBtn = el("button", { type: "button", className: "btn spectate-refresh-btn", textContent: "一覧を更新" });
      wrap.appendChild(refreshBtn);

      // ルームコードで観戦
      const codeGroup = el("fieldset", { className: "room-options-group" });
      codeGroup.appendChild(el("legend", { textContent: "ルームコードで観戦" }));
      const codeRow = el("div", { className: "lobby-join-row" });
      const codeInput = el("input", {
        type: "text",
        placeholder: "ルームコード",
        maxLength: 6,
        autocapitalize: "characters",
        className: "lobby-code-input",
      });
      const codeBtn = el("button", { type: "button", className: "btn btn-primary", textContent: "観戦する" });
      codeRow.appendChild(codeInput);
      codeRow.appendChild(codeBtn);
      codeGroup.appendChild(codeRow);
      const errorP = el("p", { className: "lobby-error" });
      codeGroup.appendChild(errorP);
      wrap.appendChild(codeGroup);

      const byCode = () => {
        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
          errorP.textContent = "ルームコードを入力してください。";
          return;
        }
        startSpectate(serverUrl, code);
      };
      codeBtn.addEventListener("click", byCode);
      codeInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") byCode();
      });

      const backBtn = el("button", { type: "button", className: "btn", textContent: "戻る" });
      backBtn.addEventListener("click", showLobby);
      wrap.appendChild(backBtn);
      root.appendChild(wrap);

      let loading = false;
      const load = async () => {
        if (loading || !wrap.isConnected) return;
        loading = true;
        refreshBtn.disabled = true;
        try {
          const games = await fetchSpectatableGames(serverUrl);
          if (!wrap.isConnected) return;
          listBox.innerHTML = "";
          if (games.length === 0) {
            listBox.appendChild(el("p", { className: "spectate-status", textContent: "観戦できる対局は今ありません。" }));
          }
          for (const g of games) {
            const item = el("div", { className: "spectate-item" });
            const info = el("div", { className: "spectate-item-info" });
            const names = g.names || {};
            info.appendChild(
              el("p", { className: "spectate-item-names", textContent: `${names.east || "Player1"} vs ${names.south || "Player2"}` })
            );
            const r = g.round;
            const scores = r && r.scores ? `${formatScore(r.scores.east)} / ${formatScore(r.scores.south)}` : "";
            const meta = [spectateRoundLabel(r), scores, g.spectators > 0 ? `観戦 ${g.spectators}人` : ""].filter(Boolean).join("　");
            info.appendChild(el("p", { className: "spectate-item-meta", textContent: meta }));
            item.appendChild(info);
            const watchBtn = el("button", { type: "button", className: "btn btn-primary", textContent: "観戦する" });
            watchBtn.addEventListener("click", () => startSpectate(serverUrl, g.code));
            item.appendChild(watchBtn);
            listBox.appendChild(item);
          }
        } catch (err) {
          if (!wrap.isConnected) return;
          listBox.innerHTML = "";
          listBox.appendChild(el("p", { className: "lobby-error", textContent: (err && err.message) || String(err) }));
        } finally {
          loading = false;
          refreshBtn.disabled = false;
        }
      };
      refreshBtn.addEventListener("click", load);
      load();
      // 画面を開いている間は一覧を定期的に更新する(画面を離れたら止める)
      const autoRefresh = setInterval(() => {
        if (!wrap.isConnected) {
          clearInterval(autoRefresh);
          return;
        }
        load();
      }, 15000);
    }

    /**
     * 「牌譜」: 端末内に自動保存した対局の一覧。再生・ファイルに書き出し・削除と、
     * 書き出したファイルの読み込みができる(kifu.js)。
     */
    function showKifuList() {
      root.innerHTML = "";
      const wrap = el("div", { className: "lobby room-options kifu-screen" });
      const head = el("div", { className: "kifu-head" });
      head.appendChild(el("h2", { className: "room-options-title", textContent: "牌譜" }));
      const headBtns = el("div", { className: "lobby-join-row" });
      const importBtn = el("button", { type: "button", className: "btn", textContent: "ファイルを読み込む" });
      const backBtn = el("button", { type: "button", className: "btn", textContent: "戻る" });
      headBtns.appendChild(importBtn);
      headBtns.appendChild(backBtn);
      head.appendChild(headBtns);
      wrap.appendChild(head);
      const errorP = el("p", { className: "lobby-error" });
      wrap.appendChild(errorP);
      const listBox = el("div", { className: "kifu-list" });
      listBox.appendChild(el("p", { className: "spectate-status", textContent: "読み込んでいます…" }));
      wrap.appendChild(listBox);
      wrap.appendChild(
        el("p", {
          className: "kifu-note",
          textContent: `対局の牌譜はこの端末に自動で保存されます(新しいものから${KIFU_MAX_RECORDS}件まで)。ブラウザのデータを消すと消えるので、残したい牌譜は「ファイルに保存」してください。`,
        })
      );
      root.appendChild(wrap);
      backBtn.addEventListener("click", showLobby);

      // ファイルの読み込み: 一覧に追加して、そのまま再生する
      const fileInput = el("input", { type: "file", accept: ".json,application/json", className: "kifu-file-input" });
      wrap.appendChild(fileInput);
      importBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          let record;
          try {
            record = kifuParseFile(String(reader.result));
          } catch (err) {
            errorP.textContent = err.message;
            return;
          }
          // 読み込んだ牌譜は一覧の先頭に出す(対局の記録の続きとしては使わない: kifu.js の _begin)
          record.imported = true;
          record.updatedAt = Date.now();
          KifuStore.put(record)
            .catch(() => {})
            .then(() => startReplay(record));
        };
        reader.onerror = () => (errorP.textContent = "ファイルを読み込めませんでした。");
        reader.readAsText(file);
      });

      const fmtDate = (ms) => {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };
      const windName = { east: "東", south: "南", west: "西", north: "北" };
      const render = (rows) => {
        listBox.innerHTML = "";
        if (rows.length === 0) {
          listBox.appendChild(el("p", { className: "spectate-status", textContent: "保存された牌譜はまだありません。" }));
          return;
        }
        for (const r of rows) {
          const item = el("div", { className: "spectate-item kifu-item" });
          const info = el("div", { className: "spectate-item-info" });
          const names = r.names || {};
          const sum = r.summary;
          const scoreText = sum && sum.scores ? `${formatScore(sum.scores.east)} / ${formatScore(sum.scores.south)}` : "";
          info.appendChild(
            el("p", {
              className: "spectate-item-names",
              textContent: `${names.east || "Player1"} vs ${names.south || "Player2"}`,
            })
          );
          const state = r.finished
              ? sum && sum.endReason === "bust"
                ? "トビ終了"
                : "終局"
              : sum
                ? `${windName[sum.roundWind] || ""}${sum.roundNumber}局まで`
                : "";
          const meta = [fmtDate(r.startedAt), kifuModeLabel(r.mode) + (r.partial ? "(途中から)" : ""), state, scoreText]
            .filter(Boolean)
            .join("　");
          info.appendChild(el("p", { className: "spectate-item-meta", textContent: meta }));
          item.appendChild(info);
          const btns = el("div", { className: "kifu-item-btns" });
          const playBtn = el("button", { type: "button", className: "btn btn-primary", textContent: "再生" });
          playBtn.addEventListener("click", () => startReplay(r));
          const saveBtn = el("button", { type: "button", className: "btn", textContent: "ファイルに保存" });
          saveBtn.addEventListener("click", () => kifuExportFile(r));
          const delBtn = el("button", { type: "button", className: "btn", textContent: "削除" });
          delBtn.addEventListener("click", () => {
            if (!window.confirm("この牌譜を削除しますか？")) return;
            KifuStore.remove(r.id)
              .catch(() => {})
              .then(load);
          });
          btns.appendChild(playBtn);
          btns.appendChild(saveBtn);
          btns.appendChild(delBtn);
          item.appendChild(btns);
          listBox.appendChild(item);
        }
      };
      const load = () =>
        KifuStore.list()
          .then((rows) => {
            if (wrap.isConnected) render(rows);
          })
          .catch((err) => {
            if (!wrap.isConnected) return;
            listBox.innerHTML = "";
            listBox.appendChild(el("p", { className: "lobby-error", textContent: (err && err.message) || String(err) }));
          });
      load();
    }

    function startReplay(record) {
      root.innerHTML = "";
      try {
        currentApp = new ReplayMahjongApp(root, { record, onExit: showKifuList });
      } catch (err) {
        showError("牌譜を再生できませんでした。" + ((err && err.message) || ""));
      }
    }

    async function startSpectate(serverUrl, code) {
      if (typeof WebSocket === "undefined") {
        showError("このブラウザはWebSocketに対応していないため、観戦を利用できません。");
        return;
      }
      root.innerHTML = "";
      root.appendChild(el("p", { textContent: "観戦の準備をしています…" }));
      const controller = new SpectatorController({ serverUrl });
      try {
        await controller.start(code);
        root.innerHTML = "";
        currentApp = new SpectatorMahjongApp(root, { roomController: controller, onExit: showLobby });
      } catch (err) {
        controller.stop();
        showError((err && err.message) || String(err));
      }
    }

    async function startOnline(mode, serverUrl, code, name, timeControl, roomOptions = {}) {
      if (!serverUrl) {
        showError("サーバーに接続できませんでした。");
        return;
      }
      if (typeof WebSocket === "undefined") {
        showError("このブラウザはWebSocketに対応していないため、オンライン対戦を利用できません。");
        return;
      }
      saveLastPlayerName(name || "");

      root.innerHTML = "";
      root.appendChild(el("p", { textContent: "サーバーに接続しています…" }));

      const controller = new WsRoomController({
        serverUrl,
        name: name || null,
        allowSpectate: roomOptions.allowSpectate,
        timeControl,
        dealerChoice: roomOptions.dealerChoice,
        gameLength: roomOptions.gameLength,
      });
      // 自動マッチングの相手待ちが長時間(既定5分)続いた場合に諦めてロビーへ戻るためのタイマー。
      // 相手が見つかった・キャンセルした・接続が切れた、いずれの場合も必ずクリアすること
      // (クリアし忘れると、対局が始まった後にこのタイマーが発火して controller.cancelMatch() が
      // 呼ばれ、進行中の対局を誤って終了させてしまう)。
      let matchWaitTimer = null;
      try {
        let result;
        if (mode === "match") {
          // 相手が見つかるまでの待機画面(ルール選択・ロビーに戻れる)
          controller.onMatchWaiting = () => {
            root.innerHTML = "";
            const wrap = el("div", { className: "lobby-waiting" });
            wrap.appendChild(el("p", { textContent: "対戦相手を探しています…" }));
            wrap.appendChild(el("div", { className: "connection-spinner" }));
            const hint = el("p", { className: "lobby-peer-status", textContent: "相手が見つかると自動的に対局が始まります。" });
            wrap.appendChild(hint);
            wrap.appendChild(buildOnlineCountRow((cb) => controller.watchOnlineCount(cb)));
            wrap.appendChild(
              el("p", {
                className: "lobby-peer-status",
                textContent: `ルール: ${roomOptions.gameLength === "half" ? "半荘戦" : "一荘戦"}(${GAME_LENGTH_NOTES[roomOptions.gameLength === "half" ? "half" : "full"]})`,
              })
            );
            const btnRow = el("div", { className: "lobby-join-row" });
            for (const [text, next] of [
              ["ルール選択に戻る", showMatchRuleSelect],
              ["ロビーに戻る", showLobby],
            ]) {
              const b = el("button", { type: "button", className: "btn", textContent: text });
              b.dataset.sound = "cancel"; // 戻るボタンと同じ音
              b.addEventListener("click", () => {
                clearTimeout(matchWaitTimer);
                controller.cancelMatch();
                next();
              });
              btnRow.appendChild(b);
            }
            wrap.appendChild(btnRow);
            root.appendChild(wrap);

            clearTimeout(matchWaitTimer);
            matchWaitTimer = setTimeout(() => {
              controller.cancelMatch();
              showAutoReturnMessage("長時間マッチングしなかったためロビーに戻ります。");
            }, MATCH_WAIT_TIMEOUT_MS);
          };
          result = await controller.findMatch();
          clearTimeout(matchWaitTimer);
        } else if (mode === "create") {
          result = await controller.createRoom();
        } else {
          if (!code) throw new Error("ルームコードを入力してください。");
          result = await controller.joinRoom(code);
        }
        root.innerHTML = "";
        currentApp = new OnlineMahjongApp(root, {
          roomController: controller,
          mySeat: result.mySeat,
          onExit: showLobby,
          isMatch: mode === "match",
          // ルーム作成時に選んだ持ち時間(自動マッチング・参加時は既定値。参加側は
          // 対局データが届いた時点でホストの設定に置き換わる)
          timeControl: timeControl !== undefined ? timeControl : DEFAULT_TIME_CONTROL,
          // ルーム作成時に選んだ起家の決め方(ホストだけが使う。自動マッチングはホストが起家)
          dealerChoice: roomOptions.dealerChoice,
          gameLength: roomOptions.gameLength,
        });
      } catch (err) {
        clearTimeout(matchWaitTimer);
        controller.stop();
        showError((err && err.message) || String(err));
      }
    }

    async function resumeOnline(session) {
      if (typeof WebSocket === "undefined") {
        showError("このブラウザはWebSocketに対応していないため、オンライン対戦を利用できません。");
        return;
      }
      root.innerHTML = "";
      const controller = new WsRoomController({ serverUrl: session.serverUrl, name: session.name || null });
      const waitBox = el("div", { className: "lobby" });
      waitBox.appendChild(el("p", { textContent: "前回の対局に再接続しています…" }));
      const cancelBtn = el("button", { type: "button", className: "btn", textContent: "やめる" });
      cancelBtn.addEventListener("click", () => {
        controller.stop();
        showLobby();
      });
      waitBox.appendChild(cancelBtn);
      root.appendChild(waitBox);
      try {
        const result = await controller.resume(session);
        root.innerHTML = "";
        currentApp = new OnlineMahjongApp(root, {
          roomController: controller,
          mySeat: result.mySeat,
          onExit: showLobby,
        });
      } catch (err) {
        controller.stop();
        showError((err && err.message) || String(err));
      }
    }

    MahjongAccount.configure(loadLastServerUrl);
    const params = new URLSearchParams(location.search);
    if ((params.get("mode") === "verifyEmail" && params.get("oobCode")) || (params.get("rid") && params.get("v"))) {
      // メールのリンクから開いた確認ページ
      showVerifyPage(params);
      return;
    }
    const pending = MahjongAccount.loadPending();
    if (pending) {
      // 認証コードの入力の途中でページが読み込み直された(メールを見に行った間など)
      showCodeEntry(pending);
    } else {
      showLobby();
    }
    // サーバーに名乗って、ゲスト番号・ログイン中の名前を確かめる(サーバーの起動待ちでも画面はすぐ使える)
    MahjongAccount.refresh().catch(() => {});
  }

  return { mount };
})();

window.MahjongLobby = MahjongLobby;
