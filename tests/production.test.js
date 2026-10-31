import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { initialState } from "../server/seed.js";
import { accountPlan, prepareAccounts, provisionAccounts } from "../server/accounts.js";
import { configuration, basePath } from "../server/config.js";
import { testDatabase } from "./postgres.js";
import { migrate } from "../server/store.js";
import { createApp } from "../server/app.js";
import { verifyPassword } from "../server/auth.js";
import { checkProduction } from "../server/check-production.js";

test("production defaults fail closed; demo requires preview server injection", async () => {
  const html = await readFile("index.html", "utf8");
  assert.ok(html.indexOf("window.GECC_SERVER=true") < html.indexOf('src="assets/runtime.js"'), "inline fail-closed guard must run even when runtime.js is unavailable");
  const script = await readFile("assets/runtime.js", "utf8");
  for (const preview of [undefined, true]) {
    const window = { GECC_PREVIEW: preview };
    vm.runInNewContext(script, { window, URL, document: { currentScript: { src: "https://example.org/sskgecc/assets/runtime.js" } } });
    assert.equal(window.GECC_SERVER, preview !== true);
    assert.equal(window.GECC_BASE_PATH, "/sskgecc/");
  }
});

test("deployment config separates HTTPS origin and base path", () => {
  assert.deepEqual(configuration({ APP_ORIGIN: "https://www.osscsskfda.org", BASE_PATH: "/sskgecc/", COOKIE_SECURE: "true" }),
    { origin: "https://www.osscsskfda.org", secure: true, basePath: "/sskgecc" });
  for (const value of ["/../", "//x", "/x?y", "/x%2fy"]) assert.throws(() => basePath(value));
  assert.throws(() => configuration({ APP_ORIGIN: "https://example.org/sskgecc", COOKIE_SECURE: "true" }));
  assert.throws(() => configuration({ APP_ORIGIN: "https://example.org" }));
});

test("58 named scoped accounts have unique generated passwords and stable codes", async () => {
  const s = await initialState();
  const b = prepareAccounts(s);
  assert.equal(b.accounts.length, 58);
  assert.equal(b.accounts.filter(a => a.role === "mentee").length, 32);
  assert.equal(b.accounts.filter(a => a.role === "mentor").length, 24);
  assert.equal(b.accounts.filter(a => a.role === "coord").length, 2);
  assert.equal(new Set(b.accounts.map(a => a.password)).size, 58);
  assert.ok(b.accounts.every(a => a.password.length === 24));
  assert.deepEqual(accountPlan(s), b.accounts.map(({ password, ...a }) => a));
});

test("provisioning is atomic, idempotent, requires first password change and preserves records", async () => {
  const pool = await testDatabase();
  try {
    await migrate(pool);
    const s = await initialState();
    // Small actual roster for lifecycle tests; full official roster checked above.
    s.units = s.units.slice(0, 1);
    s.teams = [{ ...s.teams[0], members: s.teams[0].members.slice(0, 1) }];
    s.mentorCoordinators = s.mentorCoordinators.slice(0, 1);
    await pool.query("INSERT INTO app_state(id,document) VALUES(1,$1)", [JSON.stringify(s)]);
    const b = prepareAccounts(s);
    const preview = await provisionAccounts(pool, b);
    assert.equal(preview.wouldCreate, 3);
    assert.equal((await pool.query("SELECT * FROM accounts")).rows.length, 0);
    const bad = structuredClone(b);
    bad.accounts.at(-1).role = "mentor";
    await assert.rejects(provisionAccounts(pool, bad, true));
    assert.equal((await pool.query("SELECT * FROM accounts")).rows.length, 0);
    assert.equal((await provisionAccounts(pool, b, true)).created, 3);
    const before = (await pool.query("SELECT * FROM accounts ORDER BY username")).rows;
    assert.ok(before.every(a => a.must_change && a.active));
    assert.ok(await verifyPassword(b.accounts[0].password, before.find(a => a.username === b.accounts[0].username).password_hash));
    assert.equal((await provisionAccounts(pool, prepareAccounts(s), true)).skipped, 3);
    assert.deepEqual((await pool.query("SELECT * FROM accounts ORDER BY username")).rows, before);
    assert.deepEqual((await pool.query("SELECT document FROM app_state")).rows[0].document, JSON.parse(JSON.stringify(s)));
  } finally { await pool.end(); }
});

test("subdirectory serves public API, redirects slash, isolates cookies and passes smoke checks", async () => {
  const pool = await testDatabase();
  const app = createApp({ pool, basePath: "/sskgecc", origin: "http://127.0.0.1", secure: true });
  try {
    await migrate(pool);
    const s = await initialState();
    await pool.query("INSERT INTO app_state(id,document) VALUES(1,$1)", [JSON.stringify(s)]);
    const b = prepareAccounts(s);
    // Coordinator-only insert via existing tested hash function to exercise cookie headers.
    const { hashPassword } = await import("../server/auth.js");
    await pool.query("INSERT INTO accounts(id,username,name,password_hash,role) VALUES('coord','coord','Test',$1,'coord')", [await hashPassword(b.accounts[0].password)]);
    await new Promise(r => app.listen(0, "127.0.0.1", r));
    const root = "http://127.0.0.1:" + app.address().port;
    assert.equal((await fetch(root + "/sskgecc", { redirect: "manual" })).status, 308);
    for (const path of ["/api/health", "/sskgecc-other/api/health", "/sskgecc/server/accounts.js", "/sskgecc/var/private/accounts.json"])
      assert.equal((await fetch(root + path)).status, 404, path);
    assert.equal((await checkProduction(root + "/sskgecc/")).ok, true);
    const login = await fetch(root + "/sskgecc/api/session", { method: "POST", headers: { Origin: "http://127.0.0.1", "Content-Type": "application/json" }, body: JSON.stringify({ username: "coord", password: b.accounts[0].password }) });
    assert.equal(login.status, 200);
    assert.match(login.headers.get("set-cookie"), /__Secure-gecc-[\w]+=/);
    assert.match(login.headers.get("set-cookie"), /Path=\/sskgecc\/;/);
    assert.match(login.headers.get("set-cookie"), /; Secure/);
  } finally { if (app.listening) await new Promise(r => app.close(r)); await pool.end(); }
});

test("all 58 generated accounts authenticate with their own scope and require password change", async () => {
  const pool = await testDatabase();
  const app = createApp({ pool, basePath: "/sskgecc", origin: "http://127.0.0.1" });
  try {
    await migrate(pool);
    const s = await initialState();
    await pool.query("INSERT INTO app_state(id,document) VALUES(1,$1)", [JSON.stringify(s)]);
    const bundle = prepareAccounts(s);
    assert.equal((await provisionAccounts(pool, bundle, true)).created, 58);
    await new Promise(r => app.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${app.address().port}/sskgecc/api/`;
    for (const a of bundle.accounts) {
      const login = await fetch(url + "session", { method: "POST", headers: { Origin: "http://127.0.0.1", "Content-Type": "application/json" }, body: JSON.stringify({ username: a.username, password: a.password }) });
      assert.equal(login.status, 200, a.username);
      const { user, csrf } = await login.json();
      assert.equal(user.mustChange, true);
      assert.equal(user.role, a.role);
      assert.equal(user.unitId, a.unitId);
      assert.equal(user.team, a.team);
      const headers = { Cookie: login.headers.get("set-cookie").split(";")[0] };
      const state = await (await fetch(url + "state", { headers })).json();
      assert.equal(state.state.units.length, a.role === "mentee" ? 1 : a.role === "mentor" ? s.units.filter(u => u.team === a.team).length : 32);
      const mutation = await fetch(url + "state", { method: "PUT", headers: { ...headers, Origin: "http://127.0.0.1", "X-CSRF-Token": csrf, "Content-Type": "application/json" }, body: "{}" });
      assert.equal(mutation.status, 403);
    }
    assert.deepEqual((await pool.query("SELECT document FROM app_state")).rows[0].document.assess, {});
  } finally { if (app.listening) await new Promise(r => app.close(r)); await pool.end(); }
});
