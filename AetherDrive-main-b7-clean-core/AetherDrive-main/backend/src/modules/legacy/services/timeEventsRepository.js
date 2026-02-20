import crypto from "crypto";

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export function isValidTimeEvent(e) {
  if (!e || typeof e !== "object") return false;
  if (typeof e.employeeRef !== "string" || !e.employeeRef.trim()) return false;
  if (typeof e.occurredAt !== "string" || Number.isNaN(new Date(e.occurredAt).getTime())) return false;
  const type = String(e.type || "").toUpperCase();
  return ["IN", "OUT", "BREAK_START", "BREAK_END"].includes(type);
}

export function normalizeIncomingEvent({ source, event }) {
  const employeeRef = String(event.employeeRef).trim();
  const occurredAt = new Date(event.occurredAt).toISOString();
  const type = String(event.type).toUpperCase();
  const deviceId = event.deviceId ? String(event.deviceId) : null;

  const externalId =
    (event.externalId && String(event.externalId)) ||
    sha256Hex(`${source}|${employeeRef}|${occurredAt}|${type}|${deviceId ?? ""}`);

  return {
    source,
    externalId,
    employeeRef,
    occurredAt,
    type,
    deviceId,
    payload: event,
  };
}

/**
 * Inserts normalized events. Requires req.db with app.org_id set (RLS).
 * Returns { accepted, duplicates } for valid events. Rejected is handled by caller.
 */
export async function insertTimeEvents(client, normalizedEvents) {
  if (normalizedEvents.length === 0) return { accepted: 0, duplicates: 0 };

  // Bulk insert with ON CONFLICT DO NOTHING; count inserted rows via RETURNING.
  // We reference org_id via current_setting('app.org_id') to keep tenant isolation
  // purely in Postgres (RLS + session vars), not JS.
  const vals = [];
  const p = [];
  let k = 1;
  for (const e of normalizedEvents) {
    vals.push(
      `(current_setting('app.org_id', true)::uuid, $${k++}, $${k++}, $${k++}, $${k++}, $${k++}, $${k++}, $${k++}::jsonb)`
    );
    p.push(e.source, e.externalId, e.employeeRef, e.occurredAt, e.type, e.deviceId, JSON.stringify(e.payload));
  }

  const q = `
    INSERT INTO aetherdrive.time_events
      (org_id, source, external_id, employee_ref, occurred_at, type, device_id, payload)
    VALUES ${vals.join(",")}
    ON CONFLICT (org_id, source, external_id) DO NOTHING
    RETURNING id;
  `;

  const r = await client.query(q, p);
  const accepted = r.rowCount;
  const duplicates = normalizedEvents.length - accepted;
  return { accepted, duplicates };
}

export async function recordImportRun(client, { source, requestId, accepted, duplicates, rejected }) {
  await client.query(
    `
    INSERT INTO aetherdrive.import_runs (org_id, source, request_id, accepted, duplicates, rejected)
    VALUES (current_setting('app.org_id', true)::uuid, $1, $2, $3, $4, $5)
    `,
    [source, requestId || null, accepted, duplicates, rejected]
  );
}

export async function getTimeEventsStatus(client) {
  const last = await client.query(
    `
    SELECT source, request_id, accepted, duplicates, rejected, received_at
    FROM aetherdrive.import_runs
    ORDER BY received_at DESC
    LIMIT 1
    `
  );

  const total = await client.query(
    `SELECT COUNT(*)::int AS n FROM aetherdrive.time_events;`
  );

  if (last.rowCount === 0) {
    return {
      lastImportAt: null,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      totalStored: total.rows[0].n,
    };
  }

  const r = last.rows[0];
  return {
    lastImportAt: new Date(r.received_at).toISOString(),
    accepted: r.accepted,
    duplicates: r.duplicates,
    rejected: r.rejected,
    totalStored: total.rows[0].n,
    source: r.source,
    requestId: r.request_id,
  };
}
