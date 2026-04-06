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

type GeoFormat = "shapefile" | "kmz" | "csv" | "coordinates";

type MappableBlock = {
  branchId: string;
  blockIndex: number;
  format: GeoFormat;
  routePath: string | null;
  routeLength: string | null;
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

async function detectRouteFormat(
  networkDir: string,
  route: string,
): Promise<GeoFormat | null> {
  const lower = route.toLowerCase();

  if (lower.endsWith(".kmz") || lower.endsWith(".kml")) {
    const fullPath = join(networkDir, route);
    try {
      await fs.access(fullPath);
      return "kmz";
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

async function computeShapefileLength(
  networkDir: string,
  route: string,
): Promise<string | null> {
  try {
    const routePath = join(networkDir, route);
    const entries = await fs.readdir(routePath);
    const shpFile = entries.find((e) => e.toLowerCase().endsWith(".shp"));
    if (!shpFile) return null;

    const shpData = await fs.readFile(join(routePath, shpFile));
    const shpB64 = Buffer.from(shpData).toString("base64");
    const result = await computeRouteKp(shpB64);

    if (!result.segments || result.segments.length === 0) return null;
    const totalM = result.segments.reduce((sum, s) => sum + s.length_m, 0);
    return `${totalM} m`;
  } catch {
    return null;
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
                const checks: Promise<void>[] = [];

                for (const node of nodes) {
                  const blocks = node.data.blocks ?? [];
                  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
                    const block = blocks[blockIndex];

                    if (hasCoordinates(block)) {
                      mappableBlocks.push({
                        branchId: node.id,
                        blockIndex,
                        format: "coordinates",
                        routePath: null,
                        routeLength: null,
                      });
                      continue;
                    }

                    const route =
                      typeof block.route === "string" && block.route.length > 0
                        ? block.route
                        : null;
                    if (!route) {
                      continue;
                    }

                    checks.push(
                      detectRouteFormat(networkDir, route).then(async (format) => {
                        if (!format) return;

                        let routeLength: string | null = null;
                        if (format === "shapefile") {
                          routeLength = await computeShapefileLength(networkDir, route);
                        }

                        mappableBlocks.push({
                          branchId: node.id,
                          blockIndex,
                          format,
                          routePath: route,
                          routeLength,
                        });
                      }),
                    );
                  }
                }

                await Promise.all(checks);
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
