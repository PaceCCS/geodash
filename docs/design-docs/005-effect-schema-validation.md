# 005: Effect Schema for Server-Side Validation

## Status

Accepted

## Context

The OLGA import/export endpoints need to validate that network blocks have the required properties for OLGA output (e.g. Pipe needs `diameter`, `roughness`; Source needs `pressure`, `temperature`, `flow_rate`). Options:

1. Zod schemas
2. Effect Schema (from the Effect ecosystem)
3. Manual validation functions

## Decision

Use Effect Schema (`@effect/schema`, now part of `effect`).

## Rationale

- **Composable:** Effect Schema supports branded types, transformations, and encoding/decoding in a single definition. The OLGA block types (Pipe, Source, Sink, Compressor) share common fields with type-specific extensions — this composes naturally.
- **Runtime + static:** Each schema provides both runtime validation and TypeScript type inference. No separate type definitions needed.
- **Consistent with future plans:** The Tauri app frontend will likely use Effect for state management and error handling. Using Effect Schema on the server keeps the validation approach consistent.

## Consequences

- `effect` is a dependency (~100KB). This is acceptable for the server; it would need evaluation before including in the frontend bundle.
- Developers need to understand Effect Schema syntax, which is less common than Zod
- Schemas live in `server/src/schemas/olga/` and are imported by `services/olga.ts`
