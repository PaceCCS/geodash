# geodash project commands

# Build the WASM module and copy it to the server
build-wasm:
    cd core/network-engine && zig build wasm
    cp core/network-engine/zig-out/bin/geodash.wasm server/wasm/geodash.wasm

# Run network-engine tests
test-network-engine:
    cd core/network-engine && zig build test

# Run shapefile parser tests
test-shapefile:
    cd core/shapefile && zig build test

# Run CRS tool tests
test-crs:
    cd core/crs && zig build test

# Run all Zig tests
test-zig: test-network-engine test-shapefile test-crs

# Run all tests (Zig only — server uses Bun runtime with no separate test runner)
test-all: test-zig

# Start the Hono server in dev mode (hot reload)
dev-server:
    cd server && bun run dev

# Start the Hono server
start-server:
    cd server && bun run start

# Install server dependencies
install-server:
    cd server && bun install

# Build WASM then start the dev server
dev: build-wasm dev-server

# Build the CRS tool
build-crs:
    cd core/crs && zig build

# Reproject a shapefile (usage: just reproject input.shp output.shp EPSG:4326)
reproject input output crs:
    core/crs/zig-out/bin/crs-tool --to {{crs}} {{input}} {{output}}

# Check WASM contract (Zig exports match TS types)
check-contract:
    bash scripts/check-wasm-contract.sh

# Check dependency direction rules
check-deps:
    bash scripts/check-deps.sh

# Lint server TypeScript
lint:
    cd server && bunx eslint src/

# Run all checks (fmt + lint + contract + deps)
check:
    zig fmt --check core/shapefile/src/ core/network-engine/src/
    cd server && bunx eslint src/
    bash scripts/check-wasm-contract.sh
    bash scripts/check-deps.sh
