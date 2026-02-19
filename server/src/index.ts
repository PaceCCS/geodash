import { Hono } from "hono";
import { cors } from "hono/cors";
import { queryRoutes } from "./routes/query";
import { networkRoutes } from "./routes/network";

const app = new Hono();

// CORS — allow requests from the Tauri frontend and local dev
app.use("/*", cors());

// Health check
app.get("/health", (c) =>
  c.json({ status: "ok", service: "geodash-api" })
);

// API routes
app.route("/api/query", queryRoutes);
app.route("/api/network", networkRoutes);

// 404
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", message: err.message }, 500);
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;
console.log(`geodash API server starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
