/**
 * 牌譜(対局の記録)の保存・書き出し/読み込み・再生。
 *
 * - KifuRecorder: 対局画面(CPU対戦・オンライン対戦・観戦)の render() のたびに状態を受け取り、
 *   変化があれば1コマとして記録する。端末内(IndexedDB)へ自動で保存する(直近 KIFU_MAX_RECORDS 件)。
 * - KifuStore: IndexedDB への保存・一覧・削除。
 * - ReplayMahjongApp: 保存した牌譜を、対局画面と同じ卓の描画で1コマずつ再生する(両者の手牌を公開)。
 *
 * 牌譜データ(書き出すファイルも同じ形の JSON):
 *   { format: "ryanma-kifu", v: 1, id, mode: "cpu"|"online"|"spectate", startedAt, updatedAt,
 *     finished, partial, names: {east, south}, viewSeat, roomCode, summary, frames: [[経過ms, 差分], ...] }
 *   1コマ目の差分は空のオブジェクトからの差分(=全体)。各コマの中身は
 *   { s: 局面(state), w: 和了(lastWin), x: 流局の結果, c: ポン/カン/リーチの表示, r: 結果画面の点数の増減 }。
 *   容量を減らすため、牌 {id, kind, isRedDora} は "~牌ID" の文字列にし、牌の種類は tiles にまとめる。
 */

const KIFU_FORMAT = "ryanma-kifu";
const KIFU_VERSION = 1;
/** 端末内に残す牌譜の件数(古いものから消える) */
const KIFU_MAX_RECORDS = 50;
/** 状態が変わってから端末内へ保存するまでの待ち時間(局の終わり・対局終了はすぐ保存する) */
const KIFU_SAVE_DELAY_MS = 1500;
/** オンライン対戦の牌譜を「対局中」とみなす時間。対局中は再生できないようにする(相手の手牌が見えるため) */
const KIFU_ONLINE_LOCK_MS = 15 * 60 * 1000;
/** 同じルームの対局をページの読み込み直し後も同じ牌譜に続けて記録する猶予 */
const KIFU_RESUME_WINDOW_MS = 30 * 60 * 1000;

// ---------------- 牌の圧縮・差分 ----------------

function kifuIsTile(v) {
  return (
    v && typeof v === "object" && !Array.isArray(v) && typeof v.id === "string" && "kind" in v &&
    Object.keys(v).length <= 3
  );
}

/** 牌を "~ID" に置き換えた複製を作る(牌の種類は tiles に集める)。"~" で始まる普通の文字列は "~~" にする */
function kifuEncode(v, tiles) {
  if (typeof v === "string") return v.charAt(0) === "~" ? "~" + v : v;
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => kifuEncode(x, tiles));
  if (kifuIsTile(v)) {
    tiles[v.id] = { kind: v.kind, isRedDora: !!v.isRedDora };
    return "~" + v.id;
  }
  const out = {};
  for (const k of Object.keys(v)) {
    if (v[k] === undefined) continue;
    out[k] = kifuEncode(v[k], tiles);
  }
  return out;
}

function kifuDecode(v, tiles) {
  if (typeof v === "string") {
    if (v.charAt(0) !== "~") return v;
    if (v.charAt(1) === "~") return v.slice(1);
    const id = v.slice(1);
    const t = tiles[id] || { kind: null, isRedDora: false };
    return { id, kind: t.kind, isRedDora: !!t.isRedDora };
  }
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => kifuDecode(x, tiles));
  const out = {};
  for (const k of Object.keys(v)) out[k] = kifuDecode(v[k], tiles);
  return out;
}

function kifuEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!kifuEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in b) || !kifuEqual(a[k], b[k])) return false;
  return true;
}

function kifuIsPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * a → b の差分。同じなら undefined。
 *   {"$": 値} 置き換え / {"$d": 1} 削除 / {"$a": [...]} 配列の末尾に追加 / {"$s": n} 配列の先頭から n 個削除
 *   それ以外のオブジェクトはキーごとの差分
 */
function kifuDiff(a, b) {
  if (kifuEqual(a, b)) return undefined;
  if (kifuIsPlainObject(a) && kifuIsPlainObject(b)) {
    const patch = {};
    for (const k of Object.keys(b)) {
      if (!(k in a)) patch[k] = { $: b[k] };
      else {
        const d = kifuDiff(a[k], b[k]);
        if (d !== undefined) patch[k] = d;
      }
    }
    for (const k of Object.keys(a)) if (!(k in b)) patch[k] = { $d: 1 };
    return patch;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (b.length > a.length && a.every((x, i) => kifuEqual(x, b[i]))) return { $a: b.slice(a.length) };
    const n = a.length - b.length;
    if (n > 0 && b.every((x, i) => kifuEqual(x, a[i + n]))) return { $s: n };
  }
  return { $: b };
}

/** 差分を当てた新しい値を返す(元の値は書き換えない) */
function kifuPatch(a, patch) {
  if (!kifuIsPlainObject(patch)) return a;
  if ("$" in patch) return patch.$;
  if ("$a" in patch) return (Array.isArray(a) ? a : []).concat(patch.$a);
  if ("$s" in patch) return (Array.isArray(a) ? a : []).slice(patch.$s);
  const out = kifuIsPlainObject(a) ? Object.assign({}, a) : {};
  for (const k of Object.keys(patch)) {
    const p = patch[k];
    if (kifuIsPlainObject(p) && "$d" in p) delete out[k];
    else out[k] = kifuPatch(out[k], p);
  }
  return out;
}

/** 牌譜の全コマを(圧縮したままの形で)順に組み立てる */
function kifuExpandFrames(record) {
  const frames = [];
  let cur = {};
  for (const [t, patch] of record.frames || []) {
    cur = kifuPatch(cur, patch);
    frames.push({ t, enc: cur });
  }
  return frames;
}

// ---------------- 保存先(IndexedDB) ----------------

const KifuStore = (() => {
  const DB_NAME = "ryanma-kifu";
  const STORE = "kifu";
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("このブラウザでは牌譜を保存できません。"));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("牌譜の保存先を開けませんでした。"));
    });
    dbPromise.catch(() => (dbPromise = null));
    return dbPromise;
  }

  function run(mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, mode);
          const store = tx.objectStore(STORE);
          let result;
          const req = fn(store);
          if (req) req.onsuccess = () => (result = req.result);
          tx.oncomplete = () => resolve(result);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error || new Error("牌譜を保存できませんでした。"));
        })
    );
  }

  /** 全件(新しい順) */
  function list() {
    return run("readonly", (s) => s.getAll()).then((rows) =>
      (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    );
  }

  function get(id) {
    return run("readonly", (s) => s.get(id));
  }

  function remove(id) {
    return run("readwrite", (s) => s.delete(id));
  }

  /** 保存して、KIFU_MAX_RECORDS 件を超えた分を古いものから消す */
  function put(record) {
    return run("readwrite", (s) => s.put(record)).then(() =>
      list().then((rows) => Promise.all(rows.slice(KIFU_MAX_RECORDS).map((r) => remove(r.id))))
    );
  }

  return { list, get, put, remove };
})();

// ---------------- 記録 ----------------

/** 記録中のレコーダー(ページを閉じる・アプリを切り替える時に保存するため) */
const KIFU_ACTIVE_RECORDERS = new Set();
if (typeof window !== "undefined") {
  const flushAll = () => KIFU_ACTIVE_RECORDERS.forEach((r) => r.flush());
  window.addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAll();
  });
}

/**
 * 局の通し番号。オンライン対戦の最初の局は roundSerial が無い(次の局から 1, 2, …)ため、無ければ 0 とみなす
 * (どちらの数え方でも、局が進むと必ず増える)。
 */
function kifuRoundSerial(s) {
  return (s && s.roundSerial) || 0;
}

function kifuNewId() {
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

class KifuRecorder {
  /** @param {{mode: "cpu"|"online"|"spectate", roomCode?: string|null}} opts */
  constructor({ mode, roomCode }) {
    this.mode = mode;
    this.roomCode = roomCode || null;
    this.record = null;
    /** 直前に記録したコマ(圧縮した形)。差分の元 */
    this._prevEnc = null;
    this._lastPhase = null;
    this._lastSerial = null;
    this._saveTimer = null;
    /** 読み込み直し後に同じ対局の牌譜を探している間は、コマをここに溜めておく */
    this._pending = null;
  }

  /** 対局画面の render() の最後に呼ぶ */
  capture(app) {
    const s = app.state;
    if (!s || !s.players || !s.players.east || !s.players.south || !s.wall) return;
    // ツモ待ち(draw)は一瞬で次へ進む途中の局面なので記録しない(局の始まりの配牌直後だけは残す)
    if (s.phase === "draw" && !app.isFreshDeal()) return;

    // 新しい対局(再戦)になったら、それまでの牌譜を閉じて新しく記録を始める
    if (this.record || this._pending) {
      const serial = kifuRoundSerial(s);
      const newGame =
        (this._lastPhase === "game_end" && s.phase !== "game_end") ||
        (this._lastSerial != null && serial < this._lastSerial);
      if (newGame) {
        this.flush();
        this.record = null;
        this._pending = null;
        this._prevEnc = null;
      }
    }

    const tiles = {};
    const enc = {
      s: kifuEncode(s, tiles),
      w: kifuEncode(app.lastWin || null, tiles),
      x: kifuEncode(app.lastExhaustiveOutcome || null, tiles),
      c: kifuEncode(app.lastCall || null, tiles),
      r: app.roundScoreChange || null,
    };
    const names = { east: app.playerName("east"), south: app.playerName("south") };

    if (!this.record && !this._pending) this._begin(app, s, names);
    const target = this.record || this._pending;
    Object.assign(target.tiles, tiles);
    target.names = names;

    this._lastPhase = s.phase;
    this._lastSerial = kifuRoundSerial(s);

    if (this._pending) {
      const last = this._pending.buffered[this._pending.buffered.length - 1];
      if (!last || !kifuEqual(last.enc, enc)) this._pending.buffered.push({ at: Date.now(), enc });
      return;
    }
    this._append(enc);
  }

  _begin(app, s, names) {
    const partial = !(s.overallRoundIndex === 1 && kifuRoundSerial(s) <= 1 && app.isFreshDeal());
    const base = {
      format: KIFU_FORMAT,
      v: KIFU_VERSION,
      id: kifuNewId(),
      mode: this.mode,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      finished: false,
      partial,
      names,
      viewSeat: app.selfSeat(),
      roomCode: this.roomCode,
      summary: null,
      tiles: {},
      frames: [],
    };
    KIFU_ACTIVE_RECORDERS.add(this);
    // オンライン対戦・観戦を途中から開いた(ページの読み込み直し・再接続)場合は、同じ対局の
    // 牌譜が端末内にあればそれに続けて記録する(別々の牌譜に分かれないように)。
    if (partial && this.roomCode && this.mode !== "cpu") {
      const pending = Object.assign(base, { buffered: [] });
      this._pending = pending;
      const startingDealer = s.startingDealer;
      KifuStore.list()
        .then((rows) =>
          rows.find(
            (r) =>
              r.mode === this.mode &&
              r.roomCode === this.roomCode &&
              !r.finished &&
              Date.now() - (r.updatedAt || 0) < KIFU_RESUME_WINDOW_MS &&
              r.frames &&
              r.frames.length > 0
          )
        )
        .catch(() => null)
        .then((found) => {
          if (this._pending !== pending) return; // その間に新しい対局になった
          let record = null;
          let prevEnc = null;
          if (found) {
            const frames = kifuExpandFrames(found);
            const lastEnc = frames[frames.length - 1].enc;
            const lastState = lastEnc && lastEnc.s;
            const first = pending.buffered[0] && pending.buffered[0].enc.s;
            if (lastState && first && lastState.startingDealer === startingDealer && kifuRoundSerial(lastState) <= kifuRoundSerial(first)) {
              record = found;
              prevEnc = lastEnc;
            }
          }
          if (!record) {
            record = pending;
            delete record.buffered;
          }
          Object.assign(record.tiles, pending.tiles);
          record.names = pending.names;
          this.record = record;
          this._prevEnc = prevEnc;
          this._pending = null;
          for (const b of pending.buffered || []) this._append(b.enc, b.at);
          this._scheduleSave(0);
        });
      return;
    }
    this.record = base;
  }

  _append(enc, at) {
    const rec = this.record;
    const patch = kifuDiff(this._prevEnc || {}, enc);
    if (patch === undefined) return;
    rec.frames.push([Math.max(0, (at || Date.now()) - rec.startedAt), patch]);
    this._prevEnc = enc;
    rec.updatedAt = Date.now();
    const st = enc.s;
    rec.finished = st.phase === "game_end";
    rec.summary = {
      roundWind: st.roundWind,
      roundNumber: st.roundNumber,
      scores: { east: st.players.east.score, south: st.players.south.score },
      endReason: st.gameEndReason ? st.gameEndReason.type : null,
    };
    // 局の終わり・対局終了はすぐ保存する(途中でページが閉じられても局単位では残るように)
    const important = st.phase === "round_end" || st.phase === "game_end";
    this._scheduleSave(important ? 0 : KIFU_SAVE_DELAY_MS);
  }

  _scheduleSave(delay) {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._save();
    }, delay);
  }

  _save() {
    const rec = this.record;
    if (!rec || rec.frames.length === 0) return;
    KifuStore.put(rec).catch(() => {
      /* 保存できない環境(プライベートブラウズ等)では記録しない */
    });
  }

  /** 保存を待たずに今すぐ保存する(退室・ページを閉じる時など) */
  flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      this._save();
    }
  }

  stop() {
    this.flush();
    KIFU_ACTIVE_RECORDERS.delete(this);
  }
}

// ---------------- 書き出し・読み込み ----------------

function kifuModeLabel(mode) {
  return { cpu: "CPU対戦", online: "オンライン対戦", spectate: "観戦" }[mode] || "対局";
}

function kifuFileName(record) {
  const d = new Date(record.startedAt || Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `ryanma-kifu-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/** 牌譜を JSON ファイルとして書き出す(iPhone ではダウンロード→「ファイル」アプリに保存される) */
function kifuExportFile(record) {
  const json = JSON.stringify(record);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = kifuFileName(record);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** 読み込んだファイルの中身を牌譜として検査する。問題があれば Error を投げる */
function kifuParseFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error("牌譜のファイルではありません(読み込めませんでした)。");
  }
  if (!data || data.format !== KIFU_FORMAT || !Array.isArray(data.frames) || !data.tiles) {
    throw new Error("二麻オンラインの牌譜のファイルではありません。");
  }
  if (data.v > KIFU_VERSION) throw new Error("新しい形式の牌譜のため読み込めません。ページを更新してください。");
  if (data.frames.length === 0) throw new Error("この牌譜には記録がありません。");
  return data;
}

/** オンライン対戦の対局中の牌譜か(相手の手牌が見えてしまうため、対局中は再生させない) */
function kifuIsLocked(record) {
  return record.mode === "online" && !record.finished && Date.now() - (record.updatedAt || 0) < KIFU_ONLINE_LOCK_MS;
}

// ---------------- 再生 ----------------

/**
 * 牌譜の再生画面。対局画面と同じ卓の描画を使い、1コマずつ進める・戻す・前後の局へ飛ぶ・自動再生ができる。
 * 操作(打牌など)・自動進行・持ち時間・配牌の演出は行わない。両者の手牌を公開し、上側の手牌を押すと視点を入れ替える。
 */
class ReplayMahjongApp extends MahjongApp {
  constructor(root, { record, onExit }) {
    super(root, { autoStart: false, onExit, timeControl: null });
    this.record = record;
    this.frames = kifuExpandFrames(record);
    this.viewSeat = record.viewSeat === "south" ? "south" : "east";
    this.allowPeekToggle = false;
    this.index = 0;
    this._playTimer = null;
    this._onKey = (e) => {
      if (this._destroyed || !this.root.isConnected) return document.removeEventListener("keydown", this._onKey);
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") this.step(1);
      else if (e.key === "ArrowLeft") this.step(-1);
      else if (e.key === "ArrowUp") this.jumpRound(-1);
      else if (e.key === "ArrowDown") this.jumpRound(1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", this._onKey);
    this.goTo(0);
  }

  selfSeat() {
    return this.viewSeat;
  }

  opponentSeat() {
    return this.viewSeat === "east" ? "south" : "east";
  }

  playerName(seat) {
    const n = this.record.names && this.record.names[seat];
    return n || `${this.seatLabel(seat)}家`;
  }

  canAct() {
    return false;
  }

  hiddenSeatFor() {
    return null;
  }

  // 再生では配牌の演出・持ち時間・結果画面の自動送りをしない
  updateDealAnimation() {
    this._dealAnim = null;
  }

  syncResultTimer() {
    this.clearResultTimers();
  }

  // 結果画面の点数の増減はコマに記録したもの(無ければ直前の局面との差)を使う
  trackRoundScoreChange() {}

  waitingHint(text) {
    if (!text || (typeof text === "string" && text.startsWith("相手"))) return document.createElement("span");
    return super.waitingHint(text);
  }

  resultCountdownText() {
    return "";
  }

  gameEndExitLabel() {
    return "再生をやめる";
  }

  renderExitButton() {
    const b = this.button(this._landscape ? "終了" : "再生をやめる", () => this.exitGame());
    b.classList.add("exit-btn");
    return b;
  }

  destroy() {
    this._destroyed = true;
    this.stopPlay();
    this.clearResultTimers();
    document.removeEventListener("keydown", this._onKey);
    for (const key of ["_winBannerTimer", "_callBannerTimer", "_exhaustiveDrawTimer"]) {
      if (this[key]) {
        clearTimeout(this[key]);
        this[key] = null;
      }
    }
  }

  /** i コマ目の局面を表示する */
  goTo(i) {
    const n = this.frames.length;
    this.index = Math.max(0, Math.min(n - 1, i));
    const tiles = this.record.tiles || {};
    const f = this.frames[this.index].enc;
    this.state = kifuDecode(f.s, tiles);
    const win = kifuDecode(f.w || null, tiles);
    if (JSON.stringify(win) !== JSON.stringify(this.lastWin)) this.setLastWin(win);
    const ex = kifuDecode(f.x || null, tiles);
    if (JSON.stringify(ex) !== JSON.stringify(this.lastExhaustiveOutcome)) this.setExhaustiveDrawOutcome(ex);
    const call = kifuDecode(f.c || null, tiles);
    const seq = call ? call.seq : null;
    if (seq !== (this.lastCall ? this.lastCall.seq : null)) this.setLastCall(call);
    this.revealUraDora = !!win;
    this.roundScoreChange = f.r || this.computeScoreChange(this.index);
    this.render();
  }

  /** 結果画面のコマについて、その局の結果による点数の増減を、直前の対局中のコマとの差で求める */
  computeScoreChange(i) {
    const cur = this.frames[i].enc.s;
    if (cur.phase !== "round_end" && cur.phase !== "game_end") return null;
    for (let j = i - 1; j >= 0; j--) {
      const s = this.frames[j].enc.s;
      if (s.phase !== "round_end" && s.phase !== "game_end") {
        return {
          east: cur.players.east.score - s.players.east.score,
          south: cur.players.south.score - s.players.south.score,
        };
      }
    }
    return null;
  }

  step(delta) {
    this.stopPlay();
    this.goTo(this.index + delta);
  }

  /** 前(-1)・次(+1)の局の始まりへ飛ぶ。前の局へは、今の局の途中なら今の局の始まりへ戻る */
  jumpRound(dir) {
    this.stopPlay();
    const key = (i) => kifuRoundSerial(this.frames[i].enc.s);
    const cur = key(this.index);
    const startOf = (i) => {
      let j = i;
      while (j > 0 && key(j - 1) === key(i)) j--;
      return j;
    };
    if (dir > 0) {
      let j = this.index;
      while (j < this.frames.length - 1 && key(j) === cur) j++;
      this.goTo(j);
    } else {
      const start = startOf(this.index);
      this.goTo(start < this.index ? start : start > 0 ? startOf(start - 1) : 0);
    }
  }

  togglePlay() {
    if (this._playTimer) {
      this.stopPlay();
      this.render();
      return;
    }
    if (this.index >= this.frames.length - 1) this.goTo(0);
    const tick = () => {
      if (this._destroyed || !this.root.isConnected) return this.stopPlay();
      if (this.index >= this.frames.length - 1) {
        this.stopPlay();
        this.render();
        return;
      }
      this.goTo(this.index + 1);
      const s = this.state;
      // 和了・流局の画面は少し長めに見せる
      const wait = s.phase === "round_end" || s.phase === "game_end" ? 3500 : this.lastCall && this.callBannerShownAt ? 1200 : 800;
      this._playTimer = setTimeout(tick, wait);
    };
    this._playTimer = setTimeout(tick, 400);
    this.render();
  }

  stopPlay() {
    if (this._playTimer) clearTimeout(this._playTimer);
    this._playTimer = null;
  }

  /** 設定のチェックボックスの代わりに、再生の操作ボタンを置く */
  renderToggles() {
    const wrap = document.createElement("div");
    wrap.className = "toggle-row replay-controls";
    const s = this.state;
    const pos = document.createElement("span");
    pos.className = "replay-position";
    pos.textContent = `${windLabel(s.roundWind)}${s.roundNumber}局　${this.index + 1} / ${this.frames.length}`;
    wrap.appendChild(pos);
    const btns = document.createElement("div");
    btns.className = "replay-buttons";
    const add = (label, title, onClick, disabled) => {
      const b = this.button(label, onClick);
      b.classList.add("replay-btn");
      b.title = title;
      b.setAttribute("aria-label", title);
      b.disabled = !!disabled;
      btns.appendChild(b);
      return b;
    };
    const atStart = this.index === 0;
    const atEnd = this.index >= this.frames.length - 1;
    add("⏮", "前の局", () => this.jumpRound(-1), atStart);
    add("◀", "1つ戻る", () => this.step(-1), atStart);
    const play = add(this._playTimer ? "⏸" : "▶▶", this._playTimer ? "自動再生を止める" : "自動再生", () => this.togglePlay());
    play.classList.add("replay-play-btn");
    add("▶", "1つ進む", () => this.step(1), atEnd);
    add("⏭", "次の局", () => this.jumpRound(1), atEnd);
    wrap.appendChild(btns);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "replay-slider";
    slider.min = "0";
    slider.max = String(this.frames.length - 1);
    slider.value = String(this.index);
    slider.setAttribute("aria-label", "再生位置");
    // 動かしている間は位置の表示だけ変え、指を離した時に移動する(途中で描き直すと指が外れるため)
    slider.addEventListener("input", () => {
      this.stopPlay();
      const f = this.frames[Number(slider.value)].enc.s;
      pos.textContent = `${windLabel(f.roundWind)}${f.roundNumber}局　${Number(slider.value) + 1} / ${this.frames.length}`;
    });
    slider.addEventListener("change", () => this.goTo(Number(slider.value)));
    wrap.appendChild(slider);
    return wrap;
  }

  render() {
    if (!this.state || this._destroyed) return;
    super.render();
    // 上側の手牌を押すと視点(下側のプレイヤー)を入れ替える(観戦画面と同じ操作)
    const row = this.root.querySelector(".hand-row-opponent");
    if (row) {
      row.classList.add("spectator-view-switch");
      row.title = `タップで${this.playerName(this.opponentSeat())}の視点に切り替え`;
      row.addEventListener("click", () => {
        if (this._destroyed) return;
        this.viewSeat = this.opponentSeat();
        this.render();
      });
    }
  }
}

window.KifuStore = KifuStore;
window.KifuRecorder = KifuRecorder;
window.ReplayMahjongApp = ReplayMahjongApp;
