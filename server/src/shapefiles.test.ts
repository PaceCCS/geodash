import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";

import { createGeodashServerConfig } from "./config";
import { shapefileModule } from "./modules/shapefiles";
import { buildShapefile } from "./services/core";

function createApp() {
  const config = createGeodashServerConfig();
  return new Elysia().use(shapefileModule(config));
}

function postJson(
  app: { handle: (req: Request) => Promise<Response> | Response },
  path: string,
  body: unknown,
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function createShapefileFixture() {
  const directoryPath = await mkdtemp(join(tmpdir(), "geodash-shapefile-"));
  const stemPath = join(directoryPath, "sample-route");
  const built = await buildShapefile({
    records: [
      {
        number: 1,
        geometry: {
          type: "PointZ",
          x: 491542.058,
          y: 5918507.093,
          z: 10.5,
          m: 0,
        },
      },
    ],
    fields: [
      {
        name: "LABEL",
        fieldType: "C",
        length: 16,
        decimalCount: 0,
      },
    ],
    rows: [["A"]],
    prj: 'GEOGCS["WGS 84"]',
  });

  await writeFile(`${stemPath}.shp`, Buffer.from(built.shp_b64, "base64"));
  await writeFile(`${stemPath}.shx`, Buffer.from(built.shx_b64, "base64"));
  await writeFile(`${stemPath}.dbf`, Buffer.from(built.dbf_b64, "base64"));
  if (built.prj_b64) {
    await writeFile(`${stemPath}.prj`, Buffer.from(built.prj_b64, "base64"));
  }

  return {
    directoryPath,
    stemPath,
    cleanup: () => rm(directoryPath, { recursive: true, force: true }),
  };
}

describe("GET /api/shapefiles", () => {
  const app = createApp();

  test("missing directory query is rejected by schema validation", async () => {
    const res = await app.handle(new Request("http://localhost/api/shapefiles"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBeTruthy();
  });

  test("lists shapefile summaries from a watched directory", async () => {
    const fixture = await createShapefileFixture();
    try {
      const res = await app.handle(
        new Request(
          `http://localhost/api/shapefiles?directory=${encodeURIComponent(fixture.directoryPath)}`,
        ),
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        files: Array<{
          name: string;
          recordCount: number;
          geometryType: string | null;
          hasDbf: boolean;
          hasPrj: boolean;
        }>;
      };

      expect(body.files).toHaveLength(1);
      expect(body.files[0]?.name).toBe("sample-route");
      expect(body.files[0]?.recordCount).toBe(1);
      expect(body.files[0]?.geometryType).toBe("PointZ");
      expect(body.files[0]?.hasDbf).toBe(true);
      expect(body.files[0]?.hasPrj).toBe(true);
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("GET /api/shapefiles/file", () => {
  const app = createApp();

  test("loads editable shapefile data for a stem", async () => {
    const fixture = await createShapefileFixture();
    try {
      const res = await app.handle(
        new Request(
          `http://localhost/api/shapefiles/file?stem=${encodeURIComponent(fixture.stemPath)}`,
        ),
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        name: string;
        geometryType: string | null;
        records: Array<{
          geometry: { type: string; x?: number };
        }>;
        fields: Array<{ name: string }>;
        rows: unknown[][];
        prj: string | null;
      };

      expect(body.name).toBe("sample-route");
      expect(body.geometryType).toBe("PointZ");
      expect(body.records[0]?.geometry.type).toBe("PointZ");
      expect(body.fields[0]?.name).toBe("LABEL");
      expect(body.rows[0]?.[0]).toBe("A");
      expect(body.prj).toContain("WGS 84");
    } finally {
      await fixture.cleanup();
    }
  });
});

describe("POST /api/shapefiles/build", () => {
  const app = createApp();

  test("builds shapefile sidecars from editable JSON", async () => {
    const res = await postJson(app, "/api/shapefiles/build", {
      records: [
        {
          number: 1,
          geometry: {
            type: "PolyLineZ",
            parts: [0],
            points: [
              { x: 0, y: 0, z: 0, m: 0 },
              { x: 10, y: 5, z: -2, m: 10 },
            ],
          },
        },
      ],
      fields: [],
      rows: [[]],
      prj: null,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      shp_b64?: string;
      shx_b64?: string;
      dbf_b64?: string;
      prj_b64?: string;
    };

    expect(typeof body.shp_b64).toBe("string");
    expect(typeof body.shx_b64).toBe("string");
    expect(typeof body.dbf_b64).toBe("string");
    expect(body.prj_b64).toBeUndefined();
  });
});
