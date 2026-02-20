# Effect Reference

TypeScript library for building complex programs with type-safe error handling, concurrency, and schema validation.

- Docs: https://effect.website/docs
- LLM reference: https://effect.website/llms.txt

## How geodash uses it

Currently used only for **Effect Schema** — runtime validation of OLGA block types at the server boundary.

## Key patterns in this codebase

```typescript
// Schema definition (server/src/schemas/olga/)
import { Schema } from "effect";

const PipeSchema = Schema.Struct({
  diameter: Schema.Number,
  roughness: Schema.Number,
  // ...
});

// Validation (server/src/services/olga.ts)
const result = Schema.decodeEither(PipeSchema)(blockData);
```

## Relevant Effect features

- `Schema.Struct` — Define object schemas with type inference
- `Schema.Number`, `Schema.String` — Primitive validators
- `Schema.optional` — Optional fields
- `Schema.decodeEither` — Validate and return `Either<Error, A>`
- `Schema.encode` — Serialize typed data back to plain objects

## Not yet using

- Effect runtime (`Effect.gen`, `Effect.runPromise`) — may adopt for the Tauri app
- Streams — could replace manual SSE handling
- Layers / Services — could structure server dependency injection

## Version

`effect@^3.19.18` (see `server/package.json`)
