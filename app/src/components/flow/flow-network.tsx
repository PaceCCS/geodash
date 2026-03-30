import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { shouldPersistNodeChanges } from "./flow-change-persistence";
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
  /**
   * External on-disk edits are being applied; hold local persistence so the
   * reloaded network can win before we write anything back out.
   */
  suspendPersistence?: boolean;
};

export function FlowNetwork({
  nodes,
  edges,
  selectedQuery,
  onSelectedQueryChange,
  syncDirectory,
  suspendPersistence = false,
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
  const [localNodes, setLocalNodes] = useState<FlowNode[]>(nodes);
  const [localEdges, setLocalEdges] = useState<FlowEdge[]>(edges);
  const localNodesRef = useRef<FlowNode[]>(nodes);
  const localEdgesRef = useRef<FlowEdge[]>(edges);

  useEffect(() => {
    setLocalNodes(nodes);
    localNodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    setLocalEdges(edges);
    localEdgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    return () => {
      clearTimeout(syncTimer.current);
    };
  }, []);

  useEffect(() => {
    if (suspendPersistence) {
      clearTimeout(syncTimer.current);
    }
  }, [suspendPersistence]);

  // Schedule a write-back of the current nodes+edges to TOML files.
  const scheduleSyncToFiles = useCallback(
    (updatedNodes: FlowNode[], updatedEdges: FlowEdge[]) => {
      if (!syncDirectory || suspendPersistence) return;
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        exportNetworkToToml(updatedNodes, updatedEdges, syncDirectory).catch(
          (err) => console.error("[sync] Failed to write TOML:", err),
        );
      }, SYNC_DEBOUNCE_MS);
    },
    [syncDirectory, suspendPersistence],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const relevantChanges = changes.filter((change) => change.type !== "select");
      if (relevantChanges.length === 0) {
        return;
      }

      setLocalNodes((currentNodes) => {
        const updated = applyNodeChanges(
          relevantChanges,
          currentNodes as Node[],
        ) as FlowNode[];

        localNodesRef.current = updated;

        if (shouldPersistNodeChanges(relevantChanges) && !suspendPersistence) {
          writeNodesToCollection(updated);
          scheduleSyncToFiles(updated, localEdgesRef.current);
        }

        return updated;
      });
    },
    [scheduleSyncToFiles, suspendPersistence],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const persistedChanges = changes.filter((change) => change.type !== "select");
      if (persistedChanges.length === 0) {
        return;
      }

      setLocalEdges((currentEdges) => {
        const updated = applyEdgeChanges(
          persistedChanges,
          currentEdges as Edge[],
        ) as FlowEdge[];

        localEdgesRef.current = updated;
        if (!suspendPersistence) {
          writeEdgesToCollection(updated);
          scheduleSyncToFiles(localNodesRef.current, updated);
        }
        return updated;
      });
    },
    [scheduleSyncToFiles, suspendPersistence],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      // Only allow branch→branch connections.
      const src = localNodesRef.current.find((n) => n.id === connection.source);
      const tgt = localNodesRef.current.find((n) => n.id === connection.target);
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
        localEdgesRef.current as Edge[],
      ) as FlowEdge[];

      setLocalEdges(updated);
      localEdgesRef.current = updated;
      if (!suspendPersistence) {
        writeEdgesToCollection(updated);
        scheduleSyncToFiles(localNodesRef.current, updated);
      }
    },
    [scheduleSyncToFiles, suspendPersistence],
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

  useEffect(() => {
    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);
    if (selectedNodeId) {
      lastViewportNodeSelectionRef.current = undefined;
    }
  }, [selectedQuery]);

  useEffect(() => {
    if (localNodes.length === 0) {
      return;
    }

    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);
    if (!selectedNodeId) {
      pendingLocalNodeSelectionRef.current = undefined;
      lastViewportNodeSelectionRef.current = undefined;
      return;
    }

    const selectedNode = localNodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) {
      handleSelectedQueryChange(null);
    }
  }, [localNodes, selectedQuery, handleSelectedQueryChange]);

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

    const selectedNode = localNodes.find((node) => node.id === selectedNodeId);
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
  }, [localNodes, selectedQuery]);

  return (
    <div className="h-full w-full">
      <FlowSelectionProvider
        value={{
          selectedQuery,
          setSelectedQuery: handleSelectedQueryChange,
        }}
      >
        <ReactFlow
          nodes={localNodes as Node[]}
          edges={localEdges as Edge[]}
          onInit={onInit}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
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
