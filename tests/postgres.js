import { PGlite } from "@electric-sql/pglite";
// Real embedded PostgreSQL engine for isolated tests. No agency database is used.
export async function testDatabase() {
  const db = new PGlite();
  await db.waitReady;
  const pool = {
    async query(sql, params) {
      if (!params && /CREATE TABLE/.test(sql)) {
        await db.exec(sql);
        return { rows: [] };
      }
      return db.query(sql, params);
    },
    async connect() {
      return { query: (...args) => pool.query(...args), release() {} };
    },
    async end() {
      await db.close();
    },
  };
  return pool;
}
