import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { validateContent } from "./policy.js";
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
  state.units.forEach((u, i) => (u.code = String(i + 1).padStart(6, "0")));
  state.nextUnitCode = state.units.length + 1;
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
      ";({library:LIBRARY_FOLDERS,advisor:COMMITTEE_ADVISOR,committee:COMMITTEE_MEMBERS,duties:COMMITTEE_DUTIES})",
  );
  validateContent(state.publicContent);
  for (const t of state.teams) t.photo = `assets/images/group-${t.id}.jpg`;
  return state;
}
