"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { FirebaseClient } = require("./firebaseClient");

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const { status = 200, json = {} } = handler(url, opts) || {};
    return { ok: status >= 200 && status < 300, status, json: async () => json, text: async () => JSON.stringify(json) };
  };
  fn.calls = calls;
  return fn;
}

test("サーバー用の鍵で署名したトークンを取り、管理者として Authentication・Firestore を呼ぶ", async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const sa = { client_email: "svc@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
  const fetch = fakeFetch((url) => {
    if (url === "https://oauth2.googleapis.com/token") return { json: { access_token: "AT", expires_in: 3600 } };
    if (url.includes("accounts:lookup")) return { json: { users: [{ localId: "U1", email: "a@example.com" }] } };
    if (url.includes("/documents/names/")) return { status: 404, json: { error: { status: "NOT_FOUND" } } };
    if (url.includes("documents:commit")) return { json: { writeResults: [{ transformResults: [{ integerValue: "7" }] }] } };
    if (url.includes("documents/users?documentId=")) return { status: 409, json: { error: { status: "ALREADY_EXISTS" } } };
    return { json: {} };
  });
  const c = new FirebaseClient({ projectId: "proj", apiKey: "KEY", serviceAccount: sa, fetch });

  const user = await c.lookupByEmail("a@example.com");
  assert.equal(user.localId, "U1");
  // 1回目はトークンを取りに行く(JWT は鍵で正しく署名されている)
  const tokenCall = fetch.calls[0];
  const assertion = new URLSearchParams(tokenCall.opts.body).get("assertion");
  const [h, p, sig] = assertion.split(".");
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, "base64url")));
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  // 管理者の呼び出しには Bearer トークンが付く
  assert.equal(fetch.calls[1].url, "https://identitytoolkit.googleapis.com/v1/projects/proj/accounts:lookup");
  assert.equal(fetch.calls[1].opts.headers.Authorization, "Bearer AT");

  // 2回目以降はトークンを使い回す
  assert.equal(await c.getDoc("names/abc"), null);
  assert.equal(fetch.calls.filter((x) => x.url.includes("oauth2")).length, 1);
  assert.equal(await c.increment("guestCounters/20260926", "next"), 7);
  const commit = fetch.calls.find((x) => x.url.includes("documents:commit"));
  assert.equal(commit.url, "https://firestore.googleapis.com/v1/projects/proj/databases/(default)/documents:commit");
  assert.equal(JSON.parse(commit.opts.body).writes[0].transform.document, "projects/proj/databases/(default)/documents/guestCounters/20260926");
  assert.equal(await c.createDoc("users", "x", { a: 1 }), false); // 既にある

  // 利用者の立場の呼び出しは API キーを付ける(トークンは付けない)
  await c.sendVerifyEmail("IDT", "https://example.test/?rid=1");
  const send = fetch.calls.at(-1);
  assert.equal(send.url, "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=KEY");
  assert.equal(send.opts.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(send.opts.body), { requestType: "VERIFY_EMAIL", idToken: "IDT", continueUrl: "https://example.test/?rid=1" });
});

test("Authentication のエラーは code に理由が入る", async () => {
  const fetch = fakeFetch(() => ({ status: 400, json: { error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER : wait" } } }));
  const c = new FirebaseClient({ projectId: "p", apiKey: "K", serviceAccount: null, fetch });
  await assert.rejects(c.sendVerifyEmail("x", "y"), (e) => e.code === "TOO_MANY_ATTEMPTS_TRY_LATER" && e.status === 400);
});
