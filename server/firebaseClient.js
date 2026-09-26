"use strict";

/**
 * Firebase(Authentication・Firestore)の REST API を呼ぶための最小限の部品。
 * 追加のパッケージを使わず、Node の標準機能(crypto・fetch)だけで書いている。
 *
 * - サーバー用の鍵(サービスアカウントの JSON)は環境変数 FIREBASE_SERVICE_ACCOUNT から読む
 *   (リポジトリには入れない)。鍵から OAuth のアクセストークンを作り、管理者として
 *   Authentication のアカウント操作と Firestore の読み書きを行う。
 * - ウェブ API キー(公開してよい値)は、利用者の立場で行う操作(パスワードでのサインイン・
 *   確認メールの送信・確認メールのリンクの適用)に使う。
 */

const crypto = require("crypto");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const IDT = "https://identitytoolkit.googleapis.com/v1";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/identitytoolkit",
].join(" ");

/** Firebase の API が返したエラー(code は "EMAIL_EXISTS" などの文字列、status は HTTP の状態) */
class FirebaseError extends Error {
  constructor(code, status) {
    super(`Firebase: ${code}`);
    this.code = code;
    this.status = status;
  }
}

function base64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

class FirebaseClient {
  /**
   * @param {{projectId: string, apiKey: string, serviceAccount: {client_email: string, private_key: string},
   *          fetch?: Function, now?: Function}} opts
   */
  constructor({ projectId, apiKey, serviceAccount, fetch: fetchFn, now }) {
    this.projectId = projectId;
    this.apiKey = apiKey;
    this.serviceAccount = serviceAccount;
    this.fetch = fetchFn || globalThis.fetch;
    this.now = now || (() => Date.now());
    this._token = null; // {value, expiresAt}
    this._tokenPromise = null;
  }

  // ---------------- 管理者のアクセストークン ----------------

  async accessToken() {
    if (this._token && this._token.expiresAt - 60000 > this.now()) return this._token.value;
    if (!this._tokenPromise) {
      this._tokenPromise = this._fetchToken().finally(() => {
        this._tokenPromise = null;
      });
    }
    return this._tokenPromise;
  }

  async _fetchToken() {
    const iat = Math.floor(this.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
      JSON.stringify({ iss: this.serviceAccount.client_email, scope: SCOPES, aud: TOKEN_URL, iat, exp: iat + 3600 })
    );
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${claims}`);
    const jwt = `${header}.${claims}.${base64url(signer.sign(this.serviceAccount.private_key))}`;
    const res = await this.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) throw new FirebaseError(json.error || "TOKEN_FAILED", res.status);
    this._token = { value: json.access_token, expiresAt: this.now() + (json.expires_in || 3600) * 1000 };
    return this._token.value;
  }

  async _request(url, { method = "POST", body, admin = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (admin) headers.Authorization = `Bearer ${await this.accessToken()}`;
    const res = await this.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch (e) {
      json = {};
    }
    if (!res.ok) {
      const err = json.error || {};
      // Authentication は message に "EMAIL_EXISTS" などのコード、Firestore は status に "ALREADY_EXISTS" など
      const code = (typeof err.message === "string" && /^[A-Z_]+/.test(err.message) ? err.message.split(/[ :]/)[0] : null) || err.status || `HTTP_${res.status}`;
      throw new FirebaseError(code, res.status);
    }
    return json;
  }

  // ---------------- Authentication ----------------

  /** メールアドレスからアカウントを探す(管理者)。無ければ null */
  async lookupByEmail(email) {
    const json = await this._request(`${IDT}/projects/${this.projectId}/accounts:lookup`, { body: { email: [email] }, admin: true });
    return (json.users && json.users[0]) || null;
  }

  /** アカウントを作る(管理者)。localId を返す */
  async createAuthUser(email, password) {
    const json = await this._request(`${IDT}/projects/${this.projectId}/accounts`, { body: { email, password }, admin: true });
    return json.localId;
  }

  /** アカウントを更新する(管理者)。patch は {password, emailVerified, email} など */
  async updateAuthUser(localId, patch) {
    await this._request(`${IDT}/projects/${this.projectId}/accounts:update`, { body: Object.assign({ localId }, patch), admin: true });
  }

  /** アカウントを削除する(管理者) */
  async deleteAuthUser(localId) {
    await this._request(`${IDT}/projects/${this.projectId}/accounts:delete`, { body: { localId }, admin: true });
  }

  /** パスワードでサインインして ID トークンを得る(確認メールを送るため) */
  async signInWithPassword(email, password) {
    const json = await this._request(`${IDT}/accounts:signInWithPassword?key=${this.apiKey}`, {
      body: { email, password, returnSecureToken: true },
    });
    return json.idToken;
  }

  /** 確認メールを送る(リンクの飛び先の continueUrl を付ける) */
  async sendVerifyEmail(idToken, continueUrl) {
    await this._request(`${IDT}/accounts:sendOobCode?key=${this.apiKey}`, {
      body: { requestType: "VERIFY_EMAIL", idToken, continueUrl },
    });
  }

  /** 確認メールのリンクに付いていた oobCode を適用し、確認できたメールアドレスを返す */
  async applyVerifyCode(oobCode) {
    const json = await this._request(`${IDT}/accounts:update?key=${this.apiKey}`, { body: { oobCode } });
    return json.email || null;
  }

  // ---------------- Firestore ----------------

  _docUrl(path) {
    return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
  }

  _docName(path) {
    return `projects/${this.projectId}/databases/(default)/documents/${path}`;
  }

  /** ドキュメントを読む。無ければ null。{data, updateTime} を返す */
  async getDoc(path) {
    try {
      const json = await this._request(this._docUrl(path), { method: "GET", admin: true });
      return { data: fromFields(json.fields || {}), updateTime: json.updateTime };
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /** ドキュメントを新しく作る。既にあれば false */
  async createDoc(collection, id, data) {
    try {
      await this._request(`${this._docUrl(collection)}?documentId=${encodeURIComponent(id)}`, {
        body: { fields: toFields(data) },
        admin: true,
      });
      return true;
    } catch (err) {
      if (err.status === 409) return false;
      throw err;
    }
  }

  /**
   * ドキュメントを丸ごと書き換える。updateTime を渡すと、その時点から変わっていない場合だけ書く
   * (変わっていたら false)。
   */
  async setDoc(path, data, updateTime) {
    const q = updateTime ? `?currentDocument.updateTime=${encodeURIComponent(updateTime)}` : "";
    try {
      await this._request(`${this._docUrl(path)}${q}`, { method: "PATCH", body: { fields: toFields(data) }, admin: true });
      return true;
    } catch (err) {
      if (updateTime && (err.status === 400 || err.status === 409 || err.code === "FAILED_PRECONDITION")) return false;
      throw err;
    }
  }

  async deleteDoc(path) {
    try {
      await this._request(this._docUrl(path), { method: "DELETE", admin: true });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
  }

  /** 数値の項目を1増やして、増やした後の値を返す(ドキュメントが無ければ作る) */
  async increment(path, field) {
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents:commit`;
    const json = await this._request(commitUrl, {
      body: {
        writes: [{ transform: { document: this._docName(path), fieldTransforms: [{ fieldPath: field, increment: { integerValue: "1" } }] } }],
      },
      admin: true,
    });
    const r = json.writeResults && json.writeResults[0] && json.writeResults[0].transformResults && json.writeResults[0].transformResults[0];
    return r ? Number(r.integerValue) : NaN;
  }
}

/** JavaScript の値(文字列・整数・真偽値・null のみ)を Firestore の形に */
function toFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) out[k] = { nullValue: null };
    else if (typeof v === "boolean") out[k] = { booleanValue: v };
    else if (typeof v === "number") out[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    else out[k] = { stringValue: String(v) };
  }
  return out;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ("stringValue" in v) out[k] = v.stringValue;
    else if ("integerValue" in v) out[k] = Number(v.integerValue);
    else if ("doubleValue" in v) out[k] = v.doubleValue;
    else if ("booleanValue" in v) out[k] = v.booleanValue;
    else out[k] = null;
  }
  return out;
}

module.exports = { FirebaseClient, FirebaseError, toFields, fromFields };
