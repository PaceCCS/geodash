# 001: Custom TOML Parser

## Status

Accepted

## Context

The network engine needs to read dagger-format TOML files (tables, arrays of tables, dotted keys, inline tables). Zig's standard library does not include a TOML parser. Options:

1. Use a Zig TOML library from the package ecosystem
2. Use a C TOML library via `@cImport`
3. Write our own

## Decision

Write our own TOML parser (`core/network-engine/src/toml.zig`).

## Rationale

- **WASM constraint:** A C dependency would complicate the WASM build and increase the import surface. Our WASM module currently imports a single WASI function.
- **Dynamic value type:** The dagger format uses a property-bag model — keys and types are not known at compile time. We need a dynamic `Value` union type (string, int, float, bool, array, table), not struct-based deserialization. Most TOML libraries are designed around `@Type` reflection into known structs.
- **Subset is sufficient:** We only need the TOML features that dagger actually uses. We don't need datetime types, multiline strings, or other features that would make a full-spec parser complex.
- **Format understanding:** Writing the parser gives us full control over error messages and lets us extend the format if needed (e.g. scope-aware inheritance semantics).

## Consequences

- We maintain ~800 lines of parser code
- Edge cases in TOML spec that we don't use may not be handled
- No upgrade path to track TOML spec changes automatically
