import express from "express";
import engine from "../engine.js";

export function createMetricsRouter({ policy }) {
  const router = express.Router();

  router.get("/api/metrics", (req, res) => {
    // engine.run(now, policy)
    res.json(engine.run(new Date(), policy));
  });

  return router;
}
