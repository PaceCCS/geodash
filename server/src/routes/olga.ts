import { Hono } from "hono";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { importFromOlga, exportToOlga, readNetworkDir } from "../services/core";
import {
  validateNetworkForOlga,
  resolveRouteSegments,
} from "../services/olga";
import { resolveNetworkPath } from "../utils/network";

export const olgaRoutes = new Hono();

// ── POST /api/operations/olga/validate ────────────────────────────────────────

olgaRoutes.post("/validate", async (c) => {
  let body: { network?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const networkDir = resolveNetworkPath(body.network);
  if (!networkDir) {
    return c.json({ error: "Missing field: network" }, 400);
  }

  try {
    const result = await validateNetworkForOlga(networkDir);
    return c.json(result);
  } catch (err) {
    return c.json(
      {
        error: "Validation failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});

// ── POST /api/operations/olga/export ─────────────────────────────────────────

olgaRoutes.post("/export", async (c) => {
  let body: { network?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const networkDir = resolveNetworkPath(body.network);
  if (!networkDir) {
    return c.json({ error: "Missing field: network" }, 400);
  }

  try {
    const { files, config } = await readNetworkDir(networkDir);
    const routeSegments = await resolveRouteSegments(networkDir, files);
    const result = await exportToOlga(files, config, routeSegments);
    return c.json(result);
  } catch (err) {
    return c.json(
      {
        error: "Export failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});

// ── POST /api/operations/olga/import ─────────────────────────────────────────

olgaRoutes.post("/import", async (c) => {
  let body: {
    key_content?: string;
    output_dir?: string;
    root_location?: { x: number; y: number; z: number };
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.key_content) {
    return c.json({ error: "Missing field: key_content" }, 400);
  }

  try {
    const result = await importFromOlga(body.key_content, body.root_location);

    if (body.output_dir) {
      await mkdir(body.output_dir, { recursive: true });

      // Write TOML files
      await Promise.all(
        Object.entries(result.files).map(([filename, content]) =>
          writeFile(join(body.output_dir!, filename), content, "utf-8")
        )
      );

      // Decode and write shapefile bytes
      await Promise.all(
        Object.entries(result.shapefiles).map(([filename, b64]) => {
          const bytes = Buffer.from(b64, "base64");
          return writeFile(join(body.output_dir!, filename), bytes);
        })
      );
    }

    return c.json({
      files: result.files,
      warnings: result.warnings,
      ...(body.output_dir ? { output_dir: body.output_dir } : {}),
    });
  } catch (err) {
    return c.json(
      {
        error: "Import failed",
        message: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});
