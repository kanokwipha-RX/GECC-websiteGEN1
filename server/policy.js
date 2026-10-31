import { isDeepStrictEqual as equal } from "node:util";
import { rules } from "./domain.js";
export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export const clone = (v) => JSON.parse(JSON.stringify(v));
export const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const dateValue = (value) =>
  value === "" ||
  (typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)));
export function allowed(actor, u) {
  return (
    !!actor &&
    !!u &&
    (actor.role === "coord" ||
      (actor.role === "mentor" && (actor.team === 0 || actor.team === u.team)) ||
      (actor.role === "mentee" && actor.unit_id === u.id))
  );
}
export function project(state, actor) {
  const d = clone(state);
  delete d.pins;
  delete d.demoStat;
  delete d.mentorRosterVersion;
  if (!actor) {
    return {
      v: d.v,
      fy: d.fy,
      isSample: false,
      teams: d.teams.map(({ id, name, photo }) => ({ id, name, photo })),
      mentorCoordinators: d.mentorCoordinators || [],
      cal: d.cal,
      publicContent: d.publicContent,
      units: [],
      assess: {},
      defects: [],
    };
  }
  const ids = new Set(
    d.units.filter((u) => allowed(actor, u)).map((u) => u.id),
  );
  d.units = d.units.filter((u) => ids.has(u.id));
  d.assess = Object.fromEntries(
    Object.entries(d.assess).filter(([id]) => ids.has(id)),
  );
  d.defects = d.defects.filter((d) => ids.has(d.unitId));
  return d;
}
const fields = [
  "started",
  "date",
  "round",
  "inspector",
  "inspectors",
  "updatedAt",
  "phys",
  "qc",
  "narr",
  "out",
  "ready",
  "survey",
  "ev",
  "rev",
  "adv",
  "sender",
  "quick",
  "wf",
];
export function validateAssessment(a) {
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    Object.keys(a).some((k) => !fields.includes(k))
  )
    fail(400, "รูปแบบแบบประเมินไม่ถูกต้อง");
  if (
    typeof a.started !== "boolean" ||
    !dateValue(a.date) ||
    !Number.isInteger(a.round) ||
    a.round < 1
  )
    fail(400, "วันที่หรือรอบการประเมินไม่ถูกต้อง");
  if (a.ready?.date !== undefined && !dateValue(a.ready.date))
    fail(400, "วันที่ลงนามไม่ถูกต้อง");
  if (a.ready)
    for (const k of ["fromY", "toY"])
      if (
        a.ready[k] !== undefined &&
        a.ready[k] !== "" &&
        !/^\d{4}$/.test(String(a.ready[k]))
      )
        fail(400, "ปีรับรองไม่ถูกต้อง");
  if (a.wf) {
    if (
      !["draft", "submitted", "returned", "reviewed"].includes(a.wf.status) ||
      (a.wf.round !== undefined &&
        (!Number.isInteger(a.wf.round) || a.wf.round < 0)) ||
      (a.wf.log !== undefined && !Array.isArray(a.wf.log))
    )
      fail(400, "สถานะหรือประวัติการส่งไม่ถูกต้อง");
    for (const entry of a.wf.log || [])
      if (
        typeof entry.status !== "string" ||
        !/^[a-z-]{1,32}$/.test(entry.status)
      )
        fail(400, "สถานะในประวัติไม่ถูกต้อง");
  }
  if (
    !Array.isArray(a.phys) ||
    a.phys.length !== 15 ||
    a.phys.some((x) => ![true, false, null].includes(x))
  )
    fail(400, "ข้อมูลเกณฑ์กายภาพไม่ถูกต้อง");
  if (
    !Array.isArray(a.qc) ||
    a.qc.length !== rules.QC.length ||
    !Array.isArray(a.narr) ||
    a.narr.length !== rules.NARR.length
  )
    fail(400, "จำนวนข้อประเมินไม่ถูกต้อง");
  const score = (n, max) =>
    n === null ||
    n === "" ||
    (typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max);
  a.qc.forEach((q, i) => {
    if (
      !q ||
      !Array.isArray(q.subs) ||
      q.subs.length !== rules.QC[i].subs.length ||
      q.subs.some((v) => typeof v !== "boolean") ||
      !score(q.score, 10)
    )
      fail(400, "คะแนน Checklist ไม่ถูกต้อง");
  });
  a.narr.forEach((n) => {
    if (
      !n ||
      !score(n.score, 10) ||
      typeof n.text !== "string" ||
      n.text.length > 20000
    )
      fail(400, "คะแนนหรือคำบรรยายไม่ถูกต้อง");
  });
  if (
    !a.out ||
    !Array.isArray(a.out.c21) ||
    a.out.c21.length !== rules.OUT.c21.items.length ||
    !Array.isArray(a.out.t3) ||
    a.out.t3.length !== rules.OUT.t3.items.length ||
    [...a.out.c21, ...a.out.t3].some((v) => typeof v !== "boolean")
  )
    fail(400, "ข้อมูลผลลัพธ์ไม่ถูกต้อง");
  for (const k of ["o11", "o12", "o13", "o14", "c22"])
    if (
      a.out[k] !== null &&
      a.out[k] !== "" &&
      !rules.OUT[k].opts.some(([v]) => v === +a.out[k])
    )
      fail(400, "คะแนนผลลัพธ์ไม่ตรงเกณฑ์");
  if (a.inspectors && !Array.isArray(a.inspectors))
    fail(400, "รายชื่อผู้ตรวจไม่ถูกต้อง");
  if (a.survey) {
    if (!Number.isFinite(+a.survey.n) || +a.survey.n < 0)
      fail(400, "จำนวนผู้ตอบไม่ถูกต้อง");
    for (const group of ["sat", "conf"])
      for (const v of Object.values(a.survey[group] || {}))
        if (v !== null && (!Number.isFinite(+v) || +v < 1 || +v > 5))
          fail(400, "คะแนนสำรวจต้องอยู่ระหว่าง 1 ถึง 5");
  }
  if (JSON.stringify(a).length > 500000)
    fail(413, "แบบประเมินมีขนาดใหญ่เกินไป");
}
export function mergeState(current, incoming, actor) {
  if (
    !incoming ||
    !Array.isArray(incoming.units) ||
    !Array.isArray(incoming.teams) ||
    !Array.isArray(incoming.defects) ||
    !incoming.assess ||
    typeof incoming.assess !== "object"
  )
    fail(400, "รูปแบบข้อมูลไม่ถูกต้อง");
  const visible = project(current, actor);
  const next = clone(current);
  const now = new Date().toISOString();
  if (actor.role !== "coord") {
    for (const k of Object.keys(incoming))
      if (!["assess", "defects"].includes(k) && !equal(incoming[k], visible[k]))
        fail(403, "ไม่มีสิทธิ์แก้ไขข้อมูลส่วนกลาง");
  }
  if (actor.role === "coord") {
    for (const k of [
      "units",
      "teams",
      "fy",
      "cal",
      "mentorCoordinators",
      "publicContent",
    ])
      if (k in incoming) next[k] = clone(incoming[k]);
    if (!Number.isInteger(next.fy) || next.fy < 1 || next.fy > 9999)
      fail(400, "ปีงบประมาณไม่ถูกต้อง");
    const groupIds = new Set();
    for (const t of next.teams) {
      if (
        !t ||
        !Number.isInteger(t.id) ||
        t.id < 1 ||
        groupIds.has(t.id) ||
        typeof t.name !== "string" ||
        !t.name.trim()
      )
        fail(400, "กลุ่ม MENTOR ไม่ถูกต้อง");
      groupIds.add(t.id);
    }
    for (const value of Object.values(next.cal || {}))
      if (!dateValue(value)) fail(400, "วันที่ในปฏิทินไม่ถูกต้อง");
    if (next.mentorCoordinators && !Array.isArray(next.mentorCoordinators))
      fail(400, "ข้อมูลผู้ประสานงานไม่ถูกต้อง");
    for (const person of [...next.teams, ...(next.mentorCoordinators || [])])
      validateContent({
        library: [],
        advisor: { photo: person.photo || "" },
        committee: [],
        duties: [],
      });
    let sequence =
      current.nextUnitCode ||
      Math.max(0, ...current.units.map((u) => +u.code || 0)) + 1;
    const retired = new Set(current.retiredUnitIds || []);
    for (const u of current.units)
      if (!next.units.some((n) => n.id === u.id)) retired.add(u.id);
    for (const u of next.units)
      if (retired.has(u.id) && !current.units.some((n) => n.id === u.id))
        fail(400, "รหัสรายการหน่วยบริการนี้ถูกยกเลิกแล้ว กรุณาสร้างรายการใหม่");
    next.retiredUnitIds = [...retired];
    for (const u of next.units)
      if (!u.code) {
        u.code = String(sequence++).padStart(6, "0");
      }
    next.nextUnitCode = sequence;
    const ids = new Set();
    const codes = new Set();
    for (const u of next.units) {
      if (
        !u ||
        !validId(u.id) ||
        ids.has(u.id) ||
        typeof u.name !== "string" ||
        !u.name.trim() ||
        !next.teams.some((t) => t.id === u.team)
      )
        fail(400, "ข้อมูลหน่วยบริการไม่ถูกต้อง");
      ids.add(u.id);
      if (u.code && (!/^\d{6}$/.test(u.code) || codes.has(u.code)))
        fail(400, "รหัสหน่วยบริการต้องเป็นเลข 6 หลักที่ไม่ซ้ำ");
      if (u.code) codes.add(u.code);
      const previous = current.units.find((x) => x.id === u.id);
      if (previous?.code && previous.code !== u.code)
        fail(400, "เปลี่ยนรหัสหน่วยบริการเดิมไม่ได้");
    }
    for (const id of Object.keys(next.assess))
      if (!ids.has(id)) delete next.assess[id];
    next.defects = next.defects.filter((d) => ids.has(d.unitId));
  }
  for (const [id, value] of Object.entries(incoming.assess)) {
    const u = next.units.find((u) => u.id === id);
    if (!allowed(actor, u)) fail(403, "ไม่มีสิทธิ์เข้าถึงหน่วยบริการนี้");
    const old = current.assess[id];
    if (equal(value, visible.assess[id])) continue;
    validateAssessment(value);
    const a = clone(value);
    const status = old?.wf?.status || "draft";
    if (status === "reviewed")
      fail(409, "ผลตรวจถูกล็อก ต้องเปิดแก้ไขพร้อมเหตุผลก่อน");
    if (!equal(a.wf, old?.wf)) fail(400, "ต้องเปลี่ยนสถานะผ่านคำสั่ง workflow");
    if (actor.role === "mentee") {
      for (const k of [
        "inspectors",
        "inspector",
        "rev",
        "adv",
        "date",
        "round",
      ])
        if (!equal(a[k], (old || rules.blankAssess())[k]))
          fail(403, "หน่วยบริการแก้ไขผลตรวจของ MENTOR ไม่ได้");
      const baseline = old || rules.blankAssess();
      for (const k of ["phys", "out"])
        if (!equal(a[k], baseline[k]))
          fail(403, "หน่วยบริการแก้ไขคะแนนตรวจประเมินไม่ได้");
      a.qc.forEach((q, i) => {
        if (!equal(q.subs, baseline.qc[i].subs))
          fail(403, "หน่วยบริการแก้ไขผล Checklist ของผู้ตรวจไม่ได้");
      });
      a.qc.forEach((q, i) => {
        if (!equal(q.score, (old || rules.blankAssess()).qc[i].score))
          fail(403, "หน่วยบริการให้คะแนน Checklist ไม่ได้");
      });
      a.narr.forEach((n, i) => {
        if (!equal(n.score, (old || rules.blankAssess()).narr[i].score))
          fail(403, "หน่วยบริการให้คะแนนคำบรรยายไม่ได้");
      });
      if (!!a.ready?.verified !== !!old?.ready?.verified)
        fail(403, "ยืนยันความพร้อมได้เฉพาะ MENTOR");
    }
    if (actor.role !== "mentee" && a.wf?.status === "submitted")
      a.wf.mentorSavedAt = now;
    a.updatedAt = now;
    next.assess[id] = a;
  }
  // An absent assessment is never interpreted as a delete by a scoped snapshot.
  const previousById = new Map(current.defects.map((d) => [d.id, d]));
  const incomingIds = new Set();
  for (const d of incoming.defects) {
    if (
      !d ||
      !validId(d.id) ||
      incomingIds.has(d.id) ||
      !allowed(
        actor,
        next.units.find((u) => u.id === d.unitId),
      )
    )
      fail(403, "ไม่มีสิทธิ์แก้ไขข้อบกพร่อง");
    incomingIds.add(d.id);
    const old = previousById.get(d.id);
    if (old && !allowed(actor, current.units.find((u) => u.id === old.unitId)))
      fail(403, "ไม่มีสิทธิ์แก้ไขข้อบกพร่องเดิม");
    if (equal(d, old)) continue;
    if (!["open", "fixing", "recheck", "closed"].includes(d.status))
      fail(400, "สถานะข้อบกพร่องไม่ถูกต้อง");
    if (
      typeof d.detail !== "string" ||
      !d.detail.trim() ||
      d.detail.length > 20000 ||
      !dateValue(d.due || "")
    )
      fail(400, "รายละเอียดหรือกำหนดแก้ไขข้อบกพร่องไม่ถูกต้อง");
    if (actor.role === "mentee") {
      if (!old) fail(403, "หน่วยบริการเพิ่มข้อบกพร่องไม่ได้");
      for (const k of Object.keys(d))
        if (
          !["response", "status", "history"].includes(k) &&
          !equal(d[k], old[k])
        )
          fail(403, "หน่วยบริการแก้ไขได้เฉพาะคำตอบ");
      if (
        d.status !== "recheck" ||
        typeof d.response !== "string" ||
        d.response.trim().length < 10
      )
        fail(400, "กรุณาระบุผลแก้ไขอย่างน้อย 10 ตัวอักษร");
    }
    const saved = {
      ...clone(d),
      history: [
        ...(old?.history || []),
        { at: now, status: d.status, by: actor.name },
      ],
    };
    const idx = next.defects.findIndex((x) => x.id === d.id);
    if (idx < 0) next.defects.push(saved);
    else next.defects[idx] = saved;
  }
  if (actor.role !== "mentee")
    next.defects = next.defects.filter(
      (d) =>
        !allowed(
          actor,
          next.units.find((u) => u.id === d.unitId),
        ) || incomingIds.has(d.id),
    );
  else
    for (const old of visible.defects)
      if (!incomingIds.has(old.id)) fail(403, "หน่วยบริการลบข้อบกพร่องไม่ได้");
  validateContent(next.publicContent);
  delete next.pins;
  next.isSample = false;
  return next;
}
export function validateContent(content) {
  if (!content) return;
  const safe = (value, image = false) => {
    if (!value && image) return;
    if (typeof value !== "string" || value.length > 2048)
      fail(400, "ลิงก์ไม่ถูกต้อง");
    if (
      image &&
      /^assets\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp)$/.test(value) &&
      !value.includes("..")
    )
      return;
    let url;
    try {
      url = new URL(value);
    } catch {
      fail(400, "กรุณาระบุลิงก์ HTTPS หรือตำแหน่งรูปใน assets");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      fail(400, "อนุญาตเฉพาะลิงก์ HTTPS");
  };
  if (
    !Array.isArray(content.library) ||
    !Array.isArray(content.committee) ||
    !Array.isArray(content.duties) ||
    !content.advisor
  )
    fail(400, "ข้อมูลเผยแพร่ไม่ครบ");
  for (const row of content.library) {
    safe(row.url);
    safe(row.image, true);
  }
  for (const p of [content.advisor, ...content.committee]) safe(p.photo, true);
}
export function transition(state, id, action, actor, note = "", sender) {
  const unit = state.units.find((u) => u.id === id);
  if (!allowed(actor, unit)) fail(403, "ไม่มีสิทธิ์เข้าถึงหน่วยบริการนี้");
  const a = state.assess[id];
  if (!a) fail(400, "กรุณาบันทึกแบบประเมินก่อน");
  const w = a.wf || { status: "draft", round: 0, log: [] };
  const now = new Date().toISOString();
  if (action === "submit") {
    if (actor.role !== "mentee") fail(403, "เฉพาะหน่วยบริการส่งตรวจ");
    if (w.status === "reviewed") fail(409, "ผลตรวจถูกล็อก");
    if (
      typeof sender?.name !== "string" ||
      !sender.name.trim() ||
      sender.name.length > 200 ||
      !/^\d{9,10}$/.test(String(sender.tel || "").replace(/\D/g, ""))
    )
      fail(400, "กรุณาระบุชื่อและโทรศัพท์ผู้ส่ง");
    sender = {
      name: sender.name.trim(),
      pos: String(sender.pos || "").slice(0, 200),
      tel: String(sender.tel || "").slice(0, 40),
    };
    if (w.status !== "submitted") w.round = (w.round || 0) + 1;
    w.status = "submitted";
    w.submittedAt = now;
    w.sender = sender;
    a.sender = sender;
  } else {
    if (!["mentor", "coord"].includes(actor.role))
      fail(403, "เฉพาะ MENTOR เปลี่ยนผลตรวจ");
    if (action === "review") {
      if (w.status === "reviewed") fail(409, "ผลตรวจถูกล็อกแล้ว");
      if (!(a.inspectors || []).length)
        fail(400, "กรุณาเลือกผู้ตรวจก่อนยืนยันผล");
      w.status = "reviewed";
      w.reviewedAt = now;
      w.reviewedBy = [...a.inspectors];
    } else if (action === "return") {
      if (w.status === "reviewed") fail(409, "ต้องเปิดแก้ไขก่อนส่งกลับ");
      if (!note.trim()) fail(400, "กรุณาระบุสิ่งที่ต้องแก้ไข");
      w.status = "returned";
      w.returnedAt = now;
      w.returnNote = note;
    } else if (action === "reopen") {
      if (w.status !== "reviewed" || note.trim().length < 10)
        fail(
          400,
          "เปิดแก้ไขได้เฉพาะผลตรวจที่ล็อกและต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษร",
        );
      w.status = "submitted";
      w.reopenedAt = now;
      w.mentorSavedAt = null;
    } else fail(400, "คำสั่งไม่ถูกต้อง");
  }
  w.log = [
    ...(w.log || []),
    {
      at: now,
      status: action === "reopen" ? "reopened" : w.status,
      by: actor.name,
      note,
    },
  ];
  a.wf = w;
  a.updatedAt = now;
  return state;
}
