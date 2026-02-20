# dim Reference

Compile-time dimensional analysis library for Zig. Provides type-safe quantities across seven SI base dimensions.

- Repo: https://github.com/Jerell/dim
- Author: Same as geodash

## How geodash uses it

The network engine imports dim as a Zig package dependency. It enforces unit correctness at compile time — quantities like pressure, temperature, flow rate, and length carry their dimensions in the type system.

Dim also compiles to WASM for client-side unit display and conversion in the Tauri app (planned, GitHub issue #7).

## Key concepts

```zig
const dim = @import("dim");

// Quantities carry SI dimensions in the type
const pressure = dim.Quantity(.{ .mass = 1, .length = -1, .time = -2 }); // Pa
const length = dim.Quantity(.{ .length = 1 }); // m

// Compile error if you add incompatible units
const x = pressure_val + length_val; // won't compile
```

## Integration

- Zig dependency in `core/network-engine/build.zig.zon` (fetched from GitHub)
- All values stored in SI internally
- Conversion to display units happens at the boundary (import/export, UI display)
- See [core belief #14](../core-beliefs.md)

## Version

Latest main branch, pinned by hash in `build.zig.zon`
