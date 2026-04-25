# Elysia Reference

Fast, type-safe web framework for Bun.

- Docs: <https://elysiajs.com/>
- OpenAPI plugin docs: <https://elysiajs.com/plugins/openapi.html>

## How geodash uses it

The Elysia server (`server/src/index.ts`) is the middleware layer between the frontend and Zig core. It runs on Bun and composes feature modules as plugins.

## Key patterns in this codebase

```typescript
// Base server setup (server/src/core/server.ts)
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi, fromTypes } from "@elysiajs/openapi";

const app = new Elysia()
  .use(openapi({ references: fromTypes() }))
  .use(cors())
  .get("/health", () => ({ status: "ok" }));

// Feature module route (server/src/modules/query.ts)
import { Elysia, t } from "elysia";
new Elysia({ prefix: "/api/query" }).get("/", handler, {
  query: t.Object({
    q: t.String(),
    network: t.String(),
  }),
});
```

## Relevant Elysia features

- `.get()`, `.post()` and other HTTP methods for route handlers
- `new Elysia({ prefix })` for module-level route grouping
- `.use()` for plugin composition and module mounting
- `t.Object(...)` schemas for request validation and typing
- `set.status` and `set.headers` for response control
- `.onError(...)` for centralized error handling

## Version

`elysia@1.4.28` (see `server/package.json`)
