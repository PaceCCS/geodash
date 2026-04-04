import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { HttpError } from "./http";
import { openapi, fromTypes } from "@elysiajs/openapi";

export type CreateFlowServerOptions<Env> = {
  readonly serviceName: string;
  readonly health?: Record<string, unknown>;
  readonly env: Env;
  readonly init?: (env: Env) => Promise<void>;
};

export async function createFlowServer<Env>(
  options: CreateFlowServerOptions<Env>,
) {
  if (options.init) {
    await options.init(options.env);
  }

  const app = new Elysia()
    .use(
      openapi({
        references: fromTypes(),
      }),
    )
    .use(cors())
    .get("/health", () => ({
      status: "ok",
      service: options.serviceName,
      ...(options.health ?? {}),
    }));

  return app.onError(({ code, error, set }) => {
    if (code === "NOT_FOUND") {
      set.status = 404;
      return { error: "not_found", message: "Not found" };
    }

    if (error instanceof HttpError) {
      set.status = error.status;
      return {
        error: error.code,
        message: error.message,
        details: error.details,
      };
    }

    console.error("Unhandled server error:", error);
    set.status = 500;
    return {
      error: "internal_error",
      message: error instanceof Error ? error.message : String(error),
    };
  });
}
