import { Hono } from "hono";
import { cors } from "hono/cors";
import { queryRoutes } from "./routes/query";
import { networkRoutes } from "./routes/network";
import { olgaRoutes } from "./routes/olga";

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
app.route("/api/operations/olga", olgaRoutes);

// 404
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error", message: err.message }, 500);
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Manage the server reference in globalThis so that bun --hot can reload
// the fetch handler without rebinding the port. Exporting
// `{ port, fetch }` as default triggers Bun's magic server detection which
// calls both server.reload() AND Bun.serve() in the same branch — the
// second bind fails with EADDRINUSE. Calling Bun.serve() directly bypasses
// that code path entirely.
const g = globalThis as { __geodashServer?: ReturnType<typeof Bun.serve> };

if (g.__geodashServer) {
  g.__geodashServer.reload({ fetch: app.fetch });
  console.log(`geodash API server hot-reloaded on port ${port}`);
} else {
  g.__geodashServer = Bun.serve({ port, fetch: app.fetch });
  console.log(`geodash API server started on port ${port}`);
}
