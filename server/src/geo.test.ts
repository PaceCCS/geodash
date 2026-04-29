import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
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
        routeGeometry: {
          type: "LineString";
          coordinates: Array<{ lon: number; lat: number; z: number | null }>;
        } | null;
      }>;
      bounds: {
        west: number;
        south: number;
        east: number;
        north: number;
      } | null;
      center: { longitude: number; latitude: number } | null;
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
    expect(spiritRoute!.routeGeometry).toBeDefined();
    expect(spiritRoute!.routeGeometry!.type).toBe("LineString");
    expect(spiritRoute!.routeGeometry!.coordinates.length).toBeGreaterThan(1000);
    expect(spiritRoute!.routeGeometry!.coordinates[0]!.lon).toBeGreaterThan(-10);
    expect(spiritRoute!.routeGeometry!.coordinates[0]!.lon).toBeLessThan(5);
    expect(spiritRoute!.routeGeometry!.coordinates[0]!.lat).toBeGreaterThan(50);
    expect(spiritRoute!.routeGeometry!.coordinates[0]!.lat).toBeLessThan(60);

    expect(kmzRoute).toBeDefined();
    expect(kmzRoute!.route.format).toBe("kmz");
    expect(kmzRoute!.route.mapStatus).toBe("ready");
    expect(kmzRoute!.route.sourceCrs).toBe("EPSG:4326");
    expect(kmzRoute!.routeGeometry).toBeDefined();
    expect(kmzRoute!.routeGeometry!.type).toBe("LineString");
    expect(kmzRoute!.routeGeometry!.coordinates.length).toBeGreaterThan(1);

    expect(compressor).toBeDefined();
    expect(compressor!.route.mapStatus).toBe("unsupported");

    expect(body.bounds).toBeDefined();
    expect(body.center).toBeDefined();
    expect(body.bounds!.west).toBeLessThan(body.bounds!.east);
    expect(body.bounds!.south).toBeLessThan(body.bounds!.north);
    expect(body.center!.longitude).toBeGreaterThanOrEqual(body.bounds!.west);
    expect(body.center!.longitude).toBeLessThanOrEqual(body.bounds!.east);
    expect(body.center!.latitude).toBeGreaterThanOrEqual(body.bounds!.south);
    expect(body.center!.latitude).toBeLessThanOrEqual(body.bounds!.north);
  });

  test("places multiple non-pipe blocks between neighboring route endpoints", async () => {
    const networkDir = await fs.mkdtemp(join(tmpdir(), "geodash-geo-"));

    try {
      await fs.mkdir(join(networkDir, "assets"));
      await fs.writeFile(
        join(networkDir, "config.toml"),
        ['id = "geo-test"', 'label = "Geo Test"'].join("\n"),
      );
      await fs.writeFile(
        join(networkDir, "assets/route-a.csv"),
        [
          "WKT,name,description",
          '"LINESTRING (-2 53, -1 54)",Route A,',
        ].join("\n"),
      );
      await fs.writeFile(
        join(networkDir, "assets/route-b.csv"),
        [
          "WKT,name,description",
          '"LINESTRING (1 55, 2 56)",Route B,',
        ].join("\n"),
      );
      await fs.writeFile(
        join(networkDir, "branch-1.toml"),
        [
          'type = "branch"',
          'label = "Branch 1"',
          "",
          "[position]",
          "x = 0",
          "y = 0",
          "",
          "[[block]]",
          'type = "Pipe"',
          'route = "assets/route-a.csv"',
          "",
          "[[block]]",
          'type = "Compressor"',
          "",
          "[[block]]",
          'type = "Valve"',
          "",
          "[[block]]",
          'type = "Pipe"',
          'route = "assets/route-b.csv"',
        ].join("\n"),
      );

      const res = await postJson(app, "/api/operations/geo/inspect", {
        network: networkDir,
      });

      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        blocks: Array<{
          type: string | null;
          previousRouteEndpoint: { lon: number; lat: number; z: number | null } | null;
          nextRouteEndpoint: { lon: number; lat: number; z: number | null } | null;
        }>;
      };
      const compressor = body.blocks.find((b) => b.type === "Compressor");
      const valve = body.blocks.find((b) => b.type === "Valve");
      const previousEndpoint = { lon: -1, lat: 54, z: 0 };
      const nextEndpoint = { lon: 1, lat: 55, z: 0 };

      expect(compressor).toBeDefined();
      expect(valve).toBeDefined();
      expect(compressor!.previousRouteEndpoint).toEqual(previousEndpoint);
      expect(compressor!.nextRouteEndpoint).toEqual(nextEndpoint);
      expect(valve!.previousRouteEndpoint).toEqual(previousEndpoint);
      expect(valve!.nextRouteEndpoint).toEqual(nextEndpoint);
    } finally {
      await fs.rm(networkDir, { recursive: true, force: true });
    }
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
