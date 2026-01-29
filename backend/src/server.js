import express from "express";
import engine from "./engine.js";

import fs from "fs";
import path from "path";
import crypto from "crypto";

const POLICY_PATH = path.resolve("config/policy.json");
const policy = JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));
const EMPLOYEES_PATH = path.resolve("data/employees.json");
const TIME_EVENTS_PATH = path.resolve("data/time_events.json");
const IMPORT_STATUS_PATH = path.resolve("data/import_status.json");


function loadEmployees() {
  try {
    const raw = fs.readFileSync(EMPLOYEES_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn(`Employees file not found or invalid JSON: ${EMPLOYEES_PATH}`);
    return [];
  }
}

function readJsonArray(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function loadTimeEvents() {
  return readJsonArray(TIME_EVENTS_PATH);
}

function saveTimeEvents(events) {
  writeJson(TIME_EVENTS_PATH, events);
}

function loadImportStatus() {
  try {
    const raw = fs.readFileSync(IMPORT_STATUS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveImportStatus(status) {
  writeJson(IMPORT_STATUS_PATH, status);
}

function requireIntegrationKey(req, res) {
  const key = req.header("X-AETHERDRIVE-KEY") || "";
  if (key !== INTEGRATION_KEY) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function isValidEvent(e) {
  if (!e || typeof e !== "object") return false;
  if (typeof e.employeeRef !== "string" || !e.employeeRef.trim()) return false;
  if (typeof e.occurredAt !== "string" || Number.isNaN(new Date(e.occurredAt).getTime())) return false;

  const type = String(e.type || "").toUpperCase();
  return ["IN", "OUT", "BREAK_START", "BREAK_END"].includes(type);
}

function normalizeJsonBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body && typeof body === "object" ? body : {};
}



const app = express();
const PORT = process.env.PORT || 10000;


const INTEGRATION_ENDPOINT =
  process.env.INTEGRATION_ENDPOINT || "https://aetherdrive.onrender.com/api/metrics";
const INTEGRATION_KEY = process.env.INTEGRATION_KEY || "demo-key"; // DEMO: ikke eksponer i prod

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.post("/api/time-events/import", (req, res) => {
  if (!requireIntegrationKey(req, res)) return;

  const body = normalizeJsonBody(req.body);
  const source = String(body.source || "unknown");
  const events = Array.isArray(body.events) ? body.events : [];


  if (events.length === 0) {
    return res.status(400).json({ ok: false, error: "events_required" });
  }

  const existing = loadTimeEvents();
  const seen = new Set(existing.map((ev) => `${ev.source}:${ev.externalId}`));

  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;

  const nowIso = new Date().toISOString();

  for (const e of events) {
    try {
      if (!isValidEvent(e)) {
        rejected++;
        continue;
      }

      const employeeRef = e.employeeRef.trim();
      const occurredAt = new Date(e.occurredAt).toISOString();
      const type = String(e.type).toUpperCase();
      const deviceId = e.deviceId ? String(e.deviceId) : null;

      const externalId =
        (e.externalId && String(e.externalId)) ||
        sha256(`${source}|${employeeRef}|${occurredAt}|${type}|${deviceId ?? ""}`);

      const key = `${source}:${externalId}`;

      if (seen.has(key)) {
        duplicates++;
        continue;
      }

      existing.push({
        source,
        externalId,
        employeeRef,
        occurredAt,
        type,
        deviceId,
        receivedAt: nowIso
      });

      seen.add(key);
      accepted++;
    } catch {
      rejected++;
    }
  }

  saveTimeEvents(existing);

  const status = {
    lastImportAt: nowIso,
    accepted,
    duplicates,
    rejected,
    totalStored: existing.length
  };
  saveImportStatus(status);

  return res.json({ ok: true, ...status });
});



app.get("/api/time-events/status", (req, res) => {
  const status = loadImportStatus();
  res.json(
    status || { lastImportAt: null, accepted: 0, duplicates: 0, rejected: 0, totalStored: loadTimeEvents().length }
  );
});

function parseDateOnlyToUtcIso(dateStr, endOfDay = false) {
  // dateStr: "YYYY-MM-DD"
  const [y, m, d] = String(dateStr).split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = endOfDay
    ? new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
    : new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  return dt.toISOString();
}

function filterEvents(events, { employeeRef, fromIso, toIso }) {
  return events.filter((e) => {
    if (employeeRef && String(e.employeeRef) !== String(employeeRef)) return false;
    if (fromIso && String(e.occurredAt) < fromIso) return false;
    if (toIso && String(e.occurredAt) > toIso) return false;
    return true;
  });
}

function groupByLocalDateUTC(iso) {
  // Since policy timezone is UTC currently, we group by YYYY-MM-DD in UTC.
  // Later: implement timezone conversion based on policy.locale.timezone.
  return iso.slice(0, 10);
}

function summarizeEmployeeEvents(events) {
  // Events are expected sorted by occurredAt asc␊
  let openIn = null; // { at }
  let openBreak = null;
  let lastOutAt = null;

  const shifts = []; // { inAt, outAt, workMs, breakMs, anomalies: [] }␊
  const anomalies = []; // global anomalies␊
  let breakMsAcc = 0;

  for (const ev of events) {
    const type = String(ev.type || "").toUpperCase();

    if (type === "IN") {
      if (openIn) {
        anomalies.push({ type: "DOUBLE_IN", at: ev.occurredAt, details: "IN received while already IN" });
      } else {
        openIn = { at: ev.occurredAt };
        breakMsAcc = 0;
        openBreak = null;
      }
      continue;
    }
 if (type === "OUT") {
      if (!openIn) {
        if (lastOutAt) {
          const prev = Date.parse(lastOutAt);
          const cur = Date.parse(ev.occurredAt);
          if (Number.isFinite(prev) && Number.isFinite(cur) && Math.abs(cur - prev) <= 2 * 60 * 1000) {
            anomalies.push({ type: "DUPLICATE_OUT", at: ev.occurredAt });
            continue;
          }
        }

        anomalies.push({ type: "OUT_WITHOUT_IN", at: ev.occurredAt });
        continue;
      }

      if (openBreak) {
        anomalies.push({ type: "OPEN_BREAK_AT_OUT", at: ev.occurredAt });
        openBreak = null;
      }

      const inAtMs = Date.parse(openIn.at);
      const outAtMs = Date.parse(ev.occurredAt);

      if (!Number.isFinite(inAtMs) || !Number.isFinite(outAtMs) || outAtMs <= inAtMs) {
        anomalies.push({ type: "INVALID_SHIFT_RANGE", inAt: openIn.at, outAt: ev.occurredAt });
      } else {
        const totalMs = outAtMs - inAtMs;
        const workMs = Math.max(0, totalMs - breakMsAcc);

        shifts.push({
          inAt: openIn.at,
          outAt: ev.occurredAt,
          totalMs,
          breakMs: breakMsAcc,
          workMs
        });

        lastOutAt = ev.occurredAt;
      }

      openIn = null;
      breakMsAcc = 0;
      openBreak = null;
      continue;
    }

    if (type === "BREAK_START") {
      if (!openIn) {
        anomalies.push({ type: "BREAK_START_WITHOUT_IN", at: ev.occurredAt });
        continue;
      }
      if (openBreak) {
        anomalies.push({ type: "DOUBLE_BREAK_START", at: ev.occurredAt });
        continue;
      }
      openBreak = { at: ev.occurredAt };
      continue;
    }

    if (type === "BREAK_END") {
      if (!openIn) {
        anomalies.push({ type: "BREAK_END_WITHOUT_IN", at: ev.occurredAt });
        continue;
      }
      if (!openBreak) {
        anomalies.push({ type: "BREAK_END_WITHOUT_START", at: ev.occurredAt });
        continue;
      }
	 
	 const bs = Date.parse(openBreak.at);
      const be = Date.parse(ev.occurredAt);
      if (Number.isFinite(bs) && Number.isFinite(be) && be > bs) {
        breakMsAcc += (be - bs);
      } else {
        anomalies.push({ type: "INVALID_BREAK_RANGE", start: openBreak.at, end: ev.occurredAt });
      }
      openBreak = null;
      continue;
    }

    anomalies.push({ type: "UNKNOWN_EVENT_TYPE", at: ev.occurredAt, value: ev.type });
  }

  if (openIn) anomalies.push({ type: "MISSING_OUT", inAt: openIn.at });
  if (openBreak) anomalies.push({ type: "MISSING_BREAK_END", breakStartAt: openBreak.at });

  // Day summaries (UTC day buckets for now)
  const byDay = {};
  for (const s of shifts) {
    const day = groupByLocalDateUTC(s.inAt);
    if (!byDay[day]) byDay[day] = { day, shifts: 0, workMs: 0, breakMs: 0 };
    byDay[day].shifts += 1;
    byDay[day].workMs += s.workMs;
    byDay[day].breakMs += s.breakMs;
  }

  const days = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));

  const totalWorkMs = shifts.reduce((acc, s) => acc + s.workMs, 0);
  const totalBreakMs = shifts.reduce((acc, s) => acc + s.breakMs, 0);

  return { shifts, days, totalWorkMs, totalBreakMs, anomalies };
}

function msToHours(ms) {
  return Math.round((ms / 3600000) * 100) / 100; // 2 decimals
}



// CORS (enkelt nå, strammere senere)
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Tillat også API key header for integrasjoner
  res.set("Access-Control-Allow-Headers", "Content-Type, X-AETHERDRIVE-KEY, Authorization, X-API-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

app.post("/api/debug/echo", (req, res) => {
  res.json({
    contentType: req.headers["content-type"] || null,
    bodyType: typeof req.body,
    body: req.body,
    keys: req.body && typeof req.body === "object" ? Object.keys(req.body) : null
  });
});


// ---- Metrics cache ----
let cachedMetrics = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15000;


function buildMetrics() {
  const now = new Date();

  const employees = loadEmployees();
  const input = { employees };
  const engineData = engine.run(input, now, policy);
  const importStatus = loadImportStatus() || engineData.importStatus;

  return {
    status: engineData.status,
    users: engineData.users,
    revenue: engineData.monthlyRevenueNOK,
    currency: policy?.locale?.currency ?? "NOK",
    employees: engineData.employees,
    importStatus,

    // Explainability
    explain: engineData.explain,

    integration: {
      endpoint: INTEGRATION_ENDPOINT
      // key: INTEGRATION_KEY // DEMO ONLY
    },

    generatedAt: engineData.generatedAt ?? now.toISOString()
  };
}


function getMetrics() {
  const nowMs = Date.now();
  if (!cachedMetrics || nowMs - cachedAt > CACHE_TTL_MS) {
    cachedMetrics = buildMetrics();
    cachedAt = nowMs;
  }
  return cachedMetrics;
}

// Pre-warm cache i bakgrunnen
setInterval(() => {
  cachedMetrics = buildMetrics();
  cachedAt = Date.now();
}, CACHE_TTL_MS).unref();

// ---- Routes ----
app.get("/", (req, res) => {
  res.send("AetherDrive backend is running 🚀");
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    policyVersion: policy?.version ?? "none"
  });
});

// ✅ Nå bruker /api/metrics cache (én sannhet)
app.get("/api/metrics", (req, res) => {
  res.json(getMetrics());
});

// Demo-only: vis endpoint (ikke key)
app.get("/api/integration", (req, res) => {
  res.json({
    endpoint: INTEGRATION_ENDPOINT
    // key: INTEGRATION_KEY // DEMO ONLY – anbefalt å holde av
  });
});

app.get("/api/time-events", (req, res) => {
  const employeeRef = req.query.employeeRef ? String(req.query.employeeRef) : null;

  const from = req.query.from ? String(req.query.from) : null; // YYYY-MM-DD or ISO
  const to = req.query.to ? String(req.query.to) : null;

  const fromIso = from && from.length === 10 ? parseDateOnlyToUtcIso(from, false) : from;
  const toIso = to && to.length === 10 ? parseDateOnlyToUtcIso(to, true) : to;

  const all = loadTimeEvents().slice().sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  const filtered = filterEvents(all, { employeeRef, fromIso, toIso });

  res.json({
    employeeRef,
    from: fromIso || null,
    to: toIso || null,
    count: filtered.length,
    events: filtered
  });
});

app.get("/api/time/summary", (req, res) => {
  const employeeRef = req.query.employeeRef ? String(req.query.employeeRef) : null;
  const from = req.query.from ? String(req.query.from) : null; // YYYY-MM-DD
  const to = req.query.to ? String(req.query.to) : null;       // YYYY-MM-DD

  if (!employeeRef) return res.status(400).json({ ok: false, error: "employeeRef_required" });
  if (!from || !to) return res.status(400).json({ ok: false, error: "from_to_required" });

  const fromIso = from.length === 10 ? parseDateOnlyToUtcIso(from, false) : null;
  const toIso = to.length === 10 ? parseDateOnlyToUtcIso(to, true) : null;

  if (!fromIso || !toIso) return res.status(400).json({ ok: false, error: "invalid_date_format" });

  const all = loadTimeEvents().slice().sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  const filtered = filterEvents(all, { employeeRef, fromIso, toIso });

  const summary = summarizeEmployeeEvents(filtered);

  res.json({
    ok: true,
    employeeRef,
    from: fromIso,
    to: toIso,
    eventCount: filtered.length,
    totals: {
      workHours: msToHours(summary.totalWorkMs),
      breakHours: msToHours(summary.totalBreakMs),
      shifts: summary.shifts.length,
      anomalyCount: summary.anomalies.length
    },
    days: summary.days.map((d) => ({
      day: d.day,
      shifts: d.shifts,
      workHours: msToHours(d.workMs),
      breakHours: msToHours(d.breakMs)
    })),
    anomalies: summary.anomalies.slice(0, 100) // cap for safety
  });
});


app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
  console.log(`Policy loaded from: ${POLICY_PATH} (version: ${policy?.version ?? "none"})`);
});
