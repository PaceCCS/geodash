import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { olgaRoutes } from "./olga";
import { Hono } from "hono";

const PRESET1 = resolve(import.meta.dir, "../../../core/network-engine/test-data/preset1");

function createApp() {
  const app = new Hono();
  app.route("/api/operations/olga", olgaRoutes);
  return app;
}

function postJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/operations/olga/validate", () => {
  const app = createApp();

  test("invalid JSON returns 400", async () => {
    const res = await app.request("/api/operations/olga/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Invalid JSON");
  });

  test("missing network returns 400", async () => {
    const res = await postJson(app, "/api/operations/olga/validate", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("network");
  });

  test("valid preset1 returns 200 with validation result", async () => {
    const res = await postJson(app, "/api/operations/olga/validate", {
      network: PRESET1,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isReady: boolean;
      summary: { branchCount: number; totalBlocks: number };
      branches: unknown[];
    };
    expect(typeof body.isReady).toBe("boolean");
    expect(body.summary.branchCount).toBeGreaterThan(0);
    expect(Array.isArray(body.branches)).toBe(true);
  });
});

describe("POST /api/operations/olga/export", () => {
  const app = createApp();

  test("missing network returns 400", async () => {
    const res = await postJson(app, "/api/operations/olga/export", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("network");
  });
});

describe("POST /api/operations/olga/import", () => {
  const app = createApp();

  test("missing key_content returns 400", async () => {
    const res = await postJson(app, "/api/operations/olga/import", {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("key_content");
  });
});
