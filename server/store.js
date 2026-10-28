import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required; no automatic demo database");
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
  });
}
export async function migrate(pool) {
  await pool.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
}
export async function transaction(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function audit(c, actor, action, resource, revision = null) {
  await c.query(
    "INSERT INTO audit(id,account_id,action,resource,revision) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(), actor, action, resource, revision],
  );
}
export async function readState(c, lock = false) {
  const { rows } = await c.query(
    "SELECT document,revision FROM app_state WHERE id=1" +
      (lock ? " FOR UPDATE" : ""),
  );
  if (!rows.length)
    throw Object.assign(new Error("ยังไม่ได้เตรียมข้อมูลระบบ"), {
      status: 503,
    });
  return rows[0];
}
