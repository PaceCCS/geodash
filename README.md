# geodash

A geospatial flow network platform for constructing, evaluating, and simulating directed graph networks. Successor to [dagger](https://github.com/Jerell/dagger), rebuilt in Zig.

Website: [geoda.sh](https://geoda.sh)

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system diagram, module boundaries, dependency rules, and data flow.

## Workflows

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
Geodash network + ONNX P×H property texture
    ↓ WebGPU compute shaders
Fluid trajectories through P×H space, one per inlet condition
    ↓ store
Zarr array (inlet_P × inlet_H × KP, one array per property)
```

### Transient Simulation

```
Geodash network + steady-state initial conditions
    ↓ HTTP request → Python Simulation Server (remote)
    ↓ SSE stream (one event per timestep)
    ↓ on completion → Zarr array (KP × time)
Frontend: live Hovmöller canvas, profile plots, time-series
```

### OLGA Integration

Bidirectional exchange with OLGA's `.key`/`.genkey` text format. OLGA expresses pipe geometry as abstract segments (LENGTH/ELEVATION) with no geographic coordinates.

- **Export** (`POST /api/operations/olga/export`): geodash network + shapefile route → OLGA `.key` with per-segment LENGTH/ELEVATION derived from KP geometry
- **Import** (`POST /api/operations/olga/import`): OLGA `.key` → geodash TOML files + optional PolyLineZ shapefile
- **Output visualisation** (planned): `.tpl`/`.ppl` binary output → P-T profile overlaid on P-H phase envelope

## Target Use Cases

These are the specific engineering workflows geodash is designed to improve, targeting flow assurance and process engineers at CCS consultancies.

### Operating Envelope Definition

Defining what inlet conditions (pressure, temperature, composition) a CO₂ transport system can accept while meeting all delivery constraints currently requires running OLGA many times with varying inlet conditions, collecting outputs, and assembling the envelope manually in Python or Excel. This is the primary target for the WebGPU design space explorer: the GPU evaluates a population of candidate inlet conditions simultaneously, constraints cull non-viable candidates, and the surviving envelope is visible in real time. Changing a block property — pipe diameter, delivery pressure, ambient temperature — updates the envelope immediately.

This is especially relevant for multi-source CCS networks where different industrial CO₂ streams (cement, steel, gas processing) have different impurity profiles that shift the phase envelope. What combinations of source streams result in acceptable trunk line conditions is a natural population-of-candidates problem.

### P-H Diagram Overlay on OLGA Results

Flow assurance engineers routinely verify that operating conditions stay in the correct phase (typically dense phase for CO₂) by comparing the P-T profile along a pipeline against the fluid's phase envelope. Currently this involves exporting OLGA results, computing the phase envelope separately using a PVT tool, and overlaying them manually in Python or Excel. Geodash can automate this: load the OLGA output, transform the P-T profile to P-H coordinates using the ONNX thermodynamic models, and plot the operating trajectory against the ONNX-computed phase envelope for the fluid composition. This is a useful standalone capability that requires no trust in geodash's own simulation.

### Compression Train Design

Sizing compressor stages and intercoolers to bring CO₂ from capture facility outlet conditions up to pipeline operating pressure is iterative: adjust stage pressure ratios and intercooling temperatures, recheck phase behaviour, verify power consumption. The P-H diagram is the natural space for this — compression is approximately isentropic (diagonal lines on P-H), intercooling is approximately isobaric (horizontal lines). Assembling these blocks in geodash and watching the fluid state trajectory update in real time is a faster design loop than running a steady-state tool for each configuration.

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

## Status

Planned work is tracked in [GitHub Issues](https://github.com/Jerell/geodash/issues). Quality grades per module are in [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md).

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — System diagram, module boundaries, dependency rules, WASM contract
- [docs/](docs/index.md) — Design decisions, core beliefs, quality scores, dependency references, enforcement rules
