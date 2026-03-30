# Network Engine

Scope-based directed graph system with hierarchical property inheritance (Global → Group → Branch → Block).

## Modules

```
src/
├── root.zig             — Public API, re-exports all modules
├── toml.zig             — TOML parser (dynamic Value type, supports tables, arrays of tables, dotted keys)
├── network.zig          — Network types (NodeData, Block, Edge) + loader from TOML files
├── scope.zig            — Config, ScopeLevel, ScopeResolver for hierarchical property inheritance
├── query.zig            — Query parser + executor with scope resolution integration
├── fluid.zig            — Fluid propagation: topological traversal, junction blending, composition injection
├── olga.zig             — OLGA .key parser (→ geodash TOML + optional PolyLineZ shapefile) and writer
├── wasm.zig             — WASM entry point; JSON-in/JSON-out exports for the Hono server
└── integration_test.zig — Tests against real dagger preset1 data
```

## Usage

### Loading a network

Networks are loaded from a map of filename → TOML content. Node IDs are derived from filenames (e.g. `branch-4.toml` → `"branch-4"`). Edges are built automatically from branch outgoing connections.

```zig
const engine = @import("network_engine");

var files = std.StringArrayHashMapUnmanaged([]const u8){};
try files.put(allocator, "config.toml", config_content);
try files.put(allocator, "branch-1.toml", branch_content);

var validation = engine.ValidationResult.init(allocator);
var network = try engine.loadNetworkFromFiles(allocator, &files, &validation);

// Check for issues (non-blocking — network is usable even with warnings)
for (validation.warnings.items) |w| std.debug.print("warning: {s}\n", .{w.message});
```

### Querying

The query language uses `/`-separated paths to navigate the network:

```zig
// Simple property access
var q = try engine.parseQuery(allocator, "branch-4/label");
var result = try executor.execute(&q);
// result.getString() → "Branch 4"

// Index into block array
var q2 = try engine.parseQuery(allocator, "branch-4/blocks/0/type");
// → "Source"

// Access nested properties
var q3 = try engine.parseQuery(allocator, "branch-4/position/x");
// → -100.0

// Filter blocks by type
var q4 = try engine.parseQuery(allocator, "branch-1/blocks/[type=Pipe]");
// → array of 2 Pipe blocks

// Range access
var q5 = try engine.parseQuery(allocator, "branch-1/blocks/0:2");
// → array of first 3 blocks

// Filter operators: =, !=, >, <, >=, <=
var q6 = try engine.parseQuery(allocator, "branch-4/blocks/[pressure>10]");
```

### Scope resolution

Properties inherit through a configurable chain. The config defines which scopes to check for each property:

```toml
# config.toml
[properties]
ambientTemperature = 20.0
pressure = 14.7

[inheritance]
general = ["block", "branch", "group", "global"]

[inheritance.rules]
ambientTemperature = ["group", "global"]
pressure = ["block"]
```

```zig
var config = try engine.Config.loadFromToml(allocator, parsed_config.table);
const resolver = engine.ScopeResolver.init(&config);

// Resolves pressure from block scope only (per rule)
const pressure = resolver.resolveProperty("pressure", &block, &branch, group);

// Resolves ambientTemperature from group → global (skips block and branch)
const temp = resolver.resolveProperty("ambientTemperature", &block, &branch, group);

// Query with scope override
var q = try engine.parseQuery(allocator, "branch-4/blocks/0/pressure?scope=block,branch,global");
const executor = engine.QueryExecutor.withScopeResolver(allocator, &network, &resolver);
var result = try executor.execute(&q);
```

## Node types

| Type             | TOML `type` value    | Description                                          |
| ---------------- | -------------------- | ---------------------------------------------------- |
| Branch           | `"branch"`           | Network segment with blocks and outgoing connections |
| Group            | `"labeledGroup"`     | Organizational container for branches                |
| GeographicAnchor | `"geographicAnchor"` | Spatial reference point                              |
| GeographicWindow | `"geographicWindow"` | Spatial viewport                                     |
| Image            | `"image"`            | Visual attachment with a file path                   |

## Dynamic properties

All nodes and blocks support arbitrary extra properties via a `Value.Table` (string-keyed map of dynamic values). Known fields (`type`, `label`, `position`, etc.) are parsed into struct fields; everything else goes into `.extra`:

```toml
[[block]]
type = "Compressor"
pressure = "120 bar"    # → stored in block.extra
efficiency = 0.85       # → stored in block.extra
```

## Testing

```sh
zig build test          # Run all tests via build system
just test-network-engine
```

Tests include:

- **TOML parser**: key-value pairs, tables, arrays of tables, dotted keys, escapes, comments
- **Network loader**: branch/group/image nodes, edge construction, validation warnings
- **Scope resolver**: block-level lookup, global fallback, per-property rule enforcement
- **Query engine**: property access, indexing, filtering, range, scope resolution
- **Fluid propagation**: composition blending at junctions, injection into branch blocks
- **OLGA parser/writer**: keyword line parsing, comment stripping, backslash continuation, round-trip
- **Integration tests**: full pipeline against dagger preset1 data (14 nodes, 9 branches)
