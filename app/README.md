# Tauri App

Rust shell hosting a WebGPU frontend.

## Visualizations

### Network editor

Create and edit the scope hierarchy (Global → Group → Branch → Block), visualize the directed graph, and manage block properties.

### Phase diagram plotter

ONNX neural networks generate RGBA storage textures mapping the P×H thermodynamic space. Properties (density, temperature, viscosity, phase fraction) are encoded as texture channels. The texture is cached in IndexedDB and optionally persisted as Zarr for reuse across sessions and by the simulation server.

### Steady-state pipe simulation

WebGPU compute shaders trace fluid trajectories through the P×H property texture along the pipe. Each inlet condition is a starting (P, H) point; the shader marches it through successive pipe segments using the property texture as a lookup table. A family of inlet conditions can be run simultaneously, producing trajectories that span the P×H space.

Results are stored as a Zarr array indexed by `(inlet_P, inlet_H, KP)` for family runs, or a flat KP-indexed array for a single run.

### Hovmöller diagram

Space-time plot with KP distance on the Y axis, time on the X axis, and a fluid property value encoded as colour. Used to visualise how pressure waves, temperature fronts, and flow changes propagate along a pipe over time.

The full `(KP × time)` Zarr array maps directly to a 2D GPU texture — the fragment shader performs the colormapping. During an active simulation run, the canvas is built incrementally from the SSE stream. After the run, the same view is served from the Zarr file.

### Profile plots

Property vs KP distance at a fixed timestep. A horizontal slice through the Hovmöller array.

### Time-series plots

Property vs time at a fixed KP location. A vertical slice through the Hovmöller array.

## Data Sources

| Data | Source | Access |
|---|---|---|
| Network topology & properties | Hono → Zig core | REST |
| Thermodynamic property texture | ONNX inference or Zarr cache | IndexedDB / Zarr |
| Steady-state results | WebGPU output | Zarr |
| Live transient data | Hono SSE proxy | EventSource |
| Historical transient data | Hono → Zarr file | zarr.js |

## dim WASM

The [dim](https://github.com/Jerell/dim) library compiles to WASM for client-side unit display and conversion, keeping unit handling consistent with the Zig core.
