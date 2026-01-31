import { Pool } from "pg";

let pool = null;

export function hasDb() {
  return !!process.env.DATABASE_URL;
}

export function getPool() {
  if (!hasDb()) throw new Error("db_not_configured");
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function query(text, params = []) {
  const p = getPool();
  return p.query(text, params);
}
