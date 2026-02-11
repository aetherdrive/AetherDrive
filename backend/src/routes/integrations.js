// integrations.js
import express from "express";
const router = express.Router();
router.post("/timebank/:provider/pull", async (req, res) => {
  res.json({ ok: true });
});
export default router;
