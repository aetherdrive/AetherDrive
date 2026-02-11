import express from "express";
import { requireRole } from "../middleware/authz.js";
import { requireIntegrationKey } from "../middleware/integrationAuth.js";
import { listJobs } from "../services/jobQueueService.js";

export const jobsRouter = express.Router();

jobsRouter.get("/", requireIntegrationkey, requireRole(["employer_admin","accountant"]), (req,res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  res.json({ ok: true, jobs: listJobs({ status }) });
});
