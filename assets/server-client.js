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
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers,
    });
    if (!response.ok) {
      let message = "เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่";
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
      Object.assign(S, { role: null, team: 0, coord: false, menteeUnit: null });
      return;
    }
    Object.assign(S, {
      role: user.role === "coord" ? "mentor" : user.role,
      team: user.role === "mentor" ? user.team : 0,
      mdTeam: user.role === "mentor" ? user.team : 0,
      coord: user.role === "coord",
      menteeUnit: user.unitId || null,
    });
  }
  async function boot() {
    if (!server) {
      notice("โหมดในเครื่อง · ข้อมูลและไฟล์แนบเก็บในเบราว์เซอร์นี้เท่านั้น");
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
  function loginModal(kind, id, label) {
    S.pinPending = { kind, id };
    const unit = kind === "unit" ? DB.units.find((u) => u.id === id) : null;
    openModal(
      `<div class="modal-h"><div><h3>เข้าสู่ระบบ</h3><p>${esc(label)}</p></div><button class="btn btn-ghost btn-icon" data-act="modal-close" aria-label="ปิด">${ic("x")}</button></div><form id="server-login" class="modal-b auth-fields" novalidate><div class="field"><label for="login-name">${kind === "unit" ? "รหัสหน่วยบริการ 6 หลัก" : "ชื่อผู้ใช้รายบุคคล"}</label><input class="inp" id="login-name" name="username" autocomplete="username" ${kind === "unit" ? 'inputmode="numeric" maxlength="6"' : ""} value="${esc(unit?.code || "")}" required></div><div class="field"><label for="login-password">รหัสผ่าน</label><input class="inp" type="password" id="login-password" name="password" autocomplete="current-password" required maxlength="128"></div><p id="login-error" class="auth-help" role="status">${kind === "unit" ? "ใช้รหัส GECC ภายในที่ได้รับจากผู้ประสานงาน" : "ใช้บัญชีส่วนบุคคลที่ผู้ประสานงานกำหนดให้"}</p><button class="btn btn-primary" type="submit">เข้าสู่ระบบ</button></form>`,
    );
  }
  async function login() {
    const name = $("#login-name"),
      pass = $("#login-password");
    if (!name || !pass) return;
    const kind = S.pinPending?.kind;
    if (kind === "unit" && !/^\d{6}$/.test(name.value.trim())) {
      name.setAttribute("aria-invalid", "true");
      name.focus();
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
      pass.setAttribute("aria-invalid", "true");
      pass.focus();
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
  function publicDashboard() {
    setHead(
      "ภาพรวม GECC จังหวัดศรีสะเกษ",
      "การยกระดับมาตรฐานบริการภาครัฐ ประจำปีงบประมาณ " + DB.fy,
    );
    const r = aggregate;
    $("#content").innerHTML =
      `<section><h2 class="section-t">ความก้าวหน้าภาพรวมจังหวัด</h2><p class="summary-note">แสดงข้อมูลรวมของหน่วยบริการที่เข้าร่วมการประเมิน เข้าสู่ระบบเพื่อดูรายละเอียด คะแนน และหลักฐานตามสิทธิ์ของท่าน</p>${
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
    const response = await fetch("/api/files/" + encodeURIComponent(id), {
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
    const response = await fetch("/api/files/" + encodeURIComponent(id), {
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
          const desc = [...ids].join(" ");
          if (el.getAttribute("aria-describedby") !== desc) {
            if (desc) el.setAttribute("aria-describedby", desc);
            else el.removeAttribute("aria-describedby");
          }
          const value = invalid ? "true" : "false";
          if (el.getAttribute("aria-invalid") !== value)
            el.setAttribute("aria-invalid", value);
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
      invalid?.setAttribute("aria-invalid", "true");
      invalid?.focus();
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
    } catch (error) {
      report(error);
    }
  });
  // Public portfolio keeps its group/role steps. Organizations type their private account code.
  document.addEventListener(
    "click",
    (e) => {
      if (!server) return;
      const el = e.target.closest("[data-act]");
      if (!el) return;
      if (el.dataset.act === "entry-mentee") {
        e.stopImmediatePropagation();
        e.preventDefault();
        loginModal("unit", null, "หน่วยบริการ · " + teamName(S.entryTeam));
      }
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
            "/api/files/" + encodeURIComponent(f.id),
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
        `<div class="modal-h"><h3>ตั้งรหัสผ่านชั่วคราวใหม่</h3><button class="btn" data-act="modal-close">ยกเลิก</button></div><form class="modal-b auth-fields" id="reset-account-form" data-id="${esc(b.dataset.accountReset)}"><label for="reset-account-pass">รหัสผ่านชั่วคราว 12–128 ตัวอักษร</label><input class="inp" id="reset-account-pass" type="password" autocomplete="new-password" required minlength="12" maxlength="128"><p role="status" id="reset-error"></p><button class="btn btn-primary">ตั้งรหัสผ่านใหม่</button></form>`,
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
    if (form.dataset.pending === "true") return;
    form.dataset.pending = "true";
    const submit = form.querySelector("button");
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
  document.addEventListener("DOMContentLoaded", () => {
    decorate();
    window.GECCMotion?.enter();
  });
  queueMicrotask(boot);
  return api;
})();
