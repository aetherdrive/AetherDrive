import crypto from "crypto";
import { query, hasDb } from "./dbClient.js";

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex");
}

if (!hasDb()) {
  console.error("DATABASE_URL not set. Cannot bootstrap org.");
  process.exit(1);
}

const orgId = process.env.BOOTSTRAP_ORG_ID || "00000000-0000-0000-0000-000000000001";
const orgName = process.env.BOOTSTRAP_ORG_NAME || "Demo Org";
const apiKeyPlain = process.env.BOOTSTRAP_API_KEY;

if (!apiKeyPlain) {
  console.error("Missing BOOTSTRAP_API_KEY env. Provide a plaintext API key to hash and store.");
  process.exit(1);
}

const keyHash = sha256Hex(apiKeyPlain);

// IMPORTANT:
// We temporarily DISABLE RLS for bootstrap inserts. Run this as the DB owner.
await query("BEGIN");
try {
  await query("ALTER TABLE aetherdrive.organizations DISABLE ROW LEVEL SECURITY");
  await query("ALTER TABLE aetherdrive.api_keys DISABLE ROW LEVEL SECURITY");

  await query(
    `INSERT INTO aetherdrive.organizations (id, name)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [orgId, orgName]
  );

  await query(
    `INSERT INTO aetherdrive.api_keys (org_id, key_hash, label, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (key_hash) DO NOTHING`,
    [orgId, keyHash, "bootstrap"]
  );

  await query("ALTER TABLE aetherdrive.organizations ENABLE ROW LEVEL SECURITY");
  await query("ALTER TABLE aetherdrive.api_keys ENABLE ROW LEVEL SECURITY");
  await query("COMMIT");

  console.log("Bootstrap complete:");
  console.log(`- org_id: ${orgId}`);
  console.log(`- org_name: ${orgName}`);
  console.log(`- key_hash (stored): ${keyHash}`);
  console.log("Keep the plaintext key safe; it will not be stored in the database.");
} catch (e) {
  try {
    await query("ROLLBACK");
  } catch {
    // ignore
  }
  console.error(e);
  process.exit(1);
}

process.exit(0);
