import crypto from "crypto";
import { getPool, hasDb } from "../db/dbClient.js";

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/**
 * Wrap an async route handler in a DB transaction where:
 * 1) X-API-Key is resolved to org_id
 * 2) app.org_id is set (for RLS)
 * 3) a PG client is provided as req.db
 */
export function withOrgDb(handler) {
  return async (req, res, next) => {
    if (!hasDb()) {
      const err = new Error("db_not_configured");
      err.status = 500;
      return next(err);
    }

    const apiKey = req.header("X-API-Key") || req.header("x-api-key");
    if (!apiKey) {
      return res.status(401).json({ ok: false, error: "api_key_required" });
    }

    const keyHash = sha256Hex(String(apiKey));
    const pool = getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Allow RLS policy on aetherdrive.api_keys to match this hash
      await client.query("SELECT set_config('app.key_hash', $1, true)", [keyHash]);

      const r = await client.query(
        `SELECT org_id
         FROM aetherdrive.api_keys
         WHERE key_hash = $1 AND is_active = true
         LIMIT 1`,
        [keyHash]
      );

      if (r.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(401).json({ ok: false, error: "api_key_invalid" });
      }

      const orgId = r.rows[0].org_id;
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);

      // Fetch tenant capabilities (feature flags / provider selection)
      const c = await client.query(
        "SELECT capabilities FROM aetherdrive.organizations WHERE id=$1 LIMIT 1",
        [orgId]
      );
      const capabilities = c.rows[0]?.capabilities || {};

      req.orgId = orgId;
      req.capabilities = capabilities;
      req.db = client;

      // Run handler
      await handler(req, res);

      if (!res.headersSent) {
        // Handler forgot to respond
        throw new Error("handler_no_response");
      }

      await client.query("COMMIT");
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback errors
      }
      return next(e);
    } finally {
      client.release();
      req.db = null;
    }
  };
}
