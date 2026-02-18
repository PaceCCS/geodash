# geodash

A geospatial flow network platform for constructing, evaluating, and simulating directed graph networks. Successor to [dagger](https://github.com/Jerell/dagger), rebuilt in Zig.

Website: [geoda.sh](https://geoda.sh)

## Architecture

```
┌───────────────────────────────────────────────────┐
│                  Tauri App (Rust)                 │
│  ┌─────────────────────────────────────────────┐  │
│  │                WebGPU Frontend              │  │
│  │  - Network editor                           │  │
│  │  - Phase diagram plotter (ONNX textures)    │  │
│  │  - Steady-state simulation (compute shaders)│  │
│  │  - Hovmöller / profile / time-series plots  │  │
│  └──────────────────────┬──────────────────────┘  │
└─────────────────────────┼─────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │      Hono Server      │
              │  - REST API           │
              │  - Network queries    │
              │  - SSE stream proxy   │
              │  - Zarr file serving  │
              └───────┬───────┬───────┘
                      │       │
         ┌────────────▼──┐  ┌─▼────────────────────────┐
         │   Zig Core    │  │ Python Simulation Server │
         │               │  │         (remote)         │
         │  - Network    │  │ - Transient pipe flow    │
         │    Engine     │  │ - Incremental Zarr write │
         │  - Shapefile  │  │ - SSE timestep stream    │
         │  - GeoTIFF    │  └──────────────────────────┘
         │  - CRS        │
         │  - Zarr       │
         └───────────────┘
```

### Tauri App

Rust shell hosting a WebGPU frontend. Handles windowing, file system access, and communication with the Hono server. The frontend uses WebGPU compute shaders for steady-state pipe simulation and `zarr.js` for loading transient simulation results.

### Hono Server

Middleware layer between the frontend and the Zig core. Exposes the network query language, handles schema validation, orchestrates calls to the Zig core, and acts as broker to the Python transient simulation server — proxying its SSE stream to connected clients and serving completed Zarr output files.

### Zig Core

The computational backbone, composed of:

- **Network Engine** — The scope-based directed graph system (Global → Group → Branch → Block) with hierarchical property inheritance, TOML serialization, and versioned schema validation. Rebuilt from dagger's Rust/TypeScript implementation.
- **[dim](https://github.com/Jerell/dim)** — Compile-time dimensional analysis library providing type-safe quantities across seven SI base dimensions. Enforces unit correctness throughout the network engine (all values stored in SI internally, converted per block type preferences). Also compiles to WASM for frontend use.
- **Shapefile Parser** — Native Zig implementation for reading/writing `.shp`, `.shx`, and `.dbf` files. No C dependencies. Priority support for PointZ geometries (dense surveyed pipe routes) and PolyLineZ (pipeline paths). See [bathymetry-tool](https://github.com/Jerell/bathymetry-tool) for the Python prototype of this workflow.
- **Route Importer** — Reads KML, KMZ, and Google My Maps CSV exports into PolyLineZ. KML altitude values are preserved as Z; reprojection and KP assignment follow via the CRS transform tool.
- **GeoTIFF I/O** — Read georeferenced raster data. Used for global bathymetric surfaces (e.g. GEBCO) to sample seabed elevation along pipe routes. *(Planned)*
- **CRS Transform** — Coordinate reference system conversions (e.g. ED50 UTM Zone 30N ↔ WGS84) needed to reconcile survey data with global datasets. Wraps PROJ via C interop.
- **Zarr Reader** — Reads Zarr v3 arrays for cases where the Zig core needs to consume simulation results directly.

### Python Simulation Server

External Python service (may run on a separate machine) that performs transient pipe flow simulation. Writes results incrementally as Zarr arrays and streams each completed timestep to Hono via SSE. See `simulation/` for the interface contract.

## Geospatial Data Model

TOML, shapefiles, GeoTIFF, and Zarr serve complementary roles:

| Concern | TOML | Shapefile | GeoTIFF | Zarr |
|---|---|---|---|---|
| Scope hierarchy & inheritance | Primary | — | — | — |
| Block type, schema, config | Primary | — | — | — |
| Route geometry & elevation | — | Primary (PointZ/PolyLineZ) | — | — |
| Block locations | — | Primary (PointZ) | — | — |
| Bathymetric surfaces | — | — | Primary (GEBCO) | — |
| Block properties/attributes | Primary (full) | Secondary (`.dbf` subset) | — | — |
| Thermodynamic property surface (P×H) | — | — | — | Primary |
| Steady-state results | — | — | — | Primary (KP-indexed) |
| Transient simulation results | — | — | — | Primary (KP × time) |

## Simulation Workflows

### Route → Network

#### Implemented

```
Route geometry source (one of):
  - KML / KMZ  →  PolyLineZ in WGS84, Z from embedded altitude if present
  - Google My Maps CSV (WKT)  →  PolyLineZ in WGS84, Z = 0
  - Existing PointZ / PolyLineZ shapefile  →  read directly
      ↓ reproject
  CRS transform (e.g. WGS84 → ED50 UTM Zone 30N) via PROJ
      ↓ compute KP
  Cumulative horizontal distance along route → KP index (metres → km)
      ↓ write
  PointZ / PolyLineZ shapefile (metric CRS, KP in M channel)
```

#### Planned: Bathymetry elevation sampling

```
GEBCO GeoTIFF (global bathymetric surface)
    ↓ reproject route to WGS84 if needed
    ↓ sample raster along route points
Route PointZ with Z values filled from GEBCO
    ↓ import into network
Branch/Block elevation properties (KP-indexed)
```

This follows the workflow in [bathymetry-tool](https://github.com/Jerell/bathymetry-tool), which reads a PointZ shapefile (~66k survey points along the Spirit pipeline at 1m spacing in ED50 UTM Zone 30N), computes cumulative KP values, and compares the high-res profile against GEBCO 2025 GeoTIFF data. If the source geometry already includes altitude (e.g. from a KML export), the GEBCO step can be skipped.

### Steady-State Simulation

```
Geodash network (block types, properties, KP positions)
    + thermodynamic property surface (ONNX → P×H Zarr texture)
    ↓ WebGPU compute shaders
Fluid trajectories through P×H space, one per inlet condition
    ↓ store
Zarr array (inlet_P × inlet_H × KP, one array per property)
```

The thermodynamic property surface is a precomputed P×H raster with fluid properties (density, temperature, viscosity, phase fraction) encoded per cell — generated once by ONNX neural networks and cached. The compute shaders march each inlet condition along the pipe, stepping through the property surface to find successive (P, H) states. Results are stored as a family of trajectories so the effect of varying inlet conditions can be compared simultaneously.

### Transient Simulation

```
Geodash network + steady-state initial conditions
    ↓ HTTP request
Python Simulation Server (remote)
    ↓ SSE stream (one event per timestep)
Hono Server → Frontend (live Hovmöller canvas)
    ↓ on completion
Zarr array (KP × time, one array per property)
    ↓ served via Hono
Frontend zarr.js (profile plots, time-series, full Hovmöller)
```

## Kilometer Post (KP)

A kilometer post (KP) is a distance marker along a pipeline route, measured as cumulative distance from the route's start point (KP 0). It's the standard way to reference locations on a pipeline — rather than using geographic coordinates, engineers refer to positions like "KP 12.5" meaning 12.5 km along the route.

KP values are computed from a sequence of surveyed 3D points along the pipe route:

```
For each consecutive pair of points (P₁, P₂):
    segment_distance = √((x₂ - x₁)² + (y₂ - y₁)²)
    KP₂ = KP₁ + segment_distance
```

The distance calculation uses the 2D horizontal (easting/northing) coordinates, not the Z (depth) values — KP represents distance along the ground/seabed surface projection, not the actual path length of the pipe.

Once computed, KP serves as the primary index for all properties along a pipe block — elevation, pressure, temperature, and simulation outputs are all plotted and queried as functions of KP.

## Scope Hierarchy

Networks are organized in a four-level scope hierarchy where properties cascade downward, with each level able to override its parent:

```
Global (config.toml)
  └── Group
        └── Branch
              └── Block
```

- **Global** — Foundation-level defaults
- **Group** — Organizational container for related branches
- **Branch** — A network segment (e.g. a pipeline section)
- **Block** — Individual component within a branch (e.g. a pipe, valve, compressor)

## Progress

### Phase 1: Zig Core Foundation — Complete

The network engine (`core/network-engine/`) is implemented with 52 passing tests:

- Custom TOML parser for the dagger file format (tables, arrays of tables, dotted keys)
- Network loader: reads a directory of `.toml` files, derives node IDs from filenames, builds edges from outgoing connections, validates references
- Scope system: `Config` loaded from `config.toml`, `ScopeResolver` walks configurable inheritance chains (per-property, per-block-type rules)
- Query engine: path-based queries (`branch-4/blocks/0/pressure`), array indexing, range slicing, filter expressions (`[type=Pipe]`), scope resolution via `?scope=` params
- Integration tests against actual dagger preset1 data (14 nodes across 5 types, 9 branches)

### Phase 2: Shapefile Parser & Geospatial I/O — Substantially Complete

Done:

- `.shp` reader/writer — PointZ and PolyLineZ geometry types
- `.shx` reader/writer — spatial index
- `.dbf` reader/writer — attribute table
- KP computation from consecutive survey points — cumulative 2D horizontal distance (metres → km)
- CRS transform — wraps PROJ 9 via C interop; CLI tool (`crs-tool --to EPSG:4326 input.shp output.shp`); ARM64 ABI workaround for pass-by-value bug
- Route importer — KML, KMZ, and Google My Maps CSV → PolyLineZ in WGS84; altitude preserved from KML where present

Still to do:

- GeoTIFF reader for sampling bathymetric surfaces (GEBCO) along pipe routes
- Map PointZ routes to Branch elevation profiles and Point features to Block locations

### Phase 3: Hono Server + API

- Set up Hono server with routes for network CRUD operations
- Expose the query engine over REST
- Schema validation endpoints
- Shapefile import/export endpoints
- Bridge to Zig core via FFI or subprocess
- Interface with Python transient simulation server: start runs, proxy SSE stream to frontend
- Serve Zarr files via static file serving with HTTP range request support

### Phase 4: Tauri App

- Scaffold Tauri app with webview frontend
- Network editor UI (create/edit scopes, visualize the DAG)
- Connect to Hono server for data operations
- Integrate `dim` WASM build for client-side unit display and conversion
- Hovmöller diagram: KP on Y axis, time on X axis, property value as colour
- Profile plots: property vs KP at a fixed timestep
- Time-series plots: property vs time at a fixed KP location
- Live Hovmöller canvas fed by SSE stream during active simulation runs
- Zarr-backed retrospective analysis via `zarr.js`

### Phase 5: WebGPU Simulation Pipeline

- Load thermodynamic property surface from Zarr into GPU texture (or generate live via ONNX)
- Implement compute shader trajectory integration: march inlet conditions through P×H property texture along pipe
- Store family-of-results as Zarr array (inlet_P × inlet_H × KP × property)
- Single-run mode: one inlet condition, KP-indexed result array
- Connect simulation results back to Block properties in the network engine
