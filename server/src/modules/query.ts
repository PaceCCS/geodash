import { Effect } from "effect";
import { Elysia } from "elysia";
import { createModule } from "../core/operations";
import {
  badRequest,
  internalError,
  runRequest,
  tryPromise,
} from "../core/http";
import type { GeodashServerConfig } from "../config";
import { queryNetwork } from "../services/core";
import { resolveNetworkPath } from "../utils/network";

export const queryModule = createModule(
  (_config: GeodashServerConfig) =>
    new Elysia({ prefix: "/api/query" }).get("/", async ({ query, set }) =>
      runRequest(
        Effect.gen(function* () {
          if (typeof query.q !== "string" || query.q.length === 0) {
            return yield* Effect.fail(
              badRequest("Missing required query parameter: q"),
            );
          }

          const networkDir = resolveNetworkPath(
            typeof query.network === "string" ? query.network : undefined,
          );
          if (!networkDir) {
            return yield* Effect.fail(
              badRequest("Missing required query parameter: network"),
            );
          }

          return yield* tryPromise(
            () => queryNetwork(networkDir, query.q),
            (error) =>
              internalError("Query failed", {
                message: error instanceof Error ? error.message : String(error),
              }),
          );
        }),
        set,
      ),
    ),
);
