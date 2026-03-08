# geodash App

React/TanStack frontend with an Electron desktop shell.

## Modes

Desktop development:

```bash
bun run dev
```

Browser-only development:

```bash
bun run dev:web
```

Production build:

```bash
bun run build
```

This builds the web renderer and the Electron main/preload code into `dist-electron/`.

## Desktop Bridge

The renderer talks to Electron through `src/lib/desktop.ts`.

That bridge owns:

- backend process startup
- native directory picking
- TOML file read/write/delete
- directory watching for live network reload
