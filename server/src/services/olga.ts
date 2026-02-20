import { Schema } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadNetwork,
  readNetworkDir,
  computeRouteKp,
  type RouteSegment,
} from "./core";
import { olgaSchemaRegistry, type OlgaBlockType } from "../schemas/olga";

// ── Validation types ──────────────────────────────────────────────────────────

export type BlockValidationStatus = "ready" | "missing_properties" | "unknown_type";

export type BlockValidationResult = {
  index: number;
  type: string;
  status: BlockValidationStatus;
  missingProperties: string[];
  definedProperties: Record<string, unknown>;
};

export type BranchValidationResult = {
  id: string;
  label?: string;
  blocks: BlockValidationResult[];
};

export type OlgaValidationResult = {
  isReady: boolean;
  summary: {
    branchCount: number;
    totalBlocks: number;
    readyBlocks: number;
  };
  branches: BranchValidationResult[];
};

// ── validateNetworkForOlga ────────────────────────────────────────────────────

const schemas = olgaSchemaRegistry["v1.0-olga"];

/** Walk network blocks against olgaSchemaRegistry["v1.0-olga"]. */
export async function validateNetworkForOlga(
  networkDir: string
): Promise<OlgaValidationResult> {
  const raw = (await loadNetwork(networkDir)) as {
    nodes: Array<{
      id: string;
      type: string;
      label?: string;
      blocks?: Array<{ type: string; [key: string]: unknown }>;
    }>;
  };

  const branches: BranchValidationResult[] = [];
  let totalBlocks = 0;
  let readyBlocks = 0;

  // Re-read files to get block property detail (loadNetwork only returns structure)
  const { files } = await readNetworkDir(networkDir);

  // Parse block properties from TOML content — quick and dirty JSON path through
  // the full network data returned by loadNetwork doesn't include block extras.
  // We parse each branch TOML manually.
  const { parse: parseTOML } = await import("smol-toml").catch(() => ({ parse: null }));

  for (const node of raw.nodes) {
    if (node.type !== "branch") continue;

    // Load block details from TOML if available
    const tomlKey = Object.keys(files).find(
      (k) => k === `${node.id}.toml` || k.endsWith(`/${node.id}.toml`)
    );
    let blockDefs: Array<Record<string, unknown>> = [];

    if (tomlKey && parseTOML) {
      try {
        const parsed = parseTOML(files[tomlKey]) as {
          block?: Array<Record<string, unknown>>;
        };
        blockDefs = parsed.block ?? [];
      } catch {
        // ignore parse errors — validate with empty properties
      }
    }

    const blockResults: BlockValidationResult[] = [];

    for (let bi = 0; bi < blockDefs.length; bi++) {
      const blockDef = blockDefs[bi];
      const blockType = String(blockDef.type ?? "");
      totalBlocks++;

      let status: BlockValidationStatus;
      const missingProperties: string[] = [];

      if (blockType in schemas) {
        const schema = schemas[blockType as OlgaBlockType];
        const result = Schema.decodeUnknownEither(schema as Schema.Schema<unknown>)(blockDef);
        if (result._tag === "Right") {
          status = "ready";
          readyBlocks++;
        } else {
          status = "missing_properties";
          // Extract missing field names from the error
          const errStr = String(result.left);
          const matches = errStr.matchAll(/"(\w+)"/g);
          for (const m of matches) {
            if (!missingProperties.includes(m[1])) {
              missingProperties.push(m[1]);
            }
          }
        }
      } else if (blockType === "") {
        status = "unknown_type";
      } else {
        // Known block type not in OLGA schema (e.g. a custom block) — skip
        status = "unknown_type";
      }

      blockResults.push({
        index: bi,
        type: blockType,
        status,
        missingProperties,
        definedProperties: blockDef,
      });
    }

    branches.push({
      id: node.id,
      label: node.label,
      blocks: blockResults,
    });
  }

  return {
    isReady: branches.every((b) =>
      b.blocks.every((bl) => bl.status === "ready" || bl.status === "unknown_type")
    ),
    summary: {
      branchCount: branches.length,
      totalBlocks,
      readyBlocks,
    },
    branches,
  };
}

// ── computeRouteSegments ──────────────────────────────────────────────────────

/** Read .shp file bytes, base64-encode, call WASM, return segments. */
export async function computeRouteSegments(
  shpPath: string
): Promise<RouteSegment[]> {
  const bytes = await readFile(shpPath);
  const b64 = bytes.toString("base64");
  const result = await computeRouteKp(b64);
  return result.segments;
}

// ── resolveRouteSegments ──────────────────────────────────────────────────────

/** For each Pipe block with a `route` property, compute segments from its shapefile. */
export async function resolveRouteSegments(
  networkDir: string,
  files: Record<string, string>
): Promise<Record<string, RouteSegment[]>> {
  const { parse: parseTOML } = await import("smol-toml").catch(() => ({
    parse: null,
  }));
  if (!parseTOML) return {};

  const result: Record<string, RouteSegment[]> = {};

  for (const [filename, content] of Object.entries(files)) {
    if (!filename.endsWith(".toml")) continue;

    let parsed: { block?: Array<Record<string, unknown>> };
    try {
      parsed = parseTOML(content) as typeof parsed;
    } catch {
      continue;
    }

    if (!parsed.block) continue;

    // Derive branch ID from filename (strip .toml)
    const branchId = filename.slice(0, -5);

    for (let bi = 0; bi < parsed.block.length; bi++) {
      const block = parsed.block[bi];
      if (block.type !== "Pipe") continue;
      const route = block.route;
      if (typeof route !== "string") continue;

      const shpPath = join(networkDir, route);
      try {
        const segs = await computeRouteSegments(shpPath);
        result[`${branchId}/blocks/${bi}`] = segs;
      } catch {
        // Route file not found — skip; writer will use block properties
      }
    }
  }

  return result;
}
