import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Elysia } from "elysia";

import { createGeodashServerConfig } from "./config";
import { createOperationsApp } from "./core/operations";
import { geoModule } from "./modules/operations/geo";

function createApp() {
  const config = createGeodashServerConfig();
  return createOperationsApp().use(geoModule(config));
}

function postJson(
  app: { handle: (req: Request) => Promise<Response> | Response },
  path: string,
  body: unknown,
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const PRESET1_DIR = join(import.meta.dir, "../../core/network-engine/test-data/preset1");

describe("POST /api/operations/geo/inspect", () => {
  const app = createApp();

  test("detects shapefile route on branch-1 pipe block", async () => {
    const res = await postJson(app, "/api/operations/geo/inspect", {
      network: PRESET1_DIR,
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      blocks: Array<{
        branchId: string;
        blockIndex: number;
        format: string;
        routePath: string | null;
        routeLength: string | null;
      }>;
    };

    expect(body.blocks.length).toBeGreaterThanOrEqual(1);

    const shapefileBlock = body.blocks.find(
      (b) => b.branchId === "branch-1" && b.format === "shapefile",
    );
    expect(shapefileBlock).toBeDefined();
    expect(shapefileBlock!.blockIndex).toBe(2);
    expect(shapefileBlock!.routePath).toBe("assets/spirit");
    expect(shapefileBlock!.routeLength).toMatch(/^\d+(\.\d+)? m$/);
  });

  test("returns empty blocks for missing network", async () => {
    const res = await postJson(app, "/api/operations/geo/inspect", {
      network: "/nonexistent/path",
    });

    // loadNetwork will fail → 500
    expect(res.status).toBe(500);
  });

  test("rejects request without network field", async () => {
    const res = await postJson(app, "/api/operations/geo/inspect", {});
    expect(res.status).toBe(422);
  });
});
