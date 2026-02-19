# Hono Server

Middleware layer between the frontend and the Zig core, and the integration point for the Python transient simulation server.

## Responsibilities

- REST API for network query and load operations
- OLGA `.key` import/export and network validation
- Bridge to Zig core via WASM (geodash.wasm loaded in-process)
- Interface with the Python transient simulation server: start runs, proxy the SSE timestep stream to connected frontend clients
- Serve Zarr files with HTTP range request support so `zarr.js` can fetch individual chunks on demand

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/query` | Query network (`?network=<path>&q=<query>`) |
| GET | `/api/network` | Load network structure (`?network=<path>`) |
| POST | `/api/operations/olga/validate` | Validate network blocks against OLGA schema |
| POST | `/api/operations/olga/export` | Export geodash network to OLGA `.key` |
| POST | `/api/operations/olga/import` | Parse OLGA `.key` into geodash TOML files |

## WASM Bridge

The Zig core compiles to `geodash.wasm` (wasm32-wasi). The server loads it once at startup and calls exported functions using a JSON-in / JSON-out protocol:

```
JS allocates input buffer → writes JSON → calls export → reads output JSON → frees buffers
```

Exported functions:

| Export | Description |
|--------|-------------|
| `geodash_query` | Execute a path query against a network |
| `geodash_load_network` | Load network structure (nodes + edges) |
| `geodash_olga_import` | Parse OLGA `.key` → TOML files + optional shapefile bytes |
| `geodash_olga_export` | Generate OLGA `.key` from network + route segments |
| `geodash_compute_route_kp` | Compute length/elevation segments from `.shp` bytes |
| `geodash_create_route` | Build a PolyLineZ `.shp` from segments + root location |

Build WASM and copy to server:

```sh
just build-wasm
```

## OLGA Operations

### Import

```sh
curl -X POST http://localhost:3001/api/operations/olga/import \
  -H "Content-Type: application/json" \
  -d '{
    "key_content": "CASE PROJECT='\''test'\''...",
    "root_location": { "x": 450000, "y": 6200000, "z": 0 },
    "output_dir": "/path/to/output"
  }'
```

Returns `{ files, warnings }`. If `output_dir` is provided, TOML files and shapefile bytes are written to disk.

### Export

```sh
curl -X POST http://localhost:3001/api/operations/olga/export \
  -H "Content-Type: application/json" \
  -d '{ "network": "/path/to/network" }'
```

Returns `{ key_content, warnings }`. If Pipe blocks have `route` properties pointing to `.shp` files, their KP geometry is used to emit one OLGA `PIPE` per segment.

### Validate

```sh
curl -X POST http://localhost:3001/api/operations/olga/validate \
  -H "Content-Type: application/json" \
  -d '{ "network": "/path/to/network" }'
```

Returns per-block validation status against the OLGA schema (required fields: `diameter`, `roughness` for Pipe; `pressure`, `temperature`, `flow_rate` for Source; `pressure` for Sink).

## Transient Simulation Integration

The Hono server brokers between the frontend and the Python simulation server, which may run on a separate machine.

Flow:

1. Frontend requests a simulation run (network definition + inlet conditions)
2. Hono forwards the request to the Python simulation server
3. Hono subscribes to the simulation server's SSE stream
4. Hono forwards SSE events (one per completed timestep) to connected frontend clients
5. On completion, Hono serves the resulting Zarr file for retrospective analysis

The simulation server URL is configured via environment variable. The Hono server does not need to understand the Zarr format — it serves the chunk files as static content.
