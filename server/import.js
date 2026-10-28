import {
  clone,
  fail,
  validateAssessment,
  validateContent,
  mergeState,
  project,
  validId,
} from "./policy.js";
export function prepareImport(current, source) {
  if (
    !source ||
    !Array.isArray(source.units) ||
    !Array.isArray(source.teams) ||
    !source.assess ||
    !Array.isArray(source.defects)
  )
    fail(400, "ไฟล์ข้อมูล GECC ไม่ถูกต้อง");
  if (source.isSample)
    fail(
      400,
      "พบเครื่องหมายข้อมูลสาธิต กรุณาให้เจ้าของข้อมูลตรวจจำแนกก่อนนำเข้า",
    );
  if (Object.keys(current.assess).length || current.defects.length)
    fail(
      409,
      "ระบบกลางมีข้อมูลประเมินแล้ว ต้องตรวจรวมข้อมูลโดยผู้ดูแลก่อน ไม่สามารถแทนที่อัตโนมัติ",
    );
  const ids = new Set(current.units.map((u) => u.id));
  const sourceIds = new Set(source.units.map((u) => u.id));
  if (
    sourceIds.size !== source.units.length ||
    source.units.length !== current.units.length ||
    source.units.some((u) => !ids.has(u.id))
  )
    fail(400, "รายชื่อหน่วยบริการต่างจากระบบกลาง ต้องตรวจจับคู่รหัสก่อน");
  const next = clone(current);
  for (const k of ["teams", "mentorCoordinators", "cal", "fy"])
    if (k in source) next[k] = clone(source[k]);
  next.units = source.units.map((u) => ({
    ...clone(u),
    code: current.units.find((x) => x.id === u.id).code,
  }));
  if (
    next.units.some(
      (u) => !u.name?.trim() || !next.teams.some((t) => t.id === u.team),
    )
  )
    fail(400, "ชื่อหรือกลุ่มหน่วยบริการไม่ถูกต้อง");
  Object.assign(
    next,
    mergeState(current, project(next, { role: "coord", name: "Migration" }), {
      role: "coord",
      name: "Migration",
    }),
  );
  next.assess = clone(source.assess);
  next.defects = clone(source.defects);
  for (const [id, a] of Object.entries(next.assess)) {
    if (!ids.has(id)) fail(400, "พบผลประเมินที่ไม่มีหน่วยบริการ");
    validateAssessment(a);
    if (
      a.wf &&
      !["draft", "submitted", "returned", "reviewed"].includes(a.wf.status)
    )
      fail(400, "สถานะประเมินไม่ถูกต้อง");
  }
  const defectIds = new Set();
  for (const d of next.defects) {
    if (
      !ids.has(d.unitId) ||
      !validId(d.id) ||
      defectIds.has(d.id) ||
      !["open", "fixing", "recheck", "closed"].includes(d.status)
    )
      fail(400, "ข้อมูลข้อบกพร่องไม่ถูกต้อง");
    defectIds.add(d.id);
  }
  delete next.pins;
  next.isSample = false;
  validateContent(next.publicContent);
  return next;
}
export function references(state) {
  return Object.entries(state.assess).flatMap(([unitId, a]) =>
    [
      ...Object.values(a.ev || {}).flatMap((e) => e.files || []),
      ...(a.quick || []).flatMap((q) => q.files || []),
    ].map((f) => ({ ...f, unitId })),
  );
}
