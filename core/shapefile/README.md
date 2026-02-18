# Shapefile Parser

Native Zig implementation for reading and writing `.shp`, `.shx`, `.dbf`, and `.prj` files. No C dependencies.

Priority geometry types: **PointZ** (dense surveyed pipe routes) and **PolyLineZ** (pipeline paths). Includes KP (kilometer post) computation from consecutive survey points.

---

## What is a shapefile?

A shapefile is not a single file — it is a set of files that share a stem name and must be kept together:

| Extension | Contains |
|-----------|---------|
| `.shp` | The geometry (points, lines, polygons) |
| `.shx` | A spatial index into the `.shp` file |
| `.dbf` | A table of attributes, one row per geometry record |
| `.prj` | The coordinate reference system, as a WKT string |

Every record in a shapefile has the **same geometry type**. You cannot mix points and lines in one file. Each record in `.shp` corresponds to a row in `.dbf` by position — record 1 in `.shp` → row 1 in `.dbf`.

Geometry types used in geodash:

- **PointZ** — a single point with X, Y, Z (elevation), and M (measure/KP) values
- **PolyLineZ** — an ordered sequence of points forming one or more connected line segments, each point carrying Z and M values

---

## How geodash uses shapefiles

The geodash network is defined in TOML files. Shapefiles carry the **physical geography** that TOML cannot express: where a pipe actually runs, how deep it is, and what the seabed looks like beneath it.

### Pipe blocks and elevation profiles

A `Pipe` block in a branch TOML can have a `route` property pointing to a file that describes the pipe's physical route — the ordered sequence of 3D coordinates along the pipe, with cumulative KP distance at each point.

A PolyLineZ shapefile is the intended format for this. It stores an ordered **sequence of points** as three parallel arrays:
- `points` — XY coordinates
- `z` — elevation at each point (metres; negative = below sea level)
- `m` — the "measure" field, used here for **KP in metres** from the start of this pipe

The `.dbf` accompanies the geometry with a single row (one per PolyLineZ feature). Block properties (diameter, roughness, etc.) stay in the TOML — the DBF carries only the identifiers needed to link the shapefile back to the correct block: `BRANCH_ID` and `BLOCK_IDX`.

```toml
[[block]]
type = "Pipe"
route = "assets/branch-1-pipe-0.shp"
```

### Multiple blocks in a branch

A branch can contain multiple blocks. Not all blocks have routes:

| Block type | Geometry |
|---|---|
| `Pipe` | Linear route → PolyLineZ shapefile |
| `Source`, `Sink`, `Compressor`, `Reservoir`, etc. | Point location → PointZ shapefile (if spatial placement is needed) |

Because shapefiles cannot mix geometry types, linear routes and point features must be in separate files. And because the TOML `route` property points to a specific file for each Pipe block, **each Pipe block gets its own shapefile**. This mirrors the current convention where each Pipe block has its own CSV.

Example branch with two Pipe blocks:

```toml
# branch-1.toml
[[block]]
type = "Source"

[[block]]
type = "Pipe"
route = "assets/branch-1-pipe-0.shp"   # PolyLineZ

[[block]]
type = "Compressor"

[[block]]
type = "Pipe"
route = "assets/branch-1-pipe-1.shp"   # separate PolyLineZ
```

```
networks/my-network/
  branch-1.toml
  assets/
    branch-1-pipe-0.shp    — PolyLineZ route for first Pipe block
    branch-1-pipe-0.shx
    branch-1-pipe-0.dbf
    branch-1-pipe-0.prj
    branch-1-pipe-1.shp    — PolyLineZ route for second Pipe block
    branch-1-pipe-1.shx
    branch-1-pipe-1.dbf
    branch-1-pipe-1.prj
```

If a branch has only one Pipe block, a single file is enough and can be named anything the TOML points to (e.g. `assets/segments.shp` to stay close to the existing CSV name).

---

## API

### Top-level (via `root.zig`)

```zig
// Readers
pub const readShp  = shp.read;      // []ShpRecord
pub const readShx  = shx.read;      // []ShxRecord
pub const readDbf  = dbf.read;      // DbfFile
pub const readPrj  = shp.readPrj;   // []u8 (WKT string)
pub const readKml  = kml.read;      // PolyLineZ — reads .kml, .kmz, or My Maps .csv

// Writers
pub const writeShp = shp.write;     // .shp + .shx together
pub const writeDbf = dbf.write;     // .dbf only
pub const writePrj = shp.writePrj;  // .prj only

// Convenience
pub fn writeShapefile(
    stem: []const u8,
    allocator: std.mem.Allocator,
    records: []const ShpRecord,
    fields: []const DbfField,
    rows: []const []const DbfValue,
    wkt: ?[]const u8,   // null to skip .prj
) !void
```

Sub-modules (`shp`, `shx`, `dbf`, `kp`, `kml`) are also re-exported for direct access.

---

## Usage

```sh
cd core/shapefile
zig build test
```

### Reading a PointZ shapefile

```zig
const sf = @import("shapefile");

const records = try sf.readShp(allocator, "path/to/file.shp");
defer {
    for (records) |rec| {
        if (rec.geometry == .poly_line_z)
            rec.geometry.poly_line_z.deinit(allocator);
    }
    allocator.free(records);
}

// Compute KP from PointZ survey points
var pts = try allocator.alloc(sf.PointZ, records.len);
defer allocator.free(pts);
for (records, pts) |rec, *pt| pt.* = rec.geometry.point_z;

const kp_points = try sf.computeKp(allocator, pts);
defer allocator.free(kp_points);

std.debug.print("Final KP: {d:.3} km\n", .{kp_points[kp_points.len - 1].kp_km});
```

### Reading attributes

```zig
const table = try sf.readDbf(allocator, "path/to/file.dbf");
defer table.deinit(allocator);

for (table.header.fields, 0..) |field, i| {
    const name = std.mem.sliceTo(&field.name, 0);
    std.debug.print("Field {d}: {s} (type={c}, len={d})\n",
        .{ i, name, field.field_type, field.length });
}
```

### Reading the CRS

```zig
const wkt = try sf.readPrj(allocator, "path/to/file.prj");
defer allocator.free(wkt);
// wkt is raw WKT string — pass to core/crs/ for parsing
```

---

## Guide: Creating a pipe route shapefile

The steps below take you from drawing a route on a map to a finished shapefile that a `Pipe` block can reference via its `route` property.

### Step 1 — Draw the route

Go to [mymaps.google.com](https://mymaps.google.com) and create a new map. Select the **Draw a line** tool, click each point along the pipe route, and double-click to finish. For a rough alignment this is sufficient — survey-grade geometry would come from a contractor's shapefile and skip this step entirely.

Export the route using one of two options (both are supported):

- **KMZ** — three-dot menu on your layer → Export to KML/KMZ → KMZ file
- **CSV** — three-dot menu → Export data → CSV

### Step 2 — Import into geodash

`readKml` reads `.kml`, `.kmz`, and Google My Maps `.csv` files and returns a `PolyLineZ` in WGS84 (EPSG:4326):

```zig
const sf = @import("shapefile");

const route = try sf.readKml(allocator, "route.kmz");
defer route.deinit(allocator);
// route.points.len — number of vertices
// route.z          — all zeros (My Maps has no elevation data)
// route.m          — all zeros (KP not yet computed)
```

### Step 3 — Reproject to a metric CRS

KP computation requires metre units. WGS84 uses degrees, so the route must be reprojected before KP is meaningful. Use `crs-tool` from `core/crs/`:

```sh
# For a North Sea / UK pipeline, UTM Zone 30N is appropriate.
# Adjust the EPSG code for your region.
crs-tool --to EPSG:32630 route.kmz route_utm.shp
```

This produces `route_utm.shp` in WGS84 UTM Zone 30N (metres). Use `crs-tool --to EPSG:27700` for British National Grid, or find the right EPSG code for your area at [epsg.io](https://epsg.io).

### Step 4 — Write the finished shapefile

After reprojection, add the linking attributes and write the final shapefile. The WKT for the `.prj` comes from the reprojected file's `.prj` sidecar:

```zig
const sf = @import("shapefile");

// Read the reprojected geometry
const records = try sf.readShp(allocator, "route_utm.shp");
defer allocator.free(records);

// Read the CRS from the reprojected .prj
const wkt = try sf.readPrj(allocator, "route_utm.prj");
defer allocator.free(wkt);

// DBF: branch ID and block index for validation
var branch_field: [11]u8 = .{0} ** 11;
@memcpy(branch_field[0..9], "BRANCH_ID");
var idx_field: [11]u8 = .{0} ** 11;
@memcpy(idx_field[0..9], "BLOCK_IDX");
const fields = [_]sf.DbfField{
    .{ .name = branch_field, .field_type = 'C', .length = 32, .decimal_count = 0 },
    .{ .name = idx_field,    .field_type = 'N', .length = 4,  .decimal_count = 0 },
};
const row = [_]sf.DbfValue{ .{ .string = "branch-1" }, .{ .number = 1 } };
const rows = [_][]const sf.DbfValue{&row};

// Write to the network's assets directory
try sf.writeShapefile(
    "networks/my-network/assets/branch-1-pipe-0",
    allocator, records, &fields, &rows, wkt,
);
```

### Step 5 — Reference the shapefile from TOML

Point the `Pipe` block's `route` property at the shapefile stem:

```toml
[[block]]
type = "Pipe"
route = "assets/branch-1-pipe-0.shp"
```

### What about elevation?

The route from My Maps has Z = 0 at every point — no elevation data is embedded in the export. For offshore pipelines, seabed elevation is sampled separately from a bathymetric surface (e.g. GEBCO) and merged into the Z values. That workflow is handled by `core/geotiff/`.

---

## Guide: Writing shapefiles

### The four files

Every complete shapefile set has four files. `writeShapefile` writes all of them from a path stem:

```zig
const sf = @import("shapefile");

// Stem "assets/branch-1-pipe-0" produces:
//   assets/branch-1-pipe-0.shp
//   assets/branch-1-pipe-0.shx
//   assets/branch-1-pipe-0.dbf
//   assets/branch-1-pipe-0.prj
try sf.writeShapefile(stem, allocator, records, fields, rows, wkt);
```

### Writing a Pipe elevation profile (PolyLineZ)

A PolyLineZ stores a **sequence of points** as three parallel arrays:
- `points` — XY coordinates as `[2]f64` pairs
- `z` — elevation at each point (metres, typically negative offshore)
- `m` — measure at each point; used here for **KP in metres** from the pipe's start

The `parts` array lists the starting index of each connected sub-line. Most pipes are a single contiguous line, so `parts = {0}`.

```zig
const sf = @import("shapefile");

// Points along the pipe route (XY in the survey CRS, e.g. ED50 UTM Zone 30N)
const xy_points = [_][2]f64{
    .{ 491542.058, 5918507.093 },  // KP 0.0 m
    .{ 491515.554, 5918850.070 },  // KP 344.0 m
    .{ 491515.477, 5918851.068 },  // KP 348.1 m
    // ... more points
};

// Elevation at each point (metres; negative = below sea level)
const z_values = [_]f64{ 3.0, 3.0, -1.0 };

// Cumulative distance from the start of this pipe (metres)
const m_values = [_]f64{ 0.0, 344.0, 348.1 };

const route = sf.PolyLineZ{
    .bbox = .{
        .min_x = 491515.477, .min_y = 5918507.093,
        .max_x = 491542.058, .max_y = 5918851.068,
    },
    .parts   = &[_]u32{0},       // single contiguous line starting at index 0
    .points  = &xy_points,
    .z_range = .{ .min = -1.0, .max = 3.0 },
    .z       = &z_values,
    .m_range = .{ .min = 0.0, .max = 348.1 },
    .m       = &m_values,
};

// One record — one PolyLineZ feature
const records = [_]sf.ShpRecord{
    .{ .number = 1, .geometry = .{ .poly_line_z = route } },
};

// DBF: one row linking this shapefile back to its block in the TOML.
// Field names are at most 10 characters, stored in an 11-byte null-padded array.
var branch_field: [11]u8 = .{0} ** 11;
@memcpy(branch_field[0..9], "BRANCH_ID");
var idx_field: [11]u8 = .{0} ** 11;
@memcpy(idx_field[0..9], "BLOCK_IDX");

// 'C' = character/string, 'N' = numeric
// For 'N': length = total character width (digits + sign + decimal point)
//          decimal_count = digits after the decimal point
const fields = [_]sf.DbfField{
    .{ .name = branch_field, .field_type = 'C', .length = 32, .decimal_count = 0 },
    .{ .name = idx_field,    .field_type = 'N', .length = 4,  .decimal_count = 0 },
};

const row = [_]sf.DbfValue{ .{ .string = "branch-1" }, .{ .number = 1 } };
const rows = [_][]const sf.DbfValue{&row};

// WKT from the survey's .prj file (read with readPrj, or produced by crs-tool)
const wkt = "PROJCS[\"ED_1950_UTM_Zone_30N\",...]";

try sf.writeShapefile("assets/branch-1-pipe-0", allocator, &records, &fields, &rows, wkt);
```

### DBF field rules

**Field names** are stored in an 11-byte fixed array. Initialise to zero, then copy up to 10 characters:

```zig
var name: [11]u8 = .{0} ** 11;
@memcpy(name[0..8], "DIAMETER");
```

**Numeric field sizing** — `length` is the total character width including sign, decimal point, and all digits. For a block index (integer 0–9999), `length = 4, decimal_count = 0` is sufficient.

### Writing only specific files

```zig
// .shp + .shx together (.shx path is optional — pass null to skip)
try sf.writeShp("output.shp", "output.shx", allocator, records);

// .dbf only
try sf.writeDbf("output.dbf", allocator, fields, rows);

// .prj only
try sf.writePrj("output.prj", wkt);
```

---

## Binary Format

Shapefiles use **mixed endianness**: file/record headers are big-endian; geometry and version fields are little-endian.

### `.shp` / `.shx` file header (100 bytes)

| Offset | Size | Endian | Field |
|--------|------|--------|-------|
| 0 | 4 | big | File code (`9994`) |
| 4–23 | 20 | — | Unused |
| 24 | 4 | big | File length in 16-bit words |
| 28 | 4 | little | Version (`1000`) |
| 32 | 4 | little | Shape type |
| 36 | 8 | little | Bbox Xmin |
| 44 | 8 | little | Bbox Ymin |
| 52 | 8 | little | Bbox Xmax |
| 60 | 8 | little | Bbox Ymax |
| 68 | 8 | little | Zmin |
| 76 | 8 | little | Zmax |
| 84 | 8 | little | Mmin |
| 92 | 8 | little | Mmax |

### `.shp` record header (8 bytes, big-endian)

| Offset | Field |
|--------|-------|
| 0 | Record number (1-indexed) |
| 4 | Content length in 16-bit words |

Content begins with the shape type (`i32`, little-endian).

### Shape type codes

| Code | Type | Content size |
|------|------|-------------|
| 11 | PointZ | 36 bytes (x, y, z, m — each f64) |
| 13 | PolyLineZ | Variable (bbox, parts, XY array, Z array, M array) |

### `.shx` record (8 bytes, big-endian)

| Field | Notes |
|-------|-------|
| Offset | Byte offset in `.shp` ÷ 2 |
| Length | Content length in 16-bit words |

### `.dbf` header

| Offset | Field | Notes |
|--------|-------|-------|
| 0 | Version | `0x03` = dBASE III |
| 1–3 | Last update | YY MM DD |
| 4 | Record count | `u32` little-endian |
| 8 | Header size | `u16` little-endian (bytes) |
| 10 | Record size | `u16` little-endian (bytes) |

Field descriptors follow (32 bytes each), terminated by `0x0D`. Each record begins with a deletion flag (`0x20` = active, `0x2A` = deleted), then packed field bytes.

### Field types

| Code | Type |
|------|------|
| `C` | Character (string) |
| `N` | Numeric |
| `F` | Float |
| `L` | Logical (boolean) |
| `D` | Date (`YYYYMMDD`) |

---

## Modules

| File | Purpose |
|------|---------|
| `src/shp.zig` | `.shp` geometry reader/writer + `.prj` reader/writer |
| `src/shx.zig` | `.shx` index reader/writer |
| `src/dbf.zig` | `.dbf` attribute table reader/writer |
| `src/kp.zig` | KP computation from a `PointZ` sequence |
| `src/types.zig` | Shared types (`PointZ`, `PolyLineZ`, `ShpRecord`, `DbfValue`, …) |
| `src/root.zig` | Public re-exports + `writeShapefile` |

---

## KP Computation

KP (kilometer post) is the cumulative distance along a survey track from the first point. Distance uses **2D Euclidean** (XY only — Z is ignored), matching the Python prototype.

The input CRS must use metres as the linear unit for KP to be meaningful in km.

```zig
pub const KpPoint = struct {
    x: f64,
    y: f64,
    z: f64,
    kp_km: f64,  // cumulative distance from first point, in kilometres
};

pub fn computeKp(allocator: std.mem.Allocator, points: []const PointZ) ![]KpPoint
```

---

## Test Data

`test-data/spirit/` contains the Spirit pipeline survey (ED50 UTM Zone 30N):

| File | Size |
|------|------|
| `KP_Points_1m.shp` | 2.8 MB |
| `KP_Points_1m.shx` | 515 KB |
| `KP_Points_1m.dbf` | 450 KB |
| `KP_Points_1m.prj` | 412 B |

Integration test assertions:

| Check | Expected |
|-------|---------|
| Record count | 65,883 |
| First point X | ≈ 491,542.058 m |
| First point Y | ≈ 5,918,507.093 m |
| Final KP | ≈ 65.88 km |
| CRS | `ED_1950_UTM_Zone_30N` |
