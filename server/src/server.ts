import express from "express";
import { config } from "./config.js";
import { agentsRouter } from "./routes/agents.js";
import { betsRouter } from "./routes/bets.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Allow requests from any origin (useful for browser-based AI clients / testing).
// If you later need tighter security, replace `*` with your allowlist.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Prevent unexpected async route failures from crashing the server process.
// Express error middleware will still handle standard thrown errors.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/agents", agentsRouter);
app.use("/api/bets", betsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
