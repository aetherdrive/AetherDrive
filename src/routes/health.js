import express from "express";

export function createHealthRouter() {
  const router = express.Router();

  router.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  return router;
}
