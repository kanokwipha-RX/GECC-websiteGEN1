import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { rules } from "../server/domain.js";
const original = execFileSync("git", ["show", "4606a5f:index.html"], {
  encoding: "utf8",
  maxBuffer: 3e6,
});
const slices = [
  ["const PHYS =", "const GROUP_PHOTOS ="],
  ["function blankAssess(){", "function defaultTeams(){"],
  ["function qcScore(a,i){", "function nextGap(c){"],
  ["function subOf(a){", "const SUBL ="],
  ["function readyOf(a){", "const READY_L="],
];
const old = vm.runInNewContext(
  slices
    .map(([a, b]) =>
      original.slice(
        original.indexOf(a),
        original.indexOf(b, original.indexOf(a)),
      ),
    )
    .join("\n") + ";({blankAssess,calc,subOf,readyOf})",
  { todayISO: () => "2026-10-27" },
);
test("shared rules preserve incumbent calculations across 300 deterministic records", () => {
  let seed = 2570;
  const rand = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let n = 0; n < 300; n++) {
    const a = rules.blankAssess();
    a.started = true;
    a.phys = a.phys.map(() => [true, false, null][Math.floor(rand() * 3)]);
    a.qc.forEach((q) => {
      q.subs = q.subs.map(() => rand() > 0.4);
      q.score = rand() > 0.5 ? null : Math.floor(rand() * 21) / 2;
    });
    a.narr.forEach(
      (q) => (q.score = rand() > 0.2 ? Math.floor(rand() * 21) / 2 : null),
    );
    Object.assign(a.out, {
      o11: Math.floor(rand() * 6),
      o12: 5,
      o13: 10,
      o14: 10,
      c22: 15,
      c21: a.out.c21.map(() => rand() > 0.5),
      t3: a.out.t3.map(() => rand() > 0.5),
    });
    for (const f of ["calc", "subOf", "readyOf"])
      assert.equal(JSON.stringify(rules[f](a)), JSON.stringify(old[f](a)));
  }
});
test("physical gate and award thresholds preserved", () => {
  const a = rules.blankAssess();
  a.phys.fill(true);
  a.qc.forEach((q) => (q.score = 10));
  a.narr.forEach((q) => (q.score = 10));
  Object.assign(a.out, {
    o11: 5,
    o12: 5,
    o13: 15,
    o14: 15,
    c22: 15,
    c21: a.out.c21.map(() => true),
    t3: a.out.t3.map(() => true),
  });
  assert.equal(rules.calc(a).level, "gold");
  a.phys[0] = false;
  assert.equal(rules.calc(a).level, "gate");
});
test("external assets and original core event actions retained", () => {
  const s = readFileSync("index.html", "utf8");
  for (const action of [
    "save",
    "wf-submit",
    "wf-review",
    "wf-return",
    "reopen",
    "export",
    "import",
    "pdf-report",
    "def-save",
  ])
    assert.ok(s.includes(action));
  assert.ok(s.includes("IBM+Plex+Sans+Thai"));
});
test("award cutoffs at 240, 260 and 280 remain exact", () => {
  const a = rules.blankAssess();
  a.phys.fill(true);
  a.qc.forEach((q) => (q.score = 10));
  for (const k of ["o11", "o12", "o13", "o14", "c22"])
    a.out[k] = Math.max(...rules.OUT[k].opts.map(([v]) => v));
  a.out.c21.fill(true);
  a.out.t3.fill(true);
  for (const [total, level] of [
    [239.5, "below"],
    [240, "blue"],
    [259.5, "blue"],
    [260, "silver"],
    [279.5, "silver"],
    [280, "gold"],
    [300, "gold"],
  ]) {
    a.narr.forEach(
      (n, i) => (n.score = Math.max(0, Math.min(10, total - 200 - i * 10))),
    );
    assert.equal(rules.calc(a).total, total);
    assert.equal(rules.calc(a).level, level);
  }
});
