import { useEffect, useState, useCallback, useRef } from "react";
import {
  onFileChanged,
  startWatchingDirectory,
  stopWatchingDirectory,
} from "@/lib/desktop";
import { getNetworkFromPath } from "@/lib/api-client";
import {
  clearFlowCollections,
  getNetworkSourceFromCollections,
  resetFlowToNetwork,
} from "@/lib/collections/flow";
import {
  appendActivityLogEntries,
  clearActivityLog,
} from "@/contexts/activity-log-context";
import {
  createNetworkSnapshotFromResponse,
  diffNetworkSnapshots,
} from "@/lib/network-activity";

export type WatchModeState = {
  enabled: boolean;
  directoryPath: string | null;
  isWatching: boolean;
};

const WATCH_RELOAD_DEBOUNCE_MS = 150;

function getWatchNetworkLabel(label: string | null | undefined): string | null {
  const trimmed = label?.trim();
  return trimmed ? trimmed : null;
}

export function useFileWatcher() {
  const [watchMode, setWatchMode] = useState<WatchModeState>({
    enabled: false,
    directoryPath: null,
    isWatching: false,
  });
  const [networkLabel, setNetworkLabel] = useState<string | null>(null);
  const [isApplyingExternalChange, setIsApplyingExternalChange] = useState(false);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const reloadSequenceRef = useRef(0);
  const watchModeRef = useRef<WatchModeState>({
    enabled: false,
    directoryPath: null,
    isWatching: false,
  });

  useEffect(() => {
    watchModeRef.current = watchMode;
  }, [watchMode]);

  const reloadNetwork = useCallback(
    async (
      directoryPath: string,
      {
        retriesRemaining = 1,
        source = "manual",
      }: {
        retriesRemaining?: number;
        source?: "manual" | "external";
      } = {},
    ): Promise<string | null> => {
      const reloadId = ++reloadSequenceRef.current;

      try {
        const previousNetwork =
          source === "external"
            ? (await getNetworkSourceFromCollections().catch(() => null))?.network
            : null;
        const network = await getNetworkFromPath(directoryPath);
        if (reloadId !== reloadSequenceRef.current) {
          return null;
        }

        await resetFlowToNetwork(network);
        const networkLabel = getWatchNetworkLabel(network.label);
        setNetworkLabel(networkLabel);
        console.log("[watch] Network reloaded from disk");

        if (source === "external") {
          const diffEntries = previousNetwork
            ? diffNetworkSnapshots(
                createNetworkSnapshotFromResponse(previousNetwork),
                createNetworkSnapshotFromResponse(network),
                {
                  source: "filesystem",
                },
              )
            : [];

          if (diffEntries.length > 0) {
            appendActivityLogEntries(diffEntries);
          }
        }

        if (source === "external") {
          setIsApplyingExternalChange(false);
        }

        return networkLabel;
      } catch (error) {
        if (reloadId !== reloadSequenceRef.current) {
          return null;
        }

        if (retriesRemaining > 0) {
          clearTimeout(reloadTimerRef.current);
          reloadTimerRef.current = setTimeout(() => {
            void reloadNetwork(directoryPath, {
              retriesRemaining: retriesRemaining - 1,
              source,
            });
          }, WATCH_RELOAD_DEBOUNCE_MS);
          return null;
        }

        if (source === "external") {
          setIsApplyingExternalChange(false);
        }
        console.error("[watch] Error reloading network:", error);
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!watchMode.enabled || !watchMode.directoryPath) return;

    const scheduleReload = (directoryPath: string) => {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        void reloadNetwork(directoryPath, {
          source: "external",
        });
      }, WATCH_RELOAD_DEBOUNCE_MS);
    };

    const unlisten = onFileChanged((changedPaths) => {
      console.log("[watch] External file change:", changedPaths);
      setIsApplyingExternalChange(true);
      scheduleReload(watchMode.directoryPath!);
    });

    return () => {
      clearTimeout(reloadTimerRef.current);
      unlisten();
    };
  }, [watchMode.enabled, watchMode.directoryPath, reloadNetwork]);

  const teardownWatchMode = useCallback(
    async ({ resetState }: { resetState: boolean }) => {
      clearTimeout(reloadTimerRef.current);
      reloadSequenceRef.current += 1;
      clearActivityLog();
      await stopWatchingDirectory();
      await clearFlowCollections();

      if (resetState) {
        setIsApplyingExternalChange(false);
        setWatchMode({
          enabled: false,
          directoryPath: null,
          isWatching: false,
        });
        setNetworkLabel(null);
      }
    },
    [],
  );

  const enableWatchMode = useCallback(async (directoryPath: string) => {
    clearActivityLog();
    await startWatchingDirectory(directoryPath);
    const networkLabel = await reloadNetwork(directoryPath, { retriesRemaining: 0 });
    setNetworkLabel(networkLabel);
    setWatchMode({ enabled: true, directoryPath, isWatching: true });
  }, [reloadNetwork]);

  const disableWatchMode = useCallback(async () => {
    await teardownWatchMode({ resetState: true });
  }, [teardownWatchMode]);

  useEffect(() => {
    return () => {
      if (watchModeRef.current.enabled) {
        void teardownWatchMode({ resetState: false });
      } else {
        clearActivityLog();
      }
    };
  }, [teardownWatchMode]);

  return {
    watchMode,
    networkLabel,
    isApplyingExternalChange,
    enableWatchMode,
    disableWatchMode,
  };
}
