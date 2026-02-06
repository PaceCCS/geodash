# geodash

A geospatial flow network platform for constructing, evaluating, and simulating directed graph networks. Successor to [dagger](https://github.com/Jerell/dagger), rebuilt in Zig.

Website: [geoda.sh](https://geoda.sh)

## Architecture

```
┌─────────────────────────────────────┐
│           Tauri App (Rust)          │
│  ┌───────────────────────────────┐  │
│  │     WebGPU Frontend           │  │
│  │  - Network editor             │  │
│  │  - Phase diagram plotter      │  │
│  │  - Compute shader simulation  │  │
│  └──────────────┬────────────────┘  │
└─────────────────┼───────────────────┘
                  │
        ┌─────────▼─────────┐
        │   Hono Server     │
        │  - REST API       │
        │  - Query engine   │
        │  - Schema routing │
        └─────────┬─────────┘
                  │
    ┌─────────────▼─────────────────┐
    │        Zig Core               │
    │  ┌─────────┐  ┌────────────┐  │
    │  │ Network │  │ Shapefile  │  │
    │  │ Engine  │  │ Parser     │  │
    │  ├─────────┤  ├────────────┤  │
    │  │ dim     │  │ GeoTIFF    │  │
    │  │ (units) │  │ I/O        │  │
    │  └─────────┘  └────────────┘  │
    └───────────────────────────────┘
```

### Tauri App

Rust shell hosting a webview frontend. Handles windowing, file system access, and communication with the Hono server. The frontend uses WebGPU compute shaders for:

- Phase diagram plotting via ONNX neural nets generating RGBA storage textures
- Steady-state pipe simulation using thermodynamic property textures

### Hono Server

Middleware layer between the frontend and the Zig core. Exposes the network query language, handles schema validation, and orchestrates calls to the core engine and any external APIs.

### Zig Core

The computational backbone, composed of:

- **Network Engine** — The scope-based directed graph system (Global → Group → Branch → Block) with hierarchical property inheritance, TOML serialization, and versioned schema validation. Rebuilt from dagger's Rust/TypeScript implementation.
- **[dim](https://github.com/Jerell/dim)** — Compile-time dimensional analysis library providing type-safe quantities across seven SI base dimensions. Enforces unit correctness throughout the network engine (all values stored in SI internally, converted per block type preferences). Also compiles to WASM for frontend use.
- **Shapefile Parser** — Native Zig implementation for reading/writing `.shp`, `.shx`, and `.dbf` files. No C dependencies. Priority support for PointZ geometries (dense surveyed pipe routes) and PolyLineZ (pipeline paths). See [bathymetry-tool](https://github.com/Jerell/bathymetry-tool) for the Python prototype of this workflow.
- **GeoTIFF I/O** — Read/write georeferenced raster data. Used for global bathymetric surfaces (e.g. GEBCO), fluid property maps from compute shaders, and pipe simulation outputs.
- **CRS Transform** — Coordinate reference system conversions (e.g. ED50 UTM Zone 30N ↔ WGS84) needed to reconcile survey data with global datasets. Likely wraps PROJ via C interop.

## Geospatial Data Model

TOML and shapefiles serve complementary roles:

| Concern | TOML | Shapefile | GeoTIFF |
|---|---|---|---|
| Scope hierarchy & inheritance | Primary | — | — |
| Block type, schema, config | Primary | — | — |
| Route geometry & elevation | — | Primary (PointZ/PolyLineZ) | — |
| Block locations | — | Primary (PointZ) | — |
| Bathymetric surfaces | — | — | Primary (e.g. GEBCO) |
| Block properties/attributes | Primary (full) | Secondary (`.dbf` subset) | — |
| Simulation output grids | — | — | Primary |

A typical pipeline workflow:

```
GEBCO GeoTIFF (bathymetric surface)
    ↓ sample along route
PointZ Shapefile (surveyed pipe profile, e.g. 1m-spaced KP points)
    ↓ import into network
Branch/Block elevation properties (with KP indexing via dim)
    ↓ simulate
Compute shader outputs → GeoTIFF export
```

This mirrors the workflow in [bathymetry-tool](https://github.com/Jerell/bathymetry-tool), which reads a PointZ shapefile (~66k survey points along the Spirit pipeline at 1m spacing in ED50 UTM Zone 30N), computes cumulative KP values, and compares the high-res profile against GEBCO 2025 GeoTIFF data after coordinate transform to WGS84.

## Kilometer Post (KP)

A kilometer post (KP) is a distance marker along a pipeline route, measured as cumulative distance from the route's start point (KP 0). It's the standard way to reference locations on a pipeline — rather than using geographic coordinates, engineers refer to positions like "KP 12.5" meaning 12.5 km along the route.

KP values are computed from a sequence of surveyed 3D points along the pipe route:

```
For each consecutive pair of points (P₁, P₂):
    segment_distance = √((x₂ - x₁)² + (y₂ - y₁)²)
    KP₂ = KP₁ + segment_distance
```

The distance calculation uses the 2D horizontal (easting/northing) coordinates, not the Z (depth) values — KP represents distance along the ground/seabed surface projection, not the actual path length of the pipe. This is important because elevation changes don't affect how positions are referenced.

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

## Suggested Plan

### Phase 1: Zig Core Foundation

- Port the scope hierarchy and property inheritance system from dagger to Zig
- Integrate `dim` for compile-time unit safety on all quantity values
- Implement TOML parsing for network definitions
- Port the query language for property navigation and filtering
- Implement versioned schema validation

### Phase 2: Shapefile Parser & Geospatial I/O

- Implement `.shp` reader with PointZ and PolyLineZ as priority geometry types
- Implement `.shx` reader (spatial index)
- Implement `.dbf` reader (attribute data)
- KP (kilometer post) computation from consecutive survey points — cumulative distance along route
- CRS transform support (wrap PROJ) for reconciling survey and global datasets
- GeoTIFF reader for sampling bathymetric surfaces (GEBCO) along pipe routes
- Write support for `.shp`/`.shx`/`.dbf`
- Map PointZ routes to Branch elevation profiles and Point features to Block locations

### Phase 3: Hono Server + API

- Set up Hono server with routes for network CRUD operations
- Expose the query engine over REST
- Schema validation endpoints
- Shapefile import/export endpoints
- Bridge to Zig core via FFI or subprocess

### Phase 4: Tauri App

- Scaffold Tauri app with webview frontend
- Network editor UI (create/edit scopes, visualize the DAG)
- Connect to Hono server for data operations
- Integrate `dim` WASM build for client-side unit display and conversion

### Phase 5: WebGPU Simulation Pipeline

- Integrate phase diagram plotter (ONNX neural nets → RGBA storage textures)
- Integrate pipe steady-state compute shaders consuming property textures
- Connect simulation results back to Block properties in the network engine
- GeoTIFF export for simulation outputs with georeferencing metadata
