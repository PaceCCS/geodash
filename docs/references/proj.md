# PROJ Reference

Coordinate transformation library. Converts between coordinate reference systems (CRS).

- Docs: https://proj.org/en/stable/
- API: https://proj.org/en/stable/development/reference/functions.html

## How geodash uses it

The CRS module (`core/crs/`) wraps PROJ 9 via Zig's C interop (`@cImport`). It provides a CLI tool for reprojecting shapefiles between CRS.

```sh
crs-tool --to EPSG:4326 input.shp output.shp
```

## Important: ARM64 ABI bug

`proj_trans(pj, dir, coord)` returns all zeros on Apple Silicon because `PJ_COORD` (32 bytes) is broken in Zig's C ABI pass-by-value on ARM64.

**Workaround:** Use `proj_trans_generic` with separate x/y/z arrays. See [ADR 003](../design-docs/003-proj-arm64-workaround.md).

## Key API functions used

```c
// Context and pipeline creation
PJ_CONTEXT *ctx = proj_context_create();
PJ *pj = proj_create_crs_to_crs(ctx, "EPSG:23030", "EPSG:4326", NULL);

// Transform arrays of coordinates (our workaround)
size_t n = proj_trans_generic(pj, PJ_FWD,
    x_array, sizeof(double), count,
    y_array, sizeof(double), count,
    z_array, sizeof(double), count,
    NULL, 0, 0);

// Cleanup (return value must be discarded in Zig)
_ = proj_destroy(pj);
_ = proj_context_destroy(ctx);
```

## Build requirement

PROJ must be installed as a system library. On macOS: `brew install proj`.

Linked via `b.linkSystemLibrary("proj")` in `core/crs/build.zig`.

## Quarantine

PROJ is a C library. The CRS module is **never** compiled into WASM and **never** imported by network-engine. It exists only as a standalone CLI tool. See [core belief #3 and #11](../core-beliefs.md).

## Version

PROJ 9.7 (installed via Homebrew)
