# Hono Reference

Small, ultrafast web framework built on Web Standards. Runs on Bun, Node, Deno, Cloudflare Workers.

- Docs: https://hono.dev/docs
- LLM reference: https://hono.dev/llms-small.txt

## How geodash uses it

The Hono server (`server/src/index.ts`) is the middleware layer between the frontend and Zig core. It runs on Bun.

## Key patterns in this codebase

```typescript
// Route definition (server/src/routes/query.ts)
import { Hono } from "hono";
const app = new Hono();
app.get("/api/query", async (c) => {
  const result = await queryNetwork(dir, q);
  return c.json(result);
});

// Mount routes (server/src/index.ts)
import { cors } from "hono/cors";
app.use("*", cors());
app.route("/", queryRoutes);
```

## Relevant Hono features

- `c.json()` — Return JSON response
- `c.req.query()` — Access query parameters
- `c.req.json()` — Parse JSON request body
- `cors()` middleware — CORS headers
- `app.route()` — Mount sub-applications
- Streaming responses via `c.stream()` — needed for SSE proxy (future)

## Version

`hono@^4.7.0` (see `server/package.json`)
