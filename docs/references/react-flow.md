# React Flow Reference

React library for building interactive node-based graphs and diagrams.

- Docs: https://reactflow.dev/
- LLM reference: https://reactflow.dev/llms.txt (if available)

## How geodash will use it

The Tauri app's network editor (GitHub issue #6) will use React Flow to visualise and edit the scope hierarchy (Global → Group → Branch → Block) as a directed graph.

## Planned usage

- Nodes represent Blocks (Pipe, Source, Sink, Compressor, etc.)
- Edges represent flow connections between blocks
- Custom node types for each block type, showing key properties
- Node properties panel for editing block configuration
- Drag-and-drop to add new blocks
- Scope hierarchy visible as nested groups or swimlanes

## Key concepts

- `<ReactFlow nodes={nodes} edges={edges} />` — Main component
- `useNodesState()` / `useEdgesState()` — Managed state hooks
- Custom nodes via `nodeTypes` prop — render block-specific UI
- `onConnect` — Handle new edge creation
- `onNodesChange` / `onEdgesChange` — Handle drag, select, delete
- Minimap, Controls, Background — Built-in UI components

## Notes

- React Flow is MIT-licensed for open-source projects
- Works with React 18+ and TanStack Start
- Supports both controlled and uncontrolled modes
