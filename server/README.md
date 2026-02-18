# Hono Server

Middleware layer between the frontend and the Zig core, and the integration point for the Python transient simulation server.

## Responsibilities

- REST API for network CRUD operations
- Expose the network query engine over HTTP
- Schema validation endpoints
- Shapefile import/export endpoints
- Bridge to Zig core via FFI or subprocess
- Interface with the Python transient simulation server: start runs, proxy the SSE timestep stream to connected frontend clients
- Serve Zarr files with HTTP range request support so `zarr.js` can fetch individual chunks on demand

## Transient Simulation Integration

The Hono server brokers between the frontend and the Python simulation server, which may run on a separate machine.

Flow:

1. Frontend requests a simulation run (network definition + inlet conditions)
2. Hono forwards the request to the Python simulation server
3. Hono subscribes to the simulation server's SSE stream
4. Hono forwards SSE events (one per completed timestep) to connected frontend clients
5. On completion, Hono serves the resulting Zarr file for retrospective analysis

The simulation server URL is configured via environment variable. The Hono server does not need to understand the Zarr format — it serves the chunk files as static content.

## Zarr Serving

Zarr chunk files are served as static files with support for HTTP range requests. The `zarr.js` client in the frontend fetches individual chunks by constructing paths from the array metadata, so Hono just needs to serve the directory correctly. No Zarr-specific logic is required in the server.
