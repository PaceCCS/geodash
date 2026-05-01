import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  viewMode?: "schematic" | "fluid";
  selectedQuery?: string;
  onSelectedQueryChange?: (query: string | null) => void;
  onEditNode?: (nodeId: string) => void;
  onOpenNodeInFinder?: (nodeId: string) => void;
  onAddBlockToBranch?: (branchId: string) => void;
  onCreateBranch?: (
    position: { x: number; y: number },
    parentId?: string,
  ) => void;
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
  viewMode = "schematic",
  selectedQuery,
  onEditNode,
  onOpenNodeInFinder,
  onAddBlockToBranch,
  onCreateBranch,
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
  const [menuTarget, setMenuTarget] = useState<MenuTarget | null>(null);
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
      if (changes.length === 0) {
        return;
      }

      const updated = applyNodeChanges(
        changes,
        localNodesRef.current as Node[],
      ) as FlowNode[];

      localNodesRef.current = updated;
      setLocalNodes(updated);

      const persistedChanges = changes.filter(
        (change) => change.type !== "select",
      );

      if (
        persistedChanges.length > 0 &&
        shouldPersistNodeChanges(persistedChanges) &&
        !suspendPersistence
      ) {
        const shouldReloadDerivedData =
          shouldRefreshDerivedDataForNodeChanges(persistedChanges);
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
      if (changes.length === 0) {
        return;
      }

      const updated = applyEdgeChanges(
        changes,
        localEdgesRef.current as Edge[],
      ) as FlowEdge[];

      localEdgesRef.current = updated;
      setLocalEdges(updated);

      const persistedChanges = changes.filter(
        (change) => change.type !== "select",
      );

      if (persistedChanges.length > 0 && !suspendPersistence) {
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

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      onEdgesChange([{ type: "remove", id: edgeId }]);
    },
    [onEdgesChange],
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
    handleSelectedQueryChange(null);
  }, [handleSelectedQueryChange]);

  const onNodeContextMenu = useCallback<NodeMouseHandler<Node>>(
    (event, node) => {
      setMenuTarget({
        kind: "node",
        node,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    [],
  );

  const onEdgeContextMenu = useCallback(
    (event: ReactMouseEvent, edge: Edge) => {
      setMenuTarget({
        kind: "edge",
        edge,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    [],
  );

  const onPaneContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent) => {
      setMenuTarget({
        kind: "pane",
        clientX: event.clientX,
        clientY: event.clientY,
      });
    },
    [],
  );

  const handleCreateBranchAtTarget = useCallback(
    (parentId?: string) => {
      if (!menuTarget || !onCreateBranch) {
        return;
      }

      const reactFlow = reactFlowRef.current;
      if (!reactFlow) {
        return;
      }

      const flowPosition = reactFlow.screenToFlowPosition({
        x: menuTarget.clientX,
        y: menuTarget.clientY,
      });

      let position = flowPosition;
      if (parentId) {
        const parent = localNodesRef.current.find(
          (candidate) => candidate.id === parentId,
        );
        if (parent) {
          position = {
            x: flowPosition.x - parent.position.x,
            y: flowPosition.y - parent.position.y,
          };
        }
      }

      onCreateBranch(position, parentId);
    },
    [menuTarget, onCreateBranch],
  );

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
          viewMode,
          selectedQuery,
          setSelectedQuery: handleSelectedQueryChange,
          onAddBlockToBranch,
        }}
      >
        <ContextMenu
          onOpenChange={(open) => {
            if (!open) {
              setMenuTarget(null);
            }
          }}
        >
          <ContextMenuTrigger asChild>
            <div className="h-full w-full">
              <ReactFlow
                nodes={localNodes as Node[]}
                edges={localEdges as Edge[]}
                onInit={onInit}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onNodeContextMenu={onNodeContextMenu}
                onEdgeContextMenu={onEdgeContextMenu}
                onPaneContextMenu={onPaneContextMenu}
                onPaneClick={onPaneClick}
                nodeTypes={nodeTypes}
                colorMode={colorMode}
                deleteKeyCode={["Backspace", "Delete"]}
                fitView
                onlyRenderVisibleElements
              >
                <Background />
                <Controls position="top-right" />
                {/* <MiniMap position="bottom-left" /> */}
              </ReactFlow>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <FlowContextMenuItems
              target={menuTarget}
              onEditNode={onEditNode}
              onOpenNodeInFinder={onOpenNodeInFinder}
              onCreateBranch={
                onCreateBranch ? handleCreateBranchAtTarget : undefined
              }
              onDeleteEdge={handleDeleteEdge}
            />
          </ContextMenuContent>
        </ContextMenu>
      </FlowSelectionProvider>
    </div>
  );
}

type MenuTarget =
  | { kind: "pane"; clientX: number; clientY: number }
  | { kind: "node"; node: Node; clientX: number; clientY: number }
  | { kind: "edge"; edge: Edge; clientX: number; clientY: number };

function FlowContextMenuItems({
  target,
  onEditNode,
  onOpenNodeInFinder,
  onCreateBranch,
  onDeleteEdge,
}: {
  target: MenuTarget | null;
  onEditNode?: (nodeId: string) => void;
  onOpenNodeInFinder?: (nodeId: string) => void;
  onCreateBranch?: (parentId?: string) => void;
  onDeleteEdge?: (edgeId: string) => void;
}) {
  if (!target) {
    return null;
  }

  if (target.kind === "pane") {
    if (!onCreateBranch) {
      return null;
    }

    return (
      <ContextMenuItem onSelect={() => onCreateBranch()}>
        Create Branch
      </ContextMenuItem>
    );
  }

  if (target.kind === "edge") {
    const { edge } = target;
    const weight =
      typeof edge.data?.weight === "number" ? edge.data.weight : null;

    return (
      <>
        <div className="px-2 py-1.5 text-xs text-muted-foreground">
          {weight === null ? "No weight" : `Weight: ${weight}`}
        </div>
        {onDeleteEdge ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              variant="destructive"
              onSelect={() => onDeleteEdge(edge.id)}
            >
              Delete
            </ContextMenuItem>
          </>
        ) : null}
      </>
    );
  }

  const { node } = target;
  const canEdit = node.type === "branch" || node.type === "labeledGroup";
  const showCreateInGroup =
    node.type === "labeledGroup" && Boolean(onCreateBranch);

  return (
    <>
      {canEdit && onEditNode ? (
        <ContextMenuItem onSelect={() => onEditNode(node.id)}>
          Edit
        </ContextMenuItem>
      ) : null}
      {showCreateInGroup ? (
        <ContextMenuItem onSelect={() => onCreateBranch!(node.id)}>
          Create Branch in group
        </ContextMenuItem>
      ) : null}
      {(canEdit || showCreateInGroup) && onOpenNodeInFinder ? (
        <ContextMenuSeparator />
      ) : null}
      {onOpenNodeInFinder ? (
        <ContextMenuItem onSelect={() => onOpenNodeInFinder(node.id)}>
          Open in Finder
        </ContextMenuItem>
      ) : null}
    </>
  );
}
