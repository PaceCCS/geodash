import { useCallback, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  writeNodesToCollection,
  writeEdgesToCollection,
} from "@/lib/collections/flow";
import { exportNetworkToToml } from "@/lib/exporters/network-toml";
import { BranchNode } from "./nodes/branch";
import { LabeledGroupNode } from "./nodes/labeled-group";
import { GeographicAnchorNode } from "./nodes/geographic-anchor";
import { GeographicWindowNode } from "./nodes/geographic-window";
import { ImageNode } from "./nodes/image";
import type { FlowNode, FlowEdge } from "@/lib/collections/flow-nodes";

const nodeTypes: NodeTypes = {
  branch: BranchNode as NodeTypes["branch"],
  labeledGroup: LabeledGroupNode as NodeTypes["labeledGroup"],
  geographicAnchor: GeographicAnchorNode as NodeTypes["geographicAnchor"],
  geographicWindow: GeographicWindowNode as NodeTypes["geographicWindow"],
  image: ImageNode as NodeTypes["image"],
};

/** Debounce delay before flushing canvas edits to TOML files (ms). */
const SYNC_DEBOUNCE_MS = 300;

type FlowNetworkProps = {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /**
   * When provided, canvas edits are written back to TOML files in this
   * directory after a short debounce (bidirectional sync).
   */
  syncDirectory?: string;
};

export function FlowNetwork({ nodes, edges, syncDirectory }: FlowNetworkProps) {
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Schedule a write-back of the current nodes+edges to TOML files.
  const scheduleSyncToFiles = useCallback(
    (updatedNodes: FlowNode[], updatedEdges: FlowEdge[]) => {
      if (!syncDirectory) return;
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        exportNetworkToToml(updatedNodes, updatedEdges, syncDirectory).catch(
          (err) => console.error("[sync] Failed to write TOML:", err),
        );
      }, SYNC_DEBOUNCE_MS);
    },
    [syncDirectory],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, nodes as Node[]) as FlowNode[];
      writeNodesToCollection(updated);
      scheduleSyncToFiles(updated, edges);
    },
    [nodes, edges, scheduleSyncToFiles],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, edges as Edge[]) as FlowEdge[];
      writeEdgesToCollection(updated);
      scheduleSyncToFiles(nodes, updated);
    },
    [nodes, edges, scheduleSyncToFiles],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      // Only allow branch→branch connections.
      const src = nodes.find((n) => n.id === connection.source);
      const tgt = nodes.find((n) => n.id === connection.target);
      if (
        !src ||
        !tgt ||
        src.type !== "branch" ||
        tgt.type !== "branch" ||
        connection.source === connection.target
      ) {
        return;
      }

      const updated = addEdge(
        { ...connection, data: { weight: 1 } },
        edges as Edge[],
      ) as FlowEdge[];

      writeEdgesToCollection(updated);
      scheduleSyncToFiles(nodes, updated);
    },
    [nodes, edges, scheduleSyncToFiles],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes as Node[]}
        edges={edges as Edge[]}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background />
        <Controls position="top-right" />
        <MiniMap position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
