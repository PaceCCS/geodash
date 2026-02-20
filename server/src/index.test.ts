import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

// Build a minimal app matching the routes in src/index.ts
function createApp() {
  const app = new Hono();
  app.get("/health", (c) =>
    c.json({ status: "ok", service: "geodash-api" })
  );
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  return app;
}

describe("health routes", () => {
  const app = createApp();

  test("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", service: "geodash-api" });
  });

  test("GET /nonexistent returns 404", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });
});
