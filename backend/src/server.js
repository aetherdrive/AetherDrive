import express from "express";
import engine from "./engine.js";

import fs from "fs";
import path from "path";

const POLICY_PATH = path.resolve("config/policy.json");
const policy = JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));
const EMPLOYEES_PATH = path.resolve("data/employees.json");

function loadEmployees() {
  try {
    const raw = fs.readFileSync(EMPLOYEES_PATH, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`Employees file not found or invalid JSON: ${EMPLOYEES_PATH}`);
    return null; // engine kan fallback'e til demo internt hvis du har det der
  }
}

const app = express();
const PORT = process.env.PORT || 10000;

const INTEGRATION_ENDPOINT =
  process.env.INTEGRATION_ENDPOINT || "https://aetherdrive.onrender.com/api/metrics";
const INTEGRATION_KEY = process.env.INTEGRATION_KEY || "demo-key"; // DEMO: ikke eksponer i prod

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
const CACHE_TTL_MS = 3000;

function buildMetrics() {
  const now = new Date();

  // ✅ Policy injiseres her, så alle tall er policy-styrt
  const employees = loadEmployees();
const input = { employees };
const engineData = engine.run(input, now, policy);


  return {
    status: engineData.status,
    users: engineData.users,
    revenue: engineData.monthlyRevenueNOK,
    currency: policy?.locale?.currency ?? "NOK",
    employees: engineData.employees,
    importStatus: engineData.importStatus,

    // ✅ Explain hvis engine returnerer det (ryddet engine.js gjør det)
    explain: engineData.explain,

    integration: {
      endpoint: INTEGRATION_ENDPOINT
      // 🚫 Ikke send key tilbake i prod (hold den server-side)
      // key: INTEGRATION_KEY
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
