import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
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
import {
  shouldPersistNodeChanges,
  shouldRefreshDerivedDataForNodeChanges,
} from "./flow-change-persistence";
import type { FlowNode, FlowEdge } from "@/lib/collections/flow-nodes";
import {
  getSelectedNodeIdFromQuery,
  normalizeFlowSelectionQuery,
} from "@/lib/flow-selection";
import { appendActivityLogEntries } from "@/contexts/activity-log-context";
import {
  createNetworkSnapshotFromFlow,
  diffNetworkSnapshots,
} from "@/lib/network-activity";
import { cn } from "@/lib/utils";

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
  onEditNode?: (nodeId: string) => void;
  onOpenNodeInFinder?: (nodeId: string) => void;
  onAddBlockToBranch?: (branchId: string) => void;
  onPropagationInputsChanged?: () => Promise<void> | void;
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
  onEditNode,
  onOpenNodeInFinder,
  onAddBlockToBranch,
  onSelectedQueryChange,
  onPropagationInputsChanged,
  syncDirectory,
  suspendPersistence = false,
}: FlowNetworkProps) {
  const theme = useTheme((s) => s.theme);
  const colorMode = useMemo(
    () => (theme === "dark" ? "dark" : "light") as "dark" | "light",
    [theme],
  );
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingDerivedRefreshRef = useRef(false);
  const reactFlowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null);
  const pendingLocalNodeSelectionRef = useRef<string | undefined>(undefined);
  const lastViewportNodeSelectionRef = useRef<string | undefined>(undefined);
  const [localNodes, setLocalNodes] = useState<FlowNode[]>(nodes);
  const [localEdges, setLocalEdges] = useState<FlowEdge[]>(edges);
  const [contextMenu, setContextMenu] = useState<{
    node: Node;
    x: number;
    y: number;
  } | null>(null);
  const localNodesRef = useRef<FlowNode[]>(nodes);
  const localEdgesRef = useRef<FlowEdge[]>(edges);
  const persistedNodesRef = useRef<FlowNode[]>(nodes);
  const persistedEdgesRef = useRef<FlowEdge[]>(edges);

  useEffect(() => {
    setLocalNodes(nodes);
    localNodesRef.current = nodes;
    persistedNodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    setLocalEdges(edges);
    localEdgesRef.current = edges;
    persistedEdgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    return () => {
      clearTimeout(syncTimer.current);
      pendingDerivedRefreshRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (suspendPersistence) {
      clearTimeout(syncTimer.current);
      pendingDerivedRefreshRef.current = false;
    }
  }, [suspendPersistence]);

  // Schedule a write-back of the current nodes+edges to TOML files.
  const scheduleSyncToFiles = useCallback(
    (
      updatedNodes: FlowNode[],
      updatedEdges: FlowEdge[],
      options?: { reloadDerivedData?: boolean },
    ) => {
      if (!syncDirectory || suspendPersistence) return;
      pendingDerivedRefreshRef.current =
        pendingDerivedRefreshRef.current || Boolean(options?.reloadDerivedData);
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        const shouldReloadDerivedData = pendingDerivedRefreshRef.current;
        pendingDerivedRefreshRef.current = false;

        exportNetworkToToml(updatedNodes, updatedEdges, syncDirectory)
          .then(async () => {
            if (shouldReloadDerivedData) {
              await onPropagationInputsChanged?.();
            }
          })
          .catch((err) => console.error("[sync] Failed to write TOML:", err));
      }, SYNC_DEBOUNCE_MS);
    },
    [onPropagationInputsChanged, syncDirectory, suspendPersistence],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const relevantChanges = changes.filter(
        (change) => change.type !== "select",
      );
      if (relevantChanges.length === 0) {
        return;
      }

      const currentNodes = localNodesRef.current;
      const updated = applyNodeChanges(
        relevantChanges,
        currentNodes as Node[],
      ) as FlowNode[];

      localNodesRef.current = updated;
      setLocalNodes(updated);

      if (shouldPersistNodeChanges(relevantChanges) && !suspendPersistence) {
        const shouldReloadDerivedData =
          shouldRefreshDerivedDataForNodeChanges(relevantChanges);
        const activityEntries = diffNetworkSnapshots(
          createNetworkSnapshotFromFlow(
            persistedNodesRef.current,
            persistedEdgesRef.current,
          ),
          createNetworkSnapshotFromFlow(updated, localEdgesRef.current),
          {
            source: "canvas",
          },
        );
        writeNodesToCollection(updated);
        persistedNodesRef.current = updated;
        scheduleSyncToFiles(updated, localEdgesRef.current, {
          reloadDerivedData: shouldReloadDerivedData,
        });
        appendActivityLogEntries(activityEntries);
      }
    },
    [scheduleSyncToFiles, suspendPersistence],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const persistedChanges = changes.filter(
        (change) => change.type !== "select",
      );
      if (persistedChanges.length === 0) {
        return;
      }

      const currentEdges = localEdgesRef.current;
      const updated = applyEdgeChanges(
        persistedChanges,
        currentEdges as Edge[],
      ) as FlowEdge[];

      localEdgesRef.current = updated;
      setLocalEdges(updated);

      if (!suspendPersistence) {
        const activityEntries = diffNetworkSnapshots(
          createNetworkSnapshotFromFlow(
            persistedNodesRef.current,
            persistedEdgesRef.current,
          ),
          createNetworkSnapshotFromFlow(localNodesRef.current, updated),
          {
            source: "canvas",
          },
        );
        writeEdgesToCollection(updated);
        persistedEdgesRef.current = updated;
        scheduleSyncToFiles(localNodesRef.current, updated, {
          reloadDerivedData: true,
        });
        appendActivityLogEntries(activityEntries);
      }
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
        const activityEntries = diffNetworkSnapshots(
          createNetworkSnapshotFromFlow(
            persistedNodesRef.current,
            persistedEdgesRef.current,
          ),
          createNetworkSnapshotFromFlow(localNodesRef.current, updated),
          {
            source: "canvas",
          },
        );
        writeEdgesToCollection(updated);
        persistedEdgesRef.current = updated;
        scheduleSyncToFiles(localNodesRef.current, updated, {
          reloadDerivedData: true,
        });
        appendActivityLogEntries(activityEntries);
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
    setContextMenu(null);
    handleSelectedQueryChange(null);
  }, [handleSelectedQueryChange]);

  const onNodeContextMenu = useCallback<NodeMouseHandler<Node>>((event, node) => {
    event.preventDefault();
    setContextMenu({ node, x: event.clientX, y: event.clientY });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;

    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (localNodes.length === 0) return;

    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);
    if (!selectedNodeId) {
      pendingLocalNodeSelectionRef.current = undefined;
      lastViewportNodeSelectionRef.current = undefined;
      return;
    }

    const selectedNode = localNodes.find((node) => node.id === selectedNodeId);
    if (!selectedNode) {
      handleSelectedQueryChange(null);
      return;
    }

    if (pendingLocalNodeSelectionRef.current === selectedNodeId) {
      pendingLocalNodeSelectionRef.current = undefined;
      lastViewportNodeSelectionRef.current = selectedNodeId;
      return;
    }

    if (lastViewportNodeSelectionRef.current === selectedNodeId) {
      return;
    }

    lastViewportNodeSelectionRef.current = selectedNodeId;
    const reactFlow = reactFlowRef.current;
    if (reactFlow) {
      void reactFlow.fitView({
        nodes: [{ id: selectedNode.id }],
        duration: 250,
        maxZoom: 1.25,
        padding: 0.25,
      });
    }
  }, [localNodes, selectedQuery, handleSelectedQueryChange]);

  return (
    <div className="h-full w-full">
      <FlowSelectionProvider
        value={{
          selectedQuery,
          setSelectedQuery: handleSelectedQueryChange,
          onAddBlockToBranch,
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
          onNodeContextMenu={onNodeContextMenu}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          colorMode={colorMode}
          fitView
          onlyRenderVisibleElements
        >
          <Background />
          <Controls position="top-right" />
          {/* <MiniMap position="bottom-left" /> */}
        </ReactFlow>
        {contextMenu ? (
          <FlowNodeContextMenu
            node={contextMenu.node}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onEditNode={onEditNode}
            onOpenNodeInFinder={onOpenNodeInFinder}
          />
        ) : null}
      </FlowSelectionProvider>
    </div>
  );
}

function FlowNodeContextMenu({
  node,
  onClose,
  onEditNode,
  onOpenNodeInFinder,
  x,
  y,
}: {
  node: Node;
  onClose: () => void;
  onEditNode?: (nodeId: string) => void;
  onOpenNodeInFinder?: (nodeId: string) => void;
  x: number;
  y: number;
}) {
  const canEdit = node.type === "branch" || node.type === "labeledGroup";
  const closeAndRun = (run: (() => void) | undefined) => {
    onClose();
    run?.();
  };

  return (
    <div
      className="fixed z-50 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: x, top: y }}
    >
      <FlowContextMenuButton
        disabled={!canEdit || !onEditNode}
        onClick={() => closeAndRun(() => onEditNode?.(node.id))}
      >
        Edit
      </FlowContextMenuButton>
      <div className="-mx-1 my-1 h-px bg-border" />
      <FlowContextMenuButton
        disabled={!onOpenNodeInFinder}
        onClick={() => closeAndRun(() => onOpenNodeInFinder?.(node.id))}
      >
        Open in Finder
      </FlowContextMenuButton>
    </div>
  );
}

function FlowContextMenuButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
