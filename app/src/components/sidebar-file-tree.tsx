import { FileTree, useFileTree } from "@pierre/trees/react";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { browseDirectory, onFileChanged } from "@/lib/desktop";

const MAX_TREE_PATHS = 2000;

type SidebarFileTreeProps = {
  directoryPath: string;
};

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "ready"; paths: string[]; truncated: boolean }
  | { status: "error"; message: string };

function getPathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function toRelativePath(rootPath: string, entryPath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  const relative = entryPath.startsWith(`${normalizedRoot}/`)
    ? entryPath.slice(normalizedRoot.length + 1)
    : getPathName(entryPath);

  return relative.replace(/\\/g, "/");
}

function toDirectoryPath(rootPath: string, entryPath: string): string {
  return `${toRelativePath(rootPath, entryPath).replace(/\/+$/, "")}/`;
}

async function loadTreePaths(rootPath: string): Promise<{
  paths: string[];
  truncated: boolean;
}> {
  const paths: string[] = [];
  const pending = [rootPath];
  let truncated = false;

  while (pending.length > 0) {
    const directory = pending.shift();
    if (!directory) continue;

    const result = await browseDirectory(directory, "file");
    for (const entry of result.entries) {
      if (paths.length >= MAX_TREE_PATHS) {
        truncated = true;
        pending.length = 0;
        break;
      }

      if (entry.type === "directory") {
        paths.push(toDirectoryPath(rootPath, entry.path));
        pending.push(entry.path);
      } else {
        paths.push(toRelativePath(rootPath, entry.path));
      }
    }
  }

  return { paths, truncated };
}

export function SidebarFileTree({ directoryPath }: SidebarFileTreeProps) {
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    flattenEmptyDirectories: true,
    icons: "standard",
    initialExpansion: "open",
  });
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const loadedPaths = state.status === "ready" ? state.paths.join("\n") : "";

  useEffect(() => {
    let cancelled = false;

    async function reload() {
      setState({ status: "loading" });
      try {
        const next = await loadTreePaths(directoryPath);
        if (cancelled) return;
        model.resetPaths(next.paths);
        setState({ status: "ready", ...next });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    void reload();
    const unlisten = onFileChanged((changedPaths) => {
      const normalizedRoot = directoryPath.replace(/[\\/]+$/, "");
      if (changedPaths.some((path) => path.startsWith(normalizedRoot))) {
        void reload();
      }
    });

    return () => {
      cancelled = true;
      unlisten();
    };
  }, [directoryPath, model]);

  if (state.status === "error") {
    return (
      <div className="px-2 py-3 text-xs text-destructive group-data-[collapsible=icon]:hidden">
        {state.message}
      </div>
    );
  }

  return (
    <div
      data-testid="sidebar-file-tree"
      data-loaded-paths={loadedPaths}
      className="flex h-full min-h-0 flex-1 flex-col group-data-[collapsible=icon]:hidden"
    >
      {state.status === "loading" ? (
        <div className="px-2 py-2 text-xs text-sidebar-foreground/60">
          Loading files...
        </div>
      ) : null}
      {state.status === "ready" && state.paths.length === 0 ? (
        <div className="px-2 py-3 text-xs text-sidebar-foreground/60">
          This directory is empty.
        </div>
      ) : null}
      <FileTree
        model={model}
        className="min-h-0 flex-1 text-sm"
        style={{
          height: "100%",
          "--trees-background-override": "var(--sidebar)",
          "--trees-foreground-override": "var(--sidebar-foreground)",
        } as CSSProperties}
      />
      {state.status === "ready" && state.truncated ? (
        <div className="border-t border-sidebar-border px-2 py-2 text-xs text-sidebar-foreground/60">
          Showing first {MAX_TREE_PATHS.toLocaleString()} paths.
        </div>
      ) : null}
    </div>
  );
}
