import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { HttpError } from "./http";
import { openapi, fromTypes } from "@elysiajs/openapi";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { serverTiming } from "@elysiajs/server-timing";

import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";

// const exporter = new OTLPTraceExporter({
//   url: "http://localhost:4318/v1/traces",
// });

// const processor = new BatchSpanProcessor(exporter);

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
    .use(
      opentelemetry({
        spanProcessors: [
          new BatchSpanProcessor(
            new OTLPTraceExporter({
              url: "https://api.axiom.co/v1/traces",
              headers: {
                Authorization: `Bearer ${Bun.env.AXIOM_TOKEN}`,
                "X-Axiom-Dataset": Bun.env.AXIOM_DATASET,
              },
            }),
          ),
        ],
      }),
    )
    .use(serverTiming())
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
