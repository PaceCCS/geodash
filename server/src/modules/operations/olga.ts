import { Effect } from "effect";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createOperationModule } from "../../core/operations";
import {
  badRequest,
  internalError,
  runRequest,
  tryPromise,
} from "../../core/http";
import type { GeodashServerConfig } from "../../config";
import {
  exportToOlga,
  importFromOlga,
  readNetworkDir,
} from "../../services/core";
import {
  resolveRouteSegments,
  validateNetworkForOlga,
} from "../../services/olga";
import { resolveNetworkPath } from "../../utils/network";

type OlgaValidateBody = {
  readonly network?: string;
};

type OlgaImportBody = {
  readonly key_content?: string;
  readonly output_dir?: string;
  readonly root_location?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseValidateBody(body: unknown): OlgaValidateBody {
  if (!isRecord(body)) {
    return {};
  }

  return {
    network: typeof body.network === "string" ? body.network : undefined,
  };
}

function parseImportBody(body: unknown): OlgaImportBody {
  if (!isRecord(body)) {
    return {};
  }

  const rootLocation = isRecord(body.root_location)
    && typeof body.root_location.x === "number"
    && typeof body.root_location.y === "number"
    && typeof body.root_location.z === "number"
      ? {
          x: body.root_location.x,
          y: body.root_location.y,
          z: body.root_location.z,
        }
      : undefined;

  return {
    key_content:
      typeof body.key_content === "string" ? body.key_content : undefined,
    output_dir: typeof body.output_dir === "string" ? body.output_dir : undefined,
    root_location: rootLocation,
  };
}

export const olgaOperationModule = createOperationModule({
  prefix: "/olga",
  register: (app, _config: GeodashServerConfig) =>
    app
      .post("/validate", async ({ body, set }) =>
        runRequest(
          Effect.gen(function* () {
            const payload = parseValidateBody(body);
            const networkDir = resolveNetworkPath(payload.network);
            if (!networkDir) {
              return yield* Effect.fail(badRequest("Missing field: network"));
            }

            return yield* tryPromise(
              () => validateNetworkForOlga(networkDir),
              (error) =>
                internalError("Validation failed", {
                  message: error instanceof Error ? error.message : String(error),
                }),
            );
          }),
          set,
        ),
      )
      .post("/export", async ({ body, set }) =>
        runRequest(
          Effect.gen(function* () {
            const payload = parseValidateBody(body);
            const networkDir = resolveNetworkPath(payload.network);
            if (!networkDir) {
              return yield* Effect.fail(badRequest("Missing field: network"));
            }

            const { files, config } = yield* tryPromise(
              () => readNetworkDir(networkDir),
              (error) =>
                internalError("Export failed", {
                  message: error instanceof Error ? error.message : String(error),
                }),
            );

            const routeSegments = yield* tryPromise(
              () => resolveRouteSegments(networkDir, files),
              (error) =>
                internalError("Export failed", {
                  message: error instanceof Error ? error.message : String(error),
                }),
            );

            return yield* tryPromise(
              () => exportToOlga(files, config, routeSegments),
              (error) =>
                internalError("Export failed", {
                  message: error instanceof Error ? error.message : String(error),
                }),
            );
          }),
          set,
        ),
      )
      .post("/import", async ({ body, set }) =>
        runRequest(
          Effect.gen(function* () {
            const payload = parseImportBody(body);

            if (!payload.key_content) {
              return yield* Effect.fail(badRequest("Missing field: key_content"));
            }

            const result = yield* tryPromise(
              () => importFromOlga(payload.key_content!, payload.root_location),
              (error) =>
                internalError("Import failed", {
                  message: error instanceof Error ? error.message : String(error),
                }),
            );

            if (payload.output_dir) {
              yield* tryPromise(
                async () => {
                  await mkdir(payload.output_dir!, { recursive: true });

                  await Promise.all(
                    Object.entries(result.files).map(([filename, content]) =>
                      writeFile(join(payload.output_dir!, filename), content, "utf-8"),
                    ),
                  );

                  await Promise.all(
                    Object.entries(result.shapefiles).map(([filename, b64]) => {
                      const bytes = Buffer.from(b64, "base64");
                      return writeFile(join(payload.output_dir!, filename), bytes);
                    }),
                  );
                },
                (error) =>
                  internalError("Import failed", {
                    message: error instanceof Error ? error.message : String(error),
                  }),
              );
            }

            return {
              files: result.files,
              warnings: result.warnings,
              ...(payload.output_dir
                ? { output_dir: payload.output_dir }
                : {}),
            };
          }),
          set,
        ),
      ),
});
