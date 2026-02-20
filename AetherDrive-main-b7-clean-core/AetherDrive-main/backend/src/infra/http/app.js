import express from "express";
import helmet from "helmet";

import { requestContext } from "../middleware/requestContext.js";
import { requestId } from "../middleware/requestId.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { authenticate } from "../middleware/auth.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { requireIdempotencyKey } from "../middleware/requireIdempotencyKey.js";
import {
  assertIntegrationConfiguration,
  requireIntegrationKey,
} from "../middleware/integrationAuth.js";

import { createHealthRouter } from "../routes/health.js";
import { docsRouter } from "../routes/docs.js";
import { enginePayrollRouter } from "../routes/engine.payroll.routes.js";

// Legacy (optional)
import { jobsRouter } from "../../modules/legacy/http/routes/jobs.routes.js";
import { integrationsRouter } from "../../modules/legacy/http/routes/integrations.routes.js";
import complianceRouter from "../../modules/legacy/http/routes/compliance.js";
import { metricsRouter } from "../../modules/legacy/http/routes/metrics.js";

function isProd() {
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

function boolEnv(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function corsMiddleware() {
  return (req, res, next) => {
    const allowed = (process.env.CORS_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const origin = req.headers.origin;
    if (origin && allowed.includes(origin)) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Vary", "Origin");
    }

    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-PAYBRIDGE-KEY, X-API-Key, X-User-Role, X-Idempotency-Key, X-Request-Id"
    );

    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  };
}

export function createApp() {
  // Integration key configuration
  // - In production we hard-fail if INTEGRATION_KEY is missing (unless PB_ALLOW_INSECURE_INTEGRATIONS=true)
  // - In development/pilot we only warn so the server can start
  try {
    assertIntegrationConfiguration();
  } catch (e) {
    if (isProd()) throw e;
    console.warn(String(e?.message || e));
  }

  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));

  // Minimal structured access log (JSON)
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - started;
      const rid = req.header("X-Request-Id") || res.getHeader("X-Request-Id");
      console.log(
        JSON.stringify({
          level: "info",
          rid: rid || null,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          ms,
        })
      );
    });
    next();
  });

  app.use(requestContext);
  app.use(requestId);
  app.use(rateLimit({ windowMs: 10 * 60 * 1000, max: 100 }));
  app.use(corsMiddleware());

  // Auth: enable JWT only when JWT_SECRET is configured (recommended for production).
  if (process.env.JWT_SECRET) {
    app.use(authenticate);
  } else {
    console.warn("JWT_SECRET not set: authentication middleware is disabled (pilot/dev mode).");
  }

  // Public / always-on
  app.get("/", (req, res) => res.send("AetherDrive backend is running"));
  app.use(createHealthRouter());
  app.use("/docs", docsRouter);

  // Embedded contract: /v1
  // All writes require idempotency key.
  app.use("/v1", requireIdempotencyKey);
  app.use("/v1", requireIntegrationKey, enginePayrollRouter);

  // Backwards compatibility: /api (deprecated)
  if (boolEnv("ENABLE_API_COMPAT", true)) {
    app.use("/api", requireIdempotencyKey);
    app.use("/api", requireIntegrationKey, enginePayrollRouter);
  }

  // Legacy modules are off by default to keep the embedded core clean.
  if (boolEnv("FEATURE_LEGACY_MODULES", false)) {
    app.use("/jobs", jobsRouter);
    app.use("/integrations", integrationsRouter);
    app.use("/compliance", complianceRouter);
    app.use("/metrics", metricsRouter);
  }

  // Error handler last
  app.use(errorHandler);

  return app;
}
