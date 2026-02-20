import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query, hasDb } from "./dbClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readSql(relPath) {
  // __dirname: backend/src/infra/db -> up to backend/, then resolve relPath
  const p = path.resolve(__dirname, "..", "..", "..", relPath);
  return fs.readFileSync(p, "utf8");
}

if (!hasDb()) {
  console.error("DATABASE_URL not set. Cannot init DB.");
  process.exit(1);
}

// 1) Core multi-tenant schema (RLS, time_events, import_runs, api_keys, orgs)
const schemaSql = readSql("db/schema.sql");

await query(schemaSql);

console.log("DB initialized:");
console.log("- aetherdrive schema (orgs, api_keys, time_events, import_runs, reviews, payroll engine) + RLS");
console.log("Next: create at least one org + api key hash (see backend/db/bootstrap.sql or run npm run db:bootstrap)");

process.exit(0);
