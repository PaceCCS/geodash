import { Effect } from "effect";
import { Elysia, t } from "elysia";
import { join } from "node:path";
import { promises as fs } from "node:fs";

import { createOperationModule } from "../../core/operations";
import {
  badRequest,
  internalError,
  runRequest,
  tryPromise,
} from "../../core/http";
import type { GeodashServerConfig } from "../../config";
import { computeRouteKp, loadNetwork } from "../../services/core";
import { resolveNetworkPath } from "../../utils/network";

type GeoFormat = "shapefile" | "kmz" | "kml" | "csv" | "coordinates";
type GeoMapStatus =
  | "ready"
  | "needs_reprojection"
  | "missing_crs"
  | "unsupported"
  | "missing_file"
  | "parse_error";

type GeoCoordinate = {
  lon: number;
  lat: number;
  z: number | null;
};

type RouteGeometry = {
  type: "LineString";
  coordinates: GeoCoordinate[];
};

type RouteInfo = {
  path: string | null;
  format: GeoFormat;
  length_m: number | null;
  displayLength: string | null;
  mapStatus: GeoMapStatus;
  sourceCrs: string | null;
  targetCrs: "EPSG:4326";
  message: string | null;
};

type MappableBlock = {
  branchId: string;
  blockIndex: number;
  type: string | null;
  format: GeoFormat;
  routePath: string | null;
  routeLength: string | null;
  route: RouteInfo;
  routeGeometry: RouteGeometry | null;
  previousRouteEndpoint: GeoCoordinate | null;
  nextRouteEndpoint: GeoCoordinate | null;
};

type InspectResult = {
  blocks: MappableBlock[];
};

type NetworkBlock = {
  type?: string;
  route?: string;
  lat?: number;
  lng?: number;
  latitude?: number;
  longitude?: number;
  [key: string]: unknown;
};

type NetworkNode = {
  id: string;
  type: string;
  data: {
    id: string;
    blocks?: NetworkBlock[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type NetworkResponse = {
  nodes?: NetworkNode[];
  [key: string]: unknown;
};

const COORDINATE_KEYS = [
  ["lat", "lng"],
  ["latitude", "longitude"],
  ["lat", "lon"],
] as const;

function hasCoordinates(block: NetworkBlock): boolean {
  return COORDINATE_KEYS.some(
    ([latKey, lngKey]) =>
      typeof block[latKey] === "number" && typeof block[lngKey] === "number",
  );
}

function getBlockCoordinate(block: NetworkBlock): GeoCoordinate | null {
  for (const [latKey, lngKey] of COORDINATE_KEYS) {
    const lat = block[latKey];
    const lon = block[lngKey];
    if (typeof lat === "number" && typeof lon === "number") {
      return { lat, lon, z: null };
    }
  }
  return null;
}

function displayLength(lengthM: number | null): string | null {
  return lengthM === null ? null : `${lengthM} m`;
}

async function detectRouteFormat(
  networkDir: string,
  route: string,
): Promise<GeoFormat | null> {
  const lower = route.toLowerCase();

  if (lower.endsWith(".kmz") || lower.endsWith(".kml")) {
    const fullPath = join(networkDir, route);
    try {
      await fs.access(fullPath);
      return lower.endsWith(".kml") ? "kml" : "kmz";
    } catch {
      return null;
    }
  }

  if (lower.endsWith(".csv")) {
    const fullPath = join(networkDir, route);
    try {
      await fs.access(fullPath);
      return "csv";
    } catch {
      return null;
    }
  }

  // Check if it's a directory containing .shp files (shapefile directory)
  const routePath = join(networkDir, route);
  try {
    const stat = await fs.stat(routePath);
    if (stat.isDirectory()) {
      const entries = await fs.readdir(routePath);
      const hasShp = entries.some((e) => e.toLowerCase().endsWith(".shp"));
      if (hasShp) {
        return "shapefile";
      }
    }
  } catch {
    // path doesn't exist or isn't accessible
  }

  return null;
}

async function findShapefileStem(networkDir: string, route: string): Promise<string | null> {
  const routePath = join(networkDir, route);
  const stat = await fs.stat(routePath);
  if (stat.isFile() && routePath.toLowerCase().endsWith(".shp")) {
    return routePath.slice(0, -4);
  }
  if (!stat.isDirectory()) return null;

  const entries = await fs.readdir(routePath);
  const shpFile = entries.find((e) => e.toLowerCase().endsWith(".shp"));
  return shpFile ? join(routePath, shpFile.slice(0, -4)) : null;
}

async function inspectShapefileCrs(stem: string): Promise<Pick<RouteInfo, "mapStatus" | "sourceCrs" | "message">> {
  try {
    const prj = await fs.readFile(`${stem}.prj`, "utf8");
    const normalized = prj.toLowerCase();
    const isWgs84 =
      normalized.includes("wgs_1984") ||
      normalized.includes("wgs 84") ||
      normalized.includes("epsg\",4326") ||
      normalized.includes("epsg:4326");

    if (isWgs84) {
      return { mapStatus: "ready", sourceCrs: "EPSG:4326", message: null };
    }

    return {
      mapStatus: "needs_reprojection",
      sourceCrs: prj.split(/\r?\n/)[0]?.slice(0, 160) || "Projected CRS",
      message:
        "This shapefile uses projected coordinates and must be reprojected to EPSG:4326 before it can be drawn on the map.",
    };
  } catch {
    return {
      mapStatus: "missing_crs",
      sourceCrs: null,
      message:
        "This shapefile has no .prj file, so its coordinates cannot be safely drawn on the map.",
    };
  }
}

async function inspectShapefileRoute(
  networkDir: string,
  route: string,
): Promise<{ lengthM: number | null; mapStatus: GeoMapStatus; sourceCrs: string | null; message: string | null }> {
  try {
    const stem = await findShapefileStem(networkDir, route);
    if (!stem) {
      return {
        lengthM: null,
        mapStatus: "missing_file",
        sourceCrs: null,
        message: "No .shp file was found for this route.",
      };
    }

    const crs = await inspectShapefileCrs(stem);
    if (crs.mapStatus === "ready") {
      return { lengthM: null, ...crs };
    }

    const shpData = await fs.readFile(`${stem}.shp`);
    const shpB64 = Buffer.from(shpData).toString("base64");
    const result = await computeRouteKp(shpB64);
    const lengthM = result.segments?.reduce((sum, s) => sum + s.length_m, 0) ?? null;

    return { lengthM, ...crs };
  } catch {
    return {
      lengthM: null,
      mapStatus: "parse_error",
      sourceCrs: null,
      message: "This shapefile could not be read.",
    };
  }
}

async function inspectRoute(networkDir: string, routePath: string, format: GeoFormat): Promise<{
  route: RouteInfo;
  routeGeometry: RouteGeometry | null;
}> {
  if (format === "shapefile") {
    const info = await inspectShapefileRoute(networkDir, routePath);
    return {
      route: {
        path: routePath,
        format,
        length_m: info.lengthM,
        displayLength: displayLength(info.lengthM),
        mapStatus: info.mapStatus,
        sourceCrs: info.sourceCrs,
        targetCrs: "EPSG:4326",
        message: info.message,
      },
      routeGeometry: null,
    };
  }

  return {
    route: {
      path: routePath,
      format,
      length_m: null,
      displayLength: null,
      mapStatus: "ready",
      sourceCrs: "EPSG:4326",
      targetCrs: "EPSG:4326",
      message:
        "This route is in a map-ready geographic format. Route coordinates will be returned after the Zig/WASM route geometry operation is added.",
    },
    routeGeometry: null,
  };
}

function routeStart(block: MappableBlock): GeoCoordinate | null {
  return block.routeGeometry?.coordinates[0] ?? null;
}

function routeEnd(block: MappableBlock): GeoCoordinate | null {
  const coordinates = block.routeGeometry?.coordinates;
  return coordinates?.[coordinates.length - 1] ?? null;
}

function attachNeighborRouteEndpoints(blocks: MappableBlock[]) {
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.routeGeometry) continue;

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex--) {
      const endpoint = routeEnd(blocks[previousIndex]);
      if (endpoint) {
        block.previousRouteEndpoint = endpoint;
        break;
      }
    }

    for (let nextIndex = index + 1; nextIndex < blocks.length; nextIndex++) {
      const endpoint = routeStart(blocks[nextIndex]);
      if (endpoint) {
        block.nextRouteEndpoint = endpoint;
        break;
      }
    }
  }
}

export const geoModule = createOperationModule({
  prefix: "/geo",
  register: (app, _config: GeodashServerConfig) =>
    app.post(
      "/inspect",
      async ({ body, set }) =>
        runRequest(
          Effect.gen(function* () {
            const networkDir = resolveNetworkPath(body.network);
            if (!networkDir) {
              return yield* Effect.fail(
                badRequest("Missing required field: network"),
              );
            }

            const network = yield* tryPromise(
              () => loadNetwork(networkDir),
              (error) =>
                internalError("Failed to load network", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );

            const data = network as NetworkResponse;
            const nodes = (data.nodes ?? []).filter(
              (n) => n.type === "branch",
            );
            const mappableBlocks: MappableBlock[] = [];

            yield* tryPromise(
              async () => {
                for (const node of nodes) {
                  const blocks = node.data.blocks ?? [];
                  const branchBlocks: MappableBlock[] = [];

                  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
                    const block = blocks[blockIndex];
                    const type = typeof block.type === "string" ? block.type : null;

                    if (hasCoordinates(block)) {
                      const coordinate = getBlockCoordinate(block);
                      branchBlocks.push({
                        branchId: node.id,
                        blockIndex,
                        type,
                        format: "coordinates",
                        routePath: null,
                        routeLength: null,
                        route: {
                          path: null,
                          format: "coordinates",
                          length_m: null,
                          displayLength: null,
                          mapStatus: coordinate ? "ready" : "parse_error",
                          sourceCrs: "EPSG:4326",
                          targetCrs: "EPSG:4326",
                          message: null,
                        },
                        routeGeometry: coordinate
                          ? { type: "LineString", coordinates: [coordinate] }
                          : null,
                        previousRouteEndpoint: null,
                        nextRouteEndpoint: null,
                      });
                      continue;
                    }

                    const route =
                      typeof block.route === "string" && block.route.length > 0
                        ? block.route
                        : null;
                    if (!route) {
                      branchBlocks.push({
                        branchId: node.id,
                        blockIndex,
                        type,
                        format: "coordinates",
                        routePath: null,
                        routeLength: null,
                        route: {
                          path: null,
                          format: "coordinates",
                          length_m: null,
                          displayLength: null,
                          mapStatus: "unsupported",
                          sourceCrs: null,
                          targetCrs: "EPSG:4326",
                          message: "This block does not define its own route geometry.",
                        },
                        routeGeometry: null,
                        previousRouteEndpoint: null,
                        nextRouteEndpoint: null,
                      });
                      continue;
                    }

                    const format = await detectRouteFormat(networkDir, route);
                    if (!format) {
                      branchBlocks.push({
                        branchId: node.id,
                        blockIndex,
                        type,
                        format: "coordinates",
                        routePath: route,
                        routeLength: null,
                        route: {
                          path: route,
                          format: "coordinates",
                          length_m: null,
                          displayLength: null,
                          mapStatus: "missing_file",
                          sourceCrs: null,
                          targetCrs: "EPSG:4326",
                          message: "The route file could not be found or is unsupported.",
                        },
                        routeGeometry: null,
                        previousRouteEndpoint: null,
                        nextRouteEndpoint: null,
                      });
                      continue;
                    }

                    const inspected = await inspectRoute(networkDir, route, format);
                    branchBlocks.push({
                      branchId: node.id,
                      blockIndex,
                      type,
                      format,
                      routePath: route,
                      routeLength: inspected.route.displayLength,
                      route: inspected.route,
                      routeGeometry: inspected.routeGeometry,
                      previousRouteEndpoint: null,
                      nextRouteEndpoint: null,
                    });
                  }

                  attachNeighborRouteEndpoints(branchBlocks);
                  mappableBlocks.push(...branchBlocks);
                }
              },
              (error) =>
                internalError("Failed to inspect network blocks", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );

            const result: InspectResult = { blocks: mappableBlocks };
            return result;
          }),
          set,
        ),
      {
        body: t.Object({
          network: t.String({
            description: "Network directory path",
          }),
        }),
        detail: {
          summary: "Inspect geo-mappable blocks",
          description:
            "Inspects all blocks in a network for mappable routes (shapefile, KMZ, CSV) or direct coordinate properties.",
        },
      },
    ),
});
