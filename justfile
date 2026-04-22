# geodash project commands

default:
    just --list

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

# Run server tests
test-server:
    cd server && bun test

# Run all tests
test-all: test-zig test-server

# Install server dependencies
install-server:
    cd server && bun install

# Start Electron dev (spawns Elysia server automatically)
dev:
    cd app && bun run dev

# Start the server standalone
dev-server:
    cd server && bun run dev

# Start the renderer in browser-only mode
dev-web:
    cd app && bun run dev:web

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

# Lint app TypeScript/TSX
lint-app:
    cd app && bunx eslint src/

# Check WASM binary size
check-wasm-size:
    bash scripts/check-wasm-size.sh

# Check docs reference all modules
check-docs:
    bash scripts/check-docs-freshness.sh

# Check all Zig source files have tests
check-test-coverage:
    bash scripts/check-test-coverage.sh

# Check committed WASM matches a fresh build
check-wasm-freshness:
    bash scripts/check-wasm-freshness.sh

# Check QUALITY_SCORE.md test counts match reality
check-test-counts:
    bash scripts/check-test-counts.sh

# Build pinned dim WASM via Nix and copy it to the app's public assets
build-dim-wasm:
    nix --extra-experimental-features 'nix-command flakes' build path:.#dim-wasm
    mkdir -p app/public/dim
    cp result/share/dim/dim_wasm.wasm app/public/dim/dim_wasm.wasm

# Build dim WASM from a local sibling checkout and copy it to the app
build-dim-wasm-local:
    nix --extra-experimental-features 'nix-command flakes' build path:.#dim-wasm --override-input dim-src path:../dim
    mkdir -p app/public/dim
    cp result/share/dim/dim_wasm.wasm app/public/dim/dim_wasm.wasm

# Install app dependencies
install-app:
    cd app && bun install

# Check all route handlers have OpenAPI annotations
check-openapi:
    bash scripts/check-openapi.sh

# Check observability patterns (record, plugins)
check-observability:
    bash scripts/check-observability.sh

# Check local thermodynamic training datasets against recorded hashes
check-thermo-datasets:
    cd tools/thermo-models && uv run check_dataset_hashes.py

# Train any thermodynamic model into the default thermo artifact root
train-thermo-model model version="local":
    cd tools/thermo-models && uv run train_model.py --model {{model}} --version {{version}}

# Train the full thermodynamic model family into the default thermo artifact root
train-thermo-model-family version="local":
    cd tools/thermo-models && uv run train_model.py --model all --version {{version}}

# Compare a trained thermodynamic model against the reference ONNX family
compare-thermo-model model version="local":
    cd tools/thermo-models && uv run compare_models.py --model {{model}} --version {{version}}

# Compare the full trained thermodynamic model family against the reference ONNX family
compare-thermo-model-family version="local":
    cd tools/thermo-models && uv run compare_models.py --model all --version {{version}}

# Run all checks
check:
    zig fmt --check core/shapefile/src/ core/network-engine/src/
    cd server && bunx eslint src/
    cd app && bunx eslint src/
    bash scripts/check-wasm-contract.sh
    bash scripts/check-deps.sh
    bash scripts/check-wasm-size.sh
    bash scripts/check-docs-freshness.sh
    bash scripts/check-test-coverage.sh
    bash scripts/check-test-counts.sh
    bash scripts/check-openapi.sh
    bash scripts/check-observability.sh
