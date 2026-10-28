import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "/bin/bash";
const available = existsSync(bash);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gecc-deploy-"));
  const bin = join(root, "fake-bin");
  await mkdir(bin);
  await mkdir(join(root, "deploy"));
  for (const file of ["production.sh", "check-host.sh"])
    await copyFile("deploy/" + file, join(root, "deploy", file));
  await copyFile("compose.yaml", join(root, "compose.yaml"));
  const commands = {
    uname: '#!/bin/sh\nprintf "Linux\\n"\n',
    openssl: '#!/bin/sh\nprintf "%064d\\n" 1\n',
    flock: '#!/bin/sh\nexit 0\n',
    docker: `#!/bin/bash
printf '%s\n' "$*" >> "$GECC_TEST_LOG"
if [[ -n "$GECC_TEST_FAIL" && "$*" == *"$GECC_TEST_FAIL"* ]]; then exit 19; fi
if [[ "$*" == *"server/accounts.js prepare"* ]]; then
  printf '{"testOnly":true}' > var/private/accounts.json
fi
exit 0
`,
  };
  for (const [name, text] of Object.entries(commands))
    await writeFile(join(bin, name), text, { mode: 0o755 });
  const log = join(root, "commands.log");
  function run(args, extra = {}) {
    // The mock PATH is set inside Bash so Windows drive-letter separators cannot
    // accidentally bypass it and invoke an installed Docker client.
    return spawnSync(bash, ["-c", 'export PATH="$PWD/fake-bin:$PATH"; exec bash deploy/production.sh "$@"', "test", ...args], {
      cwd: root, encoding: "utf8", env: { ...process.env, GECC_TEST_LOG: log, ...extra },
    });
  }
  return { root, log, run, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("deployment shell syntax and explicit mutation flag", { skip: !available }, async () => {
  assert.equal(spawnSync(bash, ["-n", "deploy/production.sh"]).status, 0);
  const f = await fixture();
  try {
    assert.equal(f.run(["init"]).status, 2);
    assert.equal(f.run(["start"]).status, 2);
    assert.equal(existsSync(join(f.root, ".env")), false);
    assert.equal(existsSync(f.log), false);
  } finally { await f.cleanup(); }
});

test("setup orchestration orders migration/provision/start and preserves rerun secrets", { skip: !available }, async () => {
  const f = await fixture();
  try {
    const first = f.run(["init", "--apply"]);
    assert.equal(first.status, 0, first.stderr);
    const config = await readFile(join(f.root, ".env"), "utf8");
    assert.ok(config.includes("BASE_PATH=/sskgecc"));
    assert.ok(!first.stdout.includes("POSTGRES_PASSWORD="));
    const lines = (await readFile(f.log, "utf8")).split("\n");
    const at = text => lines.findIndex(l => l.includes(text));
    assert.ok(at("build web") < at("up -d --wait db"));
    assert.ok(at("server/manage.js migrate") < at("server/accounts.js check"));
    assert.ok(at("server/accounts.js check") < at("server/accounts.js apply"));
    assert.ok(at("server/accounts.js apply") < at("up -d --wait web"));
    const accounts = await readFile(join(f.root, "var/private/accounts.json"), "utf8");
    assert.equal(f.run(["init", "--apply"]).status, 0);
    assert.equal(await readFile(join(f.root, ".env"), "utf8"), config);
    assert.equal(await readFile(join(f.root, "var/private/accounts.json"), "utf8"), accounts);
    const all = await readFile(f.log, "utf8");
    assert.equal(all.split("server/accounts.js prepare").length - 1, 1);
    assert.ok(!/down|volume rm|reset-all|--apply-empty/.test(all));
  } finally { await f.cleanup(); }
});

test("failed migration stops account creation and web start", { skip: !available }, async () => {
  const f = await fixture();
  try {
    const result = f.run(["init", "--apply"], { GECC_TEST_FAIL: "server/manage.js migrate" });
    assert.notEqual(result.status, 0);
    const commands = await readFile(f.log, "utf8");
    assert.ok(!commands.includes("server/accounts.js apply"));
    assert.ok(!commands.includes("up -d --wait web"));
  } finally { await f.cleanup(); }
});

test("check and status never build, migrate, provision or start services", { skip: !available }, async () => {
  const f = await fixture();
  try {
    assert.equal(f.run(["check"]).status, 0);
    assert.equal(existsSync(join(f.root, ".env")), false);
    await writeFile(join(f.root, ".env"), "# test-only config\n");
    assert.equal(f.run(["status"]).status, 0);
    const commands = await readFile(f.log, "utf8");
    assert.ok(!/build web|up -d|server\/manage|server\/accounts/.test(commands));
  } finally { await f.cleanup(); }
});
