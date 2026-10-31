import { createServer } from "node:http";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  accountView,
  hashPassword,
  verifyPassword,
  passwordValid,
  token,
  hashToken,
} from "./auth.js";
import { audit, readState, transaction } from "./store.js";
import {
  allowed,
  clone,
  fail,
  project,
  mergeState,
  transition,
} from "./policy.js";
import { summary, rules } from "./domain.js";
import { staticFile } from "./static.js";
import { prepareImport, references } from "./import.js";
import { basePath as normalizeBasePath } from "./config.js";
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(JSON.stringify(value));
};
async function body(req, max = 2 * 1024 * 1024, raw = false) {
  if (Number(req.headers["content-length"]) > max) {
    req.resume();
    fail(413, "ข้อมูลมีขนาดใหญ่เกินไป");
  }
  let n = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    n += chunk.length;
    if (n > max) {
      req.resume();
      fail(413, "ข้อมูลมีขนาดใหญ่เกินไป");
    }
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (raw) return data;
  try {
    return JSON.parse(data.toString());
  } catch {
    fail(400, "ข้อมูล JSON ไม่ถูกต้อง");
  }
}
export function fileType(b) {
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return "image/jpeg";
  if (
    b.subarray(0, 4).toString() === "RIFF" &&
    b.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
function collectFiles(a) {
  return [
    ...Object.values(a?.ev || {}).flatMap((e) => e.files || []),
    ...(a?.quick || []).flatMap((q) => q.files || []),
  ];
}
export function createApp({
  pool,
  origin = "http://127.0.0.1:8080",
  fileRoot = "./var/files",
  secure = false,
  basePath = "",
}) {
  basePath = normalizeBasePath(basePath);
  const attempts = new Map();
  const root = resolve(fileRoot);
  const cookieName = basePath
    ? `${secure ? "__Secure-" : ""}gecc-${hashToken(basePath).slice(0, 12)}`
    : secure ? "__Host-gecc" : "gecc";
  const cookie = (value, age = 28800) =>
    `${cookieName}=${value}; HttpOnly; SameSite=Strict; Path=${basePath}/; Max-Age=${age}${secure ? "; Secure" : ""}`;
  return createServer(async (req, res) => {
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      const url = new URL(req.url, origin);
      if (basePath && url.pathname === basePath && ["GET", "HEAD"].includes(req.method)) {
        res.writeHead(308, { Location: basePath + "/" + url.search });
        return res.end();
      }
      if (basePath && !url.pathname.startsWith(basePath + "/"))
        return json(res, 404, { error: "Not found" });
      const path = url.pathname.slice(basePath.length);
      req.url = path + url.search;
      if (!path.startsWith("/api/")) return await staticFile(req, res, true);
      if (path === "/api/health" && req.method === "GET") {
        try {
          await readState(pool);
          return json(res, 200, { ok: true });
        } catch {
          return json(res, 503, { ok: false });
        }
      }
      const modifying = !["GET", "HEAD"].includes(req.method);
      if (modifying && req.headers.origin !== origin)
        fail(403, "ต้นทางคำขอไม่ถูกต้อง");
      const cookies = Object.fromEntries(
        (req.headers.cookie || "").split(";").map((v) => v.trim().split("=")),
      );
      const found = cookies[cookieName]
        ? await pool.query(
            "SELECT s.csrf,s.expires_at,a.* FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1",
            [hashToken(cookies[cookieName])],
          )
        : { rows: [] };
      const session = found.rows.find(
        (s) => s.active && new Date(s.expires_at) > new Date(),
      );
      if (path === "/api/session" && req.method === "POST") {
        const input = await body(req, 4096);
        const { rows } = await pool.query(
          "SELECT * FROM accounts WHERE username=$1",
          [String(input.username || "").trim()],
        );
        const account = rows[0];
        const key =
          req.socket.remoteAddress +
          ":" +
          hashToken(String(input.username || "").trim());
        const now = Date.now();
        if (attempts.size >= 10000) {
          for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
          if (attempts.size >= 10000 && !attempts.has(key))
            fail(429, "ระบบกำลังรับคำขอจำนวนมาก กรุณาลองใหม่ภายหลัง");
        }
        let rate = attempts.get(key);
        if (!rate || rate.until < now)
          rate = { count: 0, until: now + 15 * 60e3 };
        if (rate.count >= 10)
          fail(429, "ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอ 15 นาที");
        // Reserve before awaiting scrypt so parallel attempts cannot bypass the limit.
        rate.count++;
        attempts.set(key,rate);
        const valid = await verifyPassword(
          input.password,
          account?.password_hash ||
            "00000000000000000000000000000000:00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        );
        if (!account?.active || !valid) {
          fail(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
        }
        attempts.delete(key);
        const sid = token(),
          csrf = token();
        await transaction(pool, async (c) => {
          if (cookies[cookieName])
            await c.query("DELETE FROM sessions WHERE token_hash=$1", [
              hashToken(cookies[cookieName]),
            ]);
          await c.query("DELETE FROM sessions WHERE expires_at < $1", [
            new Date(),
          ]);
          await c.query(
            "INSERT INTO sessions(token_hash,account_id,csrf,expires_at) VALUES($1,$2,$3,$4)",
            [
              hashToken(sid),
              account.id,
              csrf,
              new Date(Date.now() + 8 * 3600e3),
            ],
          );
          await audit(c, account.id, "login", "session");
        });
        return json(
          res,
          200,
          { user: accountView(account), csrf },
          { "Set-Cookie": cookie(sid) },
        );
      }
      if (path === "/api/session" && req.method === "GET")
        return json(res, 200, {
          user: session ? accountView(session) : null,
          csrf: session?.csrf || null,
        });
      if (
        modifying &&
        (!session || req.headers["x-csrf-token"] !== session.csrf)
      )
        fail(
          session ? 403 : 401,
          session ? "คำขอยืนยันตัวตนไม่ถูกต้อง" : "กรุณาเข้าสู่ระบบอีกครั้ง",
        );
      if (path === "/api/session" && req.method === "DELETE") {
        await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
          hashToken(cookies[cookieName]),
        ]);
        return json(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
      }
      if (path === "/api/password" && req.method === "POST") {
        const input = await body(req, 4096);
        if (!(await verifyPassword(input.current, session.password_hash)))
          fail(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง");
        if (!passwordValid(input.password) || input.current === input.password)
          fail(400, "ใช้รหัสผ่านใหม่ 12–128 ตัวอักษรที่ต่างจากเดิม");
        const hash = await hashPassword(input.password);
        await transaction(pool, async (c) => {
          await c.query(
            "UPDATE accounts SET password_hash=$1,must_change=false WHERE id=$2",
            [hash, session.id],
          );
          await c.query("DELETE FROM sessions WHERE account_id=$1", [
            session.id,
          ]);
          await audit(c, session.id, "password-change", "account");
        });
        return json(res, 200, { ok: true }, { "Set-Cookie": cookie("", 0) });
      }
      if (modifying && session.must_change)
        fail(403, "กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน");
      if (path === "/api/state" && req.method === "GET") {
        const { document, revision } = await readState(pool);
        return json(res, 200, {
          state: project(document, session),
          revision,
          summary: summary(document),
        });
      }
      if (path === "/api/summary" && req.method === "GET") {
        const { document } = await readState(pool);
        return json(res, 200, summary(document));
      }
      if (path === "/api/public/login-options" && req.method === "GET") {
        const { document } = await readState(pool);
        const { rows: accounts } = await pool.query(
          "SELECT username,name,role,unit_id,team FROM accounts WHERE active=true",
        );
        const username = (matches) => {
          const found = accounts.filter(matches);
          return found.length === 1 ? found[0].username : "";
        };
        return json(res, 200, {
          units: (document.units || []).map((u) => ({
            id: u.id,
            name: u.name,
            team: u.team,
            username: username((a) => u.id && a.role === "mentee" && a.unit_id === u.id),
          })),
          mentors: (document.teams || []).flatMap((team) =>
            (team.members || []).map((person) => ({
              name: person.name || "",
              pos: person.pos || "",
              photo: person.photo || "",
              team: team.id,
              username: username((a) => typeof person.name === "string" && person.name.trim() !== "" && a.name === person.name && a.role === "mentor" && a.team === team.id),
            })),
          ),
          advisors: (document.publicContent?.mentorAdvisors || []).map((person) => ({
            name: person.name || "",
            title: person.title || "",
            role: person.role || "",
            photo: person.photo || "",
            username: username((a) => typeof person.name === "string" && person.name.trim() !== "" && a.name === person.name && ["mentor", "coord"].includes(a.role) && (!Object.hasOwn(person, "loginUsername") || a.username === person.loginUsername)),
          })),
        });
      }
      if (
        ["/api/import/preview", "/api/import"].includes(path) &&
        req.method === "POST"
      ) {
        if (session.role !== "coord")
          fail(403, "เฉพาะผู้ประสานงานนำเข้าข้อมูล");
        const input = await body(req, 8 * 1024 * 1024);
        const result = await transaction(pool, async (c) => {
          const { document, revision } = await readState(c, true);
          if (input.revision !== revision)
            fail(409, "ข้อมูลเปลี่ยนแปลง กรุณาตรวจนำเข้าใหม่");
          const next = prepareImport(document, input.state);
          const missing = [];
          for (const f of references(next)) {
            const { rows } = await c.query(
              "SELECT unit_id FROM files WHERE id=$1",
              [f.id],
            );
            if (!rows[0] || rows[0].unit_id !== f.unitId)
              missing.push({ id: f.id, unitId: f.unitId });
          }
          if (path.endsWith("preview"))
            return {
              revision,
              units: next.units.length,
              assessments: Object.keys(next.assess).length,
              defects: next.defects.length,
              missing,
            };
          if (missing.length) fail(400, "ยังมีไฟล์แนบไม่ครบ กรุณาตรวจชุดสำรอง");
          await c.query(
            "UPDATE app_state SET document=$1,revision=$2 WHERE id=1",
            [JSON.stringify(next), revision + 1],
          );
          await audit(c, session.id, "import", "state", revision + 1);
          return {
            state: project(next, session),
            revision: revision + 1,
            summary: summary(next),
          };
        });
        return json(res, 200, result);
      }
      if (path === "/api/admin/reset" && req.method === "POST") {
        if (session.role !== "coord")
          fail(403, "เฉพาะผู้ประสานงานจัดการข้อมูล");
        const input = await body(req, 4096);
        if (!["assessments", "official"].includes(input.mode))
          fail(400, "คำสั่งไม่ถูกต้อง");
        const result = await transaction(pool, async (c) => {
          const { document, revision } = await readState(c, true);
          if (input.revision !== revision)
            fail(409, "ข้อมูลเปลี่ยนแปลง กรุณาโหลดใหม่");
          const next = clone(document);
          next.assess = {};
          next.defects = [];
          next.nextUnitCode =
            next.nextUnitCode ||
            Math.max(0, ...next.units.map((u) => +u.code || 0)) + 1;
          if (input.mode === "official") {
            const official = JSON.parse(
              await readFile(
                new URL("../sisaket-gecc-2570-units-28.json", import.meta.url),
                "utf8",
              ),
            );
            next.units = official.units.map((u) => ({
              ...u,
              code:
                document.units.find((x) => x.id === u.id)?.code ||
                String(next.nextUnitCode++).padStart(6, "0"),
            }));
            next.teams = official.teams.map((t) => ({
              ...t,
              photo: `assets/images/group-${t.id}.jpg`,
            }));
          }
          await c.query(
            "UPDATE app_state SET document=$1,revision=$2 WHERE id=1",
            [JSON.stringify(next), revision + 1],
          );
          await audit(
            c,
            session.id,
            "reset-" + input.mode,
            "state",
            revision + 1,
          );
          return {
            state: project(next, session),
            revision: revision + 1,
            summary: summary(next),
          };
        });
        return json(res, 200, result);
      }
      if (path === "/api/state" && req.method === "PUT") {
        const input = await body(req, 8 * 1024 * 1024);
        const result = await transaction(pool, async (c) => {
          const { document, revision } = await readState(c, true);
          if (input.revision !== revision)
            fail(
              409,
              "มีข้อมูลใหม่จากผู้ใช้อื่น กรุณาโหลดข้อมูลใหม่ก่อนบันทึก",
            );
          const next = mergeState(document, input.state, session);
          for (const removed of document.units.filter(
            (u) => !next.units.some((n) => n.id === u.id),
          )) {
            await c.query("UPDATE accounts SET active=false WHERE unit_id=$1", [
              removed.id,
            ]);
            await c.query(
              "DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE unit_id=$1)",
              [removed.id],
            );
          }
          for (const u of next.units) {
            const oldFiles = new Map(
              collectFiles(document.assess[u.id]).map((f) => [f.id, f]),
            );
            const nextFiles = collectFiles(next.assess[u.id]);
            const role = session.role === "coord" ? "mentor" : session.role;
            for (const [id, old] of oldFiles)
              if (
                !nextFiles.some((f) => f.id === id) &&
                old.by !== role &&
                session.role !== "coord"
              )
                fail(403, "ลบไฟล์แนบของอีกบทบาทไม่ได้");
            for (const f of nextFiles) {
              const { rows } = await c.query(
                "SELECT f.*,a.role AS owner_role FROM files f JOIN accounts a ON a.id=f.account_id WHERE f.id=$1",
                [f.id],
              );
              const stored = rows[0];
              if (!stored || stored.unit_id !== u.id)
                fail(400, "ไฟล์แนบยังไม่ถูกอัปโหลดหรือไม่ตรงหน่วยบริการ");
              f.by =
                oldFiles.get(f.id)?.by ||
                (stored.owner_role === "coord" ? "mentor" : stored.owner_role);
              f.type = stored.mime;
              f.size = stored.size;
            }
          }
          await c.query(
            "UPDATE app_state SET document=$1,revision=$2,updated_at=$3 WHERE id=1",
            [JSON.stringify(next), revision + 1, new Date()],
          );
          await audit(c, session.id, "save", "state", revision + 1);
          return {
            state: project(next, session),
            revision: revision + 1,
            summary: summary(next),
          };
        });
        return json(res, 200, result);
      }
      const wf = path.match(/^\/api\/workflow\/([\w-]+)$/);
      if (wf && req.method === "POST") {
        const input = await body(req, 8192);
        const result = await transaction(pool, async (c) => {
          const { document, revision } = await readState(c, true);
          if (input.revision !== revision)
            fail(409, "ข้อมูลเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่");
          const next = transition(
            clone(document),
            wf[1],
            sessionAction(input.action),
            session,
            String(input.note || "").slice(0, 4000),
            input.sender,
          );
          await c.query(
            "UPDATE app_state SET document=$1,revision=$2,updated_at=$3 WHERE id=1",
            [JSON.stringify(next), revision + 1, new Date()],
          );
          await audit(c, session.id, input.action, wf[1], revision + 1);
          return {
            state: project(next, session),
            revision: revision + 1,
            summary: summary(next),
          };
        });
        return json(res, 200, result);
      }
      const file = path.match(/^\/api\/files\/([A-Za-z0-9_-]{1,160})$/);
      if (file) {
        if (!session) fail(401, "กรุณาเข้าสู่ระบบ");
        const id = file[1];
        if (req.method === "PUT") {
          const uid = String(req.headers["x-unit-id"] || "");
          const { document } = await readState(pool);
          if (
            !allowed(
              session,
              document.units.find((u) => u.id === uid),
            )
          )
            fail(403, "ไม่มีสิทธิ์แนบไฟล์");
          if (document.assess[uid]?.wf?.status === "reviewed")
            fail(409, "ผลตรวจถูกล็อก");
          const bytes = await body(req, 10 * 1024 * 1024, true);
          const mime = fileType(bytes);
          if (!mime || !bytes.length)
            fail(
              400,
              "รับเฉพาะ PDF, JPEG, PNG หรือ WebP ที่ถูกต้อง ขนาดไม่เกิน 10 MB",
            );
          let name;
          try {
            name = decodeURIComponent(req.headers["x-file-name"] || id);
          } catch {
            fail(400, "ชื่อไฟล์ไม่ถูกต้อง");
          }
          name = name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 200);
          await mkdir(root, { recursive: true });
          await writeFile(resolve(root, id), bytes, { flag: "wx" }).catch(() =>
            fail(409, "รหัสไฟล์ซ้ำ กรุณาแนบไฟล์ใหม่"),
          );
          try {
            await transaction(pool, async (c) => {
              await c.query(
                "INSERT INTO files(id,unit_id,account_id,name,mime,size,digest) VALUES($1,$2,$3,$4,$5,$6,$7)",
                [
                  id,
                  uid,
                  session.id,
                  name,
                  mime,
                  bytes.length,
                  hashToken(bytes),
                ],
              );
              await audit(c, session.id, "upload", id);
            });
          } catch (e) {
            await unlink(resolve(root, id));
            throw e;
          }
          return json(res, 201, { id, name, type: mime, size: bytes.length });
        }
        if (req.method === "GET") {
          const { rows } = await pool.query("SELECT * FROM files WHERE id=$1", [
            id,
          ]);
          const f = rows[0];
          const { document } = await readState(pool);
          if (
            !f ||
            !allowed(
              session,
              document.units.find((u) => u.id === f.unit_id),
            )
          )
            fail(404, "ไม่พบไฟล์");
          const bytes = await readFile(resolve(root, id));
          res.writeHead(200, {
            "Content-Type": f.mime,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox; default-src 'none'",
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
            "Cache-Control": "private, no-store",
          });
          return res.end(bytes);
        }
      }
      if (path === "/api/accounts" && session?.role === "coord") {
        if (req.method === "GET") {
          const { rows } = await pool.query(
            "SELECT id,username,name,role,unit_id,team,active,must_change FROM accounts ORDER BY username",
          );
          return json(res, 200, {
            accounts: rows.map((a) => ({
              ...accountView(a),
              active: a.active,
            })),
          });
        }
        if (req.method === "POST") {
          const input = await body(req, 8192);
          const { document } = await readState(pool);
          const role = input.role;
          const unit = document.units.find((u) => u.id === input.unitId);
          const username = String(
            role === "mentee" ? unit?.code || "" : input.username || "",
          ).trim();
          if (
            !["mentee", "mentor", "coord"].includes(role) ||
            !username ||
            username.length > 80 ||
            typeof input.name !== "string" ||
            !input.name.trim() ||
            input.name.length > 200 ||
            (role === "mentee" && !unit) ||
            (role === "mentor" &&
              !document.teams.some((t) => t.id === +input.team))
          )
            fail(400, "ข้อมูลบัญชีไม่ถูกต้อง");
          const hash = await hashPassword(input.password);
          const id = randomUUID();
          await transaction(pool, async (c) => {
            await c.query(
              "INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id,
                username,
                input.name.trim(),
                hash,
                role,
                unit?.id || null,
                role === "mentor" ? +input.team : null,
              ],
            );
            await audit(c, session.id, "create-account", id);
          });
          return json(res, 201, { ok: true });
        }
      }
      const account = path.match(/^\/api\/accounts\/([\w-]+)$/);
      if (account && req.method === "PATCH" && session?.role === "coord") {
        const input = await body(req, 4096);
        if (account[1] === session.id && input.active === false)
          fail(400, "ปิดบัญชีตนเองไม่ได้");
        const hash = input.password ? await hashPassword(input.password) : null;
        await transaction(pool, async (c) => {
          const { rows } = await c.query(
            "SELECT id FROM accounts WHERE id=$1",
            [account[1]],
          );
          if (!rows.length) fail(404, "ไม่พบบัญชี");
          if (typeof input.active === "boolean")
            await c.query("UPDATE accounts SET active=$1 WHERE id=$2", [
              input.active,
              account[1],
            ]);
          if (hash)
            await c.query(
              "UPDATE accounts SET password_hash=$1,must_change=true WHERE id=$2",
              [hash, account[1]],
            );
          await c.query("DELETE FROM sessions WHERE account_id=$1", [
            account[1],
          ]);
          await audit(c, session.id, "update-account", account[1]);
        });
        return json(res, 200, { ok: true });
      }
      if (
        path === "/api/audit" &&
        req.method === "GET" &&
        session?.role === "coord"
      ) {
        const { rows } = await pool.query(
          "SELECT action,resource,account_id,revision,created_at FROM audit ORDER BY created_at DESC LIMIT 100",
        );
        return json(res, 200, { events: rows });
      }
      fail(session ? 404 : 401, session ? "ไม่พบรายการ" : "กรุณาเข้าสู่ระบบ");
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = e.status || (e.code === "23505" ? 409 : 500);
      json(res, status, {
        error:
          status === 500
            ? "ระบบไม่สามารถทำรายการได้ กรุณาลองใหม่"
            : e.code === "23505"
              ? "ข้อมูลนี้มีอยู่แล้ว"
              : e.message,
      });
      if (status === 500) console.error("Request failed:", e.code || e.name);
    }
  });
}
function sessionAction(action) {
  if (!["submit", "review", "return", "reopen"].includes(action))
    fail(400, "คำสั่งไม่ถูกต้อง");
  return action;
}
