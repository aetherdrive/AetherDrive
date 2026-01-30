import express from "express";
import fs from "fs";
import path from "path";

// Simple API documentation route. Reads the OpenAPI specification from
// backend/api-docs.json and returns it as JSON. If the file cannot be
// parsed, returns a 500 error.

export const docsRouter = express.Router();

docsRouter.get("/", (req, res) => {
  try {
    const specPath = path.resolve("backend/api-docs.json");
    const raw = fs.readFileSync(specPath, "utf8");
    const spec = JSON.parse(raw);
    res.json(spec);
  } catch (err) {
    res.status(500).json({ ok: false, error: "failed_to_load_spec" });
  }
});