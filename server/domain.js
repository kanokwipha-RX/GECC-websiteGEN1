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
    submission: { done: 0, prog: 0, none: 0 },
    readiness: { ready: 0, notready: 0, draft: 0, none: 0 },
    crit: {
      qc: { done: 0, prog: 0, none: 0 },
      narr: { done: 0, prog: 0, none: 0 },
      out: { done: 0, prog: 0, none: 0 },
    },
    levels: { gold: 0, silver: 0, blue: 0, below: 0, gate: 0, none: 0 },
    phys: { full: 0, part: 0, zero: 0, bars: [] },
    survey: { tot: 0, units: 0, avg: { s3: null, s4: null, s5: null, c1: null, c2: null, c5: null } },
    scores: [],
    lastUpdatedAt: null,
  };
  const svWeights = { s3: 0, s4: 0, s5: 0, c1: 0, c2: 0, c5: 0 };
  const svSums = { s3: 0, s4: 0, s5: 0, c1: 0, c2: 0, c5: 0 };

  for (const u of state.units) {
    const a = state.assess[u.id];
    const sub = rules.subOf(a);
    const complete = ["phys", "qual", "out"].every((k) => sub[k] === "done");
    result.submission[complete ? "done" : Object.values(sub).some(s => s !== "none") ? "prog" : "none"]++;
    result.readiness[rules.readyOf(a).st]++;
    if (a?.updatedAt && (!result.lastUpdatedAt || a.updatedAt > result.lastUpdatedAt)) result.lastUpdatedAt = a.updatedAt;
    if (a?.wf?.status === "submitted") result.submitted++;
    if (a?.wf?.status === "reviewed") result.reviewed++;
    if (rules.readyOf(a).st === "ready") result.ready++;

    for (const ck of ["qc", "narr", "out"]) {
      result.crit[ck][sub[ck]]++;
    }

    const pv = (a && a.started && Array.isArray(a.phys)) ? a.phys.filter((v) => v === true).length : 0;
    if (pv === 15) result.phys.full++;
    else if (pv > 0) result.phys.part++;
    else result.phys.zero++;
    result.phys.bars.push({ name: u.name, team: u.team, v: pv });

    if (complete) {
      result.complete++;
      const c = rules.calc(a);
      const open = state.defects.some(
        (d) => d.unitId === u.id && d.status !== "closed",
      );
      result[
        !c.physComplete || c.total < 240 ? "risk" : open ? "fix" : "pass"
      ]++;
      result.levels[c.level]++;
      result.scores.push({ total: c.total, level: c.level, name: u.name });
    } else {
      result.none++;
      result.levels.none++;
    }

    const sv = a?.survey;
    if (sv && Number(sv.n) > 0) {
      const nVal = Number(sv.n);
      let hasAny = false;
      for (const sk of ["s3", "s4", "s5"]) {
        if (sv.sat?.[sk] != null && !isNaN(sv.sat[sk])) {
          svSums[sk] += Number(sv.sat[sk]) * nVal;
          svWeights[sk] += nVal;
          hasAny = true;
        }
      }
      for (const ck of ["c1", "c2", "c5"]) {
        if (sv.conf?.[ck] != null && !isNaN(sv.conf[ck])) {
          svSums[ck] += Number(sv.conf[ck]) * nVal;
          svWeights[ck] += nVal;
          hasAny = true;
        }
      }
      if (hasAny) {
        result.survey.tot += nVal;
        result.survey.units++;
      }
    }
  }

  for (const k of Object.keys(result.survey.avg)) {
    if (svWeights[k] > 0) {
      result.survey.avg[k] = Math.round((svSums[k] / svWeights[k]) * 100) / 100;
    }
  }

  result.phys.bars.sort((a, b) => b.v - a.v || a.team - b.team);
  return result;
}
