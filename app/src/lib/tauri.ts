import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type NetworkFile = {
  path: string;
  content: string;
};

/** Open a native directory picker and return the selected path (or null). */
export async function pickNetworkDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Select Network Directory",
  });
  return Array.isArray(selected) ? selected[0] : selected;
}

/** Read all TOML files from a directory. */
export async function readNetworkDirectory(
  path: string
): Promise<NetworkFile[]> {
  return invoke<NetworkFile[]>("read_network_directory", { path });
}

/**
 * Write a TOML file. Marks the path as a self-write in the file watcher so
 * the resulting file-system event is suppressed (no echo reload).
 */
export async function writeNetworkFile(
  path: string,
  content: string
): Promise<void> {
  return invoke<void>("write_network_file", { path, content });
}

/** Delete a TOML file from a network directory. */
export async function deleteNetworkFile(path: string): Promise<void> {
  return invoke<void>("delete_network_file", { path });
}

/** Start watching a directory for external TOML changes. */
export async function startWatchingDirectory(path: string): Promise<void> {
  return invoke<void>("start_watching_directory", { path });
}

/** Stop watching the current directory. */
export async function stopWatchingDirectory(): Promise<void> {
  return invoke<void>("stop_watching_directory");
}
