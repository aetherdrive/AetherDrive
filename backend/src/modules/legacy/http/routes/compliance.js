// routes/compliance.js (ESM)
import express from "express";
import { readLastEvents } from "../../../domain/auditService.js";

const router = express.Router();

router.get("/audit", async (req, res) => {
  const limit = Number(req.query?.limit || 200);
  const events = await readLastEvents(limit);
  res.json({ ok: true, events });
});

export default router;
