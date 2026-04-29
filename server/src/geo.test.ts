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
const EXAMPLE_DIR = join(import.meta.dir, "../../workingfiles/example");

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
        type: string | null;
        format: string;
        routePath: string | null;
        routeLength: string | null;
        route: {
          path: string | null;
          format: string;
          length_m: number | null;
          displayLength: string | null;
          mapStatus: string;
          sourceCrs: string | null;
          targetCrs: string;
          message: string | null;
        };
        routeGeometry: unknown;
        previousRouteEndpoint: unknown;
        nextRouteEndpoint: unknown;
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
    expect(shapefileBlock!.route.length_m).toBeGreaterThan(0);
    expect(shapefileBlock!.route.mapStatus).toMatch(
      /^(ready|needs_reprojection|missing_crs)$/,
    );
  });

  test("flags map readiness for example route blocks", async () => {
    const res = await postJson(app, "/api/operations/geo/inspect", {
      network: EXAMPLE_DIR,
    });

    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      blocks: Array<{
        branchId: string;
        blockIndex: number;
        type: string | null;
        routePath: string | null;
        route: {
          format: string;
          length_m: number | null;
          mapStatus: string;
          sourceCrs: string | null;
          message: string | null;
        };
        routeGeometry: unknown;
      }>;
    };

    const spiritRoute = body.blocks.find(
      (b) => b.branchId === "branch-1" && b.routePath === "assets/spirit_wgs84",
    );
    const kmzRoute = body.blocks.find(
      (b) => b.branchId === "branch-1" && b.routePath === "assets/kmz_routes/route.kmz",
    );
    const compressor = body.blocks.find(
      (b) => b.branchId === "branch-1" && b.type === "Compressor",
    );

    expect(spiritRoute).toBeDefined();
    expect(spiritRoute!.route.mapStatus).toBe("ready");
    expect(spiritRoute!.route.sourceCrs).toBe("EPSG:4326");
    expect(spiritRoute!.route.length_m).toBeNull();
    expect(spiritRoute!.route.message).toBeNull();
    expect(spiritRoute!.routeGeometry).toBeNull();

    expect(kmzRoute).toBeDefined();
    expect(kmzRoute!.route.format).toBe("kmz");
    expect(kmzRoute!.route.mapStatus).toBe("ready");
    expect(kmzRoute!.route.sourceCrs).toBe("EPSG:4326");
    expect(kmzRoute!.routeGeometry).toBeNull();

    expect(compressor).toBeDefined();
    expect(compressor!.route.mapStatus).toBe("unsupported");
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
