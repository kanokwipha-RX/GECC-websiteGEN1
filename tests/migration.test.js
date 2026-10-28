import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../server/seed.js";
import { prepareImport } from "../server/import.js";
import { mergeState, project, validateContent } from "../server/policy.js";
import { rules } from "../server/domain.js";
import { testDatabase } from "./postgres.js";
import { migrate, transaction } from "../server/store.js";
const actor = { role: "coord", name: "Test coordinator" };
test("reviewer cannot take a defect from another group by changing its unit identifier", async () => {
  const s = await initialState();
  const original = s.units[0];
  const own = s.units.find(u => u.team !== original.team);
  s.defects = [{ id: "protected-defect", unitId: original.id, detail: "Existing finding", due: "2026-11-30", status: "open" }];
  const reviewer = { role: "mentor", team: own.team, name: "Reviewer" };
  const input = project(s, reviewer);
  input.defects.push({ ...s.defects[0], unitId: own.id });
  assert.throws(() => mergeState(s, input, reviewer), error => error.status === 403);
});
test("initialization uses official roster with no sample scores or credentials", async () => {
  const s = await initialState();
  assert.equal(s.units.length, 28);
  assert.equal(s.teams.length, 6);
  assert.equal(new Set(s.units.map((u) => u.code)).size, 28);
  assert.equal(s.units[0].code, "000001");
  assert.deepEqual(s.assess, {});
  assert.deepEqual(s.defects, []);
  assert.equal(s.isSample, false);
  assert.ok(!s.pins);
  assert.equal(s.publicContent.library.length, 5);
  assert.equal(s.publicContent.committee.length, 12);
});
test("import preserves source edits while keeping stable organization codes; nonempty target refused", async () => {
  const current = await initialState();
  const source = structuredClone(current);
  delete source.units[0].code;
  source.units[0].name = "Owner-reviewed organization label";
  source.assess.u01 = JSON.parse(JSON.stringify(rules.blankAssess()));
  const next = prepareImport(current, source);
  assert.equal(next.units[0].code, "000001");
  assert.equal(next.units[0].name, source.units[0].name);
  assert.ok(next.assess.u01);
  assert.throws(() => prepareImport(next, source), /ข้อมูลประเมินแล้ว/);
  assert.throws(
    () => prepareImport(current, { ...source, isSample: true }),
    /สาธิต/,
  );
});
test("retired unit IDs/codes are not reused and newly created organizations get fresh codes", async () => {
  const s = await initialState();
  const input = project(s, actor);
  input.units = input.units.filter((u) => u.id !== "u01");
  const removed = mergeState(s, input, actor);
  const add = project(removed, actor);
  add.units.push({ id: "u29", name: "Test new organization", team: 1 });
  const next = mergeState(removed, add, actor);
  assert.equal(next.units.at(-1).code, "000029");
  const bad = project(next, actor);
  bad.units.push({ id: "u01", name: "Reused identifier", team: 1 });
  assert.throws(() => mergeState(next, bad, actor), /ถูกยกเลิก/);
});
test("public document URLs reject active-content schemes and invalid image paths", async () => {
  const s = await initialState();
  s.publicContent.library[0].url = "javascript:alert(1)";
  assert.throws(() => validateContent(s.publicContent));
  s.publicContent.library[0].url =
    "https://drive.google.com/drive/folders/example";
  s.publicContent.advisor.photo = "assets/../../secret.jpg";
  assert.throws(() => validateContent(s.publicContent));
});
test("PostgreSQL transaction rollback and migration idempotence", async () => {
  const pool = await testDatabase();
  try {
    await migrate(pool);
    await migrate(pool);
    await assert.rejects(
      transaction(pool, async (c) => {
        await c.query("INSERT INTO app_state(id,document) VALUES(1,'{}')");
        throw Error("injected failure");
      }),
    );
    assert.equal((await pool.query("SELECT id FROM app_state")).rows.length, 0);
  } finally {
    await pool.end();
  }
});
