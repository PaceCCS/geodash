# geodash Server

Bun/Elysia API server for geodash.

## Stack

- Bun runtime
- Elysia for routing
- Effect for request flow and error handling
- Zig/WASM core loaded from `server/wasm/geodash.wasm`

## Run

```bash
bun install
bun run dev
```

Default standalone URL:

```text
http://localhost:3001
```

## Build

```bash
bun run build
```

## Main Endpoints

- `GET /health`
- `GET /api/query?q=<query>&network=<path>`
- `GET /api/network?network=<path>`
- `GET /api/network/assets/*?network=<path>`

## Operations

All operation modules are mounted under `/api/operations`.

### OLGA

- `POST /api/operations/olga/validate`
- `POST /api/operations/olga/export`
- `POST /api/operations/olga/import`

## WASM

Build and refresh the Zig core artifact with:

```bash
just build-wasm
```
