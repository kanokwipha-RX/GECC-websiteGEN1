window.GECCBackup = {
  async exportBundle() {
    const data = clone(DB);
    delete data.pins;
    const references = [];
    for (const [unitId, a] of Object.entries(data.assess || {}))
      for (const f of [
        ...Object.values(a.ev || {}).flatMap((e) => e.files || []),
        ...(a.quick || []).flatMap((q) => q.files || []),
      ])
        references.push({ ...f, unitId });
    const files = [],
      missing = [],
      seen = new Set();
    toast("กำลังเตรียมข้อมูลและไฟล์แนบ…");
    for (const f of references) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const blob = await FDB.get(f.id);
      if (!blob) {
        missing.push(f.id);
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const digest = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      ]
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
      let binary = "";
      for (let i = 0; i < bytes.length; i += 32768)
        binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      files.push({
        id: f.id,
        unitId: f.unitId,
        name: f.name,
        type: blob.type || f.type,
        size: bytes.length,
        sha256: digest,
        base64: btoa(binary),
      });
    }
    const bundle = {
      format: "gecc-bundle-v1",
      exportedAt: new Date().toISOString(),
      state: data,
      files,
      missing,
    };
    await saveFile(
      "sisaket-gecc-backup-" + todayISO() + ".json",
      new Blob([JSON.stringify(bundle)], { type: "application/json" }),
    );
    toast(
      missing.length
        ? `ส่งออกข้อมูลแล้ว แต่ไม่พบไฟล์แนบ ${missing.length} ไฟล์ กรุณาตรวจสอบก่อนย้ายข้อมูล`
        : "ส่งออกข้อมูลพร้อมไฟล์แนบแล้ว",
      missing.length > 0,
    );
  },
};
