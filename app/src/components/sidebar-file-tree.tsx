import { prepareFileTreeInput, type FileTreePreparedInput } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { browseDirectory, onFileChanged } from "@/lib/desktop";

const MAX_TREE_PATHS = 2000;

type SidebarFileTreeProps = {
  directoryPath: string;
};

type LoadState =
  | { status: "idle" | "loading" }
  | {
      status: "ready";
      paths: string[];
      preparedInput: FileTreePreparedInput;
      shapefileDirectories: string[];
      truncated: boolean;
    }
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

function getDirectoryPath(path: string): string {
  const normalizedPath = path.replace(/\/+$/, "");
  const slashIndex = normalizedPath.lastIndexOf("/");

  return slashIndex === -1 ? "" : `${normalizedPath.slice(0, slashIndex)}/`;
}

function isShapefileMainPath(path: string): boolean {
  return path.toLowerCase().endsWith(".shp");
}

async function loadTreePaths(rootPath: string): Promise<{
  paths: string[];
  preparedInput: FileTreePreparedInput;
  shapefileDirectories: string[];
  truncated: boolean;
}> {
  const paths: string[] = [];
  const shapefileDirectories = new Set<string>();
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
        const relativePath = toRelativePath(rootPath, entry.path);
        paths.push(relativePath);

        if (isShapefileMainPath(relativePath)) {
          shapefileDirectories.add(getDirectoryPath(relativePath));
        }
      }
    }
  }

  return {
    paths,
    preparedInput: prepareFileTreeInput(paths, {
      flattenEmptyDirectories: true,
      sort: "default",
    }),
    shapefileDirectories: [...shapefileDirectories],
    truncated,
  };
}

export function SidebarFileTree({ directoryPath }: SidebarFileTreeProps) {
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const shapefileDirectorySetRef = useRef(new Set<string>());
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    flattenEmptyDirectories: true,
    icons: "standard",
    initialExpansion: "open",
    renderRowDecoration: ({ item }) =>
      shapefileDirectorySetRef.current.has(item.path)
        ? { text: "shp", title: "Shapefile" }
        : null,
  });
  const loadedPaths = state.status === "ready" ? state.paths.join("\n") : "";

  useEffect(() => {
    let cancelled = false;

    async function reload() {
      setState({ status: "loading" });
      try {
        const next = await loadTreePaths(directoryPath);
        if (cancelled) return;
        shapefileDirectorySetRef.current = new Set(next.shapefileDirectories);
        model.resetPaths(next.paths, { preparedInput: next.preparedInput });
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
          backgroundColor: "var(--sidebar)",
          color: "var(--sidebar-foreground)",
          borderColor: "var(--sidebar-border)",
          "--trees-theme-sidebar-bg": "var(--sidebar)",
          "--trees-theme-sidebar-fg": "var(--sidebar-foreground)",
          "--trees-theme-sidebar-header-fg": "var(--muted-foreground)",
          "--trees-theme-sidebar-border": "var(--sidebar-border)",
          "--trees-theme-list-hover-bg":
            "color-mix(in oklab, var(--sidebar-accent) 70%, transparent)",
          "--trees-theme-list-active-selection-bg": "var(--sidebar-accent)",
          "--trees-theme-list-active-selection-fg":
            "var(--sidebar-accent-foreground)",
          "--trees-theme-focus-ring": "var(--sidebar-ring)",
          "--trees-theme-input-bg": "var(--background)",
          "--trees-theme-input-border": "var(--border)",
          "--trees-theme-scrollbar-thumb": "var(--muted-foreground)",
          "--trees-file-icon-color": "var(--muted-foreground)",
          "--trees-theme-git-added-fg": "var(--rose-pine-foam)",
          "--trees-theme-git-modified-fg": "var(--rose-pine-rose)",
          "--trees-theme-git-renamed-fg": "var(--rose-pine-pine)",
          "--trees-theme-git-deleted-fg": "var(--rose-pine-love)",
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
