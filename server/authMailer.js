"use strict";

/**
 * ログイン用のメール(Firebase の「メールアドレス確認メール」)の送信と、メールのリンクの確認。
 *
 * - FirebaseAuthMailer: 本番。送るたびにそのアドレスの Firebase のアカウントを「未確認」に戻してから
 *   確認メールを送る(確認済みのアドレスにも毎回送れるように)。パスワードは使わない(送るたびに
 *   サーバーだけが知る使い捨ての値に変える)。
 * - FakeAuthMailer: テスト・ローカルでの確認用。メールは送らず、リンクを onSend に渡すだけ。
 */

const crypto = require("crypto");

class FirebaseAuthMailer {
  /** @param {{client: import("./firebaseClient").FirebaseClient}} opts */
  constructor({ client }) {
    this.client = client;
  }

  /**
   * email に確認メールを送る。Firebase のアカウントが無ければ作る。
   * @returns {Promise<string>} Firebase のアカウントの ID(authUid)
   */
  async sendLink(email, continueUrl) {
    const c = this.client;
    const password = crypto.randomBytes(24).toString("base64url");
    let user = await c.lookupByEmail(email);
    let localId;
    if (user) {
      localId = user.localId;
      await c.updateAuthUser(localId, { password, emailVerified: false });
    } else {
      localId = await c.createAuthUser(email, password);
    }
    const idToken = await c.signInWithPassword(email, password);
    await c.sendVerifyEmail(idToken, continueUrl);
    return localId;
  }

  /** メールのリンクの oobCode を確かめ、そのメールアドレスを返す(無効なら例外) */
  async applyCode(oobCode) {
    return this.client.applyVerifyCode(oobCode);
  }

  async deleteAuthUser(authUid) {
    if (authUid) await this.client.deleteAuthUser(authUid);
  }
}

class FakeAuthMailer {
  /** @param {{onSend?: (info: {email: string, link: string, oobCode: string}) => void}} [opts] */
  constructor(opts = {}) {
    this.onSend = opts.onSend || null;
    this.codes = new Map(); // oobCode -> email
    this.users = new Map(); // email -> authUid
    this.sent = [];
  }

  async sendLink(email, continueUrl) {
    const key = email.toLowerCase();
    if (!this.users.has(key)) this.users.set(key, "fake-" + crypto.randomBytes(6).toString("hex"));
    const oobCode = crypto.randomBytes(12).toString("hex");
    this.codes.set(oobCode, email);
    const link = `${continueUrl.split("?")[0]}?mode=verifyEmail&oobCode=${oobCode}&continueUrl=${encodeURIComponent(continueUrl)}`;
    const info = { email, link, oobCode, continueUrl };
    this.sent.push(info);
    if (this.onSend) this.onSend(info);
    return this.users.get(key);
  }

  async applyCode(oobCode) {
    const email = this.codes.get(oobCode);
    if (!email) throw Object.assign(new Error("INVALID_OOB_CODE"), { code: "INVALID_OOB_CODE" });
    this.codes.delete(oobCode);
    return email;
  }

  async deleteAuthUser(authUid) {
    for (const [k, v] of this.users) if (v === authUid) this.users.delete(k);
  }
}

module.exports = { FirebaseAuthMailer, FakeAuthMailer };
