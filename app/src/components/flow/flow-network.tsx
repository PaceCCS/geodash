import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type ReactFlowInstance,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FlowSelectionProvider } from "@/components/flow/selection-context";
import {
  writeNodesToCollection,
  writeEdgesToCollection,
} from "@/lib/collections/flow";
import { exportNetworkToToml } from "@/lib/exporters/network-toml";
import { useTheme } from "@/hooks/use-theme";
import { BranchNode } from "./nodes/branch";
import { LabeledGroupNode } from "./nodes/labeled-group";
import { GeographicAnchorNode } from "./nodes/geographic-anchor";
import { GeographicWindowNode } from "./nodes/geographic-window";
import { ImageNode } from "./nodes/image";
import type { FlowNode, FlowEdge } from "@/lib/collections/flow-nodes";
import {
  getSelectedNodeIdFromQuery,
  normalizeFlowSelectionQuery,
} from "@/lib/flow-selection";

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
  selectedQuery?: string;
  onSelectedQueryChange?: (query: string | null) => void;
  /**
   * When provided, canvas edits are written back to TOML files in this
   * directory after a short debounce (bidirectional sync).
   */
  syncDirectory?: string;
};

export function FlowNetwork({
  nodes,
  edges,
  selectedQuery,
  onSelectedQueryChange,
  syncDirectory,
}: FlowNetworkProps) {
  const theme = useTheme((s) => s.theme);
  const colorMode = useMemo(
    () => (theme === "dark" ? "dark" : "light") as "dark" | "light",
    [theme],
  );
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reactFlowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const pendingLocalNodeSelectionRef = useRef<string | undefined>(undefined);
  const lastViewportNodeSelectionRef = useRef<string | undefined>(undefined);

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
      const persistedChanges = changes.filter((change) => change.type !== "select");
      if (persistedChanges.length === 0) {
        return;
      }

      const updated = applyNodeChanges(
        persistedChanges,
        nodes as Node[],
      ) as FlowNode[];
      writeNodesToCollection(updated);
      scheduleSyncToFiles(updated, edges);
    },
    [nodes, edges, scheduleSyncToFiles],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const persistedChanges = changes.filter((change) => change.type !== "select");
      if (persistedChanges.length === 0) {
        return;
      }

      const updated = applyEdgeChanges(
        persistedChanges,
        edges as Edge[],
      ) as FlowEdge[];
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

  const onInit = useCallback((instance: ReactFlowInstance<Node, Edge>) => {
    reactFlowRef.current = instance;
  }, []);

  const handleSelectedQueryChange = useCallback(
    (query: string | null) => {
      const normalizedQuery = normalizeFlowSelectionQuery(query);
      pendingLocalNodeSelectionRef.current =
        getSelectedNodeIdFromQuery(normalizedQuery);
      onSelectedQueryChange?.(normalizedQuery ?? null);
    },
    [onSelectedQueryChange],
  );

  const onNodeClick = useCallback<NodeMouseHandler<Node>>(
    (_event, node) => {
      handleSelectedQueryChange(node.id);
    },
    [handleSelectedQueryChange],
  );

  const onPaneClick = useCallback(() => {
    handleSelectedQueryChange(null);
  }, [handleSelectedQueryChange]);

  const onMoveStart = useCallback(() => {
    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);
    if (!selectedNodeId) {
      return;
    }

    // If the user manually pans/zooms after a selection, allow future
    // query changes to recenter again instead of treating the viewport as
    // already synchronized forever.
    lastViewportNodeSelectionRef.current = undefined;
  }, [selectedQuery]);

  useEffect(() => {
    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);
    if (selectedNodeId) {
      lastViewportNodeSelectionRef.current = undefined;
    }
  }, [selectedQuery]);

  useEffect(() => {
    if (nodes.length === 0) {
      return;
    }

    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);
    if (!selectedNodeId) {
      pendingLocalNodeSelectionRef.current = undefined;
      lastViewportNodeSelectionRef.current = undefined;
      return;
    }

    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) {
      handleSelectedQueryChange(null);
    }
  }, [nodes, selectedQuery, handleSelectedQueryChange]);

  useEffect(() => {
    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);

    if (!selectedNodeId) {
      pendingLocalNodeSelectionRef.current = undefined;
      lastViewportNodeSelectionRef.current = undefined;
      return;
    }

    if (pendingLocalNodeSelectionRef.current === selectedNodeId) {
      pendingLocalNodeSelectionRef.current = undefined;
      lastViewportNodeSelectionRef.current = selectedNodeId;
      return;
    }

    const reactFlow = reactFlowRef.current;
    if (!reactFlow) {
      return;
    }

    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) {
      return;
    }

    if (lastViewportNodeSelectionRef.current === selectedNodeId) {
      return;
    }

    lastViewportNodeSelectionRef.current = selectedNodeId;
    void reactFlow.fitView({
      nodes: [{ id: selectedNode.id }],
      duration: 250,
      maxZoom: 1.25,
      padding: 0.25,
    });
  }, [nodes, selectedQuery]);

  return (
    <div className="h-full w-full">
      <FlowSelectionProvider
        value={{
          selectedQuery,
          setSelectedQuery: handleSelectedQueryChange,
        }}
      >
        <ReactFlow
          nodes={nodes as Node[]}
          edges={edges as Edge[]}
          onInit={onInit}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onMoveStart={onMoveStart}
          nodeTypes={nodeTypes}
          colorMode={colorMode}
          fitView
        >
          <Background />
          <Controls position="top-right" />
          <MiniMap position="bottom-left" />
        </ReactFlow>
      </FlowSelectionProvider>
    </div>
  );
}
