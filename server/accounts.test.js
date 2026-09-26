"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AccountService, validateUsername, jstDateKey } = require("./accounts");
const { AccountStore, MemoryDocStore, NAME_RELEASE_MS, NAME_CHANGE_COOLDOWN_MS } = require("./accountStore");
const { FakeAuthMailer } = require("./authMailer");
const { RoomRegistry, handleClientMessage, PROTOCOL_VERSION } = require("./protocol");

function setup() {
  const clock = { now: Date.UTC(2026, 8, 26, 3, 0, 0) };
  const now = () => clock.now;
  const mailer = new FakeAuthMailer();
  const store = new AccountStore({ docs: new MemoryDocStore(), now });
  const accounts = new AccountService({ store, mailer, publicUrl: "https://example.test/app/", now });
  return { clock, mailer, store, accounts };
}

/** 受付 → メールのリンク → 認証コード → 入力、までを通して行う */
async function runAuth(env, params, rateKey = "ip1") {
  const started = await env.accounts.startAuth(params, rateKey);
  const mail = env.mailer.sent.at(-1);
  const rid = new URL(mail.continueUrl).searchParams.get("rid");
  assert.equal(rid, started.rid);
  const { code } = await env.accounts.verifyLink({ rid, oobCode: mail.oobCode });
  return env.accounts.completeAuth({ rid, secret: started.secret, code });
}

test("ユーザー名: 見えない文字・空白・全角スペース・「(ゲスト)」で終わる名前は使えない", () => {
  assert.equal(validateUsername("たろう").name, "たろう");
  assert.equal(validateUsername("CPU").name, "CPU"); // CPU は使える
  assert.equal(validateUsername("ＣＰＵ").name, "ＣＰＵ");
  assert.ok(validateUsername("た ろう").error);
  assert.ok(validateUsername("た　ろう").error);
  assert.ok(validateUsername("た​ろう").error);
  assert.ok(validateUsername("たろう‏").error); // 向きの目印(見えない)
  assert.equal(validateUsername("‮たろう").name, "‮たろう"); // 向きを変える記号は許可
  assert.equal(validateUsername("👨‍👩‍👧").name, "👨‍👩‍👧");
  assert.equal(validateUsername("ゲストユーザー1").name, "ゲストユーザー1"); // 使える
  assert.ok(validateUsername("たろう(ゲスト)").error);
  assert.ok(validateUsername("たろう（ゲスト）").error);
  assert.equal(validateUsername("(ゲスト)たろう").name, "(ゲスト)たろう");
  assert.ok(validateUsername("あ".repeat(21)).error);
  assert.equal(validateUsername("あ".repeat(20)).name, "あ".repeat(20));
  assert.ok(validateUsername("").error);
});

test("登録: 認証コードを入力すると登録・ログインでき、自動ログインのトークンで名乗れる", async () => {
  const env = setup();
  const started = await env.accounts.startAuth({ mode: "register", name: "たろう", email: "Taro@Example.com" }, "ip1");
  assert.equal(started.email, "Ta***@Example.com");
  const mail = env.mailer.sent.at(-1);
  assert.equal(mail.email, "Taro@Example.com");
  // リンクを押す前にコードを入れても進まない
  await assert.rejects(env.accounts.completeAuth({ rid: started.rid, secret: started.secret, code: "000000" }), /まだメールのリンク/);
  const { code, mode } = await env.accounts.verifyLink({ rid: started.rid, oobCode: mail.oobCode });
  assert.equal(mode, "register");
  assert.match(code, /^\d{6}$/);
  // 同じリンクは2度使えない
  await assert.rejects(env.accounts.verifyLink({ rid: started.rid, oobCode: mail.oobCode }), /使用済み/);
  // 合言葉(secret)が違えば完了できない
  await assert.rejects(env.accounts.completeAuth({ rid: started.rid, secret: "x", code }), /一致しません/);
  const done = await env.accounts.completeAuth({ rid: started.rid, secret: started.secret, code });
  assert.equal(done.name, "たろう");
  assert.ok(done.token);
  const id = await env.accounts.identify({ sessionToken: done.token, clientId: "dev1" });
  assert.deepEqual({ guest: id.guest, name: id.name }, { guest: false, name: "たろう" });
  // 同じ名前・同じメールアドレス(大文字小文字違い)では登録できない
  await assert.rejects(env.accounts.startAuth({ mode: "register", name: "たろう", email: "b@example.com" }, "ip2"), /既に使われて/);
  await assert.rejects(env.accounts.startAuth({ mode: "register", name: "じろう", email: "taro@example.com" }, "ip2"), /既に登録/);
  // 大文字小文字・全角半角は別の名前
  await runAuth(env, { mode: "register", name: "Taro", email: "c@example.com" });
  await runAuth(env, { mode: "register", name: "ＴＡＲＯ", email: "d@example.com" });
});

test("認証コードは5回間違えると受付が取り消され、10分で期限切れになる", async () => {
  const env = setup();
  const s = await env.accounts.startAuth({ mode: "register", name: "a", email: "a@example.com" }, "ip1");
  const m = env.mailer.sent.at(-1);
  const { code } = await env.accounts.verifyLink({ rid: s.rid, oobCode: m.oobCode });
  const wrong = code === "111111" ? "222222" : "111111";
  for (let i = 0; i < 4; i++) await assert.rejects(env.accounts.completeAuth({ rid: s.rid, secret: s.secret, code: wrong }), /違います/);
  await assert.rejects(env.accounts.completeAuth({ rid: s.rid, secret: s.secret, code: wrong }), /取り消しました/);
  await assert.rejects(env.accounts.completeAuth({ rid: s.rid, secret: s.secret, code }), /有効期限/);

  const s2 = await env.accounts.startAuth({ mode: "register", name: "b", email: "b@example.com" }, "ip1");
  const m2 = env.mailer.sent.at(-1);
  const r2 = await env.accounts.verifyLink({ rid: s2.rid, oobCode: m2.oobCode });
  env.clock.now += 10 * 60 * 1000 + 1;
  await assert.rejects(env.accounts.completeAuth({ rid: s2.rid, secret: s2.secret, code: r2.code }), /有効期限/);
});

test("メールの送り直しは1分おき。受付の申し込みは接続元ごとに10分で5回まで", async () => {
  const env = setup();
  const s = await env.accounts.startAuth({ mode: "register", name: "a", email: "a@example.com" }, "ip1");
  await assert.rejects(env.accounts.resend({ rid: s.rid, secret: s.secret }), /秒待って/);
  env.clock.now += 60 * 1000;
  await env.accounts.resend({ rid: s.rid, secret: s.secret });
  assert.equal(env.mailer.sent.length, 2);
  for (let i = 0; i < 4; i++) await env.accounts.startAuth({ mode: "register", name: "n" + i, email: `n${i}@example.com` }, "ip1");
  await assert.rejects(env.accounts.startAuth({ mode: "register", name: "x", email: "x@example.com" }, "ip1"), /しばらく待って/);
  await env.accounts.startAuth({ mode: "register", name: "x", email: "x@example.com" }, "ip2");
});

test("ログイン: ユーザー名で申し込むと登録済みのアドレスにメールが届き、コードでログインできる", async () => {
  const env = setup();
  await runAuth(env, { mode: "register", name: "たろう", email: "taro@example.com" });
  await assert.rejects(env.accounts.startAuth({ mode: "login", name: "はなこ" }, "ip1"), /登録されていません/);
  const done = await runAuth(env, { mode: "login", name: "たろう" });
  assert.equal(env.mailer.sent.at(-1).email, "taro@example.com");
  assert.equal(done.name, "たろう");
  // ログアウトしたトークンは使えない
  await env.accounts.logout(done.token);
  assert.equal((await env.accounts.identify({ sessionToken: done.token, clientId: "d" })).guest, true);
});

test("名前の変更: 変えてから30日は変えられない。前の名前は5分経つと他の人が使える", async () => {
  const env = setup();
  const a = await runAuth(env, { mode: "register", name: "たろう", email: "taro@example.com" });
  const acc = await env.store.getSessionAccount(a.token);
  assert.equal((await env.accounts.rename(acc.id, "たろう2")).name, "たろう2");
  await assert.rejects(env.accounts.rename(acc.id, "たろう3"), /30日間/);
  await assert.rejects(env.accounts.startAuth({ mode: "register", name: "たろう", email: "x@example.com" }, "ip2"), /既に使われて/);
  env.clock.now += NAME_RELEASE_MS;
  await runAuth(env, { mode: "register", name: "たろう", email: "x@example.com" }, "ip2");
  env.clock.now += NAME_CHANGE_COOLDOWN_MS;
  assert.equal((await env.accounts.rename(acc.id, "たろう3")).name, "たろう3");
  // 自動ログインはそのまま使える(名前は新しいもの)
  assert.equal((await env.accounts.identify({ sessionToken: a.token })).name, "たろう3");
});

test("削除: コードで本人確認して削除すると自動ログインは無効になり、名前は5分後に使える", async () => {
  const env = setup();
  const a = await runAuth(env, { mode: "register", name: "たろう", email: "taro@example.com" });
  const acc = await env.store.getSessionAccount(a.token);
  await assert.rejects(env.accounts.startAuth({ mode: "delete" }, "ip1"), /ログインしていません/);
  const done = await runAuth(env, { mode: "delete", accountId: acc.id });
  assert.equal(done.deleted, true);
  assert.equal(await env.store.getSessionAccount(a.token), null);
  await assert.rejects(env.accounts.startAuth({ mode: "register", name: "たろう", email: "taro2@example.com" }, "ip2"), /既に使われて/);
  env.clock.now += NAME_RELEASE_MS;
  // 同じメールアドレスでも登録し直せる
  await runAuth(env, { mode: "register", name: "たろう", email: "taro@example.com" }, "ip2");
});

test("メールアドレスの変更: 引継ぎコードと新しいアドレスを入力し、新しいアドレスのメールで確認すると変わる", async () => {
  const env = setup();
  const a = await runAuth(env, { mode: "register", name: "たろう", email: "old@example.com" });
  const acc = await env.store.getSessionAccount(a.token);
  // 引継ぎコードが無い・違うと申し込めない
  await assert.rejects(
    env.accounts.startAuth({ mode: "email", name: "たろう", transferCode: "AAAA-AAAA-AAAA-AAAA", email: "new@example.com" }, "ip1"),
    /引継ぎコード/
  );
  const { code } = await env.accounts.issueTransferCode(acc.id);
  assert.match(code, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  const done = await runAuth(env, { mode: "email", name: "たろう", transferCode: code.toLowerCase(), email: "new@example.com" });
  assert.equal(env.mailer.sent.at(-1).email, "new@example.com"); // 新しいアドレスに確認メール
  assert.equal(done.name, "たろう");
  assert.equal((await env.store.getAccount(acc.id)).email, "new@example.com");
  // 以前の自動ログインは無効(新しい端末のトークンだけ有効)
  assert.equal(await env.store.getSessionAccount(a.token), null);
  assert.ok(await env.store.getSessionAccount(done.token));
  // 引継ぎコードは1回限り
  await assert.rejects(env.accounts.startAuth({ mode: "email", name: "たろう", transferCode: code, email: "n2@example.com" }, "ip1"), /引継ぎコード/);
  // 引継ぎコードは24時間で期限切れ
  const c2 = await env.accounts.issueTransferCode(acc.id);
  env.clock.now += 24 * 60 * 60 * 1000 + 1;
  await assert.rejects(env.accounts.startAuth({ mode: "email", name: "たろう", transferCode: c2.code, email: "n3@example.com" }, "ip1"), /有効期限/);
  // ログインは新しいアドレスへ
  await runAuth(env, { mode: "login", name: "たろう" }, "ip3");
  assert.equal(env.mailer.sent.at(-1).email, "new@example.com");
});

test("ゲスト番号: 同じ端末・同じ日は同じ番号、端末が違えば別の番号、日付(日本時間)が変わると振り直し", async () => {
  const env = setup();
  const g = (id) => env.accounts.identify({ clientId: id }).then((r) => r.name);
  assert.equal(await g("devA"), "ゲストユーザー1(ゲスト)");
  assert.equal(await g("devB"), "ゲストユーザー2(ゲスト)");
  assert.equal(await g("devA"), "ゲストユーザー1(ゲスト)");
  const today = jstDateKey(env.clock.now);
  env.clock.now += 24 * 60 * 60 * 1000;
  assert.notEqual(jstDateKey(env.clock.now), today);
  assert.equal(await g("devB"), "ゲストユーザー1(ゲスト)");
  assert.equal(await g("devA"), "ゲストユーザー2(ゲスト)");
  // 日本時間の0時で切り替わる(UTC 15時)
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 14, 59)), "20260926");
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 15, 0)), "20260927");
});

function fakeConn() {
  const received = [];
  return { received, send: (o) => received.push(o) };
}

const flush = () => new Promise((r) => setImmediate(r));

test("通信: hello で名乗った名前で対局に入る。ゲストはルームを作れない。名乗る前の create/join は断る", async () => {
  const env = setup();
  const registry = new RoomRegistry();
  registry.accounts = env.accounts;
  const a = await runAuth(env, { mode: "register", name: "たろう", email: "taro@example.com" });
  const host = fakeConn();
  const guest = fakeConn();
  handleClientMessage(registry, host, { type: "create", protocol: PROTOCOL_VERSION, name: "なりすまし" });
  assert.match(host.received.at(-1).message, /接続の準備/);
  handleClientMessage(registry, host, { type: "hello", reqId: 1, sessionToken: a.token, clientId: "d1" });
  handleClientMessage(registry, guest, { type: "hello", reqId: 2, clientId: "d2" });
  await flush();
  await flush();
  assert.deepEqual(host.received.at(-1), {
    reqId: 1,
    type: "hello-ok",
    guest: false,
    name: "たろう",
    guestNameError: null,
    sessionInvalid: false,
    protocol: PROTOCOL_VERSION,
  });
  assert.equal(guest.received.at(-1).name, "ゲストユーザー1(ゲスト)");
  // ゲストはルームを作れない
  handleClientMessage(registry, guest, { type: "create", protocol: PROTOCOL_VERSION });
  assert.match(guest.received.at(-1).message, /ユーザー登録/);
  // 送ってきた名前は使わず、名乗った名前を使う
  handleClientMessage(registry, host, { type: "create", protocol: PROTOCOL_VERSION, name: "なりすまし" });
  const code = host.received.find((m) => m.type === "created").code;
  handleClientMessage(registry, guest, { type: "join", protocol: PROTOCOL_VERSION, code, name: "たろう" });
  assert.deepEqual(registry.namesFor(code), { east: "たろう", south: "ゲストユーザー1(ゲスト)" });
  // 無効なトークンで名乗ったら sessionInvalid
  const x = fakeConn();
  handleClientMessage(registry, x, { type: "hello", reqId: 3, sessionToken: "z".repeat(40), clientId: "d3" });
  await flush();
  await flush();
  assert.equal(x.received.at(-1).sessionInvalid, true);
});

test("通信: 登録からログイン中の操作(情報・名前変更・引継ぎコード・ログアウト)まで", async () => {
  const env = setup();
  const registry = new RoomRegistry();
  registry.accounts = env.accounts;
  const c = fakeConn();
  const page = fakeConn(); // メールのリンクで開いた確認ページ
  const send = async (conn, msg) => {
    handleClientMessage(registry, conn, msg);
    for (let i = 0; i < 5; i++) await flush();
    return conn.received.at(-1);
  };
  await send(c, { type: "hello", clientId: "d" });
  const st = await send(c, { type: "auth-start", reqId: 5, mode: "register", name: "はなこ", email: "hana@example.com" });
  assert.equal(st.type, "auth-started");
  assert.equal(st.reqId, 5);
  const mail = env.mailer.sent.at(-1);
  const codeMsg = await send(page, { type: "auth-verify", rid: st.rid, oobCode: mail.oobCode });
  assert.equal(codeMsg.type, "auth-code");
  const done = await send(c, { type: "auth-complete", rid: st.rid, secret: st.secret, code: codeMsg.code });
  assert.equal(done.type, "auth-done");
  assert.equal(done.name, "はなこ");
  const info = await send(c, { type: "account-info" });
  assert.equal(info.email, "ha***@example.com");
  assert.equal((await send(c, { type: "account-rename", name: "はなこ2" })).name, "はなこ2");
  assert.equal(c.identity.name, "はなこ2");
  assert.equal((await send(c, { type: "transfer-issue" })).type, "transfer-code");
  assert.equal((await send(c, { type: "logout", sessionToken: done.token })).type, "logged-out");
  assert.equal((await send(c, { type: "account-info" })).type, "account-error");
});

test("Firebase の標準のページ経由: メールの中の合言葉(v)と確認済みの状態がそろえば認証コードを出す", async () => {
  const env = setup();
  const s = await env.accounts.startAuth({ mode: "register", name: "たろう", email: "taro@example.com" }, "ip1");
  const mail = env.mailer.sent.at(-1);
  const back = new URL(mail.continueUrl);
  const v = back.searchParams.get("v");
  assert.ok(v);
  // 始めた端末には v を渡していない
  assert.ok(!Object.values(s).includes(v));
  // リンクを押す前(未確認)はコードを出さない
  await assert.rejects(env.accounts.verifyLink({ rid: s.rid, v }), /確認がまだ済んでいません/);
  env.mailer.clickDefault(mail.oobCode);
  // v が違えば出さない(rid だけ知っている人=受付を始めた人には出せない)
  await assert.rejects(env.accounts.verifyLink({ rid: s.rid, v: "x" + v }), /リンクが正しくありません/);
  await assert.rejects(env.accounts.verifyLink({ rid: s.rid }), /リンクが正しくありません/);
  const { code } = await env.accounts.verifyLink({ rid: s.rid, v });
  const done = await env.accounts.completeAuth({ rid: s.rid, secret: s.secret, code });
  assert.equal(done.name, "たろう");
  // 2回目のログインも同じ流れ(送るたびに未確認に戻る)
  const s2 = await env.accounts.startAuth({ mode: "login", name: "たろう" }, "ip1");
  const m2 = env.mailer.sent.at(-1);
  const v2 = new URL(m2.continueUrl).searchParams.get("v");
  await assert.rejects(env.accounts.verifyLink({ rid: s2.rid, v: v2 }), /確認がまだ済んでいません/);
  env.mailer.clickDefault(m2.oobCode);
  const r2 = await env.accounts.verifyLink({ rid: s2.rid, v: v2 });
  assert.ok((await env.accounts.completeAuth({ rid: s2.rid, secret: s2.secret, code: r2.code })).token);
});

test("ゲストの名前: 自分で決めた名前に「(ゲスト)」を付ける。使えない名前なら既定の名前", async () => {
  const env = setup();
  assert.deepEqual(env.accounts.guestRename("はなこ"), { name: "はなこ(ゲスト)", baseName: "はなこ" });
  assert.throws(() => env.accounts.guestRename("はな こ"), /空白/);
  assert.throws(() => env.accounts.guestRename("はなこ(ゲスト)"), /で終わる名前/);
  assert.equal((await env.accounts.identify({ clientId: "d1", guestName: "はなこ" })).name, "はなこ(ゲスト)");
  const bad = await env.accounts.identify({ clientId: "d1", guestName: "は\u200Bなこ" });
  assert.equal(bad.name, "ゲストユーザー1(ゲスト)");
  assert.match(bad.guestNameError, /見えない文字/);
  // 登録ユーザーと同じ名前でも、ゲストは「(ゲスト)」付きなので区別できる
  await runAuth(env, { mode: "register", name: "はなこ", email: "h@example.com" });
  assert.equal((await env.accounts.identify({ clientId: "d2", guestName: "はなこ" })).name, "はなこ(ゲスト)");
});

test("通信: ゲストは guest-rename で名前を変えられ、その名前で対局に入る", async () => {
  const env = setup();
  const registry = new RoomRegistry();
  registry.accounts = env.accounts;
  const c = fakeConn();
  const send = async (msg) => {
    handleClientMessage(registry, c, msg);
    for (let i = 0; i < 5; i++) await flush();
    return c.received.at(-1);
  };
  await send({ type: "hello", clientId: "d", guestName: "はなこ" });
  assert.equal(c.received.at(-1).name, "はなこ(ゲスト)");
  const r = await send({ type: "guest-rename", name: "はなこ2" });
  assert.deepEqual({ type: r.type, name: r.name, baseName: r.baseName }, { type: "guest-renamed", name: "はなこ2(ゲスト)", baseName: "はなこ2" });
  assert.equal((await send({ type: "guest-rename", name: "" })).type, "account-error");
  const host = fakeConn();
  const a = await runAuth(env, { mode: "register", name: "たろう", email: "t@example.com" });
  handleClientMessage(registry, host, { type: "hello", sessionToken: a.token });
  for (let i = 0; i < 5; i++) await flush();
  handleClientMessage(registry, host, { type: "create", protocol: PROTOCOL_VERSION });
  const code = host.received.find((m) => m.type === "created").code;
  handleClientMessage(registry, c, { type: "join", protocol: PROTOCOL_VERSION, code });
  assert.deepEqual(registry.namesFor(code), { east: "たろう", south: "はなこ2(ゲスト)" });
});
