import express from "express";
import engine from "./engine.js";

import fs from "fs";
import path from "path";
import crypto from "crypto"

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



const app = express();
const PORT = process.env.PORT || 10000;

const INTEGRATION_ENDPOINT =
  process.env.INTEGRATION_ENDPOINT || "https://aetherdrive.onrender.com/api/metrics";
const INTEGRATION_KEY = process.env.INTEGRATION_KEY || "demo-key"; // DEMO: ikke eksponer i prod

app.post("/api/time-events/import", (req, res) => {
  if (!requireIntegrationKey(req, res)) return;

  const source = String(req.body?.source || "unknown");
  const events = Array.isArray(req.body?.events) ? req.body.events : [];

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


app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// CORS (enkelt nå, strammere senere)
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Tillat også API key header for integrasjoner
  res.set("Access-Control-Allow-Headers", "Content-Type, X-AETHERDRIVE-KEY, Authorization, X-API-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
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

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
  console.log(`Policy loaded from: ${POLICY_PATH} (version: ${policy?.version ?? "none"})`);
});
