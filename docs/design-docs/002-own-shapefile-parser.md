# 002: Own Shapefile Parser

## Status

Accepted

## Context

We need to read and write ESRI shapefiles (.shp, .shx, .dbf) for pipeline route geometry. The shapefile format is a well-documented binary format. Options:

1. Use GDAL/OGR via C interop
2. Use a Zig shapefile library (none existed at the time)
3. Write our own

## Decision

Write our own shapefile parser (`core/shapefile/`).

## Rationale

- **Zero dependency constraint:** The shapefile module is a dependency of network-engine, which compiles to WASM. GDAL is a massive C library (~50MB) that would be impossible to compile to WASM and would dominate the binary.
- **Narrow type support:** We only need PointZ (type 11) and PolyLineZ (type 13). A full shapefile library handles 15+ geometry types. Our parser handles exactly what we need.
- **In-memory I/O:** For WASM, we need byte-buffer variants (`readFromBytes`, `buildSHPBytes`). Most shapefile libraries assume file I/O. Writing our own lets us provide both file-based and memory-based APIs.
- **Format is simple:** The .shp, .shx, and .dbf formats are straightforward binary formats with clear specs. The total implementation is ~1500 lines across three files. This is less effort than integrating and maintaining a C binding.
- **Prior art:** The Python prototype in [bathymetry-tool](https://github.com/Jerell/bathymetry-tool) proved the format was tractable to implement from scratch.

## Consequences

- We maintain our own binary format code, including endianness handling
- Only PointZ and PolyLineZ are supported — adding new geometry types requires implementation work
- No automatic support for .prj (projection) parsing beyond reading it as a WKT string
