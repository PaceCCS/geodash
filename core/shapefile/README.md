# Shapefile Parser

Native Zig implementation for reading and writing `.shp`, `.shx`, and `.dbf` files. No C dependencies.

Priority geometry types: **PointZ** (dense surveyed pipe routes) and **PolyLineZ** (pipeline paths). Includes KP (kilometer post) computation from consecutive survey points.

See [bathymetry-tool](https://github.com/Jerell/bathymetry-tool) for the Python prototype of this workflow.

---

## Modules

| File | Purpose |
|------|---------|
| `src/shp.zig` | `.shp` geometry reader/writer + `.prj` reader |
| `src/shx.zig` | `.shx` index reader/writer |
| `src/dbf.zig` | `.dbf` attribute table reader/writer |
| `src/kp.zig` | KP computation from a `PointZ` sequence |
| `src/types.zig` | Shared types (`PointZ`, `PolyLineZ`, `ShpRecord`, `DbfValue`, …) |
| `src/root.zig` | Public re-exports |

---

## Usage

```sh
cd core/shapefile
zig build test
```

### Reading a PointZ shapefile

```zig
const sf = @import("shapefile");

// Load geometry
const records = try sf.readShp(allocator, "path/to/file.shp");
defer {
    for (records) |rec| {
        if (rec.geometry == .poly_line_z)
            rec.geometry.poly_line_z.deinit(allocator);
    }
    allocator.free(records);
}

// Compute KP
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
