import express from "express";
import fs from "fs";
import path from "path";

import engine from "../../../core/engine.js";

const POLICY_PATH = path.resolve("config/policy.json");
let policy = null;

function loadPolicyOnce() {
  if (policy) return policy;
  try {
    policy = JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));
  } catch {
    policy = { metrics: { detailLevel: "TOTALS" } };
  }
  return policy;
}

export const metricsRouter = express.Router();

// Legacy metrics endpoint (kept behind FEATURE_LEGACY_MODULES)
metricsRouter.get("/", (req, res) => {
  const p = loadPolicyOnce();
  res.json(engine.run(new Date(), p));
});
