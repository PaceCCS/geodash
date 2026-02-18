# GeoTIFF I/O

Read georeferenced raster data.

## Purpose

Used for global bathymetric surfaces such as GEBCO. Samples elevation values along a pipe route by projecting the shapefile survey coordinates into the GeoTIFF's CRS and reading or interpolating the raster values at those positions.

## Scope

GeoTIFF is the input format for geographic reference surfaces — not for simulation outputs. Steady-state and transient simulation results are stored as Zarr arrays.

## Typical usage

```
GEBCO 2025 GeoTIFF (global 15-arc-second bathymetry)
    ↓ transform survey points (CRS module)
Sample elevation at each PointZ survey point
    ↓
Elevation profile indexed by KP → Branch/Block properties
```
