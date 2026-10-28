import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { testDatabase } from "./postgres.js";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { migrate } from "../server/store.js";
import { hashPassword } from "../server/auth.js";
import { rules } from "../server/domain.js";
let server, pool, base, root;
const actors = {};
const password = "Test-only-password-2570";
before(async () => {
  pool = await testDatabase();
  await migrate(pool);
  root = await mkdtemp(join(tmpdir(), "gecc-test-"));
  const a = JSON.parse(JSON.stringify(rules.blankAssess()));
  const state = {
    v: 2,
    fy: 2570,
    isSample: false,
    teams: [
      { id: 1, name: "Test group 1" },
      { id: 2, name: "Test group 2" },
    ],
    units: [
      { id: "u01", code: "000001", name: "Test unit 1", team: 1 },
      { id: "u02", code: "000002", name: "Test unit 2", team: 2 },
    ],
    assess: { u01: a, u02: JSON.parse(JSON.stringify(a)) },
    defects: [],
    cal: {},
    mentorCoordinators: [],
  };
  await pool.query("INSERT INTO app_state(id,document) VALUES(1,$1)", [
    JSON.stringify(state),
  ]);
  const hash = await hashPassword(password);
  for (const [id, role, unit, team] of [
    ["org", "mentee", "u01", null],
    ["org2", "mentee", "u02", null],
    ["mentor", "mentor", null, 1],
    ["coord", "coord", null, null],
    ["new", "mentor", null, 1],
  ])
    await pool.query(
      "INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team,must_change) VALUES($1,$1,$1,$2,$3,$4,$5,$6)",
      [id, hash, role, unit, team, id === "new"],
    );
  server = createApp({ pool, fileRoot: root, origin: "http://127.0.0.1" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  for (const name of ["org", "org2", "mentor", "coord", "new"]) {
    const response = await fetch(base + "/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://127.0.0.1",
      },
      body: JSON.stringify({ username: name, password }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(response.headers.get("set-cookie"), /SameSite=Strict/);
    const data = await response.json();
    actors[name] = {
      cookie: response.headers.get("set-cookie").split(";")[0],
      csrf: data.csrf,
    };
  }
});
after(async () => {
  await new Promise((r) => server.close(r));
  await pool.end();
  await rm(root, { recursive: true, force: true });
});
async function call(path, name, method = "GET", data, headers = {}) {
  const a = actors[name];
  const response = await fetch(base + path, {
    method,
    headers: {
      Origin: "http://127.0.0.1",
      "Content-Type": "application/json",
      ...(a ? { Cookie: a.cookie, "X-CSRF-Token": a.csrf } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  return {
    status: response.status,
    data: await response.json(),
    headers: response.headers,
  };
}
test("public API exposes aggregates and no unit records, scores, senders or credentials", async () => {
  const r = await call("/api/state");
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.units, 2);
  assert.deepEqual(r.data.state.units, []);
  assert.deepEqual(r.data.state.assess, {});
  assert.ok(!("pins" in r.data.state));
});
test("session cookie is HttpOnly / SameSite and role projection hides other groups", async () => {
  const r = await call("/api/state", "mentor");
  assert.equal(r.status, 200);
  assert.equal(r.data.state.units.length, 1);
  assert.equal(r.data.state.units[0].id, "u01");
  assert.ok(!r.data.state.assess.u02);
  const session = await call("/api/session", "mentor");
  assert.equal(session.data.user.role, "mentor");
});
test("unauthenticated writes, forged CSRF, foreign origin and first-login writes are rejected", async () => {
  assert.equal((await call("/api/state", null, "PUT", {})).status, 401);
  assert.equal(
    (await call("/api/state", "org", "PUT", {}, { "X-CSRF-Token": "wrong" }))
      .status,
    403,
  );
  assert.equal(
    (
      await call(
        "/api/state",
        "org",
        "PUT",
        {},
        { Origin: "https://foreign.invalid" },
      )
    ).status,
    403,
  );
  assert.equal((await call("/api/state", "new", "PUT", {})).status, 403);
});
test("organization cannot forge scores, verification or central settings", async () => {
  for (const mutate of [
    (s) => (s.assess.u01.narr[0].score = 10),
    (s) => (s.assess.u01.out.o11 = 5),
    (s) => (s.assess.u01.phys[0] = true),
    (s) => (s.assess.u01.ready = { verified: true }),
    (s) => (s.units[0].team = 2),
  ]) {
    const r = await call("/api/state", "org");
    mutate(r.data.state);
    assert.equal((await call("/api/state", "org", "PUT", r.data)).status, 403);
  }
});
test("resource IDs cannot grant cross-unit access", async () => {
  const r = await call("/api/state", "org");
  r.data.state.assess.u02 = JSON.parse(JSON.stringify(rules.blankAssess()));
  assert.equal((await call("/api/state", "org", "PUT", r.data)).status, 403);
  assert.equal(
    (
      await call("/api/workflow/u02", "org", "POST", {
        revision: r.data.revision,
        action: "submit",
        sender: { name: "Tester", tel: "0812345678" },
      })
    ).status,
    403,
  );
});
test("mentor save succeeds; stale revision conflicts and leaves data unchanged", async () => {
  const r = await call("/api/state", "mentor");
  r.data.state.assess.u01.narr[0].score = 7.5;
  const saved = await call("/api/state", "mentor", "PUT", r.data);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.state.assess.u01.narr[0].score, 7.5);
  assert.equal((await call("/api/state", "mentor", "PUT", r.data)).status, 409);
});
test("organization saves narrative; existing score and other unit are preserved", async () => {
  const r = await call("/api/state", "org");
  r.data.state.assess.u01.narr[0].text = "Evidence description";
  const saved = await call("/api/state", "org", "PUT", r.data);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.state.assess.u01.narr[0].score, 7.5);
  const all = await call("/api/state", "coord");
  assert.equal(all.data.state.assess.u02.narr[0].score, null);
});
test("incumbent incomplete submit allowed; reviewer lock and reasoned reopen preserved", async () => {
  let r = await call("/api/state", "org");
  r = await call("/api/workflow/u01", "org", "POST", {
    revision: r.data.revision,
    action: "submit",
    sender: { name: "Test sender", tel: "0812345678" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.assess.u01.wf.status, "submitted");
  r = await call("/api/state", "mentor");
  r.data.state.assess.u01.inspectors = ["Test reviewer"];
  r = await call("/api/state", "mentor", "PUT", r.data);
  assert.equal(r.status, 200);
  r = await call("/api/workflow/u01", "mentor", "POST", {
    revision: r.data.revision,
    action: "review",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.assess.u01.wf.status, "reviewed");
  let locked = await call("/api/state", "mentor");
  locked.data.state.assess.u01.narr[0].score = 10;
  assert.equal(
    (await call("/api/state", "mentor", "PUT", locked.data)).status,
    409,
  );
  assert.equal(
    (
      await call("/api/workflow/u01", "mentor", "POST", {
        revision: r.data.revision,
        action: "reopen",
        note: "short",
      })
    ).status,
    400,
  );
  r = await call("/api/workflow/u01", "mentor", "POST", {
    revision: r.data.revision,
    action: "reopen",
    note: "Additional evidence required",
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.assess.u01.wf.status, "submitted");
  assert.equal(r.data.state.assess.u01.wf.log.at(-1).by, "mentor");
});
test("file magic and unit permissions enforced; upload/download persist with audit", async () => {
  const headers = {
    Origin: "http://127.0.0.1",
    Cookie: actors.org.cookie,
    "X-CSRF-Token": actors.org.csrf,
    "X-Unit-Id": "u01",
    "X-File-Name": encodeURIComponent("หลักฐาน.pdf"),
  };
  let r = await fetch(base + "/api/files/test-pdf", {
    method: "PUT",
    headers,
    body: "<script>bad</script>",
  });
  assert.equal(r.status, 400);
  r = await fetch(base + "/api/files/test-pdf", {
    method: "PUT",
    headers,
    body: "%PDF-1.4\nTest evidence",
  });
  assert.equal(r.status, 201);
  assert.equal(
    (
      await fetch(base + "/api/files/test-pdf", {
        headers: { Cookie: actors.org2.cookie },
      })
    ).status,
    404,
  );
  r = await fetch(base + "/api/files/test-pdf", {
    headers: { Cookie: actors.mentor.cookie },
  });
  assert.equal(r.status, 200);
  assert.ok((await r.text()).startsWith("%PDF"));
  assert.equal((await call("/api/audit", "mentor")).status, 404);
  assert.ok((await call("/api/audit", "coord")).data.events.length > 0);
});
test("static server never exposes source, environment, schema or private files", async () => {
  for (const path of [
    "/server/app.js",
    "/.env",
    "/package.json",
    "/server/schema.sql",
    "/var/files/test-pdf",
  ])
    assert.equal((await fetch(base + path)).status, 404);
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("window.GECC_SERVER=true"));
});
test("password change invalidates all old sessions; changed password required for new login", async () => {
  const r = await call("/api/password", "new", "POST", {
    current: password,
    password: "Replacement-test-password",
  });
  assert.equal(r.status, 200);
  assert.equal((await call("/api/session", "new")).data.user, null);
});
test("coordinator provisions individual account and disabling it revokes sessions", async () => {
  const made = await call("/api/accounts", "coord", "POST", {
    username: "reviewer-two",
    name: "Test reviewer two",
    role: "mentor",
    team: 2,
    password: "Temporary-reviewer-password",
  });
  assert.equal(made.status, 201);
  const list = await call("/api/accounts", "coord");
  const account = list.data.accounts.find((a) => a.username === "reviewer-two");
  assert.equal(account.mustChange, true);
  const response = await fetch(base + "/api/session", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1", "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "reviewer-two",
      password: "Temporary-reviewer-password",
    }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (
      await call("/api/accounts/" + account.id, "coord", "PATCH", {
        active: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await (
        await fetch(base + "/api/session", { headers: { Cookie: cookie } })
      ).json()
    ).user,
    null,
  );
  assert.equal((await call("/api/accounts", "mentor", "POST", {})).status, 404);
});
test("import endpoint refuses overwrite of nonempty assessments", async () => {
  const current = await call("/api/state", "coord");
  const result = await call("/api/import/preview", "coord", "POST", {
    state: current.data.state,
    revision: current.data.revision,
  });
  assert.equal(result.status, 409);
  const after = await call("/api/state", "coord");
  assert.equal(after.data.revision, current.data.revision);
  assert.equal(after.data.state.assess.u01.narr[0].score, 7.5);
});
test("server rejects markup in identifiers, year and assessment dates before storage", async () => {
  for (const mutate of [
    (s) => (s.fy = "<img src=x onerror=alert(1)>"),
    (s) => (s.teams[0].id = '1" onclick="alert(1)'),
    (s) => (s.units[0].id = 'bad" autofocus'),
    (s) => (s.assess.u01.date = '" onfocus="alert(1)'),
  ]) {
    const r = await call("/api/state", "coord");
    mutate(r.data.state);
    assert.equal(
      (await call("/api/state", "coord", "PUT", r.data)).status,
      400,
    );
  }
});
test("oversized attachments are rejected with 413 before buffering the body", async () => {
  const r = await fetch(base + "/api/files/oversized-file", {
    method: "PUT",
    headers: {
      Origin: "http://127.0.0.1",
      Cookie: actors.org.cookie,
      "X-CSRF-Token": actors.org.csrf,
      "X-Unit-Id": "u01",
    },
    body: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  assert.equal(r.status, 413);
});
test("parallel password guesses cannot bypass the account rate limit", async () => {
  const statuses = await Promise.all(
    Array.from({ length: 20 }, async () => {
      const r = await fetch(base + "/api/session", {
        method: "POST",
        headers: {
          Origin: "http://127.0.0.1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: "nonexistent-rate-test",
          password: "Wrong-test-password",
        }),
      });
      await r.text();
      return r.status;
    }),
  );
  assert.equal(statuses.filter((s) => s === 401).length, 10);
  assert.equal(statuses.filter((s) => s === 429).length, 10);
});
