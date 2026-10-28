import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(
  new URL("../shared/criteria.js", import.meta.url),
  "utf8",
);
export const rules = vm.runInNewContext(
  source + ";({PHYS,QC,NARR,OUT,blankAssess,calc,subOf,readyOf})",
  {
    todayISO: () =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
  },
);
export function summary(state) {
  const result = {
    units: state.units.length,
    teams: state.teams.length,
    submitted: 0,
    reviewed: 0,
    ready: 0,
    complete: 0,
    pass: 0,
    fix: 0,
    risk: 0,
    none: 0,
  };
  for (const u of state.units) {
    const a = state.assess[u.id];
    const sub = rules.subOf(a);
    const complete = ["phys", "qual", "out"].every((k) => sub[k] === "done");
    if (a?.wf?.status === "submitted") result.submitted++;
    if (a?.wf?.status === "reviewed") result.reviewed++;
    if (rules.readyOf(a).st === "ready") result.ready++;
    if (complete) {
      result.complete++;
      const c = rules.calc(a);
      const open = state.defects.some(
        (d) => d.unitId === u.id && d.status !== "closed",
      );
      result[
        !c.physComplete || c.total < 240 ? "risk" : open ? "fix" : "pass"
      ]++;
    } else result.none++;
  }
  return result;
}
