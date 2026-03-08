import { describe, expect, test } from "bun:test";
import { createFlowServer } from "./core/server";
import { createGeodashServerConfig } from "./config";

describe("health routes", () => {
  const config = createGeodashServerConfig();

  test("GET /health returns 200", async () => {
    const app = await createFlowServer({
      serviceName: config.serviceName,
      env: config,
    });
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", service: "geodash-api" });
  });

  test("GET /nonexistent returns 404", async () => {
    const app = await createFlowServer({
      serviceName: config.serviceName,
      env: config,
    });
    const res = await app.handle(new Request("http://localhost/nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "not_found", message: "Not found" });
  });
});
