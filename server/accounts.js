"use strict";

/**
 * アカウント機能の流れ(docs/account-spec.md の「1. 登録・ログイン」〜「6. 削除・メールアドレス変更」)。
 *
 * 認証の流れ(登録・ログイン・削除・メールアドレス変更で共通):
 *   1. startAuth: 受付(rid)と、始めた端末だけが知る合言葉(secret)と、メールの中にだけ書く合言葉(v)を作り、確認メールを送る。
 *      メールのリンクの戻り先(continueUrl)は公開ページ(publicUrl)の ?rid=…&v=…。
 *   2. verifyLink: 確認ページから。次のどちらかで「メールの持ち主がリンクを押した」ことを確かめ、6桁の認証コードを作って返す。
 *      - Firebase の標準のページでアドレスの確認が済み、「続行」で戻ってきた: rid と v(メールの中にしか無い)が一致し、
 *        Firebase のアカウントが確認済みになっている(送るたびに未確認に戻している)
 *      - アクション URL を公開ページにしている場合: リンクの oobCode を Firebase に適用できた
 *   3. completeAuth: 始めた端末が rid・secret・認証コードを送ってくる → 一致すれば登録/ログイン等を行う。
 * 受付はメモリ上に置く(サーバーが再起動したらやり直し)。
 */

const crypto = require("crypto");
const { sha256 } = require("./accountStore");

/** 受付の有効期限(メールのリンクを押すまで) */
const REQUEST_TTL_MS = 30 * 60 * 1000;
/** 認証コードの有効期限 */
const CODE_TTL_MS = 10 * 60 * 1000;
/** 認証コードを間違えてよい回数 */
const CODE_MAX_ATTEMPTS = 5;
/** 同じ受付でメールを送り直せるまでの間隔 */
const RESEND_INTERVAL_MS = 60 * 1000;
/** 1つの接続が一定時間内に始められる受付の数 */
const START_WINDOW_MS = 10 * 60 * 1000;
const START_MAX_PER_WINDOW = 5;
/** 引継ぎコードの有効期限 */
const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000;
/** ユーザー名の最大文字数 */
const MAX_USERNAME_LENGTH = 20;
/** ゲストの既定の名前の頭(「Playern(ゲスト)」) */
const GUEST_PREFIX = "Player";
/** ゲストの名前の後ろに付ける印(この印で終わる名前は登録できない) */
const GUEST_SUFFIX = "(ゲスト)";

class AccountError extends Error {
  /** message はそのまま利用者に見せてよい文言 */
  constructor(message, reason) {
    super(message);
    this.reason = reason || null;
  }
}

// ---------------- ユーザー名・メールアドレスの検査 ----------------

const BIDI_ALLOWED = /[‪-‮⁦-⁩]/u; // 文字の向きを変える記号(埋め込み・上書き・分離)は許可
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Z}ᅟᅠㅤﾠ⠀͏឴឵᠋-᠏]/u;
const EXT_PICT = /\p{Extended_Pictographic}/u;

/**
 * 登録するユーザー名を検査する。問題なければ NFC に正規化した名前、だめなら理由の文言を返す。
 * 見えない文字(空白・全角スペース・ゼロ幅文字・向きの目印 LRM/RLM など)は禁止。
 * 文字の向きを変える記号(埋め込み・上書き・分離)は許可(表示時に名前の中に閉じ込める)。
 * 絵文字どうしをつなぐゼロ幅接合子は許可。結合文字は1文字につき3つまで。「(ゲスト)」で終わる名前は禁止。
 * @returns {{name: string} | {error: string}}
 */
function validateUsername(raw) {
  if (typeof raw !== "string") return { error: "名前を入力してください。" };
  const name = raw.normalize("NFC");
  if (!name) return { error: "名前を入力してください。" };
  const chars = Array.from(name);
  let visible = 0;
  let marks = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (BIDI_ALLOWED.test(c)) continue;
    if (c === "‍") {
      const prev = chars[i - 1] === "️" ? chars[i - 2] : chars[i - 1];
      if (EXT_PICT.test(prev || "") && EXT_PICT.test(chars[i + 1] || "")) continue;
      return { error: "名前に見えない文字は使えません。" };
    }
    if (INVISIBLE.test(c)) {
      return { error: /\p{Z}/u.test(c) ? "名前に空白は使えません。" : "名前に見えない文字は使えません。" };
    }
    if (/\p{M}/u.test(c)) {
      if (++marks > 3) return { error: "名前に、同じ文字へ4つ以上の記号を重ねることはできません。" };
      continue;
    }
    marks = 0;
    visible++;
  }
  if (visible === 0) return { error: "名前を入力してください。" };
  if (visible > MAX_USERNAME_LENGTH) return { error: `名前は${MAX_USERNAME_LENGTH}文字までです。` };
  if (/[(（]ゲスト[)）]$/u.test(name)) return { error: `「${GUEST_SUFFIX}」で終わる名前は使えません。` };
  return { name };
}

function validateEmail(raw) {
  if (typeof raw !== "string") return { error: "メールアドレスを入力してください。" };
  const email = raw.trim();
  if (!email) return { error: "メールアドレスを入力してください。" };
  if (email.length > 254 || !/^[^\s@"<>()[\]\\,;:]+@[^\s@"<>()[\]\\,;:]+\.[^\s@"<>()[\]\\,;:]+$/.test(email)) {
    return { error: "メールアドレスの形が正しくありません。" };
  }
  return { email };
}

/** メールアドレスを一部伏せた表示(例: ab***@gmail.com) */
function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  return `${user.slice(0, 2)}***@${domain || ""}`;
}

/** 日本時間の日付(例: 20260926) */
function jstDateKey(now) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

const TRANSFER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomTransferCode() {
  let s = "";
  for (let i = 0; i < 16; i++) s += TRANSFER_ALPHABET[crypto.randomInt(TRANSFER_ALPHABET.length)];
  return s.match(/.{4}/g).join("-");
}

function normalizeTransferCode(raw) {
  return typeof raw === "string" ? raw.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

function safeEqualHex(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

class AccountService {
  /**
   * @param {{store: import("./accountStore").AccountStore, mailer: object, publicUrl: string, now?: Function}} opts
   *   publicUrl: メールのリンクの戻り先(公開ページの URL)
   */
  constructor({ store, mailer, publicUrl, now }) {
    this.store = store;
    this.mailer = mailer;
    this.publicUrl = publicUrl;
    this.now = now || (() => Date.now());
    /** rid -> 受付 */
    this.requests = new Map();
    /** 接続などの単位 -> 最近始めた受付の時刻 */
    this._starts = new Map();
  }

  _cleanup() {
    const now = this.now();
    for (const [rid, r] of this.requests) if (r.expiresAt < now) this.requests.delete(rid);
    for (const [k, list] of this._starts) {
      const recent = list.filter((t) => t > now - START_WINDOW_MS);
      if (recent.length) this._starts.set(k, recent);
      else this._starts.delete(k);
    }
  }

  _checkStartRate(rateKey) {
    this._cleanup();
    const list = this._starts.get(rateKey) || [];
    if (list.length >= START_MAX_PER_WINDOW) {
      throw new AccountError("短い時間に何度も申し込まれたため、しばらく待ってからお試しください。", "rate");
    }
    list.push(this.now());
    this._starts.set(rateKey, list);
  }

  // ---------------- 名前(ゲスト・ログイン中) ----------------

  /**
   * 接続してきた人が誰か。自動ログインのトークンが有効ならそのアカウント、無ければゲスト。
   * ゲストの名前は、自分で決めた名前(guestName。登録と同じ検査を通ったもの)か「Playern」に「(ゲスト)」を付けたもの。
   * @returns {Promise<{guest: boolean, name: string, accountId?: string, guestNameError?: string}>}
   */
  async identify({ sessionToken, clientId, guestName }) {
    if (sessionToken) {
      const acc = await this.store.getSessionAccount(sessionToken);
      if (acc) return { guest: false, name: acc.name, accountId: acc.id };
    }
    let guestNameError;
    if (typeof guestName === "string" && guestName) {
      const v = validateUsername(guestName);
      if (v.name) return { guest: true, name: `${v.name}${GUEST_SUFFIX}` };
      guestNameError = v.error;
    }
    const id = typeof clientId === "string" && clientId.trim() ? clientId.trim().slice(0, 100) : crypto.randomBytes(8).toString("hex");
    const n = await this.store.guestNumber(jstDateKey(this.now()), id);
    const r = { guest: true, name: `${GUEST_PREFIX}${n}${GUEST_SUFFIX}` };
    if (guestNameError) r.guestNameError = guestNameError;
    return r;
  }

  /** ゲストの名前を決める(登録と同じ検査。保存は端末側で、以後の名乗りで送られてくる) */
  guestRename(newName) {
    const v = validateUsername(newName);
    if (v.error) throw new AccountError(v.error, "name");
    return { name: `${v.name}${GUEST_SUFFIX}`, baseName: v.name };
  }

  /** オプション画面に出すアカウントの情報 */
  async accountInfo(accountId) {
    const acc = await this.store.getAccount(accountId);
    if (!acc) throw new AccountError("アカウントが見つかりませんでした。もう一度ログインしてください。", "account");
    return {
      name: acc.name,
      email: maskEmail(acc.email),
      nameChangeAvailableAt: acc.nameChangedAt ? acc.nameChangedAt + 30 * 24 * 60 * 60 * 1000 : null,
    };
  }

  // ---------------- 認証の流れ ----------------

  /**
   * 受付を始めて確認メールを送る。
   * @param {{mode: "register"|"login"|"delete"|"email", name?: string, email?: string, transferCode?: string,
   *          accountId?: string}} params  accountId は削除のとき(ログイン中の人)に使う
   * @param {*} rateKey 送信回数を数える単位(接続など)
   * @returns {Promise<{rid: string, secret: string, email: string, resendAfterMs: number}>}
   */
  async startAuth(params, rateKey) {
    const p = params || {};
    const mode = p.mode;
    let email;
    let accountId = null;
    let name = null;
    let transferCode = null;
    if (mode === "register") {
      const n = validateUsername(p.name);
      if (n.error) throw new AccountError(n.error, "name");
      const e = validateEmail(p.email);
      if (e.error) throw new AccountError(e.error, "email");
      if (!(await this.store.isNameAvailable(n.name))) throw new AccountError("そのユーザー名は既に使われています。", "name");
      if (await this.store.findAccountIdByEmail(e.email)) {
        throw new AccountError("このメールアドレスは既に登録されています。「ログイン」からログインしてください。", "email");
      }
      name = n.name;
      email = e.email;
    } else if (mode === "login" || mode === "email") {
      const raw = typeof p.name === "string" ? p.name.normalize("NFC") : "";
      accountId = raw ? await this.store.findAccountIdByName(raw) : null;
      if (!accountId) throw new AccountError("そのユーザー名は登録されていません。", "name");
      const acc = await this.store.getAccount(accountId);
      if (!acc) throw new AccountError("そのユーザー名は登録されていません。", "name");
      if (mode === "login") {
        email = acc.email;
      } else {
        const e = validateEmail(p.email);
        if (e.error) throw new AccountError(e.error, "email");
        transferCode = normalizeTransferCode(p.transferCode);
        if (!(await this.store.checkTransferCode(accountId, transferCode))) {
          throw new AccountError("引継ぎコードが正しくないか、有効期限が切れています。", "transfer");
        }
        if (await this.store.findAccountIdByEmail(e.email)) throw new AccountError("このメールアドレスは既に登録されています。", "email");
        email = e.email;
      }
    } else if (mode === "delete") {
      const acc = await this.store.getAccount(p.accountId);
      if (!acc) throw new AccountError("ログインしていません。", "account");
      accountId = acc.id;
      email = acc.email;
    } else {
      throw new AccountError("不正な申し込みです。", "mode");
    }
    this._checkStartRate(rateKey);
    const rid = crypto.randomBytes(12).toString("base64url");
    const secret = crypto.randomBytes(24).toString("base64url");
    // メールの中(リンクの戻り先)にだけ書く合言葉。始めた端末には渡さない
    const vtoken = crypto.randomBytes(18).toString("base64url");
    const now = this.now();
    const req = {
      rid,
      mode,
      secretHash: sha256(secret),
      vtoken,
      email,
      name,
      accountId,
      transferCode,
      authUid: null,
      createdAt: now,
      expiresAt: now + REQUEST_TTL_MS,
      lastSentAt: 0,
      code: null,
    };
    await this._send(req);
    this.requests.set(rid, req);
    return { rid, secret, email: maskEmail(email), resendAfterMs: RESEND_INTERVAL_MS };
  }

  async _send(req) {
    try {
      req.authUid = await this.mailer.sendLink(
        req.email,
        `${this.publicUrl}?rid=${encodeURIComponent(req.rid)}&v=${encodeURIComponent(req.vtoken)}`
      );
    } catch (err) {
      if (err && /TOO_MANY_ATTEMPTS/.test(err.code || err.message || "")) {
        throw new AccountError("メールの送信が混み合っています。1分ほど待ってからお試しください。", "rate");
      }
      if (err && /QUOTA_EXCEEDED/.test(err.code || err.message || "")) {
        throw new AccountError("本日のメール送信の上限に達しました。明日もう一度お試しください。", "quota");
      }
      throw new AccountError("メールを送れませんでした。しばらくしてからお試しください。", "send");
    }
    req.lastSentAt = this.now();
  }

  _getRequest(rid, secret) {
    this._cleanup();
    const req = typeof rid === "string" ? this.requests.get(rid) : null;
    if (!req) throw new AccountError("受付の有効期限が切れました。もう一度最初からお試しください。", "expired");
    if (secret !== undefined && (typeof secret !== "string" || !safeEqualHex(req.secretHash, sha256(secret)))) {
      throw new AccountError("受付の情報が一致しません。もう一度最初からお試しください。", "secret");
    }
    return req;
  }

  /** メールを送り直す(前回から1分以上経っていれば) */
  async resend({ rid, secret }) {
    const req = this._getRequest(rid, secret);
    const wait = req.lastSentAt + RESEND_INTERVAL_MS - this.now();
    if (wait > 0) throw new AccountError(`あと${Math.ceil(wait / 1000)}秒待ってから送り直してください。`, "rate");
    if (req.code) throw new AccountError("すでに認証コードが発行されています。確認ページに表示されたコードを入力してください。", "verified");
    await this._send(req);
    return { resendAfterMs: RESEND_INTERVAL_MS };
  }

  /**
   * 確認ページから: メールの持ち主がリンクを押したことを確かめ、認証コードを作る
   * (v: リンクの戻り先の合言葉。oobCode: アクション URL を公開ページにしている場合のリンクの確認情報)。
   * @returns {Promise<{code: string, requestedAt: number, mode: string}>}
   */
  async verifyLink({ rid, oobCode, v }) {
    const req = this._getRequest(rid);
    if (typeof oobCode === "string" && oobCode) {
      if (oobCode.length > 512) throw new AccountError("リンクが正しくありません。", "link");
      let email;
      try {
        email = await this.mailer.applyCode(oobCode);
      } catch (err) {
        throw new AccountError("このリンクは使用済みか、有効期限が切れています。ゲームの画面からメールを送り直してください。", "link");
      }
      if (!email || email.toLowerCase() !== req.email.toLowerCase()) {
        throw new AccountError("このリンクは、この受付のものではありません。", "link");
      }
    } else {
      if (typeof v !== "string" || !safeEqualHex(sha256(req.vtoken), sha256(v))) {
        throw new AccountError("リンクが正しくありません。メールに届いたリンクから開いてください。", "link");
      }
      let verified = false;
      try {
        verified = await this.mailer.isVerified(req.email);
      } catch (err) {
        throw new AccountError("確認できませんでした。しばらくしてからもう一度開いてください。", "send");
      }
      if (!verified) {
        throw new AccountError("メールアドレスの確認がまだ済んでいません。メールのリンクを押して、表示されたページの「続行」を押してください。", "pending");
      }
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    // 読み込み直しなどで発行し直しても、間違えた回数は引き継ぐ
    const attempts = req.code ? req.code.attempts : 0;
    req.code = { hash: sha256(`${req.rid}:${code}`), expiresAt: this.now() + CODE_TTL_MS, attempts };
    req.expiresAt = Math.max(req.expiresAt, req.code.expiresAt);
    return { code, requestedAt: req.createdAt, mode: req.mode };
  }

  /**
   * 始めた端末から: 認証コードを確かめて、登録・ログイン・削除・メールアドレス変更を行う。
   * @returns {Promise<{token?: string, name?: string, deleted?: boolean}>}
   */
  async completeAuth({ rid, secret, code }) {
    const req = this._getRequest(rid, secret);
    if (!req.code) throw new AccountError("まだメールのリンクが押されていません。メールのリンクを押して、表示されたコードを入力してください。", "pending");
    if (req.code.expiresAt < this.now()) {
      this.requests.delete(req.rid);
      throw new AccountError("認証コードの有効期限が切れました。もう一度最初からお試しください。", "expired");
    }
    const input = typeof code === "string" ? code.replace(/\D/g, "") : "";
    if (!safeEqualHex(req.code.hash, sha256(`${req.rid}:${input}`))) {
      req.code.attempts++;
      if (req.code.attempts >= CODE_MAX_ATTEMPTS) {
        this.requests.delete(req.rid);
        throw new AccountError("認証コードを何度も間違えたため、受付を取り消しました。もう一度最初からお試しください。", "attempts");
      }
      throw new AccountError(`認証コードが違います(あと${CODE_MAX_ATTEMPTS - req.code.attempts}回)。`, "code");
    }
    this.requests.delete(req.rid);
    return this._finish(req);
  }

  async _finish(req) {
    const s = this.store;
    if (req.mode === "register") {
      let acc;
      try {
        acc = await s.createAccount({ name: req.name, email: req.email, authUid: req.authUid });
      } catch (err) {
        if (err.reason === "name") throw new AccountError("そのユーザー名は既に使われています。別の名前でお試しください。", "name");
        if (err.reason === "email") throw new AccountError("このメールアドレスは既に登録されています。", "email");
        throw err;
      }
      return { token: await s.createSession(acc.id), name: acc.name };
    }
    if (req.mode === "login") {
      const acc = await s.getAccount(req.accountId);
      if (!acc) throw new AccountError("アカウントが見つかりませんでした。", "account");
      return { token: await s.createSession(acc.id), name: acc.name };
    }
    if (req.mode === "delete") {
      const acc = await s.deleteAccount(req.accountId);
      if (acc) await this.mailer.deleteAuthUser(acc.authUid).catch(() => {});
      return { deleted: true };
    }
    if (req.mode === "email") {
      const before = await s.getAccount(req.accountId);
      if (!before) throw new AccountError("アカウントが見つかりませんでした。", "account");
      // 引継ぎコードはここで使用済みにする(メールの確認まで済んだ時点で)。確かめた後に期限切れ・使用済みになっていれば断る
      if (!(await s.consumeTransferCode(req.accountId, req.transferCode || ""))) {
        throw new AccountError("引継ぎコードが正しくないか、有効期限が切れています。", "transfer");
      }
      let acc;
      try {
        acc = await s.changeEmail(req.accountId, req.email, req.authUid);
      } catch (err) {
        if (err.reason === "email") throw new AccountError("このメールアドレスは既に登録されています。", "email");
        throw err;
      }
      if (before.authUid && before.authUid !== req.authUid) await this.mailer.deleteAuthUser(before.authUid).catch(() => {});
      return { token: await s.createSession(acc.id), name: acc.name };
    }
    throw new AccountError("不正な申し込みです。", "mode");
  }

  // ---------------- ログイン中の操作 ----------------

  async rename(accountId, newName) {
    const n = validateUsername(newName);
    if (n.error) throw new AccountError(n.error, "name");
    try {
      const acc = await this.store.renameAccount(accountId, n.name);
      return { name: acc.name };
    } catch (err) {
      if (err.reason === "cooldown") {
        const d = new Date(err.until + 9 * 60 * 60 * 1000);
        const until = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日${d.getUTCHours()}時`;
        throw new AccountError(`名前は変更してから30日間は変えられません(${until}以降に変更できます)。`, "cooldown");
      }
      if (err.reason === "name") throw new AccountError("そのユーザー名は既に使われています。", "name");
      if (err.reason === "account") throw new AccountError("アカウントが見つかりませんでした。", "account");
      throw err;
    }
  }

  /** 引継ぎコードを発行する(前に発行したものは使えなくなる) */
  async issueTransferCode(accountId) {
    const code = randomTransferCode();
    const expiresAt = this.now() + TRANSFER_TTL_MS;
    await this.store.setTransferCode(accountId, normalizeTransferCode(code), expiresAt);
    return { code, expiresAt };
  }

  async logout(sessionToken) {
    await this.store.deleteSession(sessionToken);
  }
}

module.exports = {
  AccountService,
  AccountError,
  validateUsername,
  validateEmail,
  maskEmail,
  jstDateKey,
  normalizeTransferCode,
  GUEST_PREFIX,
  GUEST_SUFFIX,
  CODE_MAX_ATTEMPTS,
  RESEND_INTERVAL_MS,
  TRANSFER_TTL_MS,
};
