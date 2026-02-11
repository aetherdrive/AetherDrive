import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const docsRouter = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// docs.js ligger typisk i backend/src/routes/
// og api-docs.json ligger i backend/api-docs.json
const specPath = path.join(__dirname, "..", "..", "api-docs.json");

docsRouter.get("/", (req, res) => {
  try {
    const raw = fs.readFileSync(specPath, "utf8");
    const spec = JSON.parse(raw);
    res.json(spec);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "failed_to_load_spec",
      specPath,
      hint: "Confirm api-docs.json is in backend/api-docs.json in the deployed repo"
    });
  }
});
