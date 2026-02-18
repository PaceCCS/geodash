# Zig Core

The computational backbone of geodash. Contains the network engine, shapefile parser, GeoTIFF I/O, CRS transform, and Zarr reader modules.

Integrates [dim](https://github.com/Jerell/dim) for compile-time dimensional safety.

## Modules

| Module | Status | Purpose |
|---|---|---|
| `network-engine/` | Complete | Scope-based directed graph system (Global → Group → Branch → Block) |
| `shapefile/` | Planned | PointZ/PolyLineZ reader/writer, KP computation from survey points |
| `geotiff/` | Planned | Bathymetric surface reader (GEBCO and similar) |
| `crs/` | Planned | Coordinate reference system transforms via PROJ C interop |
| `zarr/` | Planned | Zarr v3 array reader for consuming simulation results |
