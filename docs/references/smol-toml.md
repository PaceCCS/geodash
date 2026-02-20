# smol-toml Reference

Lightweight TOML parser for JavaScript/TypeScript.

- Repo: https://github.com/squirrelchat/smol-toml
- npm: https://www.npmjs.com/package/smol-toml

## How geodash uses it

The server-side OLGA service (`server/src/services/olga.ts`) uses smol-toml to parse TOML files when it needs to inspect network data on the TypeScript side — specifically for validating block properties against OLGA schemas before passing to the Zig core.

## Why two TOML parsers?

The Zig core has its own TOML parser (`core/network-engine/src/toml.zig`) for use inside WASM. smol-toml runs on the TypeScript side when the server needs to read TOML without going through WASM — for example, to extract block types and properties for schema validation before deciding whether to call the Zig exporter.

## Key API

```typescript
import { parse } from "smol-toml";

const data = parse(tomlString);
// data is a plain object — { key: value, ... }
```

## Version

`smol-toml@^1.6.0` (see `server/package.json`)
