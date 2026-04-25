# 004: JSON-in/JSON-out WASM Bridge

## Status

Accepted

## Context

The Elysia server needs to call Zig core functions. Options:

1. Shell out to a Zig CLI binary
2. Use FFI / native addon (Bun FFI or N-API)
3. Compile Zig to WASM, load in-process

## Decision

Compile the network-engine to `wasm32-wasi` and call it in-process via a JSON-in/JSON-out protocol.

## Design

```text
JS: encode request as JSON → geodash_alloc(len) → write to WASM memory
    → call export(ptr, len, out_ptr_ptr, out_len_ptr) → read JSON output
    → geodash_free(out_ptr, out_len) → geodash_free(in_ptr, in_len)
```

The WASM module exports:

- `geodash_alloc` / `geodash_free` — memory management
- `geodash_query`, `geodash_load_network`, etc. — domain functions

Each domain function takes `(in_ptr, in_len, out_ptr_ptr, out_len_ptr) → i32` and returns 0 on success, -1 on error (with error JSON in the output buffer).

## Rationale

- **Single process:** No child process management, no IPC latency. The WASM instance lives in the Bun event loop.
- **Portable:** WASM runs anywhere Bun runs. No platform-specific native bindings.
- **Minimal WASI surface:** The module only imports `fd_filestat_get` (stubbed to return EBADF). This keeps the instantiation simple and avoids a full WASI runtime.
- **JSON is sufficient:** Network definitions and query results are small (KB range). JSON serialisation overhead is negligible compared to the actual computation.
- **`entry = .disabled`:** The WASM module has no `main` function. This avoids importing `proc_exit` from WASI, keeping the import surface to one function.

## Consequences

- All new Zig core exports must follow the same `(in_ptr, in_len, out_ptr_ptr, out_len_ptr) → i32` convention
- TypeScript types in `services/core.ts` must be kept in sync with Zig JSON schemas manually
- Maximum input/output size is bounded by WASM linear memory (currently 256 pages = 16MB, growable)
