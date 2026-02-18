# crs — CRS Reproject Tool

Standalone CLI tool that reprojects shapefile survey coordinates from one coordinate reference system to another (e.g. ED50 UTM Zone 30N → WGS84). Wraps [PROJ](https://proj.org/) via Zig C interop.

This tool is intentionally isolated from the Tauri app binary. It runs server-side or in Docker as a preprocessing step, keeping PROJ out of the frontend build.

## Data flow

```
input.shp + input.prj  (e.g. ED50 UTM 30N)
    ↓  crs-tool --to EPSG:4326
output.shp + output.shx  (e.g. WGS84)
    ↓  geotiff sampler, network engine (no PROJ dependency)
```

## Install

**macOS:**
```sh
brew install proj
```

**Ubuntu/Debian:**
```sh
apt install libproj-dev
```

**Docker:**
```dockerfile
RUN apt-get install -y libproj-dev
```

## Usage

```sh
crs-tool --to EPSG:4326 input.shp output.shp
```

- Reads `input.prj` automatically (same stem as `input.shp`)
- Writes `output.shp` and `output.shx`
- Errors print to stderr; exit code 1 on failure

`--to` accepts any PROJ-understood string: EPSG codes, PROJ strings, or WKT.

## Build

```sh
cd core/crs
zig build          # produces zig-out/bin/crs-tool
zig build test     # runs transform tests
```

## Example: Spirit pipeline

```sh
./zig-out/bin/crs-tool --to EPSG:4326 \
  ../shapefile/test-data/spirit/KP_Points_1m.shp \
  /tmp/spirit_wgs84.shp
```

## Module API

```zig
const crs = @import("crs");

// From EPSG code or PROJ string
const t = try crs.Transform.create("EPSG:23030", "EPSG:4326");
defer t.deinit();

const lonlat = try t.forward(491542.058, 5918507.093, 0.0);
// lonlat = [lon, lat, z]

const recovered = try t.inverse(lonlat[0], lonlat[1], lonlat[2]);

// From WKT (e.g. read from a .prj file)
const t2 = try crs.createFromWkt(allocator, wkt_slice, "EPSG:4326");
defer t2.deinit();
```

Axis order is always easting/northing (PROJ `normalize_for_visualization` is applied).
