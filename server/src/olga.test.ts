import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Elysia } from "elysia";
import { createOperationsApp } from "./core/operations";
import { createGeodashServerConfig } from "./config";
import { olgaOperationModule } from "./modules/operations/olga";

const PRESET1 = resolve(import.meta.dir, "../../core/network-engine/test-data/preset1");

function createApp() {
  const config = createGeodashServerConfig();
  return new Elysia().use(createOperationsApp().use(olgaOperationModule(config)));
}

function postJson(app: { handle: (req: Request) => Promise<Response> | Response }, path: string, body: unknown) {
  return app.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/operations/olga/validate", () => {
  const app = createApp();

  test("invalid JSON returns 400", async () => {
    const res = await app.handle(new Request("http://localhost/api/operations/olga/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }));
    expect(res.status).toBe(400);
  });

  test("missing network returns 400", async () => {
    const res = await postJson(app, "/api/operations/olga/validate", {});
    expect(res.status).toBe(400);
    const body = await res.json() as { message: string };
    expect(body.message).toContain("network");
  });

  test("valid preset1 returns 200 with validation result", async () => {
    const res = await postJson(app, "/api/operations/olga/validate", {
      network: PRESET1,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
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
    const body = await res.json() as { message: string };
    expect(body.message).toContain("network");
  });
});

describe("POST /api/operations/olga/import", () => {
  const app = createApp();

  test("missing key_content returns 400", async () => {
    const res = await postJson(app, "/api/operations/olga/import", {});
    expect(res.status).toBe(400);
    const body = await res.json() as { message: string };
    expect(body.message).toContain("key_content");
  });
});
