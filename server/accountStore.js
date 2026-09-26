"use strict";

/**
 * アカウントのデータの保存(Firestore)。
 *
 * 保存先は「ドキュメントの読み書き」だけを持つ小さな部品(DocStore)に任せ、その上にアカウントの操作を書く。
 * 本番は FirebaseClient(Firestore)、テスト・ローカルでの確認は MemoryDocStore(メモリ上)を使う。
 *
 * コレクション:
 *   users/{accountId}        {name, email, authUid, createdAt, nameChangedAt, sessionVersion, transferHash, transferExpiresAt}
 *   names/{名前のキー}        {accountId | null, freeAt | null}   名前の予約(変更・削除後は freeAt まで他の人は使えない)
 *   emails/{アドレスのキー}    {accountId}                          メールアドレスの重複防止
 *   sessions/{トークンのハッシュ} {accountId, version, createdAt}    自動ログイン(users の sessionVersion と違えば無効)
 *   guestCounters/{日付}      {next}                               ゲスト番号の通し番号(日本時間の日付ごと)
 *   guestAssign/{日付_端末}    {n}                                  端末ごとのその日のゲスト番号
 */

const crypto = require("crypto");

/** 名前を変えた後・アカウントを削除した後、その名前を他の人が使えるようになるまでの時間 */
const NAME_RELEASE_MS = 5 * 60 * 1000;
/** 名前を変えてから次に変えられるまでの時間 */
const NAME_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

function hex(s) {
  return Buffer.from(String(s), "utf8").toString("hex");
}
function sha256(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}
/** 名前のキー(大文字小文字・全角半角は区別する=そのまま) */
function nameKey(name) {
  return hex(name);
}
/** メールアドレスのキー(大文字小文字は区別しない) */
function emailKey(email) {
  return hex(String(email).trim().toLowerCase());
}

/** メモリ上の DocStore(テスト・ローカルでの確認用) */
class MemoryDocStore {
  constructor() {
    this.docs = new Map();
    this._t = 0;
  }
  _stamp() {
    this._t += 1;
    return String(this._t);
  }
  async getDoc(path) {
    const d = this.docs.get(path);
    return d ? { data: Object.assign({}, d.data), updateTime: d.updateTime } : null;
  }
  async createDoc(collection, id, data) {
    const path = `${collection}/${id}`;
    if (this.docs.has(path)) return false;
    this.docs.set(path, { data: Object.assign({}, data), updateTime: this._stamp() });
    return true;
  }
  async setDoc(path, data, updateTime) {
    const d = this.docs.get(path);
    if (updateTime && (!d || d.updateTime !== updateTime)) return false;
    this.docs.set(path, { data: Object.assign({}, data), updateTime: this._stamp() });
    return true;
  }
  async deleteDoc(path) {
    this.docs.delete(path);
  }
  async increment(path, field) {
    const d = this.docs.get(path) || { data: {} };
    const next = (Number(d.data[field]) || 0) + 1;
    this.docs.set(path, { data: Object.assign({}, d.data, { [field]: next }), updateTime: this._stamp() });
    return next;
  }
}

class AccountStore {
  /** @param {{docs: object, now?: Function}} opts docs は DocStore(FirebaseClient か MemoryDocStore) */
  constructor({ docs, now }) {
    this.docs = docs;
    this.now = now || (() => Date.now());
  }

  async getAccount(accountId) {
    if (!accountId) return null;
    const d = await this.docs.getDoc(`users/${accountId}`);
    return d ? Object.assign({ id: accountId }, d.data) : null;
  }

  /** 名前の持ち主(使われていなければ null) */
  async findAccountIdByName(name) {
    const d = await this.docs.getDoc(`names/${nameKey(name)}`);
    return d && d.data.accountId ? d.data.accountId : null;
  }

  async findAccountIdByEmail(email) {
    const d = await this.docs.getDoc(`emails/${emailKey(email)}`);
    return d && d.data.accountId ? d.data.accountId : null;
  }

  /** 名前がいま空いているか(使われていない、かつ変更・削除後の5分が過ぎている) */
  async isNameAvailable(name) {
    const d = await this.docs.getDoc(`names/${nameKey(name)}`);
    return !d || (!d.data.accountId && (d.data.freeAt || 0) <= this.now());
  }

  /** 名前を確保する。取れなければ false */
  async _claimName(name, accountId) {
    const key = nameKey(name);
    if (await this.docs.createDoc("names", key, { accountId, freeAt: null })) return true;
    const d = await this.docs.getDoc(`names/${key}`);
    if (!d || d.data.accountId || (d.data.freeAt || 0) > this.now()) return false;
    return this.docs.setDoc(`names/${key}`, { accountId, freeAt: null }, d.updateTime);
  }

  /** 名前を手放す(5分後から他の人が使える) */
  async _releaseName(name) {
    await this.docs.setDoc(`names/${nameKey(name)}`, { accountId: null, freeAt: this.now() + NAME_RELEASE_MS });
  }

  /**
   * アカウントを作る。名前かメールアドレスが既に使われていれば、理由("name" | "email")を持つエラーを投げる。
   * @returns {Promise<object>} 作ったアカウント
   */
  async createAccount({ name, email, authUid }) {
    const accountId = crypto.randomBytes(12).toString("hex");
    if (!(await this._claimName(name, accountId))) throw Object.assign(new Error("name taken"), { reason: "name" });
    if (!(await this.docs.createDoc("emails", emailKey(email), { accountId }))) {
      await this.docs.deleteDoc(`names/${nameKey(name)}`);
      throw Object.assign(new Error("email taken"), { reason: "email" });
    }
    const now = this.now();
    const data = {
      name,
      email,
      authUid,
      createdAt: now,
      nameChangedAt: null,
      sessionVersion: 1,
      transferHash: null,
      transferExpiresAt: null,
    };
    await this.docs.setDoc(`users/${accountId}`, data);
    return Object.assign({ id: accountId }, data);
  }

  async _saveAccount(account) {
    const data = Object.assign({}, account);
    delete data.id;
    await this.docs.setDoc(`users/${account.id}`, data);
  }

  /**
   * 名前を変える。前回の変更から30日以内・名前が使われている場合は理由("cooldown" | "name")付きのエラー。
   * @returns {Promise<object>} 変更後のアカウント
   */
  async renameAccount(accountId, newName) {
    const acc = await this.getAccount(accountId);
    if (!acc) throw Object.assign(new Error("no account"), { reason: "account" });
    if (acc.name === newName) return acc;
    if (acc.nameChangedAt && this.now() - acc.nameChangedAt < NAME_CHANGE_COOLDOWN_MS) {
      throw Object.assign(new Error("cooldown"), { reason: "cooldown", until: acc.nameChangedAt + NAME_CHANGE_COOLDOWN_MS });
    }
    if (!(await this._claimName(newName, accountId))) throw Object.assign(new Error("name taken"), { reason: "name" });
    const oldName = acc.name;
    acc.name = newName;
    acc.nameChangedAt = this.now();
    await this._saveAccount(acc);
    await this._releaseName(oldName);
    return acc;
  }

  /** アカウントを削除する(名前は5分後から他の人が使える。自動ログインもすべて無効になる) */
  async deleteAccount(accountId) {
    const acc = await this.getAccount(accountId);
    if (!acc) return null;
    await this.docs.deleteDoc(`users/${accountId}`);
    await this.docs.deleteDoc(`emails/${emailKey(acc.email)}`);
    await this._releaseName(acc.name);
    return acc;
  }

  /** メールアドレスを変える(ほかの端末の自動ログインは無効にする) */
  async changeEmail(accountId, newEmail, newAuthUid) {
    const acc = await this.getAccount(accountId);
    if (!acc) throw Object.assign(new Error("no account"), { reason: "account" });
    if (!(await this.docs.createDoc("emails", emailKey(newEmail), { accountId }))) {
      throw Object.assign(new Error("email taken"), { reason: "email" });
    }
    const oldEmail = acc.email;
    acc.email = newEmail;
    acc.authUid = newAuthUid;
    acc.sessionVersion = (acc.sessionVersion || 1) + 1;
    acc.transferHash = null;
    acc.transferExpiresAt = null;
    await this._saveAccount(acc);
    await this.docs.deleteDoc(`emails/${emailKey(oldEmail)}`);
    return acc;
  }

  // ---------------- 自動ログイン ----------------

  /** 自動ログインのトークンを発行する(端末に保存する値。サーバーにはハッシュだけ残す) */
  async createSession(accountId) {
    const acc = await this.getAccount(accountId);
    if (!acc) throw Object.assign(new Error("no account"), { reason: "account" });
    const token = crypto.randomBytes(32).toString("base64url");
    await this.docs.setDoc(`sessions/${sha256(token)}`, { accountId, version: acc.sessionVersion || 1, createdAt: this.now() });
    return token;
  }

  /** トークンからアカウントを得る(無効なら null) */
  async getSessionAccount(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
    const s = await this.docs.getDoc(`sessions/${sha256(token)}`);
    if (!s) return null;
    const acc = await this.getAccount(s.data.accountId);
    if (!acc || (acc.sessionVersion || 1) !== s.data.version) return null;
    return acc;
  }

  async deleteSession(token) {
    if (typeof token === "string" && token) await this.docs.deleteDoc(`sessions/${sha256(token)}`);
  }

  // ---------------- 引継ぎコード ----------------

  async setTransferCode(accountId, code, expiresAt) {
    const acc = await this.getAccount(accountId);
    if (!acc) throw Object.assign(new Error("no account"), { reason: "account" });
    acc.transferHash = sha256(code);
    acc.transferExpiresAt = expiresAt;
    await this._saveAccount(acc);
  }

  /** 引継ぎコードが正しいか(正しければ使用済みにする) */
  async consumeTransferCode(accountId, code) {
    const acc = await this.getAccount(accountId);
    if (!acc || !acc.transferHash || (acc.transferExpiresAt || 0) < this.now()) return false;
    const a = Buffer.from(acc.transferHash, "hex");
    const b = Buffer.from(sha256(code), "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    acc.transferHash = null;
    acc.transferExpiresAt = null;
    await this._saveAccount(acc);
    return true;
  }

  /** 引継ぎコードが正しいかを、使用済みにせずに確かめる */
  async checkTransferCode(accountId, code) {
    const acc = await this.getAccount(accountId);
    if (!acc || !acc.transferHash || (acc.transferExpiresAt || 0) < this.now()) return false;
    const a = Buffer.from(acc.transferHash, "hex");
    const b = Buffer.from(sha256(code), "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // ---------------- ゲスト番号 ----------------

  /**
   * その日のその端末のゲスト番号(同じ日・同じ端末なら同じ番号。1日の中で重ならない)。
   * @param {string} dateKey 日本時間の日付(例: 20260926)
   * @param {string} clientId 端末ID
   */
  async guestNumber(dateKey, clientId) {
    const assignId = `${dateKey}_${sha256(clientId).slice(0, 32)}`;
    const existing = await this.docs.getDoc(`guestAssign/${assignId}`);
    if (existing) return existing.data.n;
    const n = await this.docs.increment(`guestCounters/${dateKey}`, "next");
    if (await this.docs.createDoc("guestAssign", assignId, { n })) return n;
    const again = await this.docs.getDoc(`guestAssign/${assignId}`);
    return again ? again.data.n : n;
  }
}

module.exports = { AccountStore, MemoryDocStore, NAME_RELEASE_MS, NAME_CHANGE_COOLDOWN_MS, sha256 };
