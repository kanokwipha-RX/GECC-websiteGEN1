/* Optional same-origin data adapter. Static/file previews retain browser storage. */
window.GECCClient = (() => {
  let csrf = null,
    user = null,
    revision = null,
    confirmed = null,
    aggregate = null,
    busy = false,
    blocked = false;
  const server = !!window.GECC_SERVER;
  function apiUrl(path) {
    return window.GECC_API_STYLE === "php"
      ? window.GECC_BASE_PATH + "api/index.php?route=" + encodeURIComponent(path.replace(/^\/api\//, ""))
      : window.GECC_BASE_PATH + path.replace(/^\//, "");
  }
  const clean = (value) => {
    const d = clone(value);
    delete d.pins;
    delete d.demoStat;
    delete d.mentorRosterVersion;
    return d;
  };
  async function request(path, options = {}) {
    const headers = {
      ...(options.body instanceof Blob
        ? {}
        : { "Content-Type": "application/json" }),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...options.headers,
    };
    const response = await fetch(apiUrl(path), {
      credentials: "same-origin",
      ...options,
      headers,
    });
    if (!response.ok) {
      let message = response.status === 404
        ? "ยังไม่พบระบบข้อมูลกลาง กรุณาให้ผู้ดูแลตรวจสอบการเชื่อมต่อเซิร์ฟเวอร์"
        : "เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่";
      try {
        message = (await response.json()).error || message;
      } catch {}
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  function accept(result) {
    revision = result.revision;
    confirmed = clone(result.state);
    DB = { ...clone(result.state), pins: { unit: {}, team: {}, coord: "" } };
    aggregate = result.summary;
    applyContent();
  }
  function applyContent() {
    window.GECCPublic?.resetLoginOptions();
    const c = DB.publicContent;
    if (!c) return;
    if (Array.isArray(c.library))
      LIBRARY_FOLDERS.splice(0, LIBRARY_FOLDERS.length, ...c.library);
    if (c.advisor) Object.assign(COMMITTEE_ADVISOR, c.advisor);
    if (Array.isArray(c.committee))
      COMMITTEE_MEMBERS.splice(0, COMMITTEE_MEMBERS.length, ...c.committee);
    if (Array.isArray(c.duties))
      COMMITTEE_DUTIES.splice(0, COMMITTEE_DUTIES.length, ...c.duties);
  }
  function notice(message, error = false) {
    let el = document.getElementById("connection-notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "connection-notice";
      document.querySelector("#app").before(el);
    }
    el.className = "status-notice" + (error ? " error" : "");
    el.setAttribute("role", error ? "alert" : "note");
    el.replaceChildren();
    const span = document.createElement("span");
    span.textContent = message;
    el.append(span);
    if (error && server) {
      const b = document.createElement("button");
      b.className = "btn btn-sm";
      b.textContent = "โหลดข้อมูลล่าสุด";
      b.addEventListener("click", () => {
        confirmDlg(
          "โหลดข้อมูลล่าสุด?",
          "การแก้ไขในหน้าปัจจุบันจะถูกแทนที่ กรุณาส่งออกข้อมูลร่างไว้ก่อนหากต้องการเก็บไว้",
          "โหลดข้อมูล",
          async () => {
            try {
              S.draft = null;
              S.dirty = false;
              await boot();
            } catch (e) {
              report(e);
            }
          },
        );
      });
      el.append(b);
      if (S.draft) {
        const save = document.createElement("button");
        save.className = "btn btn-sm";
        save.textContent = "เก็บสำเนาข้อมูลร่าง";
        save.onclick = () =>
          saveFile(
            "gecc-unsaved-draft.json",
            new Blob(
              [JSON.stringify({ unitId: S.unitId, draft: S.draft }, null, 2)],
              { type: "application/json" },
            ),
          );
        el.append(save);
      }
    }
  }
  function report(error) {
    console.error("GECC action failed:", error.status || error.name);
    if (
      server &&
      (error.status === 409 ||
        error.status === 401 ||
        error instanceof TypeError)
    )
      blocked = true;
    notice(
      error.message || "ทำรายการไม่สำเร็จ ข้อมูลยังไม่ถูกยืนยันการบันทึก",
      true,
    );
    toast(error.message || "ทำรายการไม่สำเร็จ", true);
    if (S.draft) S.dirty = true;
  }
  function context() {
    if (!user) {
      Object.assign(S, { role: null, team: 0, coord: false, allGroups: false, accountName: null, menteeUnit: null });
      return;
    }
    Object.assign(S, {
      role: user.role === "coord" ? "mentor" : user.role,
      team: user.role === "mentor" ? user.team : 0,
      mdTeam: user.role === "mentor" ? user.team : 0,
      coord: user.role === "coord",
      allGroups: user.role === "mentor" && user.team === 0,
      accountName: user.name,
      menteeUnit: user.unitId || null,
    });
  }
  async function boot() {
    if (!server) {
      decorate();
      window.GECCMotion?.enter();
      return;
    }
    try {
      const session = await request("/api/session");
      user = session.user;
      csrf = session.csrf;
      const result = await request("/api/state");
      accept(result);
      blocked = false;
      context();
      render();
      notice(
        user
          ? "เชื่อมต่อข้อมูลกลาง · " + user.name
          : "ข้อมูลภาพรวมจังหวัด · เข้าสู่ระบบเพื่อดูรายละเอียดหน่วยบริการ",
      );
      if (user?.mustChange) passwordModal(true);
    } catch (e) {
      DB = blankDB();
      DB.units = [];
      DB.assess = {};
      DB.defects = [];
      aggregate = null;
      S.role = null;
      render();
      report(e);
    }
  }
  async function save(value) {
    if (blocked)
      throw new Error("กรุณาเก็บสำเนาร่างและโหลดข้อมูลล่าสุดก่อนบันทึก");
    if (!user) throw new Error("กรุณาเข้าสู่ระบบก่อนบันทึก");
    if (busy) throw new Error("กำลังบันทึก กรุณารอสักครู่");
    busy = true;
    try {
      const data = clean(value),
        work = [];
      for (const [id, a] of Object.entries(data.assess || {})) {
        const old = confirmed.assess[id];
        const previous = old?.wf;
        const log = a.wf?.log || [];
        const last = log.at(-1);
        if (JSON.stringify(a.wf) !== JSON.stringify(previous)) {
          if (
            last &&
            (log.length !== (previous?.log || []).length ||
              JSON.stringify(last) !== JSON.stringify(previous?.log?.at(-1)))
          ) {
            const action =
              last.status === "reopened"
                ? "reopen"
                : a.wf.status === "submitted"
                  ? "submit"
                  : a.wf.status === "reviewed"
                    ? "review"
                    : a.wf.status === "returned"
                      ? "return"
                      : null;
            if (action)
              work.push({
                id,
                action,
                note: last.note || a.wf.returnNote || "",
                sender: a.wf.sender || a.sender,
              });
          }
          if (previous) a.wf = clone(previous);
          else delete a.wf;
        }
      }
      if (data.isSample)
        throw new Error(
          "โหมดข้อมูลกลางไม่รับตัวเลขสาธิต กรุณาตรวจข้อมูลก่อนนำเข้า",
        );
      accept(
        await request("/api/state", {
          method: "PUT",
          body: JSON.stringify({ revision, state: data }),
        }),
      );
      for (const op of work)
        accept(
          await request("/api/workflow/" + encodeURIComponent(op.id), {
            method: "POST",
            body: JSON.stringify({ ...op, revision }),
          }),
        );
      storageOK = true;
      notice("บันทึกข้อมูลกลางแล้ว");
    } catch (e) {
      storageOK = false;
      throw e;
    } finally {
      busy = false;
    }
  }
  async function workflow(uid, mut, msg) {
    const inUnit = S.view === "unit" && S.unitId === uid && S.draft;
    const draft = clone(inUnit ? S.draft : DB.assess[uid] || blankAssess());
    draft.wf = draft.wf || { status: "draft", log: [], round: 0 };
    mut(draft.wf, draft);
    DB.assess[uid] = draft;
    await save(DB);
    if (inUnit) {
      S.draft = clone(DB.assess[uid]);
      S.dirty = false;
      viewUnitKeep();
    } else render();
    toast(msg);
  }
  function loginModal(kind, id, label, username) {
    S.pinPending = { kind, id };
    const unit = kind === "unit" ? DB.units.find((u) => u.id === id) : null;
    const selectedUsername = username ?? unit?.code ?? "";
    openModal(
      `<div class="modal-h"><div><h3>เข้าสู่ระบบ</h3><p>${esc(label)}</p></div><button class="btn btn-ghost btn-icon" data-act="modal-close" aria-label="ปิด">${ic("x")}</button></div><form id="server-login" class="modal-b auth-fields" novalidate><div class="field"><label for="login-name">${kind === "unit" ? "รหัสหน่วยบริการ 6 หลัก" : "ชื่อผู้ใช้รายบุคคล"}</label><input class="inp" id="login-name" name="username" autocomplete="username" ${kind === "unit" ? 'inputmode="numeric" maxlength="6"' : ""} value="${esc(selectedUsername)}" ${selectedUsername?'readonly':''} required aria-describedby="login-error"></div><div class="field"><label for="login-password">รหัสผ่าน</label><input class="inp" type="password" id="login-password" name="password" autocomplete="current-password" required maxlength="128" aria-describedby="login-error"></div><p id="login-error" class="auth-help" role="status">${selectedUsername ? "กรอกรหัสผ่านของบัญชีที่เลือก" : "ยังไม่ได้เชื่อมรายชื่อนี้กับบัญชี กรอกชื่อผู้ใช้ที่ได้รับจากผู้ประสานงาน หรือติดต่อผู้ประสานงานเพื่อตรวจสอบ"}</p><button class="btn btn-primary" type="submit">เข้าสู่ระบบ</button></form>`,
    );
    if(selectedUsername) $("#login-password")?.focus();
  }
  function invalidField(input) {
    input.closest(".field")?.classList.add("invalid");
    input.setAttribute("aria-invalid", "true");
    input.focus();
  }
  async function login() {
    const name = $("#login-name"),
      pass = $("#login-password");
    if (!name || !pass) return;
    const kind = S.pinPending?.kind;
    if (kind === "unit" && !/^\d{6}$/.test(name.value.trim())) {
      invalidField(name);
      $("#login-error").textContent = "กรอกรหัสหน่วยบริการ 6 หลัก";
      return;
    }
    const form = $("#server-login"),
      button = form.querySelector("button[type=submit]");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const result = await request("/api/session", {
        method: "POST",
        body: JSON.stringify({
          username: name.value.trim(),
          password: pass.value,
        }),
      });
      user = result.user;
      csrf = result.csrf;
      pass.value = "";
      S.pinPending = null;
      closeModal();
      S.view = "modules";
      await boot();
    } catch (e) {
      $("#login-error").textContent = e.message;
      invalidField(pass);
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  }
  async function logout(force = false) {
    if (S.dirty && !force) {
      confirmDlg(
        "ยังไม่ได้บันทึกข้อมูล",
        "หากออกจากระบบ การแก้ไขที่ยังไม่บันทึกจะหายไป",
        "ออกจากระบบโดยไม่บันทึก",
        () => logout(true),
        true,
      );
      return;
    }
    await request("/api/session", { method: "DELETE" });
    user = null;
    csrf = null;
    S.draft = null;
    S.dirty = false;
    S.view = "exec";
    await boot();
  }
  function publicPhysChart(phys) {
    const rows = phys?.bars || [];
    const n = rows.length;
    const full = phys?.full || 0;
    const part = phys?.part || 0;
    const zero = phys?.zero ?? n;
    const L = 46, R = 16, T = 34, PH = 230, slot = 40, W = Math.max(900, L + R + n * slot), BW = 24, base = T + PH, H = base + 130, OX = 96;
    const Y = (v) => base - (v / 15) * PH;
    let g = "";
    [0, 5, 10, 15].forEach((t) => {
      g += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" class="pb-gl"/><text x="${L - 10}" y="${Y(t) + 4}" class="pb-yl">${t}</text>`;
    });
    const bars = rows.map((r, i) => {
      const cx = L + slot * i + slot / 2;
      const x = cx - BW / 2;
      const h = (r.v / 15) * PH;
      const done = r.v === 15;
      const nm = typeof shortUnit === "function" ? shortUnit(r.name) : r.name;
      return `<g class="pb-b" role="button" tabindex="0" data-public-name="${esc(r.name)}" aria-label="${esc(r.name)} ดำเนินการ ${r.v} จาก 15 ข้อ"><title>${esc(r.name)} · ${r.v}/15 ข้อ</title>
        <rect x="${x}" y="${T}" width="${BW}" height="${PH}" rx="7" class="pb-tr"/>
        ${h > 0 ? `<rect x="${x}" y="${base - h}" width="${BW}" height="${h}" rx="7" fill="url(#pbNavy)"/>` : ""}
        ${done ? `<rect x="${x}" y="${base - h}" width="${BW}" height="5" rx="2.5" fill="url(#pbGold)"/>` : ""}
        ${r.v > 0 ? (h > 30 ? `<text x="${cx}" y="${base - h + 22}" class="pb-v ${done ? "gd" : ""}">${r.v}</text>` : `<text x="${cx}" y="${base - h - 7}" class="pb-v out">${r.v}</text>`) : `<text x="${cx}" y="${base - 8}" class="pb-v zero">0</text>`}
        <text transform="translate(${cx + 4},${base + 14}) rotate(-42)" class="pb-xl">${esc(nm)}</text></g>`;
    }).join("");
    return `<section class="card pbc">
      <div class="pbc-h"><div class="pbc-t"><h3>หน่วยบริการที่มีความพร้อมด้านกายภาพ 15 ข้อ <span>(MUST HAVE)</span></h3><p>จำนวนข้อที่แต่ละหน่วยบริการดำเนินการ เรียงจากมากไปน้อย · แตะแท่งเพื่อดูรายละเอียด</p></div>
        <div class="pbc-k"><span class="pk f"><b>${full}</b>ครบ 15 ข้อ</span><span class="pk p"><b>${part}</b>ยังไม่ครบ</span><span class="pk z"><b>${zero}</b>ยังไม่ส่ง</span></div></div>
      <div class="pbc-l"><span><i class="lg-n"></i>ดำเนินการ</span><span><i class="lg-g"></i>ครบ 15 ข้อ</span><span><i class="lg-t"></i>เป้า 15 ข้อ</span></div>
      <div class="pbc-w"><svg viewBox="${-OX} 0 ${W + OX} ${H}" class="pbc-s" role="img" aria-label="กราฟแท่งจำนวนเกณฑ์ด้านกายภาพที่ดำเนินการแล้วของ ${n} หน่วยบริการ">
        <defs><linearGradient id="pbNavy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2D4EAD"/><stop offset="1" stop-color="#0C1D55"/></linearGradient><linearGradient id="pbGold" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#F0DA9A"/><stop offset=".5" stop-color="#C9A24A"/><stop offset="1" stop-color="#9A7124"/></linearGradient></defs>
        ${g}${bars}</svg></div>
    </section>`;
  }

  function publicCritBoxes(N, crit) {
    const pc = (v) => fmt(N ? (v / N) * 100 : 0);
    const CB = [
      ["qc", "2.1", "เกณฑ์ 2.1 ด้านคุณภาพ: Checklist", "แบบประเมินคุณภาพการบริการ 10 ข้อ"],
      ["narr", "2.2", "เกณฑ์ 2.2 ด้านคุณภาพ: การบรรยาย", "บรรยายความโดดเด่นและความเป็นต้นแบบ 10 ข้อ"],
      ["out", "3", "เกณฑ์ 3 ด้านผลลัพธ์", "3 ด้าน · 100 คะแนน"],
    ];
    const row = (k, cls, st, icn, l, v) =>
      `<button class="mr ${cls}" data-act="crit-list" data-k="${k}" data-s="${st}" aria-label="รายชื่อหน่วยบริการ ${l} ${v} แห่ง" title="กดดูรายละเอียดรายหน่วยบริการ"><span class="mr-i">${ic(icn)}</span><span class="mr-l">${l}</span><b>${v}</b><small>${pc(v)}%</small></button>`;
    return `<div class="grid g3 crit3">${CB.map(([k, no, nm, sb]) => {
      const d = crit?.[k]?.done || 0,
        p = crit?.[k]?.prog || 0,
        n = crit?.[k]?.none ?? N;
      return `<div class="dp2 cbx"><div class="dp2-h"><span class="dp-no">${no}</span><div><h3>${nm}</h3><p>${sb}</p></div></div>
      <div class="cbx-b"><div class="dp2-k">${row(k, "g", "done", "check", "ส่งแล้ว", d)}${row(k, "o", "prog", "clock", "ระหว่างดำเนินการ", p)}${row(k, "r", "none", "alert", "ยังไม่ส่ง", n)}</div>
      <div class="stack3" style="margin-top:12px">${d ? `<span class="s3-done" style="width:${(d / N) * 100}%"></span>` : ""}${p ? `<span class="s3-prog" style="width:${(p / N) * 100}%"></span>` : ""}${n ? `<span class="s3-none" style="width:${(n / N) * 100}%"></span>` : ""}</div>
      <div class="cb-p"><span>ส่งแล้ว</span><b>${pc(d)}%</b><span class="muted">จาก ${N} หน่วยบริการ</span></div></div></div>`;
    }).join("")}</div>`;
  }

  function publicScoreStrip(scores, W = 1000) {
    W = Math.max(280, Math.round(W));
    const H = 170, x0 = 14, x1 = W - 14, dmin = 150, dmax = 300;
    const fs = W < 480 ? 12 : 13.5;
    const X = (v) => x0 + ((Math.max(dmin, Math.min(dmax, v)) - dmin) / (dmax - dmin)) * (x1 - x0);
    const bands = [
      [150, 240, "below", "ต่ำกว่าเกณฑ์"],
      [240, 260, "blue", "พื้นฐาน"],
      [260, 280, "silver", "ก้าวหน้า"],
      [280, 300, "gold", "เป็นเลิศ"],
    ];
    const pts = (scores || []).slice().sort((a, b) => a.total - b.total);
    const buckets = {};
    let dots = "";
    pts.forEach((x) => {
      const bx = Math.round(X(x.total) / 16);
      const k = (buckets[bx] = (buckets[bx] || 0) + 1);
      const cx = X(x.total) + Math.floor((k - 1) / 5) * 8;
      const cy = 112 - ((k - 1) % 5) * 16;
      dots += `<g class="dot" role="button" tabindex="0" data-public-name="${esc(x.name)}" aria-label="${esc(x.name)} ${fmt(x.total, 1)} คะแนน ${LEVEL[x.level]?.l || ''}"><title>${esc(x.name)} · ${fmt(x.total, 1)} คะแนน · ${LEVEL[x.level]?.l || ''}</title><circle cx="${cx}" cy="${cy}" r="7" class="d-${x.level}"/></g>`;
    });
    return `<div class="strip"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="การกระจายคะแนนของหน่วยบริการเทียบเกณฑ์ผ่าน 240 คะแนน">
      ${bands.map((b) => `<rect x="${X(b[0])}" y="22" width="${X(b[1]) - X(b[0])}" height="104" rx="${b[0] === 150 ? 8 : 0}" class="band-${b[2]}"/><text x="${(X(b[0]) + X(b[1])) / 2}" y="16" text-anchor="middle" class="bandl" font-size="${fs}">${b[3]}</text>`).join("")}
      <line x1="${X(240)}" x2="${X(240)}" y1="22" y2="134" class="thr"/>
      ${[150, 180, 210, 240, 260, 280, 300].map((t) => `<text x="${X(t)}" y="154" text-anchor="${t === 150 ? "start" : t === 300 ? "end" : "middle"}" class="tick" font-size="${fs}">${t}</text>`).join("")}
      <text x="${X(240) - 6}" y="40" text-anchor="end" class="thrl" font-size="${fs}">เกณฑ์ผ่าน 240</text>
      ${dots}</svg></div>
      <div class="legend"><span class="lv lv-gold"><i></i>เป็นเลิศ</span><span class="lv lv-silver"><i></i>ก้าวหน้า</span><span class="lv lv-blue"><i></i>พื้นฐาน</span><span class="lv lv-below"><i></i>ต่ำกว่า 240</span><span class="lv lv-gate"><i></i>กายภาพยังไม่ครบ 15 ข้อ</span><span>แตะจุดเพื่อดูรายละเอียดหน่วยบริการ</span></div>`;
  }

  function publicMentorEvaluation(N, r) {
    const cnt = (s) => r?.[s] || 0;
    const lvl = (l) => r?.levels?.[l] || 0;
    const scores = r?.scores || [];
    const stripContent = scores.length
      ? publicScoreStrip(scores)
      : `<div class="empty">${ic("clipboard")}<h3>ยังไม่มีหน่วยบริการที่ส่งครบ</h3><p>เมื่อหน่วยบริการส่งครบทั้ง 3 เกณฑ์ คะแนนจะแสดงบนแถบนี้</p></div>`;
    return `<div class="resv">
      <div class="grid g4" role="group" aria-label="กรองตามสถานะ">
        ${["pass", "fix", "risk", "none"]
          .map(
            (s) => `<button class="kpi is-${s}" data-act="go-mdash" data-f="${s}" title="กดดูรายละเอียดรายหน่วยบริการ">
          <span class="kpi-k">${ic(STATUS[s].i)}${STATUS[s].l}</span><span class="kpi-v">${cnt(s)}<small>แห่ง</small></span>
          <span class="kpi-s">${s === "pass" ? "กายภาพครบ คะแนน ≥ 240 ไม่มีข้อบกพร่องค้าง" : s === "fix" ? "คะแนนผ่าน แต่ยังมีข้อบกพร่องต้องแก้ไข" : s === "risk" ? "กายภาพไม่ครบ หรือคะแนนต่ำกว่า 240" : "รอส่งเกณฑ์ให้ครบก่อนคิดผล"}</span></button>`,
          )
          .join("")}
      </div>

      <div class="grid g2" style="margin-top:16px">
        <div class="card"><div class="card-h"><div><h3><span class="hico">${ic("target")}</span>การกระจายคะแนนรวมเทียบเกณฑ์</h3><p>ผ่านเกณฑ์ไม่ต่ำกว่า 240 จาก 300 คะแนน (ร้อยละ 80)</p></div></div>
          <div class="card-b"><div class="strip-wrap" id="strip-wrap">${stripContent}</div></div></div>
        <div class="card">
          <div class="card-h"><div><h3><span class="hico">${ic("shield")}</span>ระดับมาตรฐานที่คาดหมาย</h3><p>คำนวณจากคะแนนรวมปัจจุบัน</p></div></div>
          <div class="levels" style="margin-top:12px">${["gold", "silver", "blue"].map((l) => `<div class="lvl-tile"><img src="${IMG[LEVEL[l].img]}" alt="ตรา GECC ${LEVEL[l].l}"><div class="n">${lvl(l)}</div><div class="l">${LEVEL[l].l}</div><div class="r">${LEVEL[l].r}</div></div>`).join("")}</div>
          <div class="lvl-other"><div><span class="lo-i r">${ic("xc")}</span><span><b class="num">${lvl("below")}</b>ต่ำกว่าเกณฑ์ 240</span></div><div><span class="lo-i o">${ic("alert")}</span><span><b class="num">${lvl("gate")}</b>กายภาพยังไม่ครบ</span></div><div><span class="lo-i n">${ic("clock")}</span><span><b class="num">${lvl("none")}</b>รอผลครบทุกเกณฑ์</span></div></div>
        </div>
      </div>
    </div>`;
  }

  function publicSurveySection(survey) {
    const rows = survey?.units || 0;
    const tot = survey?.tot || 0;
    const A = survey?.avg || {};
    const item = ([k, t, en], theme) => {
      const v = A[k];
      return `<div class="sx-it"><div class="sx-n"><b>${esc(t)}</b><span>${esc(en)}</span></div><div class="sx-bw"><div class="sx-bar ${theme}"><span style="width:${v == null ? 0 : (v / 5) * 100}%"></span></div>${starsHtml(v)}</div><div class="sx-v ${theme}">${v == null ? "–" : v.toFixed(2)}</div></div>`;
    };
    const panel = (theme, icon, title, en, overallLabel, ov, items) => `<div class="sx-p ${theme}">
      <div class="sx-ph"><span class="sx-pi">${icon}</span><div><h3>${title}</h3><span>${en}</span></div></div>
      <div class="sx-top"><div class="sx-g">${svGauge(ov, theme)}</div><div class="sx-ov"><span class="sx-ol">${overallLabel}</span><div class="sx-stars">${starsHtml(ov)}<b>${ov == null ? "–" : ov.toFixed(2)}</b></div>${ov != null ? `<span class="sx-lv ${theme}">ระดับ${LVL5(ov)}</span>` : ""}</div></div>
      <div class="sx-list">${items.map((q) => item(q, theme)).join("")}</div></div>`;
    const smile =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01"/><path d="M15 9h.01"/></svg>';
    return `<h2 class="section-t">สำรวจความพึงพอใจและความเชื่อมั่นของผู้รับบริการ จังหวัดศรีสะเกษ</h2>
    <section class="card sx">
      <div class="sx-h"><div><span class="sx-k">SATISFACTION &amp; TRUST</span><h2>ความพึงพอใจและความเชื่อมั่น ภาพรวมจังหวัดศรีสะเกษ</h2></div><span class="sx-pill">${ic("users")}${rows ? `ตอบแบบประเมิน <b class="num">${fmt(tot)}</b> คน · <b class="num">${rows}</b> หน่วยบริการ` : "ยังไม่มีหน่วยบริการกรอกผลสำรวจ"}</span></div>
      <div class="sx-grid">
        ${panel("gold", smile, "ความพึงพอใจ", "SATISFACTION", "ความพึงพอใจภาพรวม", A.s5, SAT.filter(([k]) => k !== "s5"))}
        ${panel("mint", ic("shield"), "ความเชื่อมั่น", "TRUST IN SERVICE", "ความเชื่อมั่นภาพรวม", A.c5, CONF.filter(([k]) => k !== "c5"))}
      </div>
      <p class="tiny muted" style="margin:12px 0 0">คำนวณเฉลี่ยถ่วงน้ำหนักตามจำนวนผู้ตอบของแต่ละหน่วยบริการ · มาตราส่วน 5 ระดับ · ชุดข้อคำถามเดียวกับ SISAKET SMART FDA</p>
    </section>`;
  }

  function publicDashboard() {
    const r = aggregate;
    executiveHead(r?.lastUpdatedAt);
    const N = r?.units || 0;
    $("#content").innerHTML =
      `${reportBar('Executive_Dashboard_GECC2570','', 'Executive Dashboard · ภาพรวมจังหวัดศรีสะเกษ',r?.lastUpdatedAt)}
      ${countdownHTML(false)}
      ${r?.submission && r?.readiness ? `<h2 class="section-t" style="margin-top:0">ความพร้อมของหน่วยบริการตามเกณฑ์การประเมิน GECC ด้านกายภาพ ด้านคุณภาพ และด้านผลลัพธ์</h2><section class="card band" aria-label="รายงานการส่งเกณฑ์และแบบประเมินความพร้อม">${dualBandSummary(N,r.submission,r.readiness,true)}<div class="band-f">${ic('clock')}ข้อมูล ณ ${r.lastUpdatedAt?thDateTime(r.lastUpdatedAt):'ยังไม่มีการบันทึก'} · หน่วยบริการที่สมัคร ${fmt(N)} แห่ง · ${fmt(r?.teams||6)} กลุ่ม MENTOR</div></section>`:''}
      <h2 class="section-t">หน่วยบริการที่มีความพร้อมด้านกายภาพ 15 ข้อ (MUST HAVE)</h2>
      ${publicPhysChart(r?.phys)}
      <h2 class="section-t">หน่วยบริการที่มีความพร้อมด้านคุณภาพ และด้านผลลัพธ์</h2>
      ${publicCritBoxes(N, r?.crit)}
      <h2 class="section-t">ผลการตรวจประเมินจาก MENTOR</h2>
      ${publicMentorEvaluation(N, r)}
      ${publicSurveySection(r?.survey)}
      <section style="margin-top:20px"><h2 class="section-t">ความก้าวหน้าภาพรวมจังหวัด</h2><p class="summary-note">กดกราฟหรือปุ่มเพื่อดูชื่อหน่วยบริการ สถานะรายข้อ และคะแนน เอกสารหลักฐานและข้อเสนอแนะภายในต้องเข้าสู่ระบบตามสิทธิ์</p>${
        r
          ? `<div class="summary-grid">${[
              ["units", "หน่วยบริการที่เข้าร่วม"],
              ["teams", "กลุ่ม MENTOR"],
              ["complete", "ส่งเกณฑ์ครบ 3 ด้าน"],
              ["reviewed", "MENTOR ยืนยันตรวจแล้ว"],
              ["ready", "ประเมินว่าพร้อม"],
              ["submitted", "รอ MENTOR ตรวจ"],
              ["pass", "ผ่านเกณฑ์และไม่มีข้อบกพร่องค้าง"],
              ["fix", "ผ่านคะแนนและรอแก้ไขข้อบกพร่อง"],
            ]
              .map(
                ([k, l]) =>
                  `<div class="summary-item"><strong>${fmt(r[k])}</strong><span>${l}</span></div>`,
              )
              .join("")}</div>`
          : '<p role="status">ยังโหลดข้อมูลภาพรวมไม่ได้ กรุณาลองโหลดข้อมูลล่าสุดอีกครั้ง</p>'
      }<button class="btn btn-primary" data-act="go" data-view="portfolio">${ic("shield")}เข้าสู่ระบบ</button></section>`;
  }
  async function putFile(id, blob, name) {
    const uid = S.unitId || S.menteeUnit;
    if (!uid) throw new Error("กรุณาเลือกหน่วยบริการก่อนแนบไฟล์");
    const response = await fetch(apiUrl("/api/files/" + encodeURIComponent(id)), {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "X-CSRF-Token": csrf,
        "X-Unit-Id": uid,
        "X-File-Name": encodeURIComponent(name || blob.name || id),
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (!response.ok) {
      const data = await response.json();
      throw Object.assign(new Error(data.error), { status: response.status });
    }
    return response.json();
  }
  async function getFile(id) {
    const response = await fetch(apiUrl("/api/files/" + encodeURIComponent(id)), {
      credentials: "same-origin",
    });
    if (response.status === 404) return null;
    if (!response.ok)
      throw Object.assign(
        new Error("โหลดไฟล์ไม่สำเร็จ กรุณาตรวจการเข้าสู่ระบบ"),
        { status: response.status },
      );
    return response.blob();
  }
  function passwordModal(required = false) {
    openModal(
      `<div class="modal-h"><h3>${required ? "ตั้งรหัสผ่านใหม่ก่อนใช้งาน" : "เปลี่ยนรหัสผ่าน"}</h3>${required ? "" : '<button class="btn" data-act="modal-close">ปิด</button>'}</div><form id="password-form" novalidate class="modal-b auth-fields"><div class="field"><label for="old-password">รหัสผ่านปัจจุบัน</label><input class="inp" type="password" id="old-password" autocomplete="current-password" required maxlength="128"></div><div class="field"><label for="new-password">รหัสผ่านใหม่ 12–128 ตัวอักษร</label><input class="inp" type="password" id="new-password" autocomplete="new-password" minlength="12" maxlength="128" required></div><div class="field"><label for="repeat-password">ยืนยันรหัสผ่านใหม่</label><input class="inp" type="password" id="repeat-password" autocomplete="new-password" minlength="12" maxlength="128" required></div><p role="status" id="password-error" class="auth-help">หลังเปลี่ยนรหัสผ่าน กรุณาเข้าสู่ระบบใหม่</p><button class="btn btn-primary" type="submit">บันทึกรหัสผ่านใหม่</button></form>`,
    );
  }
  let decorating = false;
  function decorate() {
    if (decorating) return;
    decorating = true;
    try {
      document.querySelectorAll(".field").forEach((field, i) => {
        const error = field.querySelector(".err"),
          help = field.querySelector(".help"),
          invalid = field.classList.contains("invalid");
        if (error && !error.id) error.id = "field-error-" + i;
        if (help && !help.id) help.id = "field-help-" + i;
        field.querySelectorAll("input,textarea,select").forEach((el) => {
          const ids = new Set(
            (el.getAttribute("aria-describedby") || "")
              .split(" ")
              .filter(Boolean),
          );
          if (error) {
            ids.delete(error.id);
            if (invalid) ids.add(error.id);
          }
          if (help) ids.add(help.id);
          const status = el.closest("form")?.querySelector("[role=status][id]");
          if (status) ids.add(status.id);
          const desc = [...ids].join(" ");
          if (el.getAttribute("aria-describedby") !== desc) {
            if (desc) el.setAttribute("aria-describedby", desc);
            else el.removeAttribute("aria-describedby");
          }
          const value = invalid ? "true" : "false";
          if (el.getAttribute("aria-invalid") !== value)
            el.setAttribute("aria-invalid", value);
          if (el.type === "password" && !el.dataset.secretToggle) {
            el.dataset.secretToggle = "true";
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "btn btn-ghost btn-sm";
            toggle.dataset.togglePassword = el.id;
            toggle.setAttribute("aria-controls", el.id);
            toggle.setAttribute("aria-pressed", "false");
            toggle.textContent = "แสดงรหัสผ่าน";
            el.after(toggle);
          }
        });
      });
      document.querySelectorAll("[role=tab]").forEach((t) => {
        t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1;
      });
      document.querySelectorAll("svg[role=img]").forEach((svg) => {
        if (svg.querySelector("[tabindex]")) svg.setAttribute("role", "group");
      });
      if (server && S.view === "settings") {
        document.querySelectorAll("[data-pin]").forEach((input) => {
          if (input.dataset.pin === "unit") {
            const u = DB.units.find((u) => u.id === input.dataset.id);
            input.parentElement.textContent = u?.code || "ยังไม่กำหนด";
          } else input.closest(".card")?.remove();
        });
        document.querySelectorAll("th").forEach((th) => {
          if (th.textContent === "PIN") th.textContent = "รหัสหน่วยบริการ";
        });
        const importInput = document.querySelector("[data-act-change=import]");
        if (importInput) {
          const card = importInput.closest(".card");
          const p = card?.querySelector(".card-h p");
          if (
            p &&
            p.textContent !==
              "ข้อมูลเก็บบนเซิร์ฟเวอร์หน่วยงาน สำรองพร้อมไฟล์แนบได้ ส่วนการนำเข้าต้องตรวจสอบก่อนยืนยัน"
          )
            p.textContent =
              "ข้อมูลเก็บบนเซิร์ฟเวอร์หน่วยงาน สำรองพร้อมไฟล์แนบได้ ส่วนการนำเข้าต้องตรวจสอบก่อนยืนยัน";
        }
        if (!document.querySelector("[data-server-action=accounts]")) {
          const row = document.createElement("div");
          row.className = "account-actions";
          for (const [action, label] of [
            ["accounts", "จัดการบัญชีผู้ใช้"],
            ["content", "แก้ไขข้อมูลเผยแพร่"],
            ["audit", "ประวัติการทำรายการ"],
            ["backup", "สำรองข้อมูลพร้อมไฟล์แนบ"],
            ...(window.GECC_API_STYLE === "php" ? [["repair-encoding", "ตรวจและซ่อมภาษาไทย"]] : []),
          ]) {
            const b = document.createElement("button");
            b.className = "btn";
            b.dataset.serverAction = action;
            b.textContent = label;
            row.append(b);
          }
          $("#content").prepend(row);
        }
      }
      if (
        server &&
        user &&
        !document.querySelector("[data-server-action=password]")
      ) {
        const b = document.createElement("button");
        b.className = "btn btn-sm";
        b.dataset.serverAction = "password";
        b.textContent = "เปลี่ยนรหัสผ่าน";
        $("#top-act")?.append(b);
      }
    } finally {
      decorating = false;
    }
  }
  document.addEventListener("submit", async (e) => {
    if (
      ![
        "server-login",
        "password-form",
        "account-form",
        "content-form",
      ].includes(e.target.id)
    )
      return;
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
      const invalid = form.querySelector(":invalid");
      if (invalid) invalidField(invalid);
      const error = form.querySelector("[role=status]");
      if (error)
        error.textContent = "กรุณากรอกข้อมูลให้ครบถ้วนและตรวจรูปแบบข้อมูล";
      return;
    }
    if (form.dataset.pending === "true") return;
    form.dataset.pending = "true";
    const submit = form.querySelector("button[type=submit],button:not([type])");
    if (submit) {
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
    }
    try {
      if (e.target.id === "server-login") return await login();
      if (e.target.id === "password-form") {
        if ($("#new-password").value !== $("#repeat-password").value) {
          $("#password-error").textContent = "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน";
          invalidField($("#repeat-password"));
          return;
        }
        await request("/api/password", {
          method: "POST",
          body: JSON.stringify({
            current: $("#old-password").value,
            password: $("#new-password").value,
          }),
        });
        user = null;
        csrf = null;
        closeModal();
        S.view = "portfolio";
        await boot();
        toast("เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่");
      }
      if (e.target.id === "account-form") await submitAccount(e.target);
      if (e.target.id === "content-form") await submitContent(e.target);
    } catch (error) {
      const target =
        $("#password-error") || $("#account-error") || $("#content-error");
      if (target) target.textContent = error.message;
      else report(error);
    } finally {
      delete form.dataset.pending;
      if (submit) {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
      }
    }
  });
  document.addEventListener("click", async (e) => {
    const toggle = e.target.closest("[data-toggle-password]");
    if (toggle) {
      const input = document.getElementById(toggle.dataset.togglePassword);
      const visible = input.type === "password";
      input.type = visible ? "text" : "password";
      toggle.textContent = visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน";
      toggle.setAttribute("aria-pressed", String(visible));
      return;
    }
    const action = e.target.closest("[data-server-action]")?.dataset
      .serverAction;
    if (!action) return;
    try {
      if (action === "password") passwordModal();
      if (action === "accounts") await accountsModal();
      if (action === "audit") {
        const data = await request("/api/audit");
        openModal(
          `<div class="modal-h"><h3>ประวัติการทำรายการล่าสุด</h3><button class="btn" data-act="modal-close">ปิด</button></div><div class="modal-b">${data.events.map((x) => `<p>${esc(thDateTime(x.created_at))} · ${esc(x.action)} · ${esc(x.resource)}</p>`).join("") || "<p>ยังไม่มีประวัติ</p>"}</div>`,
        );
      }
      if (action === "backup") await backup();
      if (action === "content") contentModal();
      if (action === "repair-encoding") await repairEncoding();
    } catch (error) {
      report(error);
    }
  });
  // Public login selection is owned by the step-by-step entry view.
  document.addEventListener(
    "click",
    (e) => {
      if (!server) return;
      const el = e.target.closest("[data-act]");
      if (!el) return;
      if (el.dataset.act === "load-sample") {
        e.stopImmediatePropagation();
        e.preventDefault();
        toast(
          "ข้อมูลสาธิตใช้ได้เฉพาะโหมดในเครื่อง เพื่อป้องกันการแทนที่ข้อมูลจริง",
          true,
        );
      }
      if (
        ["start-real", "load-official", "reset-all"].includes(el.dataset.act)
      ) {
        e.stopImmediatePropagation();
        e.preventDefault();
        confirmDlg(
          "ล้างข้อมูลประเมินในระบบกลาง?",
          "ผลประเมินและข้อบกพร่องจะถูกลบ ควรสำรองข้อมูลพร้อมไฟล์แนบก่อนดำเนินการ",
          "ล้างข้อมูล",
          async () => {
            accept(
              await request("/api/admin/reset", {
                method: "POST",
                body: JSON.stringify({
                  revision,
                  mode:
                    el.dataset.act === "reset-all" ? "assessments" : "official",
                }),
              }),
            );
            S.draft = null;
            S.dirty = false;
            render();
            toast("ล้างข้อมูลประเมินแล้ว");
          },
          true,
        );
      }
    },
    true,
  );
  document.addEventListener(
    "change",
    (e) => {
      if (server && e.target.dataset.actChange === "import") {
        e.stopImmediatePropagation();
        e.preventDefault();
        const file = e.target.files[0];
        e.target.value = "";
        if (file) importFile(file).catch(report);
      }
    },
    true,
  );
  async function importFile(file) {
    if (file.size > 150 * 1024 * 1024)
      throw new Error(
        "ชุดสำรองใหญ่เกิน 150 MB กรุณาใช้เครื่องมือนำเข้าของผู้ดูแลเซิร์ฟเวอร์",
      );
    const bundle = JSON.parse(await file.text()),
      state = bundle.state || bundle;
    const preview = await request("/api/import/preview", {
      method: "POST",
      body: JSON.stringify({ revision, state }),
    });
    const files = new Map((bundle.files || []).map((f) => [f.id, f]));
    const absent = preview.missing.filter((f) => !files.has(f.id));
    if (absent.length)
      throw new Error(
        "ไฟล์แนบขาด " +
          absent.length +
          " ไฟล์ กรุณาส่งออกพร้อมไฟล์แนบจากเบราว์เซอร์ต้นทาง",
      );
    confirmDlg(
      "ตรวจสอบก่อนนำเข้าข้อมูล",
      `หน่วยบริการ ${preview.units} แห่ง · แบบประเมิน ${preview.assessments} รายการ · ข้อบกพร่อง ${preview.defects} รายการ · ไฟล์ที่ต้องอัปโหลด ${preview.missing.length} ไฟล์ ระบบจะนำเข้าได้เฉพาะเมื่อยังไม่มีข้อมูลประเมินกลาง`,
      "ยืนยันนำเข้า",
      async () => {
        for (const ref of preview.missing) {
          const f = files.get(ref.id);
          if (f.unitId !== ref.unitId) throw new Error("ไฟล์ไม่ตรงหน่วยบริการ");
          const binary = atob(f.base64),
            bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
          const digest = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          ]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("");
          if (digest !== f.sha256 || bytes.length !== f.size)
            throw new Error("ไฟล์สำรองเสียหาย: " + f.name);
          const response = await fetch(
            apiUrl("/api/files/" + encodeURIComponent(f.id)),
            {
              method: "PUT",
              credentials: "same-origin",
              headers: {
                "X-CSRF-Token": csrf,
                "X-Unit-Id": ref.unitId,
                "X-File-Name": encodeURIComponent(f.name),
              },
              body: bytes,
            },
          );
          if (!response.ok) throw new Error((await response.json()).error);
        }
        accept(
          await request("/api/import", {
            method: "POST",
            body: JSON.stringify({ revision: preview.revision, state }),
          }),
        );
        S.draft = null;
        S.dirty = false;
        render();
        toast("นำเข้าข้อมูลและตรวจไฟล์แนบแล้ว");
      },
    );
  }
  function accountsModal() {
    return request("/api/accounts").then((data) => {
      openModal(
        `<div class="modal-h"><h3>บัญชีผู้ใช้</h3><button class="btn" data-act="modal-close">ปิด</button></div><div class="modal-b"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>บทบาท</th><th>การใช้งาน</th></tr></thead><tbody>${data.accounts.map((a) => `<tr><td>${esc(a.username)}</td><td>${esc(a.name)}</td><td>${esc(a.role === "coord" ? "ผู้ประสานงาน" : a.role === "mentor" ? "MENTOR" : "หน่วยบริการ")}</td><td><button class="btn btn-sm" data-account-id="${esc(a.id)}" data-account-active="${!a.active}">${a.active ? "ปิดบัญชี" : "เปิดบัญชี"}</button><button class="btn btn-sm" data-account-reset="${esc(a.id)}">ตั้งรหัสผ่านชั่วคราวใหม่</button></td></tr>`).join("")}</tbody></table></div><h4>เพิ่มบัญชี</h4><form id="account-form" novalidate class="auth-fields"><div class="field"><label for="account-role">บทบาท</label><select class="inp" id="account-role" name="role"><option value="mentee">หน่วยบริการ</option><option value="mentor">MENTOR</option><option value="coord">ผู้ประสานงานจังหวัด</option></select></div><div class="field"><label for="account-unit">หน่วยบริการ (สำหรับบัญชีหน่วยบริการ)</label><select class="inp" name="unitId" id="account-unit">${DB.units.map((u) => `<option value="${esc(u.id)}">${esc(u.code + " · " + u.name)}</option>`).join("")}</select></div><div class="field"><label for="account-team">กลุ่ม MENTOR</label><select class="inp" name="team" id="account-team">${DB.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select></div><div class="field"><label for="account-name">ชื่อผู้ใช้ (สำหรับผู้ตรวจและผู้ประสานงาน)</label><input class="inp" name="username" id="account-name" autocomplete="off" maxlength="80"></div><div class="field"><label for="account-display">ชื่อที่แสดง</label><input class="inp" name="name" id="account-display" required maxlength="200"></div><div class="field"><label for="account-pass">รหัสผ่านชั่วคราว 12–128 ตัวอักษร</label><input class="inp" type="password" name="password" id="account-pass" autocomplete="new-password" minlength="12" maxlength="128" required></div><p id="account-error" role="status" class="auth-help">รหัสบัญชีหน่วยบริการจะใช้รหัส 6 หลักโดยอัตโนมัติ ผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าใช้ครั้งแรก</p><button class="btn btn-primary">เพิ่มบัญชี</button></form></div>`,
      );
    });
  }
  async function submitAccount(form) {
    const data = Object.fromEntries(new FormData(form));
    if (data.role !== "mentee") delete data.unitId;
    await request("/api/accounts", {
      method: "POST",
      body: JSON.stringify(data),
    });
    await accountsModal();
    toast("เพิ่มบัญชีแล้ว");
  }
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-account-id],[data-account-reset]");
    if (!b) return;
    if (b.dataset.accountReset) {
      openModal(
        `<div class="modal-h"><h3>ตั้งรหัสผ่านชั่วคราวใหม่</h3><button class="btn" data-act="modal-close">ยกเลิก</button></div><form class="modal-b auth-fields" id="reset-account-form" novalidate data-id="${esc(b.dataset.accountReset)}"><div class="field"><label for="reset-account-pass">รหัสผ่านชั่วคราว 12–128 ตัวอักษร</label><input class="inp" id="reset-account-pass" type="password" autocomplete="new-password" required minlength="12" maxlength="128" aria-describedby="reset-error"></div><p role="status" id="reset-error"></p><button type="submit" class="btn btn-primary">ตั้งรหัสผ่านใหม่</button></form>`,
      );
      return;
    }
    confirmDlg(
      "เปลี่ยนสถานะบัญชี?",
      "ระบบจะยกเลิก session เดิมของบัญชีนี้",
      "ยืนยัน",
      async () => {
        try {
          await request("/api/accounts/" + b.dataset.accountId, {
            method: "PATCH",
            body: JSON.stringify({
              active: b.dataset.accountActive === "true",
            }),
          });
          await accountsModal();
        } catch (e) {
          report(e);
        }
      },
    );
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id !== "reset-account-form") return;
    e.preventDefault();
    const form = e.target;
    if (!form.checkValidity()) {
      invalidField($("#reset-account-pass"));
      $("#reset-error").textContent = "รหัสผ่านต้องมี 12–128 ตัวอักษร";
      return;
    }
    if (form.dataset.pending === "true") return;
    form.dataset.pending = "true";
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    submit.setAttribute("aria-busy", "true");
    try {
      await request("/api/accounts/" + form.dataset.id, {
        method: "PATCH",
        body: JSON.stringify({ password: $("#reset-account-pass").value }),
      });
      await accountsModal();
      toast("ตั้งรหัสผ่านชั่วคราวใหม่แล้ว");
    } catch (error) {
      $("#reset-error").textContent = error.message;
    } finally {
      delete form.dataset.pending;
      submit.disabled = false;
      submit.removeAttribute("aria-busy");
    }
  });
  async function repairEncoding() {
    if (S.dirty) throw new Error("กรุณาบันทึกข้อมูลร่างก่อนตรวจภาษาไทย");
    const preview = await request("/api/admin/repair-encoding");
    if (!preview.count) { toast("ไม่พบข้อความภาษาไทยที่ต้องซ่อม"); return; }
    openModal(`<div class="modal-h"><h3>ตรวจพบข้อความที่ซ่อมได้ ${fmt(preview.count)} รายการ</h3><button class="btn" data-act="modal-close">ปิด</button></div><div class="modal-b"><p>ตัวอย่างก่อนและหลังซ่อม ระบบจะสำรองข้อมูลไว้ในพื้นที่ส่วนตัวก่อนบันทึก</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>ข้อความเดิม</th><th>หลังซ่อม</th></tr></thead><tbody>${preview.examples.map(x=>`<tr><td>${esc(x.before)}</td><td>${esc(x.after)}</td></tr>`).join('')}</tbody></table></div><p id="encoding-error" role="status"></p></div><div class="modal-f"><button class="btn" data-act="modal-close">ยกเลิก</button><button class="btn btn-primary" id="encoding-apply">สำรองและซ่อมภาษาไทย</button></div>`);
    $("#encoding-apply").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        await request("/api/admin/repair-encoding", {method:"POST",body:JSON.stringify({revision:preview.revision})});
        await boot();
        closeModal();
        toast("สำรองข้อมูลและซ่อมภาษาไทยแล้ว");
      } catch (error) {
        $("#encoding-error").textContent = error.message;
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
      }
    });
  }
  function contentModal() {
    const c = DB.publicContent || {};
    const extra =
      DB.teams
        .map(
          (t, i) =>
            `<fieldset><legend>ภาพ${esc(t.name)}</legend><label for="group-photo-${i}">ตำแหน่งรูปภาพ</label><input class="inp" id="group-photo-${i}" name="group.${i}.photo" value="${esc(t.photo || "")}"></fieldset>`,
        )
        .join("") +
      (DB.mentorCoordinators || [])
        .map(
          (person, i) =>
            `<fieldset><legend>ผู้ประสานงาน ${i + 1}</legend>${[
              ["name", "ชื่อ"],
              ["pos", "ตำแหน่ง"],
              ["role", "หน้าที่"],
              ["photo", "ตำแหน่งรูปภาพ"],
            ]
              .map(
                ([key, label]) =>
                  `<label for="coordinator-${i}-${key}">${label}</label><input class="inp" id="coordinator-${i}-${key}" name="coordinator.${i}.${key}" value="${esc(person[key] || "")}">`,
              )
              .join("")}</fieldset>`,
        )
        .join("") +
      (c.duties || COMMITTEE_DUTIES)
        .map(
          (text, i) =>
            `<label for="duty-${i}">อำนาจหน้าที่ข้อ ${i + 1}</label><textarea class="inp" id="duty-${i}" name="duty.${i}.text">${esc(text)}</textarea>`,
        )
        .join("");
    openModal(
      `<div class="modal-h"><h3>ข้อมูลเผยแพร่</h3><button class="btn" data-act="modal-close">ปิด</button></div><form id="content-form" novalidate class="modal-b content-editor">${(
        c.library || LIBRARY_FOLDERS
      )
        .map(
          (x, i) =>
            `<fieldset><legend>คลังเอกสาร: ${esc(x.name)}</legend>${[
              ["name", "ชื่อหมวด"],
              ["detail", "คำอธิบาย"],
              ["url", "ลิงก์โฟลเดอร์"],
              ["image", "ตำแหน่งภาพปก"],
            ]
              .map(
                ([k, l]) =>
                  `<label for="lib-${i}-${k}">${l}</label><input class="inp" id="lib-${i}-${k}" name="library.${i}.${k}" value="${esc(x[k] || "")}" required>`,
              )
              .join("")}</fieldset>`,
        )
        .join("")}${[
        c.advisor || COMMITTEE_ADVISOR,
        ...(c.committee || COMMITTEE_MEMBERS),
      ]
        .map(
          (x, i) =>
            `<fieldset><legend>${i === 0 ? "ที่ปรึกษา" : "คณะทำงาน " + i}</legend>${[
              ["name", "ชื่อ"],
              ["title", "ตำแหน่ง"],
              ["role", "หน้าที่"],
              ["photo", "ตำแหน่งรูปภาพ"],
            ]
              .map(
                ([k, l]) =>
                  `<label for="person-${i}-${k}">${l}</label><input class="inp" id="person-${i}-${k}" name="person.${i}.${k}" value="${esc(x[k] || "")}">`,
              )
              .join("")}</fieldset>`,
        )
        .join(
          "",
        )}${extra}<p id="content-error" role="status"></p><button class="btn btn-primary">บันทึกข้อมูลเผยแพร่</button></form>`,
    );
  }
  async function submitContent(form) {
    const c = clone(
      DB.publicContent || {
        library: LIBRARY_FOLDERS,
        advisor: COMMITTEE_ADVISOR,
        committee: COMMITTEE_MEMBERS,
        duties: COMMITTEE_DUTIES,
      },
    );
    const people = [c.advisor, ...c.committee];
    for (const [key, value] of new FormData(form)) {
      const [group, i, k] = key.split(".");
      if (group === "duty") c.duties[+i] = value;
      else
        (group === "group"
          ? DB.teams
          : group === "coordinator"
            ? DB.mentorCoordinators
            : group === "library"
              ? c.library
              : people)[+i][k] = value;
    }
    DB.publicContent = c;
    await save(DB);
    closeModal();
    render();
    toast("บันทึกข้อมูลเผยแพร่แล้ว");
  }
  async function backup() {
    await GECCBackup.exportBundle();
  }
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-backup-bundle]")) {
      try {
        await backup();
      } catch (error) {
        report(error);
      }
    }
  });
  document.addEventListener("input", e => {
    if (e.target.closest(".auth-fields .field")) {
      e.target.closest(".field").classList.remove("invalid");
      e.target.removeAttribute("aria-invalid");
    }
  });
  const api = {
    get busy() {
      return busy;
    },
    get revision() {
      return revision;
    },
    request,
    save,
    workflow,
    boot,
    decorate,
    report,
    loginModal,
    login,
    logout,
    putFile,
    getFile,
    publicDashboard,
  };
  const observer = new MutationObserver(() => decorate());
  observer.observe(document.getElementById("app"), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  observer.observe(document.getElementById("modal-root"), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  document.addEventListener("DOMContentLoaded", () => {
    decorate();
    window.GECCMotion?.enter();
  });
  queueMicrotask(boot);
  return api;
})();
