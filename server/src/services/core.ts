/**
 * Geodash core WASM service.
 *
 * Loads geodash.wasm (compiled from core/network-engine/src/wasm.zig) and
 * exposes typed wrappers for the exported functions.
 *
 * Build the WASM first:
 *   cd core/network-engine && zig build wasm
 *   cp zig-out/bin/geodash.wasm ../../server/wasm/geodash.wasm
 * Or: bun run build:wasm
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { record } from "@elysiajs/opentelemetry";

// ── WASM export types ─────────────────────────────────────────────────────────

type WasmFn = (
  inPtr: number,
  inLen: number,
  outPtrPtr: number,
  outLenPtr: number
) => number;

type CoreExports = {
  memory: WebAssembly.Memory;
  geodash_alloc: (len: number) => number;
  geodash_free: (ptr: number, len: number) => void;
  geodash_query: WasmFn;
  geodash_load_network: WasmFn;
  geodash_olga_import: WasmFn;
  geodash_olga_export: WasmFn;
  geodash_compute_route_kp: WasmFn;
  geodash_create_route: WasmFn;
};

// ── Loader ────────────────────────────────────────────────────────────────────

type Runtime = CoreExports & {
  enc: TextEncoder;
  dec: TextDecoder;
};

let initPromise: Promise<void> | null = null;
let runtime: Runtime | null = null;

async function init(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const wasmPath = join(import.meta.dir, "../../wasm/geodash.wasm");
    const buf = await readFile(wasmPath);
    const bytes = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    );

    // The WASM module (wasm32-wasi) only imports fd_filestat_get from the WASI
    // snapshot. We stub it to return EBADF (8) — the module only needs this
    // symbol to satisfy the linker; it is never actually invoked at runtime.
    const imports = {
      wasi_snapshot_preview1: {
        fd_filestat_get: (_fd: number, _buf: number): number => 8,
      },
    };

    const result = await WebAssembly.instantiate(bytes, imports);
    const instance = (
      "instance" in result ? result.instance : result
    ) as WebAssembly.Instance & { exports: CoreExports };

    const required: Array<keyof CoreExports> = [
      "memory",
      "geodash_alloc",
      "geodash_free",
      "geodash_query",
      "geodash_load_network",
      "geodash_olga_import",
      "geodash_olga_export",
      "geodash_compute_route_kp",
      "geodash_create_route",
    ];
    for (const name of required) {
      if (!(name in instance.exports)) {
        throw new Error(`geodash WASM missing export: ${name}`);
      }
    }

    runtime = {
      ...(instance.exports as CoreExports),
      enc: new TextEncoder(),
      dec: new TextDecoder(),
    };
  })();

  return initPromise;
}

// ── Call helper ───────────────────────────────────────────────────────────────

function callWasm(
  name: string,
  rt: Runtime,
  fn: (
    inPtr: number,
    inLen: number,
    outPtrPtr: number,
    outLenPtr: number
  ) => number,
  request: unknown
): unknown {
  return record(`wasm.${name}`, () => {
    const input = rt.enc.encode(JSON.stringify(request));

    const inPtr = rt.geodash_alloc(input.length);
    if (inPtr === 0) throw new Error("geodash_alloc failed (OOM)");
    new Uint8Array(rt.memory.buffer, inPtr, input.length).set(input);

    // 8 bytes: [out_ptr: u32, out_len: u32]
    const scratchPtr = rt.geodash_alloc(8);
    if (scratchPtr === 0) {
      rt.geodash_free(inPtr, input.length);
      throw new Error("geodash_alloc failed (OOM)");
    }

    const rc = fn(inPtr, input.length, scratchPtr, scratchPtr + 4);
    rt.geodash_free(inPtr, input.length);

    const dv = new DataView(rt.memory.buffer);
    const outPtr = dv.getUint32(scratchPtr, true);
    const outLen = dv.getUint32(scratchPtr + 4, true);
    rt.geodash_free(scratchPtr, 8);

    if (outPtr === 0 || outLen === 0) {
      throw new Error("WASM returned empty output");
    }

    const text = rt.dec.decode(new Uint8Array(rt.memory.buffer, outPtr, outLen));
    rt.geodash_free(outPtr, outLen);

    const result = JSON.parse(text) as unknown;
    if (rc !== 0) {
      const err = result as { error?: string };
      throw new Error(err.error ?? "WASM call failed");
    }

    return result;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Read all .toml files in `dir`; return `{ files, config }`. */
export async function readNetworkDir(dir: string): Promise<{
  files: Record<string, string>;
  config: string | null;
}> {
  return record("io.read_network_dir", async () => {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(dir, { withFileTypes: true });
    const files: Record<string, string> = {};
    let config: string | null = null;

    await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith(".toml"))
        .map(async (e) => {
          const content = await readFile(join(dir, e.name), "utf-8");
          if (e.name === "config.toml") config = content;
          else files[e.name] = content;
        })
    );

    return { files, config };
  });
}

export async function queryNetwork(
  networkDir: string,
  query: string
): Promise<unknown> {
  await init();
  const rt = runtime!;
  const { files, config } = await readNetworkDir(networkDir);
  return callWasm(
    "query",
    rt,
    (a, b, c, d) => rt.geodash_query(a, b, c, d),
    { files, config, query }
  );
}

export async function loadNetwork(networkDir: string): Promise<unknown> {
  await init();
  const rt = runtime!;
  const { files, config } = await readNetworkDir(networkDir);
  return callWasm(
    "load_network",
    rt,
    (a, b, c, d) => rt.geodash_load_network(a, b, c, d),
    { files, config }
  );
}

export type OlgaImportResult = {
  files: Record<string, string>;
  shapefiles: Record<string, string>;
  warnings: string[];
};

export type OlgaExportResult = {
  key_content: string;
  warnings: string[];
};

export type RouteSegment = { length_m: number; elevation_m: number };

export type RouteKpResult = { segments: RouteSegment[] };

export type CreateRouteResult = {
  shp_b64: string;
  shx_b64: string;
  dbf_b64: string;
};

export async function importFromOlga(
  keyContent: string,
  rootLocation?: { x: number; y: number; z: number }
): Promise<OlgaImportResult> {
  await init();
  const rt = runtime!;
  return callWasm(
    "olga_import",
    rt,
    (a, b, c, d) => rt.geodash_olga_import(a, b, c, d),
    { key_content: keyContent, root_location: rootLocation }
  ) as OlgaImportResult;
}

export async function exportToOlga(
  files: Record<string, string>,
  config?: string | null,
  routeSegments?: Record<string, RouteSegment[]>
): Promise<OlgaExportResult> {
  await init();
  const rt = runtime!;
  return callWasm(
    "olga_export",
    rt,
    (a, b, c, d) => rt.geodash_olga_export(a, b, c, d),
    { files, config, route_segments: routeSegments }
  ) as OlgaExportResult;
}

export async function computeRouteKp(shpB64: string): Promise<RouteKpResult> {
  await init();
  const rt = runtime!;
  return callWasm(
    "compute_route_kp",
    rt,
    (a, b, c, d) => rt.geodash_compute_route_kp(a, b, c, d),
    { shp_b64: shpB64 }
  ) as RouteKpResult;
}

export async function createRoute(
  segments: RouteSegment[],
  root: { x: number; y: number; z: number }
): Promise<CreateRouteResult> {
  await init();
  const rt = runtime!;
  return callWasm(
    "create_route",
    rt,
    (a, b, c, d) => rt.geodash_create_route(a, b, c, d),
    { segments, root }
  ) as CreateRouteResult;
}

