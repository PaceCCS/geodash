import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { queryRoutes } from "./query";
import { Hono } from "hono";

const PRESET1 = resolve(import.meta.dir, "../../../core/network-engine/test-data/preset1");

function createApp() {
  const app = new Hono();
  app.route("/api/query", queryRoutes);
  return app;
}

describe("GET /api/query", () => {
  const app = createApp();

  test("missing q param returns 400", async () => {
    const res = await app.request(`/api/query?network=${PRESET1}`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("q");
  });

  test("missing network param returns 400", async () => {
    const res = await app.request("/api/query?q=branch-4/blocks/0/pressure");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("network");
  });

  test("valid query returns 200 with result", async () => {
    const res = await app.request(
      `/api/query?network=${encodeURIComponent(PRESET1)}&q=branch-4/blocks/0/pressure`
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test("invalid network dir returns 500", async () => {
    const res = await app.request(
      `/api/query?network=/nonexistent/path&q=branch-4/blocks/0/pressure`
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Query failed");
  });
});
