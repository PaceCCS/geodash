# Zarr Reader

Zig implementation for reading Zarr v3 arrays.

## Purpose

Reads Zarr arrays produced by the transient simulation server and the steady-state WebGPU simulation pipeline. Used when the Zig core needs to consume simulation results — for example, to feed transient outputs back into the network engine as block property updates, or to validate simulation output against network constraints.

The frontend uses `zarr.js` directly. The Python simulation server uses the `zarr` Python library. This Zig module covers the cases where the Zig core is the consumer.

## Zarr v3 Format

A Zarr array is a directory of chunk files alongside JSON metadata:

```
array.zarr/
  zarr.json        — array metadata (shape, dtype, chunk shape, compressor, fill value)
  c/0/0            — chunk at grid index (0, 0)
  c/0/1            — chunk at grid index (0, 1)
  c/1/0            — chunk at grid index (1, 0)
  ...
```

Each chunk is a compressed blob (zstd or gzip) of raw bytes in the array's dtype (e.g. little-endian float32). To read a chunk: open the file, decompress, reinterpret as `[]f32`.

Chunk coordinates in the filename map to array positions:

```
chunk (ci, cj) covers array indices [ci*chunk_shape[0] .. (ci+1)*chunk_shape[0],
                                      cj*chunk_shape[1] .. (cj+1)*chunk_shape[1]]
```

## Scope

Read-only. The simulation server (Python) and the WebGPU pipeline (JavaScript) are responsible for writing Zarr output. This module only reads.

## Dependencies

Compression support via C interop:
- zstd: `libzstd`
- gzip: `zlib`

Both are available as system libraries on all target platforms.
