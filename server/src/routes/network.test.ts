import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { networkRoutes } from "./network";
import { Hono } from "hono";

const PRESET1 = resolve(import.meta.dir, "../../../core/network-engine/test-data/preset1");

function createApp() {
  const app = new Hono();
  app.route("/api/network", networkRoutes);
  return app;
}

describe("GET /api/network", () => {
  const app = createApp();

  test("missing network param returns 400", async () => {
    const res = await app.request("/api/network");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("network");
  });

  test("valid network dir returns 200 with nodes/edges", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
    expect(body.nodes.length).toBeGreaterThan(0);
  });

  test("invalid network dir returns 500", async () => {
    const res = await app.request(
      `/api/network?network=/nonexistent/path`
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to load network");
  });
});
