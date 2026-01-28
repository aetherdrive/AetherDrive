import express from "express";
import engine from "./engine.js";

const app = express();
const PORT = process.env.PORT || 10000;
const INTEGRATION_ENDPOINT =
  process.env.INTEGRATION_ENDPOINT || "https://aetherdrive.onrender.com/api/metrics";
const INTEGRATION_KEY = process.env.INTEGRATION_KEY || "demo-key";

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  return next();
});

let cachedMetrics = null;
let cachedAt = 0;
const CACHE_TTL_MS = 3000;

function buildMetrics() {
  const now = new Date();
  const engineData = engine.run(now);
  return {
    status: engineData.status,
    users: engineData.users,
    revenue: engineData.monthlyRevenueNOK,
    currency: "NOK",
    employees: engineData.employees,
    importStatus: engineData.importStatus,
    integration: {
      endpoint: INTEGRATION_ENDPOINT,
      key: INTEGRATION_KEY
    },
    generatedAt: engineData.generatedAt
  };
}

function getMetrics() {
  const now = Date.now();
  if (!cachedMetrics || now - cachedAt > CACHE_TTL_MS) {
    cachedMetrics = buildMetrics();
    cachedAt = now;
  }
  return cachedMetrics;
}

setInterval(() => {
  cachedMetrics = buildMetrics();
  cachedAt = Date.now();
}, CACHE_TTL_MS).unref();

app.get("/", (req, res) => {
  res.send("AetherDrive backend is running 🚀");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/metrics", (req, res) => {
  res.set("Cache-Control", "public, max-age=2, stale-while-revalidate=8");
  res.json(getMetrics());
});

app.get("/api/integration", (req, res) => {
  res.json({
    endpoint: INTEGRATION_ENDPOINT,
    key: INTEGRATION_KEY
  });
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
