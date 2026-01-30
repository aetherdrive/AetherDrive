import express from "express";
import engine from "./engine.js";
import { enginePayrollRouter } from "./routes/engine.payroll.routes.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { docsRouter } from "./routes/docs.js";
import { rateLimit } from "./middleware/rateLimit.js";

import fs from "fs";
import path from "path";
import crypto from "crypto";

/* --------------------------------------------------
   Paths & config
-------------------------------------------------- */

const POLICY_PATH = path.resolve("config/policy.json");
const policy = JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));

const EMPLOYEES_PATH = path.resolve("data/employees.json");
const TIME_EVENTS_PATH = path.resolve("data/time_events.json");
const IMPORT_STATUS_PATH = path.resolve("data/import_status.json");

/* --------------------------------------------------
   EMPLOYEES CACHE (🚀 major perf win)
-------------------------------------------------- */

let employeesCache = null;
let employeesCacheMtimeMs = 0;

function loadEmployeesCached() {
  try {
    const st = fs.statSync(EMPLOYEES_PATH);

    if (employeesCache && st.mtimeMs === employeesCacheMtimeMs) {
      return employeesCache;
    }

    const raw = fs.readFileSync(EMPLOYEES_PATH, "utf8");
    const data = JSON.parse(raw);
    const employees = Array.isArray(data) ? data : [];

    employeesCache = employees;
    employeesCacheMtimeMs = st.mtimeMs;
    return employees;
  } catch (e) {
    console.warn(`Employees file not found or invalid JSON: ${EMPLOYEES_PATH}`);
    return [];
  }
}

/* --------------------------------------------------
   Generic JSON helpers
-------------------------------------------------- */

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

/* --------------------------------------------------
   Time events + import status
-------------------------------------------------- */

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

/* --------------------------------------------------
   Security & validation
-------------------------------------------------- */

const INTEGRATION_ENDPOINT =
  process.env.INTEGRATION_ENDPOINT || "https://aetherdrive.onrender.com/api/metrics";
const INTEGRATION_KEY = process.env.INTEGRATION_KEY || null;

// In secure mode, require an integration key to be provided via environment.
// If no key is supplied, throw on startup to prevent accidental exposure.
if (!INTEGRATION_KEY) {
  throw new Error(
    "Missing INTEGRATION_KEY environment variable. Set this to a strong shared secret to allow integration requests."
  );
}

function requireIntegrationKey(req, res) {
  const key = req.header("X-PAYBRIDGE-KEY") || "";
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

/* --------------------------------------------------
   Express setup
-------------------------------------------------- */

const app = express();
const PORT = process.env.PORT || 10000;

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// Apply a simple rate limiter to all requests. This helps prevent abuse and
// accidental overload. Adjust windowMs and max as needed.
app.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 100 }));

// Authenticate all incoming requests. This middleware looks for a JWT token
// in the Authorization header and populates req.user. If JWT_SECRET is not
// configured the middleware will return a 500 error. You can skip this
// middleware in development by not setting JWT_SECRET.
app.use(authenticate);

/* --------------------------------------------------
   CORS
-------------------------------------------------- */

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  // Permit custom headers used by the payroll API. In addition to
  // Content-Type and the integration key header, allow X-User-Role so
  // browsers can send the role for RBAC. You can extend this list with
  // other custom headers as needed.
  res.set("Access-Control-Allow-Headers", "Content-Type, X-PAYBRIDGE-KEY, X-User-Role, Authorization, X-API-Key");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

/* --------------------------------------------------
   Payroll Engine Routes (experimental)
   -------------------------------------------------- */
// Mount the payroll engine router under /api. Endpoints defined in
// backend/src/routes/engine.payroll.routes.js will be available as
// /api/payroll-runs, /api/payroll-runs/:id/import, etc.
app.use("/api", enginePayrollRouter);

/* --------------------------------------------------
   API Documentation
   -------------------------------------------------- */
// Serve the OpenAPI specification at /api-docs. The spec is defined in
// backend/api-docs.json and loaded by routes/docs.js. This makes it easy
// for developers to explore the available endpoints and integrate with
// the payroll API.
app.use("/api-docs", docsRouter);

// Global error handler. This should be registered after all routes so it
// catches any errors thrown from route handlers or middleware. Do not
// register routes after this line.
app.use(errorHandler);

/* --------------------------------------------------
   Metrics cache (🔥 fast path)
-------------------------------------------------- */

let cachedMetrics = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15000;

function buildMetrics() {
  const now = new Date();

  // 👇 cached employees
  const employees = loadEmployeesCached();

  // 👇 enforce FAST PATH
  const fastPolicy = {
    ...policy,
    metrics: {
      ...(policy.metrics || {}),
      detailLevel: "TOTALS"
    }
  };

  const engineData = engine.run({ employees }, now, fastPolicy);
  const importStatus = loadImportStatus() || engineData.importStatus;

  return {
    status: engineData.status,
    users: engineData.users,
    revenue: engineData.monthlyRevenueNOK,
    currency: fastPolicy?.locale?.currency ?? "NOK",
    employees: engineData.employees,
    importStatus,
    explain: engineData.explain,
    integration: {
      endpoint: INTEGRATION_ENDPOINT
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

// Pre-warm cache
setInterval(() => {
  cachedMetrics = buildMetrics();
  cachedAt = Date.now();
}, CACHE_TTL_MS).unref();

/* --------------------------------------------------
   Routes
-------------------------------------------------- */

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

app.get("/api/metrics", (req, res) => {
  res.json(getMetrics());
});

app.get("/api/integration", (req, res) => {
  res.json({ endpoint: INTEGRATION_ENDPOINT });
});

/* --------------------------------------------------
   Time events routes (unchanged)
-------------------------------------------------- */

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
    status || {
      lastImportAt: null,
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      totalStored: loadTimeEvents().length
    }
  );
});

/* --------------------------------------------------
   Start server
-------------------------------------------------- */

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
  console.log(`Policy loaded from: ${POLICY_PATH} (version: ${policy?.version ?? "none"})`);
});
