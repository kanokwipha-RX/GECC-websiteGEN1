import { chromium } from "playwright";
import { testDatabase } from "./postgres.js";
import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { staticFile } from "../server/static.js";
import { createApp } from "../server/app.js";
import { migrate } from "../server/store.js";
import { hashPassword } from "../server/auth.js";
import { hashToken } from "../server/auth.js";
const artifactRoot = "artifacts";
await mkdir(artifactRoot, { recursive: true });
const preview = createServer((req, res) => staticFile(req, res, false));
await new Promise((r) => preview.listen(0, "127.0.0.1", r));
const local = "http://127.0.0.1:" + preview.address().port;
const pool = await testDatabase();
await migrate(pool);
const state = JSON.parse(
  await readFile("sisaket-gecc-2570-units-28.json", "utf8"),
);
state.units.forEach((u, i) => (u.code = String(i + 1).padStart(6, "0")));
state.assess = {};
state.defects = [];
state.cal = {
  start: "2026-10-01",
  prov: "2026-12-04",
  open: "2026-11-16",
  close: "2026-12-25",
};
state.isSample = false;
delete state.pins;
for (const t of state.teams) t.photo = `assets/images/group-${t.id}.jpg`;
const hash = await hashPassword("Browser-test-password");
for (const [name, role, scope] of [
  ["test-coord", "coord", null],
  ["000001", "mentee", "u01"],
  ["test-mentor", "mentor", 1],
  ["000002", "mentee", "u02"],
])
  await pool.query(
    "INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team,must_change) VALUES($1,$1,$1,$2,$3,$4,$5,$6)",
    [
      name,
      hash,
      role,
      role === "mentee" ? scope : null,
      role === "mentor" ? scope : null,
      name === "000002",
    ],
  );
await pool.query("INSERT INTO app_state(id,document) VALUES(1,$1)", [
  JSON.stringify(state),
]);
const privateRoot = await mkdtemp(join(tmpdir(), "gecc-browser-"));
const apiOrigin = "http://127.0.0.1:8092";
const basePath = process.env.GECC_TEST_BASE_PATH || "";
const origin = apiOrigin + basePath;
const api = createApp({ pool, origin: apiOrigin, basePath, fileRoot: privateRoot });
await new Promise((r) => api.listen(8092, "127.0.0.1", r));
const browser = await chromium.launch();
const errors = [],
  checks = [],
  audits = [];
const axe = await readFile("node_modules/axe-core/axe.min.js", "utf8");
async function check(name, fn) {
  try {
    await fn();
  } catch (error) {
    console.log("BROWSER ERRORS", JSON.stringify(errors));
    await writeFile(
      artifactRoot + "/browser-failure.json",
      JSON.stringify({ checks, errors, audits }, null, 2),
    );
    throw error;
  }
  checks.push(name);
  console.log("PASS", name);
}
async function audit(page, name) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect?.getTiming().iterations))
      .map(a => a.finished.catch(() => {})));
  });
  await page.evaluate(axe);
  const results = await page.evaluate(async () =>
    axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"],
      },
    }),
  );
  audits.push({
    page: name,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  });
  await writeFile(
    artifactRoot + "/accessibility-report.json",
    JSON.stringify(audits, null, 2),
  );
}
try {
  if (!process.env.GECC_API_ONLY) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: "light",
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    const baseline = execFileSync("git", ["show", "4606a5f:index.html"], {
      encoding: "utf8",
      maxBuffer: 3e6,
    });
    await p.route("**/baseline", (route) =>
      route.fulfill({ body: baseline, contentType: "text/html" }),
    );
    await p.goto(local + "/baseline");
    await p.evaluate(() => go("portfolio"));
    await p.screenshot({
      path: artifactRoot + "/before-portfolio.png",
      fullPage: true,
    });
    await p.goto(local);
    await p.evaluate(() => go("portfolio"));
    await p.screenshot({
      path: artifactRoot + "/after-portfolio.png",
      fullPage: true,
    });
    await check(
      "original Thai font, complete group imagery and six groups retained",
      async () => {
        assert.match(
          await p
            .locator("body")
            .evaluate((e) => getComputedStyle(e).fontFamily),
          /IBM Plex Sans Thai/,
        );
        assert.equal(await p.locator("[data-act=entry-team]").count(), 6);
        assert.equal(
          await p
            .locator(".has-photo img")
            .first()
            .evaluate((e) => getComputedStyle(e).objectFit),
          "contain",
        );
      },
    );
    for (const width of [360, 390, 768, 1024, 1440]) {
      await p.setViewportSize({ width, height: 900 });
      for (const view of ["portfolio", "library", "committee", "exec"]) {
        await p.evaluate((v) => go(v), view);
        await p.waitForTimeout(100);
        const overflow = await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        assert.equal(overflow, false, view + " overflow " + width);
        if (width <= 600) {
          assert.equal(await p.evaluate(() => {
            const nav = document.querySelector(".site-nav-links").getBoundingClientRect();
            return [...document.querySelectorAll(".site-nav-links button")].every(b => {
              const r = b.getBoundingClientRect();
              return r.left >= nav.left - 1 && r.right <= nav.right + 1 && b.scrollWidth <= b.clientWidth + 1;
            });
          }), true, "mobile navigation labels must be fully visible");
        }
        if ([360, 1440].includes(width)) {
          await p.screenshot({
            path: `${artifactRoot}/${view}-${width}-light.png`,
            fullPage: true,
          });
          await audit(p, view + " " + width + " light");
        }
      }
    }
    checks.push("five responsive widths across four public screens");
    await p.setViewportSize({ width: 390, height: 844 });
    await p.emulateMedia({ colorScheme: "dark" });
    for (const view of ["portfolio", "library", "committee", "exec"]) {
      await p.evaluate((v) => go(v), view);
      await p.screenshot({
        path: `${artifactRoot}/${view}-390-dark.png`,
        fullPage: true,
      });
      await audit(p, view + " dark");
    }
    await check(
      "reduced motion cancels animation and pointer effects",
      async () => {
        await p.emulateMedia({ reducedMotion: "reduce" });
        await p.evaluate(() => go("library"));
        assert.equal(
          await p.evaluate(
            () =>
              document
                .querySelector("#content")
                .getAnimations({ subtree: true }).length,
          ),
          0,
        );
      },
    );
    await p.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await p.setViewportSize({ width: 1440, height: 1000 });
    await p.evaluate(() => {
      S.role = "mentor";
      S.coord = true;
      S.team = 0;
      go("unit", { unitId: DB.units[0].id, tab: "phys" });
    });
    await check(
      "assessment tabs navigate by keyboard; unsaved navigation still confirms",
      async () => {
        await p.locator("[role=tab]").first().focus();
        await p.keyboard.press("ArrowRight");
        assert.equal(
          await p
            .locator("[role=tab][aria-selected=true]")
            .getAttribute("data-tab"),
          "phys",
        );
        await p.evaluate(() => {
          S.dirty = true;
          go("library");
        });
        assert.equal(await p.locator("[role=dialog]").count(), 1);
        await p.keyboard.press("Escape");
        assert.equal(await p.locator("[role=dialog]").count(), 0);
        assert.equal(await p.evaluate(() => S.view), "unit");
      },
    );
    await p.evaluate(() => {
      S.dirty = false;
      confirmDlg("ทดสอบการยืนยัน", "ข้อมูลทดสอบ", "ยืนยัน", () => {});
    });
    await check(
      "modal title, inert background, keyboard trap and focus restoration",
      async () => {
        assert.equal(
          await p.locator("[role=dialog]").getAttribute("aria-labelledby"),
          "modal-title",
        );
        assert.equal(await p.locator("#app").evaluate((e) => e.inert), true);
        const buttons = p.locator("[role=dialog] button");
        await buttons.last().focus();
        await p.keyboard.press("Tab");
        assert.equal(
          await buttons.first().evaluate((e) => e === document.activeElement),
          true,
        );
        await p.keyboard.press("Escape");
        assert.equal(await p.locator("#app").evaluate((e) => e.inert), false);
      },
    );
    await p.screenshot({
      path: artifactRoot + "/assessment-desktop.png",
      fullPage: true,
    });
    await audit(p, "assessment");
    for (const scheme of ["light", "dark"]) {
      await p.emulateMedia({ colorScheme: scheme });
      await p.setViewportSize({ width: 390, height: 844 });
      for (const tab of [
        "ready",
        "phys",
        "qc",
        "narr",
        "out",
        "svy",
        "sum",
        "def",
      ]) {
        await p.evaluate((tab) => {
          S.tab = tab;
          viewUnitKeep();
        }, tab);
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          tab + " mobile overflow",
        );
        await audit(p, "assessment " + tab + " " + scheme);
      }
    }
    checks.push("all eight assessment tabs audited in light and dark at 390px");
    await p.evaluate(() => {
      DB.assess[S.unitId].wf = { status: "submitted", log: [], round: 1 };
      S.draft = null;
    });
    await p.emulateMedia({ colorScheme: "dark" });
    for (const tab of ["ready", "phys", "qc", "narr", "out", "svy"]) {
      await p.evaluate((tab) => {
        S.tab = tab;
        viewUnitKeep();
      }, tab);
      await audit(p, "editable assessment " + tab + " dark");
    }
    checks.push("unlocked reviewer forms audited in dark mode");
  }
  const central = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const c = await central.newPage();
  c.on("pageerror", (e) => errors.push(e.message));
  await c.goto(origin);
  await c.waitForFunction(() => document.querySelector(".summary-grid"));
  await check(
    "server public page has only aggregates and ignores demo login hash",
    async () => {
      assert.equal(await c.evaluate(() => DB.units.length), 0);
      await c.goto(origin + "/#demo-mentor");
      await c.waitForFunction(() => document.querySelector(".summary-grid"));
      assert.equal(await c.evaluate(() => S.role), null);
    },
  );
  await c.evaluate(() => go("portfolio"));
  await c.locator("[data-act=entry-coord]").click();
  await c.locator("#login-name").fill("test-coord");
  await c.locator("#login-password").fill("Browser-test-password");
  await c.locator("#server-login button[type=submit]").click();
  await c.waitForFunction(
    () =>
      S.coord === true &&
      S.view === "modules" &&
      DB.units.length === 28 &&
      document.querySelector(".mgrid2"),
  );
  await check("all coordinator screens fit mobile and desktop in light and dark; countdown remains readable", async () => {
    for (const scheme of ["light", "dark"]) {
      await c.emulateMedia({ colorScheme: scheme });
      for (const width of [390, 1440]) {
        await c.setViewportSize({ width, height: 1000 });
        for (const view of ["modules", "mdash", "forms", "defects", "settings"]) {
          await c.evaluate(v => go(v), view);
          await c.waitForTimeout(80);
          assert.equal(await c.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${view} ${scheme} ${width}`);
          if (view === "modules") {
            const rect = await c.locator(".cdn-compact").boundingBox();
            assert.ok(rect.width > 250 && rect.height > 80, "countdown must not inherit miniature score-bar dimensions");
            await c.screenshot({ path: `${artifactRoot}/production-modules-${scheme}-${width}.png`, fullPage: true });
          }
          await audit(c, `server ${view} ${scheme} ${width}`);
        }
      }
    }
    await c.emulateMedia({ colorScheme: "light" });
    await c.setViewportSize({ width: 1440, height: 1000 });
    await c.evaluate(() => go("modules"));
  });
  await check("account controls create, disable, re-enable and reset passwords with confirmation", async () => {
    await c.evaluate(() => go("settings"));
    await c.locator("[data-server-action=accounts]").click();
    await c.locator("#account-role").selectOption("mentor");
    await c.locator("#account-team").selectOption("2");
    await c.locator("#account-name").fill("ui-reviewer");
    await c.locator("#account-display").fill("UI reviewer");
    await c.locator("#account-pass").fill("Temporary-ui-password-2570");
    await c.locator("#account-form button:not([type])").click();
    const row = c.locator(".tbl tbody tr").filter({ hasText: "ui-reviewer" });
    await row.getByRole("button", { name: "ปิดบัญชี", exact: true }).click();
    await c.locator("[data-act=confirm-ok]").click();
    await row.getByRole("button", { name: "เปิดบัญชี", exact: true }).waitFor();
    await row.getByRole("button", { name: "เปิดบัญชี", exact: true }).click();
    await c.locator("[data-act=confirm-ok]").click();
    await row.getByRole("button", { name: "ปิดบัญชี", exact: true }).waitFor();
    await row.getByRole("button", { name: "ตั้งรหัสผ่านชั่วคราวใหม่", exact: true }).click();
    await c.locator("#reset-account-form button[type=submit]").click();
    assert.equal(await c.evaluate(() => document.activeElement.id), "reset-account-pass");
    await c.locator("#reset-account-pass").fill("Reset-ui-password-2570");
    let release;
    const held = new Promise(resolve => { release = resolve; });
    await c.route("**/api/accounts/*", async route => { await held; await route.continue(); });
    try {
      await c.locator("#reset-account-form button[type=submit]").click();
      await c.waitForFunction(() => document.querySelector("#reset-account-form button[type=submit]")?.disabled === true);
      assert.equal(await c.locator("[data-toggle-password=reset-account-pass]").isEnabled(), true);
    } finally { release(); }
    await row.waitFor();
    await c.unroute("**/api/accounts/*");
    await audit(c, "account management dialog");
    await c.locator(".modal [data-act=modal-close]").click();
  });
  await check(
    "real login opens scoped app and persists assessment through API",
    async () => {
      await c.evaluate(() => go("unit", { unitId: "u01", tab: "phys" }));
      await c.evaluate(() => {
        S.draft.inspectors = ["Test reviewer"];
        S.draft.phys[0] = true;
        S.dirty = true;
        live();
      });
      await c.locator("[data-act=save]").first().click();
      await c.waitForFunction(() => S.dirty === false);
      await c.reload();
      await c.waitForFunction(() => S.coord === true);
      assert.equal(await c.evaluate(() => DB.assess.u01.phys[0]), true);
    },
  );
  await check(
    "API failure retains draft and does not announce save success",
    async () => {
      await c.evaluate(() => go("unit", { unitId: "u01", tab: "narr" }));
      await c.evaluate(() => {
        S.draft.narr[0].text = "unsaved test";
        S.dirty = true;
        live();
      });
      await c.route("**/api/state", (route) =>
        route.request().method() === "PUT" ? route.abort() : route.continue(),
      );
      await c.locator("[data-act=save]").first().click();
      await c.waitForFunction(() =>
        document.querySelector("#connection-notice.error"),
      );
      assert.equal(await c.evaluate(() => S.dirty), true);
      assert.equal(
        await c.evaluate(() => S.draft.narr[0].text),
        "unsaved test",
      );
      await c.unroute("**/api/state");
    },
  );
  await c.screenshot({
    path: artifactRoot + "/server-save-failure.png",
    fullPage: true,
  });
  await c.evaluate(() => {
    S.dirty = false;
    S.draft = null;
  });
  await c.reload();
  await c.waitForFunction(() => S.coord === true && DB.assess.u01);
  await check(
    "server logout preserves dirty draft until confirmation",
    async () => {
      await c.evaluate(() => {
        go("unit", { unitId: "u01", tab: "phys" });
        S.dirty = true;
      });
      await c.evaluate(() => GECCClient.logout());
      assert.equal(await c.locator("[role=dialog]").count(), 1);
      assert.equal(await c.evaluate(() => S.role), "mentor");
      await c.keyboard.press("Escape");
      await c.evaluate(() => {
        S.dirty = false;
      });
    },
  );
  await check(
    "binary backup verifies SHA-256 and restores through preview into empty state",
    async () => {
      await c.evaluate(async () => {
        const blob = await (await fetch("assets/library/criteria.png")).blob();
        await FDB.put("browser-backup-file", blob, "evidence.png");
        S.draft.ev = {
          "phys:0": {
            text: "Test evidence",
            files: [
              {
                id: "browser-backup-file",
                name: "evidence.png",
                type: blob.type,
                size: blob.size,
                by: "mentor",
                at: new Date().toISOString(),
              },
            ],
          },
        };
        S.dirty = true;
        live();
        await saveAssess();
      });
      const [download] = await Promise.all([
        c.waitForEvent("download"),
        c.evaluate(() => GECCBackup.exportBundle()),
      ]);
      await download.saveAs(artifactRoot + "/backup-test.json");
      const bundle = JSON.parse(
        await readFile(artifactRoot + "/backup-test.json", "utf8"),
      );
      assert.equal(bundle.missing.length, 0);
      assert.equal(bundle.files.length, 1);
      assert.equal(
        hashToken(Buffer.from(bundle.files[0].base64, "base64")),
        bundle.files[0].sha256,
      );
      assert.ok(!bundle.state.pins);
      await c.evaluate(async () => {
        await GECCClient.request("/api/admin/reset", {
          method: "POST",
          body: JSON.stringify({
            revision: GECCClient.revision,
            mode: "assessments",
          }),
        });
        await GECCClient.boot();
        go("settings");
      });

      await c
        .locator("[data-act-change=import]")
        .setInputFiles(artifactRoot + "/backup-test.json");
      await c.waitForSelector("[role=dialog]");
      await c.locator("[data-act=confirm-ok]").click();
      await c.waitForFunction(() => !!DB.assess.u01?.ev?.["phys:0"]);
      assert.equal(await c.evaluate(() => DB.assess.u01.phys[0]), true);
    },
  );
  await check("report print path still produces a PDF", async () => {
    await c.evaluate(() => go("unit", { unitId: "u01", tab: "sum" }));
    const pdf = await c.pdf({
      path: artifactRoot + "/report-print.pdf",
      format: "A4",
      printBackground: true,
    });
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  });
  assert.deepEqual(errors, [], "runtime JavaScript errors");
  await check("missing runtime fails closed and never reads or creates browser demo records", async () => {
    const context = await browser.newContext();
    try {
      const p = await context.newPage();
      await p.route("**/assets/runtime.js", r => r.abort());
      await p.goto(origin + "/#demo-mentor");
      await p.waitForSelector("#connection-notice.error");
      assert.deepEqual(await p.evaluate(() => ({ server: window.GECC_SERVER, sample: DB.isSample, units: DB.units.length, stored: localStorage.getItem(KEY) })),
        { server: true, sample: false, units: 0, stored: null });
    } finally { await context.close(); }
  });
  await check("first login requires a new password; mismatch focuses linked error; real unit and mentor sessions are scoped", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    try {
      const p = await context.newPage();
      p.on("pageerror", e => errors.push(e.message));
      await p.goto(origin + "/");
      await p.waitForSelector(".summary-grid");
      await p.evaluate(() => GECCClient.loginModal("unit", "u02", "หน่วยบริการ"));
      await p.locator("#login-name").fill("000002");
      await p.locator("#login-password").fill("Browser-test-password");
      await p.locator("[data-toggle-password=login-password]").click();
      assert.equal(await p.locator("#login-password").getAttribute("type"), "text");
      await p.locator("[data-toggle-password=login-password]").click();
      await p.locator("#server-login button[type=submit]").click();
      await p.waitForSelector("#password-form");
      await p.locator("#old-password").fill("Browser-test-password");
      await p.locator("#new-password").fill("Changed-unit-password-2570");
      await p.locator("#repeat-password").fill("Mismatch-password-2570");
      await p.locator("#password-form button[type=submit]").click();
      assert.equal(await p.locator("#repeat-password").getAttribute("aria-invalid"), "true");
      assert.ok((await p.locator("#repeat-password").getAttribute("aria-describedby")).includes("password-error"));
      assert.equal(await p.evaluate(() => document.activeElement.id), "repeat-password");
      await p.locator("#repeat-password").fill("Changed-unit-password-2570");
      await p.locator("#password-form button[type=submit]").click();
      await p.waitForFunction(() => S.role === null && !document.getElementById("password-form"));
      await p.evaluate(() => GECCClient.loginModal("unit", "u02", "หน่วยบริการ"));
      await p.locator("#login-name").fill("000002");
      await p.locator("#login-password").fill("Changed-unit-password-2570");
      await p.locator("#server-login button[type=submit]").click();
      await p.waitForFunction(() => S.role === "mentee" && S.view === "modules");
      assert.deepEqual(await p.evaluate(() => DB.units.map(u => u.id)), ["u02"]);
      await audit(p, "first-login unit dashboard mobile");
      await p.evaluate(() => GECCClient.logout());
      await p.evaluate(() => GECCClient.loginModal("team", 1, "MENTOR"));
      await p.locator("#login-name").fill("test-mentor");
      await p.locator("#login-password").fill("Browser-test-password");
      await p.locator("#server-login button[type=submit]").click();
      await p.waitForFunction(() => S.role === "mentor" && S.team === 1);
      assert.equal(await p.evaluate(() => DB.units.every(u => u.team === 1)), true);
      await audit(p, "mentor scoped dashboard mobile");
    } finally { await context.close(); }
  });
  assert.deepEqual(errors, [], "runtime JavaScript errors after all scenarios");
  checks.push("no browser JavaScript exceptions");
  await writeFile(
    artifactRoot + "/browser-report.json",
    JSON.stringify({ checks, errors, audits }, null, 2),
  );
  const serious = audits.flatMap((a) =>
    a.violations
      .filter((v) => ["critical", "serious"].includes(v.impact))
      .map((v) => a.page + ": " + v.id),
  );
  console.log("Accessibility findings:", serious.length);
  console.log("Report:", artifactRoot + "/browser-report.json");
  if (serious.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => preview.close(r));
  await new Promise((r) => api.close(r));
  await pool.end();
  await rm(privateRoot, { recursive: true, force: true });
}
