import { Effect } from "effect";
import { Elysia, t } from "elysia";
import { basename, join } from "node:path";
import { promises as fs } from "node:fs";

import { createModule } from "../core/operations";
import {
  badRequest,
  internalError,
  notFound,
  runRequest,
  tryPromise,
} from "../core/http";
import type { GeodashServerConfig } from "../config";
import {
  buildShapefile,
  readShapefile,
  type ReadShapefileResult,
} from "../services/core";
import { resolveNetworkPath } from "../utils/network";

type ShapefileSummary = {
  stemPath: string;
  name: string;
  hasDbf: boolean;
  hasPrj: boolean;
  hasShx: boolean;
  geometryType: "PointZ" | "PolyLineZ" | null;
  recordCount: number;
  error?: string;
};

type BuildShapefilePayload = Pick<
  ReadShapefileResult,
  "records" | "fields" | "rows" | "prj"
>;

function encodeBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readShapefileStem(stemPath: string) {
  const shpPath = `${stemPath}.shp`;
  const dbfPath = `${stemPath}.dbf`;
  const prjPath = `${stemPath}.prj`;
  const shxPath = `${stemPath}.shx`;

  const [shpBytes, hasDbf, hasPrj, hasShx] = await Promise.all([
    fs.readFile(shpPath),
    fileExists(dbfPath),
    fileExists(prjPath),
    fileExists(shxPath),
  ]);

  const [dbfBytes, prj] = await Promise.all([
    hasDbf ? fs.readFile(dbfPath) : Promise.resolve(null),
    hasPrj ? fs.readFile(prjPath, "utf8") : Promise.resolve(null),
  ]);

  const document = await readShapefile(
    encodeBase64(shpBytes),
    dbfBytes ? encodeBase64(dbfBytes) : null,
    prj,
  );

  return {
    stemPath,
    name: basename(stemPath),
    hasDbf,
    hasPrj,
    hasShx,
    ...document,
  };
}

export const shapefileModule = createModule((_config: GeodashServerConfig) =>
  new Elysia({ prefix: "/api/shapefiles" })
    .get(
      "/",
      async ({ query, set }) =>
        runRequest(
          Effect.gen(function* () {
            set.headers["cache-control"] = "no-store";

            const directoryPath = resolveNetworkPath(
              typeof query.directory === "string" ? query.directory : undefined,
            );
            if (!directoryPath) {
              return yield* Effect.fail(
                badRequest("Missing required query parameter: directory"),
              );
            }

            const summaries = yield* tryPromise(
              async () => {
                const entries = await fs.readdir(directoryPath, {
                  withFileTypes: true,
                });

                const shapefileEntries = entries
                  .filter(
                    (entry) =>
                      entry.isFile() && entry.name.toLowerCase().endsWith(".shp"),
                  )
                  .sort((a, b) => a.name.localeCompare(b.name));

                return Promise.all(
                  shapefileEntries.map(async (entry) => {
                    const stemPath = join(
                      directoryPath,
                      entry.name.slice(0, -4),
                    );

                    try {
                      const document = await readShapefileStem(stemPath);
                      const summary: ShapefileSummary = {
                        stemPath: document.stemPath,
                        name: document.name,
                        hasDbf: document.hasDbf,
                        hasPrj: document.hasPrj,
                        hasShx: document.hasShx,
                        geometryType: document.geometryType,
                        recordCount: document.records.length,
                      };
                      return summary;
                    } catch (error) {
                      const summary: ShapefileSummary = {
                        stemPath,
                        name: basename(stemPath),
                        hasDbf: await fileExists(`${stemPath}.dbf`),
                        hasPrj: await fileExists(`${stemPath}.prj`),
                        hasShx: await fileExists(`${stemPath}.shx`),
                        geometryType: null,
                        recordCount: 0,
                        error:
                          error instanceof Error ? error.message : String(error),
                      };
                      return summary;
                    }
                  }),
                );
              },
              (error) =>
                internalError("Failed to list shapefiles", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );

            return { files: summaries };
          }),
          set,
        ),
      {
        query: t.Object({
          directory: t.String({
            description: "Path to the shapefile directory",
          }),
        }),
        detail: {
          summary: "List shapefiles",
          description:
            "Lists .shp stems in a directory and returns editor summaries",
        },
      },
    )
    .get(
      "/file",
      async ({ query, set }) =>
        runRequest(
          Effect.gen(function* () {
            set.headers["cache-control"] = "no-store";

            const stemPath = resolveNetworkPath(
              typeof query.stem === "string" ? query.stem : undefined,
            );
            if (!stemPath) {
              return yield* Effect.fail(
                badRequest("Missing required query parameter: stem"),
              );
            }

            const exists = yield* tryPromise(
              () => fileExists(`${stemPath}.shp`),
              (error) =>
                internalError("Failed to access shapefile", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );
            if (!exists) {
              return yield* Effect.fail(notFound("Shapefile not found"));
            }

            return yield* tryPromise(
              () => readShapefileStem(stemPath),
              (error) =>
                internalError("Failed to load shapefile", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );
          }),
          set,
        ),
      {
        query: t.Object({
          stem: t.String({
            description: "Path stem for the shapefile without extension",
          }),
        }),
        detail: {
          summary: "Load shapefile",
          description:
            "Loads a shapefile stem and returns editable geometry, DBF, and PRJ data",
        },
      },
    )
    .post(
      "/build",
      async ({ body, set }) =>
        runRequest(
          Effect.gen(function* () {
            return yield* tryPromise(
              () =>
                buildShapefile(body as BuildShapefilePayload),
              (error) =>
                internalError("Failed to build shapefile", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );
          }),
          set,
        ),
      {
        body: t.Object({
          records: t.Array(t.Any()),
          fields: t.Array(t.Any()),
          rows: t.Array(t.Array(t.Any())),
          prj: t.Optional(t.Nullable(t.String())),
        }),
        detail: {
          summary: "Build shapefile",
          description:
            "Builds shapefile sidecar bytes from editable geometry, DBF, and PRJ data",
        },
      },
    ),
);
