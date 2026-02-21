import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { startWatchingDirectory, stopWatchingDirectory } from "@/lib/tauri";
import { getNetworkFromPath } from "@/lib/api-client";
import { resetFlowToNetwork } from "@/lib/collections/flow";

export type WatchModeState = {
  enabled: boolean;
  directoryPath: string | null;
  isWatching: boolean;
};

/**
 * Manages file-system watch mode for a directory of TOML network files.
 *
 * When enabled:
 * - Starts a Tauri directory watcher (Rust notify crate).
 * - Listens for `file-changed` events (external edits only; self-writes are
 *   suppressed by the Rust self-write guard).
 * - Reloads the flow collections from the Hono server on each external change.
 *
 * Canvas edits are written back to TOML files via `exportNetworkToToml` (called
 * from FlowNetwork's debounced change handler) — not from this hook.
 */
export function useFileWatcher() {
  const [watchMode, setWatchMode] = useState<WatchModeState>({
    enabled: false,
    directoryPath: null,
    isWatching: false,
  });

  // Listen for external file-change events from the Rust watcher.
  useEffect(() => {
    if (!watchMode.enabled || !watchMode.directoryPath) return;

    const unlistenPromise = listen<string[]>("file-changed", async (event) => {
      const changedPaths = event.payload;
      console.log("[watch] External file change:", changedPaths);

      try {
        const network = await getNetworkFromPath(watchMode.directoryPath!);
        await resetFlowToNetwork(network);
        console.log("[watch] Network reloaded from external file change");
      } catch (error) {
        console.error("[watch] Error reloading network:", error);
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
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
