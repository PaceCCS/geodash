import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { FolderOpen, EyeOff, Save } from "lucide-react";

import { SelectionEditorOverlay } from "@/components/flow/editor/selection-editor-overlay";
import { DirectoryBrowserDialog } from "@/components/directory-browser-dialog";
import { FlowNetwork } from "@/components/flow/flow-network";
import {
  nodesCollection,
  edgesCollection,
  resetFlowToNetwork,
  sortNodesWithParentsFirst,
  writeNodesToCollection,
} from "@/lib/collections/flow";
import { refreshGeoCollection } from "@/lib/collections/geo";
import { useFileWatcher } from "@/lib/hooks/use-file-watcher";
import { pickNetworkDirectory } from "@/lib/desktop";
import { NetworkProvider } from "@/contexts/network-context";
import { Button } from "@/components/ui/button";
import { appendActivityLogEntries } from "@/contexts/activity-log-context";
import { HeaderSlot } from "@/components/header-slot";
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
import type { FlowNode } from "@/lib/collections/flow-nodes";
import { createNetworkSnapshotFromFlow, diffNetworkSnapshots } from "@/lib/network-activity";
import {
  getNetworkFromPath,
  type NetworkConfigMetadata,
} from "@/lib/api-client";
import { isEditableFlowSelection } from "@/lib/selection-editor";

type WatchSearch = {
  selected?: string;
  edit?: "1";
};

export const Route = createFileRoute("/network/watch")({
  validateSearch: (search): WatchSearch => ({
    [FLOW_SELECTION_QUERY_PARAM]: normalizeFlowSelectionQuery(
      search[FLOW_SELECTION_QUERY_PARAM],
    ),
    [FLOW_EDITOR_QUERY_PARAM]: normalizeFlowEditorQuery(
      search[FLOW_EDITOR_QUERY_PARAM],
    ),
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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const selectedQuery = search.selected;
  const isEditorOpen = search.edit === "1";
  const displayDirectoryPath = watchMode.directoryPath?.replace(/^\/+/, "") ?? null;

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

  const openDirectory = async (path: string) => {
    setIsBusy(true);
    try {
      await enableWatchMode(path);
    } catch (err) {
      console.error("[watch] Failed to enable watch mode:", err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSelectDirectory = () => {
    setIsDirectoryBrowserOpen(true);
  };

  const handleNativeSelectDirectory = async () => {
    const path = await pickNetworkDirectory();
    if (path) await openDirectory(path);
  };

  const handleStopWatching = async () => {
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
  };

  useCommands(
    watchMode.enabled
      ? [
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
          <div className="flex items-center justify-between w-full px-2 gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {networkLabel ? (
                <>
                  <span className="max-w-64 shrink-0 truncate text-sm font-medium">
                    {networkLabel}
                  </span>
                  <span className="text-xs text-muted-foreground">/</span>
                </>
              ) : null}
              <span className="text-sm truncate text-muted-foreground">
                {displayDirectoryPath}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground mr-2">
                <Save className="inline w-3 h-3 mr-1" />
                Auto-saving
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopWatching}
                disabled={isBusy}
              >
                <EyeOff className="mr-1 h-3 w-3" />
                Stop Watching
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between w-full px-2">
            <span className="text-sm font-medium">Watch Network Directory</span>
            <Button size="sm" onClick={handleSelectDirectory} disabled={isBusy}>
              <FolderOpen className="mr-1 h-3 w-3" />
              Select Directory
            </Button>
          </div>
        )}
      </HeaderSlot>

      <DirectoryBrowserDialog
        open={isDirectoryBrowserOpen}
        title="Select Network Directory"
        description="Browse to the folder containing your TOML network files. Large folders are rejected before watching starts."
        initialPath={watchMode.directoryPath}
        confirmLabel="Watch Directory"
        onOpenChange={setIsDirectoryBrowserOpen}
        onSelect={openDirectory}
        onNativePick={handleNativeSelectDirectory}
      />

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
                onEditorOpenChange={handleEditorOpenChange}
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
  onEditorOpenChange,
  onSelectedQueryChange,
}: {
  configMetadata: NetworkConfigMetadata | null;
  isEditorOpen: boolean;
  selectedQuery?: string;
  syncDirectory: string;
  suspendPersistence: boolean;
  onEditorOpenChange: (open: boolean) => void;
  onSelectedQueryChange: (query: string | null) => void;
}) {
  const { data: nodesRaw = [] } = useLiveQuery(nodesCollection);
  const { data: edgesRaw = [] } = useLiveQuery(edgesCollection);
  const selection = useMemo(
    () => resolveFlowSelection(selectedQuery, nodesRaw),
    [nodesRaw, selectedQuery],
  );
  const editableSelection = isEditableFlowSelection(selection) ? selection : undefined;

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

  return (
    <div className="relative h-full w-full">
      <FlowNetwork
        nodes={nodes}
        edges={edges}
        onPropagationInputsChanged={reloadPersistedNetwork}
        syncDirectory={syncDirectory}
        suspendPersistence={suspendPersistence}
        selectedQuery={selectedQuery}
        onSelectedQueryChange={onSelectedQueryChange}
      />
      <SelectionEditorOverlay
        open={isEditorOpen}
        selection={editableSelection}
        configMetadata={configMetadata}
        onClose={() => onEditorOpenChange(false)}
        onSave={handleSaveSelection}
      />
    </div>
  );
}
