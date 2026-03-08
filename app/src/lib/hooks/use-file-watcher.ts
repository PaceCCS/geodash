import { useEffect, useState, useCallback } from "react";
import {
  onFileChanged,
  startWatchingDirectory,
  stopWatchingDirectory,
} from "@/lib/desktop";
import { getNetworkFromPath } from "@/lib/api-client";
import { resetFlowToNetwork } from "@/lib/collections/flow";

export type WatchModeState = {
  enabled: boolean;
  directoryPath: string | null;
  isWatching: boolean;
};

export function useFileWatcher() {
  const [watchMode, setWatchMode] = useState<WatchModeState>({
    enabled: false,
    directoryPath: null,
    isWatching: false,
  });

  useEffect(() => {
    if (!watchMode.enabled || !watchMode.directoryPath) return;

    const unlisten = onFileChanged(async (changedPaths) => {
      console.log("[watch] External file change:", changedPaths);

      try {
        const network = await getNetworkFromPath(watchMode.directoryPath!);
        await resetFlowToNetwork(network);
        console.log("[watch] Network reloaded from external file change");
      } catch (error) {
        console.error("[watch] Error reloading network:", error);
      }
    });

    return unlisten;
  }, [watchMode.enabled, watchMode.directoryPath]);

  const enableWatchMode = useCallback(async (directoryPath: string) => {
    await startWatchingDirectory(directoryPath);
    const network = await getNetworkFromPath(directoryPath);
    await resetFlowToNetwork(network);
    setWatchMode({ enabled: true, directoryPath, isWatching: true });
  }, []);

  const disableWatchMode = useCallback(async () => {
    await stopWatchingDirectory();
    setWatchMode({ enabled: false, directoryPath: null, isWatching: false });
  }, []);

  return { watchMode, enableWatchMode, disableWatchMode };
}
