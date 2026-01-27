import express from "express";
import engine from "./engine.js";

const app = express();
app.use(express.json());

// Health endpoint
app.get("/", (req, res) => {
  res.json({ status: "AetherDrive v3 motor live 🚀" });
});

// Metrics for frontend
app.get("/metrics", (req, res) => {
  const metrics = engine.run();
  res.json({ status: "Live", ...metrics });
});

// Run motor endpoint
app.post("/run", (req, res) => {
  const input = req.body;
  const output = engine.run ? engine.run(input) : { message: "Engine running" };
  res.json(output);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend listening on port ${PORT}`));
