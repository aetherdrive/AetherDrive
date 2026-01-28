import express from "express";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("AetherDrive backend is running 🚀");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/metrics", (req, res) => {
  res.json({
    users: 42,
    revenue: 12500,
    currency: "NOK",
    status: "running"
  });
});

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
