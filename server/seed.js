import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { validateContent } from "./policy.js";
export function initializeUnitCodes(state) {
  const used = new Set();
  for (const unit of state.units) {
    if (unit.code == null) continue;
    if (!/^\d{6}$/.test(unit.code) || used.has(unit.code))
      throw new Error("Invalid or duplicate unit code");
    used.add(unit.code);
  }
  let next = Math.max(state.nextUnitCode || 1, ...[...used].map(code => Number(code) + 1));
  for (const unit of state.units) if (unit.code == null) {
    if (next > 999999) throw new Error("Unit code range exhausted");
    unit.code = String(next++).padStart(6, "0");
  }
  state.nextUnitCode = next;
}
export async function initialState() {
  const state = JSON.parse(
    await readFile(
      new URL("../sisaket-gecc-2570-units-28.json", import.meta.url),
      "utf8",
    ),
  );
  state.assess = {};
  state.defects = [];
  state.isSample = false;
  delete state.pins;
  initializeUnitCodes(state);
  state.retiredUnitIds = [];
  state.cal = {
    start: "2026-10-01",
    prov: "2026-12-04",
    open: "2026-11-16",
    close: "2026-12-25",
  };
  const source = await readFile(
    new URL("../index.html", import.meta.url),
    "utf8",
  );
  const from = source.indexOf("const LIBRARY_ROOT =");
  const to = source.indexOf("/* ================= Shell", from);
  state.publicContent = vm.runInNewContext(
    source.slice(from, to) +
      ";({library:LIBRARY_FOLDERS,advisor:COMMITTEE_ADVISOR,committee:COMMITTEE_MEMBERS,duties:COMMITTEE_DUTIES,mentorAdvisors:MENTOR_ADVISORS})",
  );
  Object.assign(state.publicContent, JSON.parse(await readFile(new URL("../php/data/content-defaults.json", import.meta.url),"utf8")));
  validateContent(state.publicContent);
  for (const t of state.teams) t.photo = `assets/images/group-${t.id}.jpg`;
  return state;
}
