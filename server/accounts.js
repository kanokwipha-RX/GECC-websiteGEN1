import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { initialState } from "./seed.js";
import { database, readState, transaction, audit } from "./store.js";
import { hashPassword, passwordValid } from "./auth.js";

export function accountPlan(state) {
  const plan = state.units.map(u => ({
    username: u.code, name: u.name, role: "mentee", unitId: u.id, team: null,
  }));
  for (const t of state.teams)
    (t.members || []).forEach((m, i) => plan.push({
      username: `mentor-${String(t.id).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
      name: m.name, role: "mentor", unitId: null, team: t.id,
    }));
  (state.mentorCoordinators || []).forEach((m, i) => plan.push({
    username: `coord-${String(i + 1).padStart(2, "0")}`,
    name: m.name, role: "coord", unitId: null, team: null,
  }));
  if (!plan.some(a => a.role === "coord") || new Set(plan.map(a => a.username)).size !== plan.length ||
      plan.some(a => !a.name || (a.role === "mentee" && !/^\d{6}$/.test(a.username))))
    throw new Error("Roster is missing names, stable codes or coordinators; review before provisioning");
  return plan;
}

export function prepareAccounts(state) {
  return { format: "gecc-accounts-v1", createdAt: new Date().toISOString(),
    accounts: accountPlan(state).map(a => ({ ...a, password: randomBytes(18).toString("base64url") })) };
}

export async function provisionAccounts(pool, bundle, apply = false) {
  if (bundle?.format !== "gecc-accounts-v1" || !Array.isArray(bundle.accounts))
    throw new Error("Invalid account bundle");
  // Validate and lock the current roster inside the same transaction as account creation.
  return transaction(pool, async c => {
    const { document } = await readState(c, true);
    if (document.isSample) throw new Error("Refusing to provision accounts into sample data");
    const plan = accountPlan(document);
    if (bundle.accounts.length !== plan.length) throw new Error("Account bundle does not match current roster");
    const used = new Set();
    const pending = [];
    let skipped = 0;
    for (const a of bundle.accounts) {
      const expected = plan.find(p => p.username === a.username);
      if (!expected || used.has(a.username) ||
          ["name", "role", "unitId", "team"].some(k => a[k] !== expected[k]) || !passwordValid(a.password))
        throw new Error("Account scope/name/password does not match roster");
      used.add(a.username);
      const found = await c.query("SELECT * FROM accounts WHERE username=$1", [a.username]);
      if (found.rows.length) {
        const old = found.rows[0];
        if (old.role !== a.role || old.name !== a.name || old.unit_id !== a.unitId || old.team !== a.team)
          throw new Error("Existing account has a different identity or scope; review manually");
        skipped++;
      } else pending.push(a);
    }
    if (apply) for (const a of pending) {
      const id = randomUUID();
      await c.query(
        "INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id, a.username, a.name, await hashPassword(a.password), a.role, a.unitId, a.team],
      );
      await audit(c, id, "provision-account", id);
    }
    return { dryRun: !apply, total: plan.length, [apply ? "created" : "wouldCreate"]: pending.length, skipped };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let pool;
  try {
    const [command, file] = process.argv.slice(2);
    if (!["prepare", "check", "apply"].includes(command) || !file)
      throw new Error("Usage: node server/accounts.js prepare|check|apply private-output.json");
    if (command === "prepare") {
      const target = resolve(file);
      const privateRoot = fileURLToPath(new URL("../var/private/", import.meta.url));
      // Keep secrets out of the application's publicly served directories.
      if (!target.startsWith(resolve(privateRoot) + sep) || !target.endsWith(".json"))
        throw new Error("Use a private .json path such as var/private/accounts.json");
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      const bundle = prepareAccounts(await initialState());
      await writeFile(target, JSON.stringify(bundle, null, 2), { flag: "wx", mode: 0o600 });
      console.log(`Prepared ${bundle.accounts.length} accounts. Passwords are in the private file only; no database was changed.`);
    } else {
      const bundle = JSON.parse(await readFile(resolve(file), "utf8"));
      pool = database();
      console.log(JSON.stringify(await provisionAccounts(pool, bundle, command === "apply")));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}
