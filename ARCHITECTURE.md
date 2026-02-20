# Architecture

## System Overview

```
┌───────────────────────────────────────────────────┐
│                  Tauri App (Rust)                 │
│  ┌─────────────────────────────────────────────┐  │
│  │         TanStack Start Frontend             │  │
│  │  - React Flow network editor                │  │
│  │  - WebGPU P×H property textures (ONNX)      │  │
│  │  - Compute shader steady-state simulation   │  │
│  │  - Hovmöller / profile / time-series plots  │  │
│  └──────────────────────┬──────────────────────┘  │
│         Tauri auto-starts Hono as child process   │
└─────────────────────────┼─────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │      Hono Server      │
              │  (Bun runtime)        │
              │  - REST API           │
              │  - WASM bridge        │
              │  - SSE stream proxy   │
              │  - Zarr file serving  │
              └───────┬───────┬───────┘
                      │       │
         ┌────────────▼──┐  ┌─▼────────────────────────┐
         │   Zig Core    │  │ Python Simulation Server │
         │   (WASM)      │  │         (remote)         │
         │               │  │ - Transient pipe flow    │
         │  - Network    │  │ - Incremental Zarr write │
         │    Engine     │  │ - SSE timestep stream    │
         │  - Shapefile  │  └──────────────────────────┘
         │  - CRS (CLI)  │
         │  - GeoTIFF    │
         │  - Zarr       │
         └───────────────┘
```

## Module Dependency Graph

Arrows mean "depends on". Only permitted edges are shown.

```
network-engine ──→ shapefile
network-engine ──→ dim (external)
crs ──→ shapefile
crs ──→ PROJ (system C library)

server ──→ network-engine (via WASM)
server ──→ effect, hono, smol-toml (npm)

app ──→ server (HTTP, managed child process)
app ──→ dim (via WASM, client-side units)
```

### Rules

1. **shapefile has zero external dependencies.** No C libraries, no other Zig packages. It must remain self-contained so it compiles cleanly to WASM as part of network-engine.
2. **CRS is isolated.** It links PROJ (a C library) and runs only as a standalone CLI tool. It is never compiled into WASM and never imported by the server.
3. **network-engine is the WASM compilation unit.** It imports shapefile and dim. Its `wasm.zig` exports a JSON-in/JSON-out API. No other Zig module produces WASM.
4. **The server never calls Zig natively.** All Zig core access goes through the WASM bridge (`server/src/services/core.ts`).
5. **The Tauri app starts Hono as a child process.** They are not independent services. Tauri spawns `bun run src/index.ts`, manages its lifecycle, and kills it on shutdown.

## Zig Core Modules

| Module | Directory | Status | WASM | Dependencies |
|---|---|---|---|---|
| network-engine | `core/network-engine/` | Complete | Yes (compilation root) | dim, shapefile |
| shapefile | `core/shapefile/` | Complete | Yes (via network-engine) | None |
| crs | `core/crs/` | Complete | No (CLI only) | PROJ 9 (C) |
| geotiff | `core/geotiff/` | Planned | TBD | None planned |
| zarr | `core/zarr/` | Planned | TBD | None planned |

## Server Layers

```
server/src/
├── index.ts              ← App entry, middleware, route mounting
├── routes/               ← HTTP handlers (thin: validate input, call service, return)
│   ├── query.ts
│   ├── network.ts
│   └── olga.ts
├── services/             ← Business logic
│   ├── core.ts           ← WASM bridge (load, call, memory management)
│   └── olga.ts           ← OLGA validation, route segment computation
├── schemas/              ← Effect Schema definitions (validation at boundary)
│   └── olga/
└── utils/                ← Shared helpers
    └── network.ts
```

### Server rules

1. **Routes are thin.** They parse/validate input, call a service, and return the result. No business logic in route handlers.
2. **Validate at the boundary.** Incoming data is validated with Effect Schema before reaching services. Internal service-to-service calls trust typed interfaces.
3. **WASM is a singleton.** `core.ts` loads the WASM module once at startup. All route handlers share the same instance.

## WASM Contract

The Zig core exports these functions. The TypeScript types in `core.ts` must match exactly.

| Export | Input | Output |
|---|---|---|
| `geodash_query` | `{ files, config, query }` | Query result (dynamic) |
| `geodash_load_network` | `{ files, config }` | `{ nodes, edges }` |
| `geodash_olga_import` | `{ key_content, root_location? }` | `{ files, shapefiles, warnings }` |
| `geodash_olga_export` | `{ files, config, route_segments? }` | `{ key_content, warnings }` |
| `geodash_compute_route_kp` | `{ shp_b64 }` | `{ segments: [{length_m, elevation_m}] }` |
| `geodash_create_route` | `{ segments, root }` | `{ shp_b64, shx_b64, dbf_b64 }` |

Memory protocol: JS allocates via `geodash_alloc`, writes JSON, calls the function, reads JSON output, frees both buffers via `geodash_free`.

## Data Flow

| Concern | Primary format | Where it lives |
|---|---|---|
| Network topology & properties | TOML | File system, loaded via server |
| Route geometry & elevation | Shapefile (PointZ/PolyLineZ) | File system |
| Bathymetric surfaces | GeoTIFF (GEBCO) | File system |
| Pipe geometry (OLGA) | `.key` text format | Imported/exported via server |
| Thermodynamic property surface | RGBA32Float GPU texture | ONNX inference → IndexedDB cache → Zarr |
| Steady-state results | Zarr array (inlet_P × inlet_H × KP) | Client-side |
| Transient simulation results | Zarr array (KP × time) | Python server → served by Hono |

## Build & Run

| Command | What it does |
|---|---|
| `just build-wasm` | Compile network-engine to WASM, copy to `server/wasm/` |
| `just dev` | Build WASM + start server with hot reload |
| `just test-zig` | Run all Zig module tests in parallel |
| `just build-crs` | Build the CRS CLI tool (requires PROJ installed) |
