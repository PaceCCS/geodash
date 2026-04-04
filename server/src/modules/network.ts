import { Effect } from "effect";
import { Elysia, t } from "elysia";
import { join, normalize, resolve } from "node:path";
import { createModule } from "../core/operations";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  runRequest,
  tryPromise,
} from "../core/http";
import type { GeodashServerConfig } from "../config";
import { loadNetwork } from "../services/core";
import { resolveNetworkPath } from "../utils/network";

export const networkModule = createModule((_config: GeodashServerConfig) =>
  new Elysia({ prefix: "/api/network" })
    .get(
      "/assets/*",
      async ({ params, query, set }) =>
        runRequest(
          Effect.gen(function* () {
            set.headers["cache-control"] = "no-store";

            const networkDir = resolveNetworkPath(
              typeof query.network === "string" ? query.network : undefined,
            );
            if (!networkDir) {
              return yield* Effect.fail(
                badRequest("Missing required query parameter: network"),
              );
            }

            const assetPath = decodeURIComponent(params["*"] ?? "");
            if (!assetPath) {
              return yield* Effect.fail(badRequest("Missing asset path"));
            }

            const fullPath = normalize(resolve(join(networkDir, assetPath)));
            if (!fullPath.startsWith(normalize(networkDir))) {
              return yield* Effect.fail(forbidden("Forbidden"));
            }

            const file = Bun.file(fullPath);
            const exists = yield* tryPromise(
              () => file.exists(),
              (error) =>
                internalError("Failed to load asset", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );

            if (!exists) {
              return yield* Effect.fail(notFound("Asset not found"));
            }

            set.headers["content-type"] =
              file.type || "application/octet-stream";
            return file;
          }),
          set,
        ),
      {
        query: t.Object({
          network: t.String({ description: "Path to the network directory" }),
        }),
        detail: {
          summary: "Get network asset",
          description: "Serves a static asset file from a network directory",
        },
      },
    )
    .get(
      "/",
      async ({ query, set }) =>
        runRequest(
          Effect.gen(function* () {
            set.headers["cache-control"] = "no-store";

            const networkDir = resolveNetworkPath(
              typeof query.network === "string" ? query.network : undefined,
            );
            if (!networkDir) {
              return yield* Effect.fail(
                badRequest("Missing required query parameter: network"),
              );
            }

            return yield* tryPromise(
              () => loadNetwork(networkDir),
              (error) =>
                internalError("Failed to load network", {
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
            );
          }),
          set,
        ),
      {
        query: t.Object({
          network: t.String({ description: "Path to the network directory" }),
        }),
        detail: {
          summary: "Load network",
          description:
            "Loads and returns the complete network definition from a directory of TOML files",
        },
      },
    ),
);
