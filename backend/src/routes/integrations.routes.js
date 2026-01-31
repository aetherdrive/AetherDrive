import express from "express";
import { requireRole } from "../middleware/authz.js";
import { queueAmelding } from "../services/altinnService.js";
import { reconcileRun } from "../services/payrollService.js";

export const integrationsRouter = express.Router();

integrationsRouter.post("/amelding/:runId", requireRole(["employer_admin","accountant"]), async (req,res) => {
  const runId = req.params.runId;
  const report = await reconcileRun(runId);
  if (!report) return res.status(404).json({ ok: false, error: "run_not_found" });
  const period = report.period_start.slice(0,7);
  const job = queueAmelding({ runId, companyId: report.companyId, period });
  return res.status(202).json({ ok: true, job, message: "queued_for_submission" });
});
