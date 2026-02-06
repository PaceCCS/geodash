# Network Engine

Scope-based directed graph system with hierarchical property inheritance (Global → Group → Branch → Block).

Includes TOML serialization, the query language for property navigation and filtering, and versioned schema validation.

## Port Plan

This plan is based on the actual dagger implementation: a Rust CLI (`cli/src/`) with parser, scope, query, schema, and dim modules, plus a TypeScript backend (`backend/src/`) with Hono routes, services, and Zod schema generation.

### What exists in dagger

**Rust CLI** (`cli/src/`):

```
parser/
  models.rs     — Core data model: Network, NodeData (Branch|Group|GeographicAnchor|GeographicWindow|Image),
                   BranchNode (blocks + outgoing), Block (type, quantity, extra HashMap), Edge
  loader.rs     — Loads network from directory of TOML files or in-memory HashMap (for WASM).
                   Node IDs derived from filenames. Validates parent_id refs and outgoing targets.
  validation.rs — ValidationResult with errors/warnings, non-blocking (flags issues but allows inspection)

scope/
  config.rs     — Config struct (global properties, InheritanceConfig, UnitPreferences).
                   PropertyInheritanceRule: Simple(Vec<ScopeLevel>) | Complex { inheritance, overrides per block type }.
                   ScopeLevel enum: Global, Group, Branch, Block.
                   Loaded from config.toml.
  resolver.rs   — ScopeResolver walks the scope chain for a property.
                   Checks block.extra → branch.base.extra → group.base.extra → config.properties.
                   Chain order is configurable per property and per block type.
  registry.rs   — Scope registry utilities

query/
  parser.rs     — QueryPath AST: Node | Property | Index | Range | Filter | ScopeResolve.
                   Filter operators: =, !=, >, <, >=, <=.
                   Scope resolution via ?scope=block,branch,group,global.
                   Unit override via ?units=property:unit.
  executor.rs   — QueryExecutor traverses the Network using the QueryPath AST.
                   Converts TOML values to JSON for output.
                   Integrates ScopeResolver for property fallback on blocks.
                   Formats units via UnitFormatter + SchemaRegistry metadata.
  formatter.rs  — JSON output formatting

schema/
  registry.rs   — SchemaRegistry loads versioned JSON schema files (generated from Zod).
                   SchemaDefinition: block_type, version, required/optional properties.
                   PropertyMetadata: dimension, default_unit, title, min, max.
  validator.rs  — SchemaValidator checks blocks against schemas.
                   Missing required properties → error. Unknown properties → warning.
  loader.rs     — File system and in-memory schema loading

dim/
  processor.rs  — UnitProcessor parses unit strings in TOML values ("100 bar" → 10000000.0 Pa).
                   Stores normalized SI float + _property_original string.
                   Schema-aware mode validates dimensions against PropertyMetadata.
  ffi.rs        — FFI bridge to Zig dim library (native builds)
  wasm_stub.rs  — Stubs for WASM builds where dim FFI isn't available
```

**TypeScript backend** (`backend/src/`):

```
routes/         — Hono REST endpoints: network, query, schema, costing, snapshot
schemas/        — Zod schema definitions per version (v1.0-costing, v1.0-snapshot)
services/       — Business logic: network loading, query execution, unit/value formatting,
                   costing adapter (maps Group→Asset, Block→CostItem)
```

**Sample network** (`network/preset1/`):

```
config.toml               — Global properties + inheritance rules
branch-{1..9}.toml        — Branches with blocks, outgoing connections
group-1.toml              — Labeled group with position and dimensions
geographic-anchor-1.toml  — Geographic anchor with position
geographic-window-{1,2}.toml
image-1.toml
```

### Step 1: Data model

Port the core types from `parser/models.rs` to Zig structs:

- `Network` — id, label, list of nodes, list of edges
- `NodeData` — tagged union: Branch, Group, GeographicAnchor, GeographicWindow, Image
- `NodeBase` — id, type, optional label, optional parent_id, position (x, y), optional width/height, extra properties (string-keyed dynamic map)
- `BranchNode` — NodeBase + list of Block + list of Outgoing
- `Block` — type, optional quantity, extra properties map
- `Outgoing` — target (string), weight (u32)
- `Edge` — source, target, id, weight

Key difference from dagger: use `dim` Quantity types directly in the extra properties map instead of storing raw f64 + `_property_original` strings. This gives compile-time unit safety rather than runtime string parsing.

The dynamic properties map (`extra` in dagger) needs a Zig equivalent. Options:
- `std.StringHashMap(Value)` where `Value` is a tagged union (string, int, float, Quantity, bool, array, table)
- Consider whether a TOML value type or a custom geodash value type is more appropriate

### Step 2: TOML parsing and network loading

Port `parser/loader.rs` logic:

- Scan a directory for `.toml` files
- Parse `config.toml` → Config (global properties, inheritance rules, unit preferences)
- Parse each node file → appropriate NodeData variant based on `type` field
- Derive node ID from filename (strip `.toml` extension)
- Build edge list from BranchNode outgoing connections (edge ID = `"{source}_{target}"`)
- Validate: warn on missing outgoing targets, validate parent_id references

Zig TOML options: use a Zig TOML parser library, or write a minimal one for the subset of TOML used (tables, arrays of tables, key-value pairs with string/int/float/bool values).

Also support in-memory loading (HashMap of filename → content) for WASM builds, same as dagger does.

### Step 3: Scope system

Port from `scope/`:

- `Config` — global properties HashMap, InheritanceConfig (general chain + per-property rules)
- `ScopeLevel` enum — Global, Group, Branch, Block
- `PropertyInheritanceRule` — Simple (list of ScopeLevel) or Complex (list + per-block-type overrides)
- `ScopeResolver` — given a property name, block, branch, and optional group:
  1. Look up the scope chain for this property (per-property rule → per-block-type override → general default)
  2. Walk the chain: check block.extra → branch.base.extra → group.base.extra → config.properties
  3. Return first match + the scope level it was found at

The scope resolver is simple but central — every property access on a block may trigger it.

### Step 4: Schema system

Port from `schema/`:

- `SchemaDefinition` — block_type, version, required properties, optional properties, property metadata
- `PropertyMetadata` — dimension (string), default_unit, title, min, max
- `SchemaRegistry` — load versioned schema files (JSON), look up by version + block_type
- `SchemaValidator` — validate block against schema:
  - Missing required properties → error
  - Unknown properties → warning
  - Non-blocking: collect all issues, don't halt

Schema definitions are currently JSON files generated from TypeScript Zod schemas. For geodash, consider:
- Keep JSON as the schema format (easy to parse in Zig)
- Or use TOML for consistency with network definitions
- Or define schemas in Zig code directly for compile-time validation where possible

### Step 5: Query engine

Port from `query/`:

- `QueryPath` AST — tagged union of:
  - `Node(id)` — look up a node by ID
  - `Property(name, inner)` — access a named field
  - `Index(idx, inner)` — array element access
  - `Range(start?, end?, inner)` — array slice
  - `Filter(field, operator, value, inner)` — conditional selection
  - `ScopeResolve(property, scopes, inner)` — scope-aware property lookup
- Query parser: tokenize path string (`branch-4/blocks/0/pressure`), parse filters (`[type=Pipe]`), parse query params (`?scope=block,branch`)
- Query executor: traverse the Network following the AST, integrate ScopeResolver for property fallback, format output as JSON

### Step 6: dim integration

Replace the FFI bridge in dagger (`dim/ffi.rs` calling the Zig dim library from Rust) with direct Zig integration:

- Unit strings in TOML values ("100 bar", "15.5 psi") parsed directly by dim at load time
- Store as proper Quantity types with dimensional metadata, not raw floats
- Schema-aware validation: if PropertyMetadata specifies dimension "pressure", verify the parsed Quantity has matching dimensions
- Unit formatting for query output: convert from SI storage to user-preferred units using dim

This is much cleaner than dagger's approach of FFI → parse → store float + original string → format on output.

### Step 7: Serialization (write path)

Dagger is primarily read-only from TOML (the frontend writes via Tauri file commands). Geodash should support full round-trip:

- Serialize Network back to directory of TOML files
- Preserve extra properties, including unit strings (convert Quantity back to human-readable strings)
- Write config.toml with current inheritance rules and global properties
- This enables programmatic network creation and modification, not just file loading

### Step 8: Testing

Port and expand the test suites from dagger:

- `parser/tests.rs` — TOML loading, node construction, validation
- `query/tests.rs` — query parsing, execution, filtering, scope resolution
- Add tests for dim integration (unit parsing in TOML values, dimension validation, round-trip serialization)
- Add tests for the full pipeline: load preset1 → query → verify results match dagger output

### What to leave out (for now)

- **ReactFlow-specific types** — Position, width/height, dragging state are frontend concerns. Keep position in NodeBase for layout but don't model ReactFlow specifics.
- **Costing adapter** — The costing server integration (Group→Asset, Block→CostItem mapping) is a separate service. Port it later if needed.
- **WASM stubs** — In dagger, dim has WASM stubs because Zig FFI doesn't compile to WASM. In geodash, dim is native Zig, so WASM compilation should work directly.
- **Snapshot system** — The snapshot routes/schemas in dagger's backend can be revisited when the server layer is built.

### File structure

```
core/network-engine/
├── src/
│   ├── main.zig
│   ├── models.zig          — Network, NodeData, Block, Edge, Value type
│   ├── loader.zig          — TOML parsing, directory scanning, network construction
│   ├── scope.zig           — Config, ScopeLevel, ScopeResolver
│   ├── schema.zig          — SchemaRegistry, SchemaDefinition, SchemaValidator
│   ├── query/
│   │   ├── parser.zig      — QueryPath AST, tokenizer
│   │   └── executor.zig    — Query execution, scope integration
│   └── validation.zig      — ValidationResult, non-blocking error collection
├── tests/
│   ├── loader_test.zig
│   ├── scope_test.zig
│   ├── schema_test.zig
│   └── query_test.zig
└── build.zig
```
