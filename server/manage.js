import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { initialState } from "./seed.js";
import { prepareImport } from "./import.js";
import { fileType } from "./app.js";
import { database, migrate, transaction, audit, readState } from "./store.js";
import { hashPassword, hashToken } from "./auth.js";
import { validateAssessment, validateContent } from "./policy.js";
const command = process.argv[2];
const pool = database();
try {
  if (command === "migrate") {
    await migrate(pool);
    const found = await pool.query("SELECT id FROM app_state WHERE id=1");
    if (!found.rows.length) {
      const state = await initialState();
      await pool.query("INSERT INTO app_state(id,document) VALUES(1,$1)", [
        JSON.stringify(state),
      ]);
    }
    console.log("Schema ready. Existing records were not replaced.");
  } else if (command === "account") {
    const [username, name, role, scope] = process.argv.slice(3);
    if (!["mentee", "mentor", "coord"].includes(role))
      throw Error(
        "Usage: account username name mentee|mentor|coord [unit-id|team-number]; password in GECC_NEW_PASSWORD",
      );
    const hash = await hashPassword(process.env.GECC_NEW_PASSWORD);
    const { document } = await readState(pool);
    const unit =
      role === "mentee" ? document.units.find((u) => u.id === scope) : null;
    if (
      (role === "mentee" && (!unit || unit.code !== username)) ||
      (role === "mentor" && !document.teams.some((t) => t.id === +scope))
    )
      throw Error("Account scope does not match organization code/group");
    if (!username || username.length > 80 || !name)
      throw Error("Username and name are required");
    await transaction(pool, async (c) => {
      const id = randomUUID();
      await c.query(
        "INSERT INTO accounts(id,username,name,password_hash,role,unit_id,team) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          username,
          name,
          hash,
          role,
          unit?.id || null,
          role === "mentor" ? +scope : null,
        ],
      );
      await audit(c, id, "provision-account", id);
    });
    console.log("Account created; password change required on first login.");
  } else if (command === "import") {
    const path = process.argv[3];
    if (!path)
      throw Error(
        "Usage: import bundle.json [--apply-empty] [--include-sample]",
      );
    const bundle = JSON.parse(await readFile(path, "utf8"));
    const state = bundle.state || bundle;
    const problems = [];
    if (
      !Array.isArray(state.units) ||
      !state.assess ||
      !Array.isArray(state.defects)
    )
      throw Error("Invalid GECC data");
    if (state.isSample && !process.argv.includes("--include-sample"))
      problems.push(
        "Sample flag present; owner must explicitly classify data before import.",
      );
    const files = new Map((bundle.files || []).map((f) => [f.id, f]));
    const { document } = await readState(pool);
    const ids = new Set(document.units.map((u) => u.id));
    for (const [id, a] of Object.entries(state.assess)) {
      if (!ids.has(id)) problems.push("Unknown organization: " + id);
      try {
        validateAssessment(a);
      } catch (e) {
        problems.push(id + ": " + e.message);
      }
      for (const f of [
        ...Object.values(a.ev || {}).flatMap((e) => e.files || []),
        ...(a.quick || []).flatMap((q) => q.files || []),
      ]) {
        const file = files.get(f.id);
        if (!file || file.unitId !== id) problems.push("Missing file: " + f.id);
      }
    }
    for (const f of files.values()) {
      const bytes = Buffer.from(f.base64 || "", "base64");
      if (
        !/^[A-Za-z0-9_-]{1,160}$/.test(f.id) ||
        !ids.has(f.unitId) ||
        bytes.length !== f.size ||
        bytes.length > 10 * 1024 * 1024 ||
        hashToken(bytes) !== f.sha256 ||
        fileType(bytes) !== f.type
      )
        problems.push("Invalid file: " + f.id);
    }
    if (Object.keys(document.assess).length || document.defects.length)
      problems.push(
        "Target already contains assessments. Merge must be reviewed; replacement is disabled.",
      );
    try {prepareImport(document,{...state,isSample:false});}catch(error){problems.push(error.message);}
    if(files.size!==(bundle.files||[]).length)problems.push('Duplicate file IDs in archive');
    console.log(
      JSON.stringify(
        {
          dryRun: !process.argv.includes("--apply-empty"),
          organizations: state.units.length,
          assessments: Object.keys(state.assess).length,
          files: files.size,
          problems,
        },
        null,
        2,
      ),
    );
    if (problems.length) {
      process.exitCode = 1;
    } else if (process.argv.includes("--apply-empty")) {
      const root = resolve(process.env.FILE_ROOT || "./var/files");
      await mkdir(root, { recursive: true });
      const created = [];
      try {
        await transaction(pool, async (c) => {
          const locked = await readState(c, true);
          if (
            Object.keys(locked.document.assess).length ||
            locked.document.defects.length
          )
            throw Error("Target changed; import cancelled");
          const owner = await c.query(
            "SELECT id FROM accounts WHERE role='coord' AND active=true LIMIT 1",
          );
          if (!owner.rows.length)
            throw Error("Create coordinator account before importing files");
          for (const f of files.values()) {
            const file = resolve(root, f.id);
            await writeFile(file, Buffer.from(f.base64, "base64"), {
              flag: "wx",
            });
            created.push(file);
            await c.query(
              "INSERT INTO files(id,unit_id,account_id,name,mime,size,digest) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                f.id,
                f.unitId,
                owner.rows[0].id,
                f.name,
                f.type,
                f.size,
                f.sha256,
              ],
            );
          }
          const next = prepareImport(locked.document, {
            ...state,
            isSample: false,
          });
          await c.query(
            "UPDATE app_state SET document=$1,revision=$2 WHERE id=1",
            [JSON.stringify(next), locked.revision + 1],
          );
          await audit(
            c,
            owner.rows[0].id,
            "import",
            "state",
            locked.revision + 1,
          );
        });
        console.log(
          "Import verified and committed. Original bundle was not changed.",
        );
      } catch (e) {
        await Promise.allSettled(created.map((f) => unlink(f)));
        throw e;
      }
    }
  } else throw Error("Choose migrate, account or import");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
