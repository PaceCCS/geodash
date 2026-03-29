import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo, useState } from "react";
import { FolderOpen, EyeOff, Save } from "lucide-react";

import { FlowNetwork } from "@/components/flow/flow-network";
import {
  nodesCollection,
  edgesCollection,
  sortNodesWithParentsFirst,
} from "@/lib/collections/flow";
import { useFileWatcher } from "@/lib/hooks/use-file-watcher";
import { pickNetworkDirectory } from "@/lib/desktop";
import { NetworkProvider } from "@/contexts/network-context";
import { Button } from "@/components/ui/button";
import { HeaderSlot } from "@/components/header-slot";

export const Route = createFileRoute("/network/watch")({
  component: WatchPage,
});

function WatchPage() {
  const { watchMode, enableWatchMode, disableWatchMode } = useFileWatcher();
  const [isBusy, setIsBusy] = useState(false);

  const { data: nodesRaw = [] } = useLiveQuery(nodesCollection);
  const { data: edges = [] } = useLiveQuery(edgesCollection);

  // ReactFlow requires parents before children.
  const nodes = useMemo(
    () => sortNodesWithParentsFirst(nodesRaw),
    [nodesRaw]
  );

  const handleSelectDirectory = async () => {
    const path = await pickNetworkDirectory();
    if (!path) return;
    setIsBusy(true);
    try {
      await enableWatchMode(path);
    } catch (err) {
      console.error("[watch] Failed to enable watch mode:", err);
    } finally {
      setIsBusy(false);
    }
  };

  const handleStopWatching = async () => {
    setIsBusy(true);
    try {
      await disableWatchMode();
    } catch (err) {
      console.error("[watch] Failed to disable watch mode:", err);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full min-h-0">
      <HeaderSlot>
        {watchMode.enabled ? (
          <div className="flex items-center justify-between w-full px-2">
            <span className="text-sm truncate max-w-[60%] text-muted-foreground">
              {watchMode.directoryPath}
            </span>
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
            <Button
              size="sm"
              onClick={handleSelectDirectory}
              disabled={isBusy}
            >
              <FolderOpen className="mr-1 h-3 w-3" />
              Select Directory
            </Button>
          </div>
        )}
      </HeaderSlot>

      {watchMode.enabled && watchMode.directoryPath ? (
        <div className="flex-1 min-h-0">
          <NetworkProvider networkId={watchMode.directoryPath}>
            <FlowNetwork
              nodes={nodes}
              edges={edges}
              syncDirectory={watchMode.directoryPath}
            />
          </NetworkProvider>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <FolderOpen className="h-16 w-16 mx-auto text-brand-grey-2" />
            <div>
              <h2 className="text-xl font-semibold">No Directory Selected</h2>
              <p className="text-sm text-brand-grey-2 mt-2">
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
