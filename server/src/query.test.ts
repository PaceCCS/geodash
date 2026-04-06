import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Elysia } from "elysia";
import { createGeodashServerConfig } from "./config";
import { queryModule } from "./modules/query";

const PRESET1 = resolve(import.meta.dir, "../../core/network-engine/test-data/preset1");

function createApp() {
  const config = createGeodashServerConfig();
  return new Elysia().use(queryModule(config));
}

describe("GET /api/query", () => {
  const app = createApp();

  test("missing q param returns 422", async () => {
    const res = await app.handle(new Request(`http://localhost/api/query?network=${encodeURIComponent(PRESET1)}`));
    expect(res.status).toBe(422);
  });

  test("missing network param returns 422", async () => {
    const res = await app.handle(new Request("http://localhost/api/query?q=branch-4/blocks/0/pressure"));
    expect(res.status).toBe(422);
  });

  test("valid query returns 200 with result", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/query?network=${encodeURIComponent(PRESET1)}&q=branch-4/blocks/0/pressure`,
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test("invalid network dir returns 500", async () => {
    const res = await app.handle(
      new Request(
        "http://localhost/api/query?network=/nonexistent/path&q=branch-4/blocks/0/pressure",
      ),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as { message: string };
    expect(body.message).toBe("Query failed");
  });
});
