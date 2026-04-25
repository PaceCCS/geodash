# Transient Simulation Server

External Python service that runs transient pipe flow simulations. It may run on a separate machine from the Elysia server.

## Role

The simulation server:

- Accepts a pipe network definition and initial/inlet conditions from the Elysia server
- Runs a time-domain pipe flow simulation (e.g. method of characteristics or finite difference)
- Writes results incrementally to a Zarr array as each timestep completes
- Streams each completed timestep to Elysia via SSE so the frontend can update in real time

The geodash codebase defines the interface contract here. The server implementation lives in a separate repository.

## Interface with Elysia

### Starting a run

```text
POST /simulate
{
  "network": { ... },   // geodash network definition
  "conditions": { ... } // inlet conditions, duration, timestep
}
→ { "run_id": "abc123" }
```

### SSE stream

```text
GET /simulate/{run_id}/stream
→ text/event-stream

data: { "t": 0, "kp": [...], "pressure": [...], "temperature": [...], ... }
data: { "t": 1, ... }
...
data: { "status": "complete", "zarr_path": "runs/abc123.zarr" }
```

Each event contains one timestep's values across all KP positions.

### Zarr output

```text
GET /runs/{run_id}.zarr/{path}
```

Zarr chunks are served with HTTP range request support so `zarr.js` can fetch individual chunks directly.

## Output Format

Results are written as a Zarr group with one array per fluid property:

```text
runs/{run_id}.zarr/
  pressure/       # shape (kp, time), float32
  temperature/    # shape (kp, time), float32
  flow_rate/      # shape (kp, time), float32
  density/        # shape (kp, time), float32
  .zgroup
```

### Chunk shape

A chunk shape of approximately `(256, 256)` balances the three main access patterns:

- **Profile at a timestep** — reads one row: `[:, t]` — favours wide KP chunks
- **Time series at a location** — reads one column: `[kp, :]` — favours wide time chunks
- **Hovmöller diagram** — reads the full array or a large window — prefers larger chunks

The KP dimension aligns with the shapefile route. KP position metadata (distances in km) is stored as a Zarr array attribute.

## Coordinates

The `kp` dimension corresponds to positions along the pipe route as computed from the shapefile survey points. Absolute KP values (in km) are stored as a Zarr coordinate array alongside the simulation output so the frontend can render axes correctly.

Time is stored as seconds from simulation start, with the wall-clock start time recorded as a metadata attribute.
