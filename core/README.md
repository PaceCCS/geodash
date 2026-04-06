# Zig Core

The computational backbone of geodash. Contains the network engine, shapefile parser, GeoTIFF I/O, CRS transform, and Zarr reader modules.

Integrates [dim](https://github.com/PaceCCS/dim) for compile-time dimensional safety.

## Modules

| Module            | Status   | Purpose                                                             |
| ----------------- | -------- | ------------------------------------------------------------------- |
| `network-engine/` | Complete | Scope-based directed graph system (Global → Group → Branch → Block) |
| `shapefile/`      | Complete | PointZ/PolyLineZ reader/writer, KP computation from survey points   |
| `crs/`            | Complete | Standalone CLI tool — reprojects shapefiles between CRS via PROJ    |
| `geotiff/`        | Planned  | Bathymetric surface reader (GEBCO and similar)                      |
| `zarr/`           | Planned  | Zarr v3 array reader for consuming simulation results               |
