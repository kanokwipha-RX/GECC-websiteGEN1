/* ================= แดชบอร์ดผลการประเมินและความพร้อมรายหน่วยบริการ GECC 2570 (Excel Matrix & Cards) ================= */

function evaluationDashboardHTML(customInfos) {
  const units = (window.DB && window.DB.units && window.DB.units.length) ? window.DB.units : (typeof OFFICIAL_UNITS !== 'undefined' ? OFFICIAL_UNITS : []);
  const N = units.length || 34;
  const teams = (window.DB && window.DB.teams && window.DB.teams.length) ? window.DB.teams : (typeof defaultTeams === 'function' ? defaultTeams() : []);
  const lastUpd = (units || []).map(u => window.DB?.assess?.[u.id]?.updatedAt).filter(Boolean).sort().pop();
  const mode = S.evalMode || 'mentor';
  const filter = S.evalFilter || 'all';
  const evalView = S.evalView || 'excel';

  const unitList = units.map(u => {
    const a = window.DB?.assess?.[u.id];
    const pu = window.GECC_PUBLIC_UNITS ? window.GECC_PUBLIC_UNITS.find(x => x.id === u.id) : null;
    const sub = typeof subOf === 'function' && a ? subOf(a) : { phys: 'none', qual: 'none', out: 'none' };
    const complete = sub.phys === 'done' && sub.qual === 'done' && sub.out === 'done';
    const c = complete && typeof calc === 'function' ? calc(a) : null;
    const defs = (window.DB?.defects || []).filter(d => d.unitId === u.id && d.status !== 'closed');
    const readySt = typeof readyOf === 'function' && a ? readyOf(a).st : 'none';

    // 1. ตรวจสอบข้อมูลด้านกายภาพ (ทั้งจากการตรวจของ MENTOR และการแนบหลักฐานของหน่วยบริการ)
    let physEvKeys = [];
    if (a && a.ev) {
      physEvKeys = Object.keys(a.ev).filter(k => k.startsWith('phys:') && (a.ev[k]?.files?.length > 0 || a.ev[k]?.text));
    }
    let physEvCount = physEvKeys.length;

    let quickPhysFiles = 0;
    let quickPhysHas14 = false;
    if (a && Array.isArray(a.quick)) {
      a.quick.filter(q => q.topic === 'phys').forEach(q => {
        const files = q.files || [];
        quickPhysFiles += files.length || 1;
        files.forEach(f => {
          const fn = f.name || '';
          if (fn.includes('14 ข้อ') || fn.includes('14ข้อ')) quickPhysHas14 = true;
        });
      });
    }

    let mentorPhysCount = (a && a.phys && Array.isArray(a.phys)) ? a.phys.filter(v => v === true).length : 0;
    if (pu && pu.physical && Array.isArray(pu.physical)) {
      mentorPhysCount = Math.max(mentorPhysCount, pu.physical.filter(v => v === true).length);
    }

    let physCount = Math.max(mentorPhysCount, physEvCount);
    if (quickPhysHas14) {
      physCount = Math.max(physCount, 14);
    } else if (quickPhysFiles > 0 && physCount === 0) {
      physCount = Math.min(15, quickPhysFiles);
    }
    if (pu && typeof pu.physCount === 'number') {
      physCount = Math.max(physCount, pu.physCount);
    }

    const wfStatus = a?.wf?.status || pu?.workflow || pu?.criteria?.wfStatus || 'draft';
    if ((wfStatus === 'submitted' || wfStatus === 'reviewed') && physCount === 0 && (physEvCount > 0 || quickPhysFiles > 0)) {
      physCount = 14;
    }

    let physSt = (physCount >= 15 || sub.phys === 'done' || pu?.criteria?.phys === 'done') ? 'physfull' : (physCount > 0 || pu?.criteria?.phys === 'prog' ? 'physpart' : 'physnone');

    // 2.1 ด้านคุณภาพ: Checklist 20 ข้อ
    let qcEvCount = a?.ev ? Object.keys(a.ev).filter(k => k.startsWith('qc:') && (a.ev[k]?.files?.length > 0 || a.ev[k]?.text)).length : 0;
    let quickQcFiles = 0;
    if (a && Array.isArray(a.quick)) {
      a.quick.filter(q => q.topic === 'qc' || q.topic === 'qual').forEach(q => {
        quickQcFiles += (q.files?.length || 1);
      });
    }
    let mentorQcDone = (a && a.qc && Array.isArray(a.qc)) ? a.qc.filter(x => (x.subs && x.subs.some(Boolean)) || (x.score !== null && x.score !== '')).length : 0;
    let qcSt = sub.qc || 'none';
    if (pu?.criteria?.qc === 'done' || mentorQcDone >= 10 || qcEvCount >= 10 || quickQcFiles >= 5) {
      qcSt = 'done';
    } else if (pu?.criteria?.qc === 'prog' || mentorQcDone > 0 || qcEvCount > 0 || quickQcFiles > 0) {
      if (qcSt === 'none') qcSt = 'prog';
    }

    // 2.2 ด้านคุณภาพ: บรรยาย 10 ข้อ
    let narrEvCount = a?.ev ? Object.keys(a.ev).filter(k => k.startsWith('narr:') && (a.ev[k]?.files?.length > 0 || a.ev[k]?.text)).length : 0;
    let quickNarrFiles = 0;
    if (a && Array.isArray(a.quick)) {
      a.quick.filter(q => q.topic === 'narr').forEach(q => {
        quickNarrFiles += (q.files?.length || 1);
      });
    }
    let mentorNarrDone = (a && a.narr && Array.isArray(a.narr)) ? a.narr.filter(n => n.score !== null && n.score !== '').length : 0;
    let narrSt = sub.narr || 'none';
    if (pu?.criteria?.narr === 'done' || mentorNarrDone >= 10 || narrEvCount >= 10 || quickNarrFiles >= 5) {
      narrSt = 'done';
    } else if (pu?.criteria?.narr === 'prog' || mentorNarrDone > 0 || narrEvCount > 0 || quickNarrFiles > 0) {
      if (narrSt === 'none') narrSt = 'prog';
    }

    // รวมด้านคุณภาพเดิม
    let qualSt = (qcSt === 'done' && narrSt === 'done') ? 'done' : (qcSt !== 'none' || narrSt !== 'none' ? 'prog' : 'none');
    if (pu?.criteria?.qual === 'done' || (qcEvCount + narrEvCount) >= 20 || (quickQcFiles + quickNarrFiles) >= 10) {
      qualSt = 'done';
    }

    // 3. ด้านผลลัพธ์
    let outEvCount = a?.ev ? Object.keys(a.ev).filter(k => k.startsWith('out:') && (a.ev[k]?.files?.length > 0 || a.ev[k]?.text)).length : 0;
    let quickOutFiles = 0;
    if (a && Array.isArray(a.quick)) {
      a.quick.filter(q => q.topic === 'out').forEach(q => {
        quickOutFiles += (q.files?.length || 1);
      });
    }
    let outSt = sub.out || 'none';
    if (pu?.criteria?.out === 'done' || outEvCount >= 3 || quickOutFiles >= 3) {
      outSt = 'done';
    } else if (pu?.criteria?.out === 'prog' || outEvCount > 0 || quickOutFiles > 0) {
      if (outSt === 'none') outSt = 'prog';
    }

    // 4. แบบประเมินความพร้อม
    let rdySt = readySt === 'ready' ? 'ready' : (readySt === 'draft' ? 'draft' : 'notready');
    if (pu && pu.readiness) {
      rdySt = pu.readiness === 'ready' ? 'ready' : (pu.readiness === 'draft' ? 'draft' : 'notready');
    }
    if (rdySt !== 'ready' && (a?.ev?.['ready:0']?.files?.length || (a?.quick || []).some(q => q.topic === 'ready'))) {
      rdySt = 'ready';
    }

    // 5. สถานะผลตรวจ MENTOR
    let mentorSt = 'none';
    if (wfStatus === 'submitted') {
      mentorSt = 'submitted';
    } else if (wfStatus === 'returned') {
      mentorSt = 'returned';
    } else if (wfStatus === 'reviewed') {
      if (complete && c) {
        if (!c.physComplete || c.total < 240) mentorSt = 'risk';
        else if (defs.length > 0) mentorSt = 'fix';
        else mentorSt = 'pass';
      } else {
        mentorSt = 'reviewed';
      }
    } else if (complete && c) {
      if (!c.physComplete || c.total < 240) mentorSt = 'risk';
      else if (defs.length > 0) mentorSt = 'fix';
      else mentorSt = 'pass';
    } else if (physCount > 0 || qualSt !== 'none' || outSt !== 'none' || rdySt === 'ready') {
      mentorSt = 'draft';
    }

    let subSt = (physSt === 'physfull' && qualSt === 'done' && outSt === 'done') ? 'subdone' : (physCount > 0 || qualSt !== 'none' || outSt !== 'none' || wfStatus === 'submitted' ? 'subprog' : 'subnone');

    let curSt = mentorSt;
    if (mode === 'sub') curSt = subSt;
    else if (mode === 'phys') curSt = physSt;
    else if (mode === 'ready') curSt = rdySt;

    return {
      u,
      id: u.id,
      team: u.team,
      num: (typeof TRACKING_NUMS !== 'undefined' && TRACKING_NUMS[u.id]) ? TRACKING_NUMS[u.id] : (u.code ? u.code.slice(-2) : '00'),
      sName: (typeof TRACKING_SHORT_NAMES !== 'undefined' && TRACKING_SHORT_NAMES[u.id]) ? TRACKING_SHORT_NAMES[u.id] : u.name,
      mentorSt,
      subSt,
      physSt,
      physCount,
      qcSt,
      narrSt,
      qualSt,
      outSt,
      rdySt,
      curSt,
      wfStatus
    };
  });

  const passCount = unitList.filter(x => x.mentorSt === 'pass' || x.mentorSt === 'reviewed').length;
  const submittedCount = unitList.filter(x => x.mentorSt === 'submitted').length;
  const fixCount = unitList.filter(x => x.mentorSt === 'fix' || x.mentorSt === 'returned').length;
  const riskCount = unitList.filter(x => x.mentorSt === 'risk').length;
  const pendingCount = unitList.filter(x => x.mentorSt === 'none' || x.mentorSt === 'draft').length;

  const subDoneCount = unitList.filter(x => x.subSt === 'subdone').length;
  const subProgCount = unitList.filter(x => x.subSt === 'subprog').length;
  const subNoneCount = unitList.filter(x => x.subSt === 'subnone').length;

  const physFullCount = unitList.filter(x => x.physSt === 'physfull' || x.physCount === 15).length;
  const physPartCount = unitList.filter(x => x.physSt === 'physpart' && x.physCount < 15).length;
  const physNoneCount = unitList.filter(x => x.physSt === 'physnone' && x.physCount === 0).length;

  const rdyDoneCount = unitList.filter(x => x.rdySt === 'ready').length;
  const rdyNoneCount = unitList.filter(x => x.rdySt === 'notready' || x.rdySt === 'none').length;

  const qualDoneTotal = unitList.filter(x => x.qualSt === 'done').length;
  const qcDoneTotal = unitList.filter(x => x.qcSt === 'done').length;
  const narrDoneTotal = unitList.filter(x => x.narrSt === 'done').length;
  const outDoneTotal = unitList.filter(x => x.outSt === 'done').length;

  const renderPhysCell = (x) => {
    if (x.physSt === 'physfull' || x.physCount === 15) {
      return `<div class="eval-chk-box"><span class="eval-chk-icon done" title="ด้านกายภาพส่งครบ 15 ข้อ">✔</span><span class="eval-chk-txt done">ครบ 15 ข้อ</span></div>`;
    }
    if (x.physCount > 0 || x.physSt === 'physpart') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon prog" title="ส่งแล้ว ${x.physCount}/15 ข้อ">${x.physCount}/15</span><span class="eval-chk-txt prog">${x.physCount}/15 ข้อ</span></div>`;
    }
    return `<div class="eval-chk-box"><span class="eval-chk-icon none" title="ยังไม่ส่ง">—</span><span class="eval-chk-txt none">ยังไม่ส่ง</span></div>`;
  };

  const renderQcCell = (x) => {
    if (x.qcSt === 'done') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon done" title="ด้านคุณภาพ (Checklist 20 ข้อ) ส่งครบแล้ว">✔</span><span class="eval-chk-txt done">ส่งครบ</span></div>`;
    }
    if (x.qcSt === 'prog') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon prog" title="ส่งหลักฐาน Checklist แล้วบางส่วน">➔</span><span class="eval-chk-txt prog">ส่งบางส่วน</span></div>`;
    }
    return `<div class="eval-chk-box"><span class="eval-chk-icon none" title="ยังไม่ส่ง">—</span><span class="eval-chk-txt none">ยังไม่ส่ง</span></div>`;
  };

  const renderNarrCell = (x) => {
    if (x.narrSt === 'done') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon done" title="ด้านคุณภาพ (บรรยาย 10 ข้อ) ส่งครบแล้ว">✔</span><span class="eval-chk-txt done">ส่งครบ</span></div>`;
    }
    if (x.narrSt === 'prog') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon prog" title="ส่งเนื้อหาบรรยายแล้วบางส่วน">➔</span><span class="eval-chk-txt prog">ส่งบางส่วน</span></div>`;
    }
    return `<div class="eval-chk-box"><span class="eval-chk-icon none" title="ยังไม่ส่ง">—</span><span class="eval-chk-txt none">ยังไม่ส่ง</span></div>`;
  };

  const renderQualCell = (x) => {
    if (x.qualSt === 'done') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon done" title="ด้านคุณภาพส่งครบแล้ว">✔</span><span class="eval-chk-txt done">ส่งครบ</span></div>`;
    }
    if (x.qualSt === 'prog') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon prog" title="ส่งหลักฐานแล้วบางส่วน">➔</span><span class="eval-chk-txt prog">ส่งบางส่วน</span></div>`;
    }
    return `<div class="eval-chk-box"><span class="eval-chk-icon none" title="ยังไม่ส่ง">—</span><span class="eval-chk-txt none">ยังไม่ส่ง</span></div>`;
  };

  const renderOutCell = (x) => {
    if (x.outSt === 'done') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon done" title="ด้านผลลัพธ์ส่งครบแล้ว">✔</span><span class="eval-chk-txt done">ส่งครบ</span></div>`;
    }
    if (x.outSt === 'prog') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon prog" title="ส่งหลักฐานแล้วบางส่วน">➔</span><span class="eval-chk-txt prog">ส่งบางส่วน</span></div>`;
    }
    return `<div class="eval-chk-box"><span class="eval-chk-icon none" title="ยังไม่ส่ง">—</span><span class="eval-chk-txt none">ยังไม่ส่ง</span></div>`;
  };

  const renderReadyCell = (x) => {
    if (x.rdySt === 'ready') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon done" title="แบบประเมินความพร้อมเรียบร้อย">✔</span><span class="eval-chk-txt done">พร้อม</span></div>`;
    }
    if (x.rdySt === 'draft') {
      return `<div class="eval-chk-box"><span class="eval-chk-icon prog" title="ฉบับร่าง">➔</span><span class="eval-chk-txt prog">ฉบับร่าง</span></div>`;
    }
    return `<div class="eval-chk-box"><span class="eval-chk-icon none" title="ยังไม่ส่ง">—</span><span class="eval-chk-txt none">ยังไม่ส่ง</span></div>`;
  };

  const renderMentorCell = (st) => {
    if (st === 'pass') {
      return `<span class="eval-pill st-pass"><span class="eval-chk-icon done-xs">✔</span> ผ่านเกณฑ์</span>`;
    }
    if (st === 'reviewed') {
      return `<span class="eval-pill st-pass"><span class="eval-chk-icon done-xs">✔</span> MENTOR ตรวจแล้ว</span>`;
    }
    if (st === 'submitted') {
      return `<span class="eval-pill st-wait" title="หน่วยบริการยืนยันส่งข้อมูลแล้ว อยู่ในคิวรอ MENTOR ตรวจ"><span class="eval-chk-icon prog-xs" style="background:#2563EB">📩</span> รอ MENTOR ตรวจ</span>`;
    }
    if (st === 'returned') {
      return `<span class="eval-pill st-fix"><span class="eval-chk-icon prog-xs" style="background:#D97706">⚠️</span> ส่งกลับแก้ไข</span>`;
    }
    if (st === 'fix') {
      return `<span class="eval-pill st-fix"><span class="eval-chk-icon prog-xs" style="background:#D97706">⚠️</span> ต้องแก้ไข</span>`;
    }
    if (st === 'risk') {
      return `<span class="eval-pill st-risk"><span class="eval-chk-icon prog-xs" style="background:#DC2626">❌</span> เสี่ยงไม่ผ่าน</span>`;
    }
    if (st === 'draft') {
      return `<span class="eval-pill st-none"><span class="eval-chk-icon none-xs">⏱️</span> ยังส่งไม่ครบ</span>`;
    }
    return `<span class="eval-pill st-none"><span class="eval-chk-icon none-xs">—</span> ยังไม่ส่ง</span>`;
  };

  // ================= มุมมองแบบตาราง Excel (Excel Grid Matrix) =================
  let contentHTML = '';
  if (evalView === 'excel') {
    contentHTML = `
      <!-- แถบเครื่องมือค้นหาและเลือกกลุ่มสไตล์ Excel -->
      <div class="eval-excel-toolbar">
        <div class="eval-excel-filter-wrap">
          <label for="eval-excel-team" class="sr-only">เลือกกลุ่ม MENTOR</label>
          <select id="eval-excel-team" onchange="window.filterEvalExcel()" class="eval-excel-select">
            <option value="all">🏢 แสดงทั้งหมด 6 กลุ่ม (${N} แห่ง)</option>
            ${teams.map(t => `<option value="${t.id}">กลุ่ม ${t.id}: ${esc(t.name)}</option>`).join('')}
          </select>

          <label for="eval-excel-q" class="sr-only">ค้นหาชื่อหน่วยงาน</label>
          <input type="text" id="eval-excel-q" placeholder="🔍 ค้นหาชื่อหน่วยงาน หรือรหัส..." oninput="window.filterEvalExcel()" class="eval-excel-input">

          <span id="eval-excel-count" class="eval-excel-count">แสดง ${N} จาก ${N} แห่ง</span>
        </div>

        <div class="eval-excel-legend">
          <span class="eval-legend-item"><span class="eval-chk-icon done-xs">✔</span> ส่งครบ / เสร็จขั้นตอน</span>
          <span class="eval-legend-item"><span class="eval-chk-icon prog-xs">14</span> ส่งบางส่วน (ระบุข้อ)</span>
          <span class="eval-legend-item"><span class="eval-chk-icon prog-xs" style="background:#2563EB">📩</span> รอ MENTOR ตรวจ</span>
          <span class="eval-legend-item"><span class="eval-chk-icon none-xs">—</span> ยังไม่ส่ง</span>
        </div>
      </div>

      <!-- ตารางเช็คลิสต์หลัก (Excel Matrix Table) -->
      <div class="eval-excel-wrap">
        <table class="eval-excel-table" id="eval-excel-table">
          <thead>
            <tr>
              <th style="width: 55px;">รหัส</th>
              <th class="th-unit" style="min-width: 240px;">ชื่อหน่วยบริการ</th>
              <th class="th-crit" style="width: 135px;">
                <div>🏢 1. ด้านกายภาพ</div>
                <small>Checklist 15 ข้อ</small>
              </th>
              <th class="th-crit" style="width: 130px;">
                <div>📋 2.1 ด้านคุณภาพ</div>
                <small>Checklist 20 ข้อ</small>
              </th>
              <th class="th-crit" style="width: 130px;">
                <div>✍️ 2.2 ด้านคุณภาพ</div>
                <small>บรรยาย 10 ข้อ</small>
              </th>
              <th class="th-crit" style="width: 130px;">
                <div>📈 3. ด้านผลลัพธ์</div>
                <small>3 ด้าน (100 คะแนน)</small>
              </th>
              <th class="th-crit" style="width: 135px;">
                <div>🛡️ 4. แบบประเมิน</div>
                <small>ความพร้อม GECC</small>
              </th>
              <th class="th-crit" style="width: 145px;">
                <div>🏆 5. ผลตรวจ MENTOR</div>
                <small>สถานะการประเมิน</small>
              </th>
            </tr>
          </thead>
          <tbody id="eval-excel-tbody">
            ${teams.map(t => {
              const tUnits = unitList.filter(x => x.team === t.id).sort((a, b) => (parseInt(a.num, 10) || 0) - (parseInt(b.num, 10) || 0));
              let grpHeader = `
                <tr class="eval-excel-grp-row" data-team="${t.id}">
                  <td colspan="8">
                    🏛️ กลุ่มที่ ${t.id}: ${esc(t.name)} (${tUnits.length} แห่ง)
                  </td>
                </tr>
              `;
              let rows = tUnits.map(x => `
                <tr class="eval-excel-row" data-team="${x.team}" data-name="${esc(x.u.name)} ${esc(x.sName)}" data-num="${x.num}">
                  <td class="eval-td-num">
                    <span class="eval-num-pill ${x.physCount > 0 || x.qcSt !== 'none' || x.narrSt !== 'none' || x.outSt !== 'none' || x.rdySt === 'ready' ? 'active' : ''}">${x.num}</span>
                  </td>
                  <td class="eval-td-unit">
                    <button type="button" class="eval-unit-btn" data-act="eval-unit" data-id="${x.id}" title="คลิกเพื่อดูรายละเอียด / ข้อมูลประเมิน">
                      <b>${esc(x.sName)}</b>
                      <span class="eval-unit-sub">${esc(x.u.name)}</span>
                    </button>
                  </td>
                  <td class="eval-td-chk">
                    ${renderPhysCell(x)}
                  </td>
                  <td class="eval-td-chk">
                    ${renderQcCell(x)}
                  </td>
                  <td class="eval-td-chk">
                    ${renderNarrCell(x)}
                  </td>
                  <td class="eval-td-chk">
                    ${renderOutCell(x)}
                  </td>
                  <td class="eval-td-chk">
                    ${renderReadyCell(x)}
                  </td>
                  <td class="eval-td-chk">
                    ${renderMentorCell(x.mentorSt)}
                  </td>
                </tr>
              `).join('');
              return grpHeader + rows;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2" class="total-label">รวมหน่วยบริการที่ส่งข้อมูลครบแล้ว:</td>
              <td>
                <b>${physFullCount} / ${N} แห่ง</b>
                <small style="display:block;font-size:10.5px;color:#047857;font-weight:600;">(ร้อยละ ${Math.round(physFullCount/N*100)})</small>
              </td>
              <td>
                <b>${qcDoneTotal} / ${N} แห่ง</b>
                <small style="display:block;font-size:10.5px;color:#047857;font-weight:600;">(ร้อยละ ${Math.round(qcDoneTotal/N*100)})</small>
              </td>
              <td>
                <b>${narrDoneTotal} / ${N} แห่ง</b>
                <small style="display:block;font-size:10.5px;color:#047857;font-weight:600;">(ร้อยละ ${Math.round(narrDoneTotal/N*100)})</small>
              </td>
              <td>
                <b>${outDoneTotal} / ${N} แห่ง</b>
                <small style="display:block;font-size:10.5px;color:#047857;font-weight:600;">(ร้อยละ ${Math.round(outDoneTotal/N*100)})</small>
              </td>
              <td>
                <b>${rdyDoneCount} / ${N} แห่ง</b>
                <small style="display:block;font-size:10.5px;color:#047857;font-weight:600;">(ร้อยละ ${Math.round(rdyDoneCount/N*100)})</small>
              </td>
              <td>
                <b>ผ่าน ${passCount} แห่ง</b>
                ${submittedCount > 0 ? `<small style="display:block;font-size:10.5px;color:#2563EB;font-weight:600;">(รอตรวจ ${submittedCount} แห่ง)</small>` : ''}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  } else {
    // ================= มุมมองแบบการ์ดเดิม (Cards View) =================
    let tabsHTML = '';
    if (mode === 'mentor') {
      tabsHTML = `
        <button type="button" class="eval-stat-tab st-pass ${filter === 'pass' ? 'active' : ''}" data-act="eval-filter" data-f="pass" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ผ่านเกณฑ์">
          <span class="eval-u-badge st-pass">✔</span>
          <span>ผ่านเกณฑ์ ${passCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-fix ${filter === 'fix' ? 'active' : ''}" data-act="eval-filter" data-f="fix" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ต้องแก้ไข">
          <span class="eval-u-badge st-fix">⚠️</span>
          <span>ต้องแก้ไข ${fixCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-risk ${filter === 'risk' ? 'active' : ''}" data-act="eval-filter" data-f="risk" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่เสี่ยงไม่ผ่าน">
          <span class="eval-u-badge st-risk">❌</span>
          <span>เสี่ยงไม่ผ่าน ${riskCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-none ${filter === 'none' ? 'active' : ''}" data-act="eval-filter" data-f="none" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ยังส่งไม่ครบ">
          <span class="eval-u-badge st-none">⏱️</span>
          <span>ยังส่งไม่ครบ ${pendingCount} แห่ง</span>
        </button>
      `;
    } else if (mode === 'sub') {
      tabsHTML = `
        <button type="button" class="eval-stat-tab st-subdone ${filter === 'subdone' ? 'active' : ''}" data-act="eval-filter" data-f="subdone" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ส่งครบ 3 ด้าน">
          <span class="eval-u-badge st-subdone">✔</span>
          <span>ส่งครบ 3 ด้าน ${subDoneCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-subprog ${filter === 'subprog' ? 'active' : ''}" data-act="eval-filter" data-f="subprog" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่อยู่ระหว่างดำเนินการ">
          <span class="eval-u-badge st-subprog">➔</span>
          <span>ระหว่างดำเนินการ ${subProgCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-subnone ${filter === 'subnone' ? 'active' : ''}" data-act="eval-filter" data-f="subnone" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ยังไม่ส่ง">
          <span class="eval-u-badge st-subnone">➖</span>
          <span>ไม่ส่ง ต้องติดตาม ${subNoneCount} แห่ง</span>
        </button>
      `;
    } else if (mode === 'phys') {
      tabsHTML = `
        <button type="button" class="eval-stat-tab st-physfull ${filter === 'physfull' ? 'active' : ''}" data-act="eval-filter" data-f="physfull" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ครบ 15 ข้อ">
          <span class="eval-u-badge st-physfull">✔</span>
          <span>ครบ 15 ข้อ ${physFullCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-physpart ${filter === 'physpart' ? 'active' : ''}" data-act="eval-filter" data-f="physpart" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ยังไม่ครบ 15 ข้อ">
          <span class="eval-u-badge st-physpart">➔</span>
          <span>ยังไม่ครบ 1-14 ข้อ ${physPartCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-physnone ${filter === 'physnone' ? 'active' : ''}" data-act="eval-filter" data-f="physnone" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ยังไม่ส่งเกณฑ์กายภาพ">
          <span class="eval-u-badge st-physnone">➖</span>
          <span>ยังไม่ส่ง ${physNoneCount} แห่ง</span>
        </button>
      `;
    } else {
      tabsHTML = `
        <button type="button" class="eval-stat-tab st-ready ${filter === 'ready' ? 'active' : ''}" data-act="eval-filter" data-f="ready" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่มีความพร้อม">
          <span class="eval-u-badge st-ready">✔</span>
          <span>มีความพร้อม ${rdyDoneCount} แห่ง</span>
        </button>
        <button type="button" class="eval-stat-tab st-notready ${filter === 'notready' ? 'active' : ''}" data-act="eval-filter" data-f="notready" title="คลิกเพื่อกรองเฉพาะหน่วยงานที่ยังไม่พร้อม">
          <span class="eval-u-badge st-notready">➖</span>
          <span>ยังไม่พร้อม / รอประเมิน ${rdyNoneCount} แห่ง</span>
        </button>
      `;
    }

    contentHTML = `
      <!-- เมนูเลือกโหมดตามแดชบอร์ดหลัก 4 หัวข้อ -->
      <div class="eval-mode-nav" role="tablist" aria-label="เลือกหัวข้อแดชบอร์ดที่ต้องการดูรายชื่อ">
        <button type="button" class="eval-mode-btn ${mode === 'mentor' ? 'active' : ''}" data-act="eval-mode" data-m="mentor">
          ${ic('award')} 1. ผลตรวจ MENTOR (4 สถานะ)
        </button>
        <button type="button" class="eval-mode-btn ${mode === 'sub' ? 'active' : ''}" data-act="eval-mode" data-m="sub">
          ${ic('clipboard')} 2. ความพร้อมเกณฑ์ 3 ด้าน
        </button>
        <button type="button" class="eval-mode-btn ${mode === 'phys' ? 'active' : ''}" data-act="eval-mode" data-m="phys">
          ${ic('check')} 3. ด้านกายภาพ 15 ข้อ
        </button>
        <button type="button" class="eval-mode-btn ${mode === 'ready' ? 'active' : ''}" data-act="eval-mode" data-m="ready">
          ${ic('shield')} 4. แบบประเมินความพร้อม
        </button>
      </div>

      <!-- แถบแสดงจำนวนและตัวกรองสถานะ -->
      <div class="trk-flt-controls">
        <div class="trk-flt-hint">คลิกแถบสถานะด้านบนเพื่อกรองรายชื่อ หรือคลิกที่ชื่อหน่วยงานเพื่อดูรายละเอียดผลการตรวจ</div>
        <button type="button" class="trk-all-btn ${filter === 'all' ? 'active' : ''}" data-act="eval-filter" data-f="all">แสดงทั้งหมด (${N} แห่ง)</button>
      </div>

      <div class="eval-status-grid">
        ${tabsHTML}
      </div>

      <!-- ตาราง 6 กลุ่ม แสดงชื่อทุกหน่วยงานตามสีสถานะของโหมดที่เลือก -->
      <div class="trk-groups-grid">
        ${teams.map(t => {
          const tUnits = unitList.filter(x => x.team === t.id).sort((a, b) => (parseInt(a.num, 10) || 0) - (parseInt(b.num, 10) || 0));
          const tGood = tUnits.filter(x => {
            if (mode === 'mentor') return x.mentorSt === 'pass';
            if (mode === 'sub') return x.subSt === 'subdone';
            if (mode === 'phys') return x.physSt === 'physfull';
            return x.rdySt === 'ready';
          }).length;
          const subLabel = mode === 'mentor'
            ? `ผ่านเกณฑ์ ${tGood}/${tUnits.length}`
            : (mode === 'sub'
              ? `ส่งครบ 3 ด้าน ${tGood}/${tUnits.length}`
              : (mode === 'phys'
                ? `ครบ 15 ข้อ ${tGood}/${tUnits.length}`
                : `พร้อม ${tGood}/${tUnits.length}`));
          return `
          <div class="trk-group-box">
            <div class="trk-group-header">
              <div class="trk-group-title">กลุ่ม ${t.id} ${esc(t.name)}</div>
              <div class="trk-group-sent">${subLabel}</div>
            </div>
            <div class="trk-group-body">
              ${tUnits.map(x => {
                let ico = '⏱️';
                if (mode === 'mentor') {
                  ico = x.mentorSt === 'pass' ? '✔' : (x.mentorSt === 'fix' ? '⚠️' : (x.mentorSt === 'risk' ? '❌' : '⏱️'));
                } else if (mode === 'sub') {
                  ico = x.subSt === 'subdone' ? '✔' : (x.subSt === 'subprog' ? '➔' : '➖');
                } else if (mode === 'phys') {
                  ico = x.physSt === 'physfull' ? '✔' : (x.physSt === 'physpart' ? '➔' : '➖');
                } else {
                  ico = x.rdySt === 'ready' ? '✔' : '➖';
                }
                const isVisible = filter === 'all' || x.curSt === filter;
                const physNote = (mode === 'phys' && x.physCount > 0) ? ` <small style="font-weight:600;opacity:0.85">(${x.physCount}/15)</small>` : '';
                return `
                <button type="button" class="eval-u-item st-${x.curSt}" data-act="eval-unit" data-id="${x.id}" data-st="${x.curSt}" style="${isVisible ? '' : 'display:none'}" title="${esc(x.u.name)}">
                  <span class="eval-u-badge st-${x.curSt}">${ico}</span>
                  <span class="eval-u-text"><b>${x.num}</b> ${esc(x.sName)}${physNote}</span>
                </button>
                `;
              }).join('')}
            </div>
          </div>
          `;
        }).join('')}
      </div>
    `;
  }

  return `
  <section class="eval-board-section" id="evaluation-dashboard" aria-label="สถานะผลการประเมินและความพร้อมรายหน่วยบริการ">
    <!-- Header Bar สไตล์ Navy-Gold -->
    <div class="eval-hdr-bar">
      <div class="trk-hdr-brand">
        <div class="trk-seals">
          <img src="${IMG.prov}" alt="ตราประจำจังหวัดศรีสะเกษ">
          <img src="${IMG.gecc}" alt="ตราศูนย์ราชการสะดวก">
        </div>
        <div class="trk-hdr-title">
          <h2>สถานะผลการประเมินและความพร้อมรายหน่วยบริการ (34 แห่ง)</h2>
          <p>ตารางเช็คลิสต์กำกับติดตาม (Excel Grid Matrix) แยกเกณฑ์ 3 ด้าน และผลการตรวจประเมิน · ข้อมูล ณ ${lastUpd ? thDateTime(lastUpd) : thDate(todayISO(), true)}</p>
        </div>
      </div>
      <div class="trk-badge-gold">${ic('clipboard')} ตารางเช็คลิสต์สไตล์ Excel</div>
    </div>

    <!-- แถบสรุปภาพรวมแยกเกณฑ์ (Summary KPI Ribbon) -->
    <div class="eval-summary-ribbon">
      <div class="eval-ribbon-card">
        <div class="eval-ribbon-icon phys">🏢</div>
        <div class="eval-ribbon-body">
          <div class="eval-ribbon-title">1. ด้านกายภาพ</div>
          <div class="eval-ribbon-val">${physFullCount} <span class="eval-ribbon-sub">/ ${N} แห่ง</span></div>
          ${physPartCount > 0 ? `<div style="font-size:11.5px;color:#D97706;font-weight:600;margin-top:2px;">ส่ง 1-14 ข้อ ${physPartCount} แห่ง</div>` : ''}
        </div>
      </div>
      <div class="eval-ribbon-card">
        <div class="eval-ribbon-icon qual">📋</div>
        <div class="eval-ribbon-body">
          <div class="eval-ribbon-title">2.1 คุณภาพ Checklist</div>
          <div class="eval-ribbon-val">${qcDoneTotal} <span class="eval-ribbon-sub">/ ${N} แห่ง</span></div>
        </div>
      </div>
      <div class="eval-ribbon-card">
        <div class="eval-ribbon-icon narr">✍️</div>
        <div class="eval-ribbon-body">
          <div class="eval-ribbon-title">2.2 คุณภาพ บรรยาย</div>
          <div class="eval-ribbon-val">${narrDoneTotal} <span class="eval-ribbon-sub">/ ${N} แห่ง</span></div>
        </div>
      </div>
      <div class="eval-ribbon-card">
        <div class="eval-ribbon-icon out">📈</div>
        <div class="eval-ribbon-body">
          <div class="eval-ribbon-title">3. ด้านผลลัพธ์</div>
          <div class="eval-ribbon-val">${outDoneTotal} <span class="eval-ribbon-sub">/ ${N} แห่ง</span></div>
        </div>
      </div>
      <div class="eval-ribbon-card">
        <div class="eval-ribbon-icon rdy">🛡️</div>
        <div class="eval-ribbon-body">
          <div class="eval-ribbon-title">4. ความพร้อม GECC</div>
          <div class="eval-ribbon-val">${rdyDoneCount} <span class="eval-ribbon-sub">/ ${N} แห่ง</span></div>
        </div>
      </div>
      <div class="eval-ribbon-card">
        <div class="eval-ribbon-icon mnt">🏆</div>
        <div class="eval-ribbon-body">
          <div class="eval-ribbon-title">5. ผ่านเกณฑ์ MENTOR</div>
          <div class="eval-ribbon-val">${passCount} <span class="eval-ribbon-sub">/ ${N} แห่ง</span></div>
          ${submittedCount > 0 ? `<div style="font-size:11.5px;color:#2563EB;font-weight:600;margin-top:2px;">รอตรวจ ${submittedCount} แห่ง</div>` : ''}
        </div>
      </div>
    </div>

    <!-- ปุ่มสลับมุมมองระหว่างตาราง Excel Matrix และกล่องรายกลุ่ม -->
    <div class="eval-view-nav" role="tablist" aria-label="เลือกรูปแบบการแสดงผล">
      <button type="button" class="eval-view-btn ${evalView === 'excel' ? 'active' : ''}" data-act="eval-view" data-v="excel">
        ${ic('clipboard')} ตารางเช็คลิสต์ (Excel Grid Matrix)
      </button>
      <button type="button" class="eval-view-btn ${evalView === 'cards' ? 'active' : ''}" data-act="eval-view" data-v="cards">
        ${ic('users')} การ์ดสรุปแยกตาม 6 กลุ่ม MENTOR
      </button>
    </div>

    ${contentHTML}
  </section>
  `;
}

window.filterEvalExcel = function() {
  const teamEl = document.getElementById('eval-excel-team');
  const qEl = document.getElementById('eval-excel-q');
  const team = teamEl ? teamEl.value : 'all';
  const q = qEl ? qEl.value.toLowerCase().trim() : '';
  const rows = document.querySelectorAll('.eval-excel-row');
  let visibleCount = 0;
  rows.forEach(r => {
    const rTeam = r.getAttribute('data-team');
    const rName = (r.getAttribute('data-name') || '').toLowerCase();
    const rNum = r.getAttribute('data-num') || '';
    const matchTeam = (team === 'all' || rTeam === team);
    const matchQ = (!q || rName.includes(q) || rNum.includes(q));
    const show = matchTeam && matchQ;
    r.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });
  document.querySelectorAll('.eval-excel-grp-row').forEach(g => {
    const gTeam = g.getAttribute('data-team');
    g.style.display = (team === 'all' && !q) ? '' : 'none';
  });
  const cntEl = document.getElementById('eval-excel-count');
  if (cntEl) cntEl.textContent = 'แสดง ' + visibleCount + ' จาก 34 แห่ง';
};

window.evaluationDashboardHTML = evaluationDashboardHTML;
