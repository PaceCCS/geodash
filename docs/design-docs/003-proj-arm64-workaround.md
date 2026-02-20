# 003: PROJ ARM64 ABI Workaround

## Status

Accepted

## Context

The CRS module uses PROJ 9 for coordinate reprojection (e.g. ED50 UTM Zone 30N to WGS84). The natural API is:

```c
PJ_COORD result = proj_trans(pj, PJ_FWD, coord);
```

On Apple Silicon (ARM64), `proj_trans` returns all zeros. The `PJ_COORD` union is 32 bytes — Zig's C ABI interop on ARM64 does not handle pass-by-value of this struct correctly.

## Decision

Use `proj_trans_generic` instead, which operates on separate `double*` arrays for x, y, z, and t:

```c
size_t n = proj_trans_generic(pj, PJ_FWD, x, sx, n, y, sy, n, z, sz, n, NULL, 0, 0);
```

## Rationale

- **Correctness:** `proj_trans_generic` works correctly on ARM64 because it passes pointers, not large structs by value.
- **Batch-friendly:** The generic API naturally supports transforming arrays of coordinates in one call, which is what we need for shapefile routes (thousands of points).
- **No upstream fix needed:** This is a Zig-PROJ interop issue on a specific platform. Working around it avoids depending on a fix in either Zig or PROJ.

## Consequences

- Slightly more verbose calling code (separate x, y, z arrays instead of a single coord)
- The workaround is ARM64-specific but the generic API works everywhere, so we use it unconditionally
- CRS module is quarantined from WASM (it links PROJ, a C system library)
