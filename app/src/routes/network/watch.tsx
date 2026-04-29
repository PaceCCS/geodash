import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { FolderOpen, EyeOff, Map, Save, Workflow } from "lucide-react";

import { BlockCreatorDialog } from "@/components/flow/editor/block-creator-dialog";
import { SelectionEditorOverlay } from "@/components/flow/editor/selection-editor-overlay";
import { DirectoryBrowserDialog } from "@/components/directory-browser-dialog";
import { FlowNetwork } from "@/components/flow/flow-network";
import {
  nodesCollection,
  edgesCollection,
  resetFlowToNetwork,
  sortNodesWithParentsFirst,
  writeEdgesToCollection,
  writeNodesToCollection,
} from "@/lib/collections/flow";
import { refreshGeoCollection } from "@/lib/collections/geo";
import { useFileWatcher } from "@/lib/hooks/use-file-watcher";
import { revealPath, writeNetworkFile } from "@/lib/desktop";
import { NetworkProvider } from "@/contexts/network-context";
import { Button } from "@/components/ui/button";
import { ShapefileEditorDialog } from "@/components/shapefile/shapefile-editor-dialog";
import { appendActivityLogEntries } from "@/contexts/activity-log-context";
import { HeaderSlot, useHeaderFileActions } from "@/components/header-slot";
import { useCommands } from "@/contexts/keybind-provider";
import { useHydrated } from "@/hooks/use-hydrated";
import { exportNetworkToToml } from "@/lib/exporters/network-toml";
import {
  EDIT_SELECTION_SHORTCUT,
  FLOW_EDITOR_QUERY_PARAM,
  FLOW_SELECTION_QUERY_PARAM,
  getSelectedNodeIdFromQuery,
  normalizeFlowEditorQuery,
  normalizeFlowSelectionQuery,
  resolveFlowSelection,
} from "@/lib/flow-selection";
import type { FlowEdge, FlowNode } from "@/lib/collections/flow-nodes";
import { createNetworkSnapshotFromFlow, diffNetworkSnapshots } from "@/lib/network-activity";
import {
  getNetworkFromPath,
  type NetworkConfigMetadata,
} from "@/lib/api-client";
import { isBranchNode } from "@/lib/collections/flow-nodes";
import {
  isEditableFlowSelection,
  type EditableFlowSelection,
} from "@/lib/selection-editor";
import { useWorkspaceSidebar } from "@/lib/stores/workspace-sidebar";

type WatchSearch = {
  directory?: string;
  selected?: string;
  edit?: "1";
  view?: NetworkViewMode;
};

type NetworkViewMode = "schematic" | "geographic";

const NETWORK_VIEW_MODES = ["schematic", "geographic"] as const;

function normalizeNetworkViewMode(value: unknown): NetworkViewMode {
  return NETWORK_VIEW_MODES.includes(value as NetworkViewMode)
    ? (value as NetworkViewMode)
    : "schematic";
}

const DEFAULT_NETWORK_CONFIG = `id = "new-project"
label = "New project"

# Global properties (preset-level defaults)
[properties]
ambientTemperature = 20.0
pressure = 14.7

# Inheritance rules
[inheritance]
general = ["block", "branch", "group", "global"]

[inheritance.rules]
ambientTemperature = ["group", "global"]
pressure = ["block"]
`;

export const Route = createFileRoute("/network/watch")({
  validateSearch: (search): WatchSearch => ({
    directory: typeof search.directory === "string" ? search.directory : undefined,
    [FLOW_SELECTION_QUERY_PARAM]: normalizeFlowSelectionQuery(
      search[FLOW_SELECTION_QUERY_PARAM],
    ),
    [FLOW_EDITOR_QUERY_PARAM]: normalizeFlowEditorQuery(
      search[FLOW_EDITOR_QUERY_PARAM],
    ),
    view: normalizeNetworkViewMode(search.view),
  }),
  component: WatchPage,
});

function WatchPage() {
  const {
    watchMode,
    networkLabel,
    networkConfig,
    isApplyingExternalChange,
    enableWatchMode,
    disableWatchMode,
  } = useFileWatcher();
  const hydrated = useHydrated();
  const [isBusy, setIsBusy] = useState(false);
  const [isDirectoryBrowserOpen, setIsDirectoryBrowserOpen] = useState(false);
  const [shapefileDialogPath, setShapefileDialogPath] = useState<string | null>(null);
  const { setActions: setHeaderFileActions } = useHeaderFileActions();
  const setSidebarDirectory = useWorkspaceSidebar((state) => state.setDirectory);
  const setSidebarItemActions = useWorkspaceSidebar((state) => state.setItemActions);
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const selectedQuery = search.selected;
  const isEditorOpen = search.edit === "1";
  const directoryQuery = search.directory;
  const viewMode = search.view ?? "schematic";

  const handleSelectedQueryChange = useCallback(
    (nextQuery: string | null) => {
      const nextSelected = normalizeFlowSelectionQuery(nextQuery);

      if (search.selected === nextSelected) {
        return;
      }

      navigate({
        replace: true,
        search: (prev) => ({
          ...prev,
          selected: nextSelected,
          [FLOW_EDITOR_QUERY_PARAM]: nextSelected ? prev[FLOW_EDITOR_QUERY_PARAM] : undefined,
        }),
      });
    },
    [navigate, search.selected],
  );

  const handleEditorOpenChange = useCallback(
    (open: boolean) => {
      navigate({
        replace: true,
        search: (prev) => ({
          ...prev,
          [FLOW_EDITOR_QUERY_PARAM]:
            open && prev[FLOW_SELECTION_QUERY_PARAM] ? "1" : undefined,
        }),
      });
    },
    [navigate],
  );

  const handleViewModeChange = useCallback(
    (nextViewMode: NetworkViewMode) => {
      navigate({
        replace: true,
        search: (prev) => ({
          ...prev,
          view: nextViewMode === "schematic" ? undefined : nextViewMode,
          [FLOW_EDITOR_QUERY_PARAM]:
            nextViewMode === "schematic" ? prev[FLOW_EDITOR_QUERY_PARAM] : undefined,
        }),
      });
    },
    [navigate],
  );

  const openDirectory = useCallback(async (path: string) => {
    setIsBusy(true);
    try {
      await enableWatchMode(path);
    } catch (err) {
      console.error("[watch] Failed to enable watch mode:", err);
      throw err;
    } finally {
      setIsBusy(false);
    }
  }, [enableWatchMode]);

  const handleSelectDirectory = useCallback(() => {
    setIsDirectoryBrowserOpen(true);
  }, []);

  const initializeCreatedNetworkDirectory = async (path: string) => {
    await writeNetworkFile(`${path}/config.toml`, DEFAULT_NETWORK_CONFIG);
  };

  useEffect(() => {
    if (!directoryQuery || watchMode.directoryPath === directoryQuery) return;
    void openDirectory(directoryQuery).then(() => {
      navigate({
        replace: true,
        search: (prev) => ({
          ...prev,
          directory: undefined,
        }),
      });
    });
  }, [directoryQuery, navigate, openDirectory, watchMode.directoryPath]);

  const handleStopWatching = useCallback(async () => {
    setIsBusy(true);
    try {
      await disableWatchMode();
      navigate({
        replace: true,
        search: (prev) => ({
          ...prev,
          selected: undefined,
          [FLOW_EDITOR_QUERY_PARAM]: undefined,
        }),
      });
    } catch (err) {
      console.error("[watch] Failed to disable watch mode:", err);
    } finally {
      setIsBusy(false);
    }
  }, [disableWatchMode, navigate]);

  const handleClose = useCallback(() => {
    void handleStopWatching().finally(() => {
      void navigate({ to: "/" });
    });
  }, [handleStopWatching, navigate]);

  useEffect(() => {
    setHeaderFileActions({
      openDirectory: handleSelectDirectory,
      close: handleClose,
    });
    return () => setHeaderFileActions({});
  }, [handleClose, handleSelectDirectory, setHeaderFileActions]);

  useEffect(() => {
    if (watchMode.enabled && watchMode.directoryPath) {
      setSidebarDirectory({ path: watchMode.directoryPath, label: "Network Files" });
      return () => setSidebarDirectory(null);
    }

    setSidebarDirectory(null);
  }, [setSidebarDirectory, watchMode.directoryPath, watchMode.enabled]);

  useEffect(() => {
    if (!watchMode.enabled || !watchMode.directoryPath) {
      setSidebarItemActions({});
      return;
    }

    const getNodeIdFromTreePath = (path: string) =>
      path.replace(/\.toml$/i, "").split("/").at(-1) ?? path;
    const getAbsoluteTreePath = (path: string) => {
      const normalizedDirectory = watchMode.directoryPath!.replace(/[\\/]+$/, "");
      const normalizedPath = path.replace(/[\\/]+$/, "");
      return normalizedPath ? `${normalizedDirectory}/${normalizedPath}` : normalizedDirectory;
    };

    setSidebarItemActions({
      viewPath: (path) => {
        navigate({
          replace: true,
          search: (prev) => ({
            ...prev,
            selected: getNodeIdFromTreePath(path),
            [FLOW_EDITOR_QUERY_PARAM]: undefined,
          }),
        });
      },
      editPath: (path) => {
        if (path.endsWith("/")) {
          setShapefileDialogPath(getAbsoluteTreePath(path));
          return;
        }

        navigate({
          replace: true,
          search: (prev) => ({
            ...prev,
            selected: getNodeIdFromTreePath(path),
            [FLOW_EDITOR_QUERY_PARAM]: "1",
          }),
        });
      },
      openInFinder: (path) => {
        void revealPath(path).catch((err) =>
          console.error("[sidebar] Failed to reveal path:", err),
        );
      },
      copyPath: (path) => {
        void navigator.clipboard.writeText(path).catch((err) =>
          console.error("[sidebar] Failed to copy path:", err),
        );
      },
    });

    return () => setSidebarItemActions({});
  }, [navigate, setSidebarItemActions, watchMode.directoryPath, watchMode.enabled]);

  useCommands(
    watchMode.enabled
      ? [
          {
            id: "network-view-schematic",
            label: "Schematic",
            run: (dialog) => {
              handleViewModeChange("schematic");
              dialog.close();
            },
            group: "View",
            icon: <Workflow />,
            shortcut: "Mod+H",
            checked: viewMode === "schematic",
            separatorBefore: true,
            menuOrder: 200,
          },
          {
            id: "network-view-geographic",
            label: "Geographic",
            run: (dialog) => {
              handleViewModeChange("geographic");
              dialog.close();
            },
            group: "View",
            icon: <Map />,
            shortcut: "Mod+G",
            checked: viewMode === "geographic",
            menuOrder: 201,
          },
          {
            id: "select-directory",
            label: "Change Watch Directory",
            run: (dialog) => {
              dialog.close();
              handleSelectDirectory();
            },
            group: "Network",
            icon: <FolderOpen />,
            shortcut: "Mod+O",
          },
          {
            id: "stop-watching",
            label: "Stop Watching Directory",
            run: (dialog) => {
              dialog.close();
              handleStopWatching();
            },
            group: "Network",
            icon: <EyeOff />,
          },
        ]
      : [
          {
            id: "select-directory",
            label: "Select Watch Directory",
            run: (dialog) => {
              dialog.close();
              handleSelectDirectory();
            },
            group: "Network",
            icon: <FolderOpen />,
            shortcut: "Mod+O",
          },
        ],
  );

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <HeaderSlot>
        {watchMode.enabled ? (
          <div className="flex w-full items-center justify-end px-2">
            <div className="flex min-w-0 items-center gap-2">
              {networkLabel ? (
                <>
                  <span className="max-w-64 truncate text-sm font-medium">
                    {networkLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">•</span>
                </>
              ) : null}
              <span className="shrink-0 text-xs text-muted-foreground">
                <Save className="inline w-3 h-3 mr-1" />
                Auto-saving
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full px-2">
            <span className="text-sm font-medium">Watch Network Directory</span>
          </div>
        )}
      </HeaderSlot>

      <DirectoryBrowserDialog
        open={isDirectoryBrowserOpen}
        title="Select Network Directory"
        description="Browse to the folder containing your TOML network files. Large folders are rejected before watching starts."
        initialPath={watchMode.directoryPath}
        confirmLabel="Watch Directory"
        allowCreate
        onOpenChange={setIsDirectoryBrowserOpen}
        onSelect={openDirectory}
        onCreate={initializeCreatedNetworkDirectory}
      />

      {shapefileDialogPath ? (
        <ShapefileEditorDialog
          open
          directoryPath={shapefileDialogPath}
          onOpenChange={(open) => {
            if (!open) {
              setShapefileDialogPath(null);
            }
          }}
        />
      ) : null}

      {watchMode.enabled && watchMode.directoryPath ? (
        <div className="flex-1 min-h-0">
          <NetworkProvider networkId={watchMode.directoryPath}>
            {hydrated ? (
              <HydratedWatchNetwork
                configMetadata={networkConfig}
                isEditorOpen={isEditorOpen}
                selectedQuery={selectedQuery}
                syncDirectory={watchMode.directoryPath}
                suspendPersistence={isApplyingExternalChange}
                viewMode={viewMode}
                onEditorOpenChange={handleEditorOpenChange}
                onEditNode={(nodeId) => {
                  navigate({
                    replace: true,
                    search: (prev) => ({
                      ...prev,
                      selected: nodeId,
                      [FLOW_EDITOR_QUERY_PARAM]: "1",
                    }),
                  });
                }}
                onOpenNodeInFinder={(nodeId) => {
                  if (!watchMode.directoryPath) return;
                  void revealPath(`${watchMode.directoryPath}/${nodeId}.toml`).catch((err) =>
                    console.error("[flow] Failed to reveal node file:", err),
                  );
                }}
                onSelectedQueryChange={handleSelectedQueryChange}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading network...
              </div>
            )}
          </NetworkProvider>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <FolderOpen className="h-16 w-16 mx-auto text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold">No Directory Selected</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Choose a directory containing TOML network files.
                <br />
                Canvas edits are automatically written back to the files.
              </p>
            </div>
            <Button onClick={handleSelectDirectory} size="lg" disabled={isBusy}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Select Directory
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HydratedWatchNetwork({
  configMetadata,
  isEditorOpen,
  selectedQuery,
  syncDirectory,
  suspendPersistence,
  viewMode,
  onEditorOpenChange,
  onEditNode,
  onOpenNodeInFinder,
  onSelectedQueryChange,
}: {
  configMetadata: NetworkConfigMetadata | null;
  isEditorOpen: boolean;
  selectedQuery?: string;
  syncDirectory: string;
  suspendPersistence: boolean;
  viewMode: NetworkViewMode;
  onEditorOpenChange: (open: boolean) => void;
  onEditNode?: (nodeId: string) => void;
  onOpenNodeInFinder?: (nodeId: string) => void;
  onSelectedQueryChange: (query: string | null) => void;
}) {
  const { data: nodesRaw = [] } = useLiveQuery(nodesCollection);
  const { data: edgesRaw = [] } = useLiveQuery(edgesCollection);
  const [addBlockBranchId, setAddBlockBranchId] = useState<string | null>(null);
  const selection = useMemo(
    () => resolveFlowSelection(selectedQuery, nodesRaw),
    [nodesRaw, selectedQuery],
  );
  const editableSelection = isEditableFlowSelection(selection) ? selection : undefined;
  const addBlockBranch = useMemo(() => {
    if (!addBlockBranchId) {
      return undefined;
    }

    const candidate = nodesRaw.find((node) => node.id === addBlockBranchId);
    return candidate && isBranchNode(candidate) ? candidate : undefined;
  }, [addBlockBranchId, nodesRaw]);

  useEffect(() => {
    if (addBlockBranchId && !addBlockBranch) {
      setAddBlockBranchId(null);
    }
  }, [addBlockBranch, addBlockBranchId]);

  const nodes = useMemo(() => {
    const selectedNodeId = getSelectedNodeIdFromQuery(selectedQuery);

    return sortNodesWithParentsFirst(nodesRaw).map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
    }));
  }, [nodesRaw, selectedQuery]);

  const edges = useMemo(
    () =>
      edgesRaw.map((edge) => ({
        ...edge,
        selected: false,
      })),
    [edgesRaw],
  );

  useEffect(() => {
    if (isEditorOpen && !editableSelection) {
      onEditorOpenChange(false);
    }
  }, [editableSelection, isEditorOpen, onEditorOpenChange]);

  useCommands(
    editableSelection
      ? [
          {
            id: "edit-selection",
            label: isEditorOpen ? "Close Selection Editor" : "Edit Selection",
            run: (dialog) => {
              dialog.close();
              onEditorOpenChange(!isEditorOpen);
            },
            group: "Selection",
            shortcut: EDIT_SELECTION_SHORTCUT,
          },
        ]
      : [],
  );

  const reloadPersistedNetwork = useCallback(async () => {
    const refreshedNetwork = await getNetworkFromPath(syncDirectory);
    await resetFlowToNetwork(refreshedNetwork);
    refreshGeoCollection(syncDirectory).catch((err) =>
      console.error("[watch] geo inspect failed:", err),
    );
  }, [syncDirectory]);

  const handleSaveSelection = useCallback(
    async (nextNode: FlowNode) => {
      const previousNodes = sortNodesWithParentsFirst(nodesRaw);
      const nextNodes = previousNodes.map((node) =>
        node.id === nextNode.id ? nextNode : node,
      );
      const activityEntries = diffNetworkSnapshots(
        createNetworkSnapshotFromFlow(previousNodes, edgesRaw),
        createNetworkSnapshotFromFlow(nextNodes, edgesRaw),
        {
          source: "details",
        },
      );

      writeNodesToCollection(nextNodes);
      await exportNetworkToToml(nextNodes, edgesRaw, syncDirectory);
      await reloadPersistedNetwork();
      appendActivityLogEntries(activityEntries);
    },
    [edgesRaw, nodesRaw, reloadPersistedNetwork, syncDirectory],
  );

  const handleDeleteSelection = useCallback(
    async (target: EditableFlowSelection) => {
      const previousNodes = sortNodesWithParentsFirst(nodesRaw);
      const previousEdges = edgesRaw;

      let nextNodes: FlowNode[] = previousNodes;
      let nextEdges: FlowEdge[] = previousEdges;
      let edgesChanged = false;

      if (target.kind === "block") {
        nextNodes = previousNodes.map((node) => {
          if (node.id !== target.node.id || !isBranchNode(node)) {
            return node;
          }
          return {
            ...node,
            data: {
              ...node.data,
              blocks: node.data.blocks.filter(
                (_, index) => index !== target.blockIndex,
              ),
            },
          };
        });
      } else if (target.kind === "branch") {
        nextNodes = previousNodes.filter((node) => node.id !== target.node.id);
        nextEdges = previousEdges.filter(
          (edge) =>
            edge.source !== target.node.id && edge.target !== target.node.id,
        );
        edgesChanged = nextEdges.length !== previousEdges.length;
      } else {
        nextNodes = previousNodes
          .filter((node) => node.id !== target.node.id)
          .map((node) =>
            node.parentId === target.node.id
              ? { ...node, parentId: undefined, extent: undefined }
              : node,
          );
      }

      const activityEntries = diffNetworkSnapshots(
        createNetworkSnapshotFromFlow(previousNodes, previousEdges),
        createNetworkSnapshotFromFlow(nextNodes, nextEdges),
        {
          source: "details",
        },
      );

      writeNodesToCollection(nextNodes);
      if (edgesChanged) {
        writeEdgesToCollection(nextEdges);
      }
      await exportNetworkToToml(nextNodes, nextEdges, syncDirectory);
      await reloadPersistedNetwork();
      appendActivityLogEntries(activityEntries);

      onSelectedQueryChange(target.kind === "block" ? target.node.id : null);
    },
    [
      edgesRaw,
      nodesRaw,
      onSelectedQueryChange,
      reloadPersistedNetwork,
      syncDirectory,
    ],
  );

  return (
    <div className="relative h-full w-full">
      {viewMode === "schematic" ? (
        <>
          <FlowNetwork
            nodes={nodes}
            edges={edges}
            onPropagationInputsChanged={reloadPersistedNetwork}
            syncDirectory={syncDirectory}
            suspendPersistence={suspendPersistence}
            selectedQuery={selectedQuery}
            onEditNode={onEditNode}
            onOpenNodeInFinder={onOpenNodeInFinder}
            onAddBlockToBranch={setAddBlockBranchId}
            onSelectedQueryChange={onSelectedQueryChange}
          />
          <SelectionEditorOverlay
            open={isEditorOpen}
            selection={editableSelection}
            configMetadata={configMetadata}
            onClose={() => onEditorOpenChange(false)}
            onSave={handleSaveSelection}
            onAddBlock={setAddBlockBranchId}
            onDelete={handleDeleteSelection}
          />
          <BlockCreatorDialog
            open={Boolean(addBlockBranch)}
            branch={addBlockBranch}
            onClose={() => setAddBlockBranchId(null)}
            onSave={handleSaveSelection}
          />
        </>
      ) : (
        <GeographicNetworkView syncDirectory={syncDirectory} />
      )}
    </div>
  );
}

function GeographicNetworkView({ syncDirectory }: { syncDirectory: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted/30 p-6">
      <div className="max-w-md rounded-lg border bg-background/95 p-6 text-center shadow-sm">
        <Map className="mx-auto mb-4 size-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Geographic view</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Map rendering is ready to be added here. This view will use geographic route
          data from KMZ or shapefile sources in {syncDirectory}.
        </p>
      </div>
    </div>
  );
}
