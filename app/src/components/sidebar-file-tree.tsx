import {
  prepareFileTreeInput,
  type ContextMenuOpenContext,
  type FileTreeDropResult,
  type FileTreePreparedInput,
  type FileTreeRenameEvent,
} from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { FilePlus2, FolderPlus } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  createDirectory,
  moveFileSystemEntry,
  onFileChanged,
  readFileTree,
  writeNetworkFile,
} from "@/lib/desktop";
import type { WorkspaceItemActions } from "@/lib/stores/workspace-sidebar";
import { useWorkspaceSidebar } from "@/lib/stores/workspace-sidebar";
import { cn } from "@/lib/utils";

const MAX_TREE_PATHS = 2_000;

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

type TreeContextMenuTarget = {
  absolutePath: string;
  canEdit: boolean;
  canRename: boolean;
  canView: boolean;
  isConfig: boolean;
  treePath: string;
};

type TreeSelectionModel = {
  getFocusedPath: () => string | null;
  getItem: (path: string) => {
    deselect: () => void;
    focus: () => void;
    isDirectory: () => boolean;
    select: () => void;
  } | null;
  getSelectedPaths: () => readonly string[];
  startRenaming: (path?: string) => boolean;
};

function joinTreePath(rootPath: string, treePath: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  const normalizedTreePath = treePath.replace(/[\\/]+$/, "");

  return normalizedTreePath
    ? `${normalizedRoot}/${normalizedTreePath}`
    : normalizedRoot;
}

function isBranchOrGroupFile(path: string): boolean {
  return /^(branch|group)-[^/]+\.toml$/i.test(path);
}

function isConfigFile(path: string): boolean {
  return path.toLowerCase() === "config.toml";
}

function getUniquePath(
  paths: string[],
  baseName: string,
  extension = "",
): string {
  const existingPaths = new Set(paths.map((path) => path.replace(/\/+$/, "")));
  const firstPath = `${baseName}${extension}`;
  if (!existingPaths.has(firstPath)) {
    return firstPath;
  }

  for (let index = 2; ; index += 1) {
    const nextPath = `${baseName}-${index}${extension}`;
    if (!existingPaths.has(nextPath)) {
      return nextPath;
    }
  }
}

function getParentTreePath(path: string): string {
  const normalizedPath = path.replace(/\/+$/, "");
  const lastSlash = normalizedPath.lastIndexOf("/");
  return lastSlash === -1 ? "" : `${normalizedPath.slice(0, lastSlash)}/`;
}

function getTreePathName(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/g, "");
  const lastSlash = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );

  return lastSlash === -1
    ? normalizedPath
    : normalizedPath.slice(lastSlash + 1);
}

function getDropDestinationTreePath(
  sourcePath: string,
  targetDirectoryPath: string | null,
): string {
  const directoryPath = targetDirectoryPath?.replace(/\/+$/, "") ?? "";
  const destinationName = getTreePathName(sourcePath);
  const destinationPath = directoryPath
    ? `${directoryPath}/${destinationName}`
    : destinationName;

  return sourcePath.endsWith("/") ? `${destinationPath}/` : destinationPath;
}

function getSelectedTargetDirectory(model: TreeSelectionModel): string {
  const selectedPath = model.getSelectedPaths()[0] ?? model.getFocusedPath();
  if (!selectedPath) {
    return "";
  }

  const item = model.getItem(selectedPath);
  return item?.isDirectory()
    ? `${selectedPath.replace(/\/+$/, "")}/`
    : getParentTreePath(selectedPath);
}

function selectTreePath(model: TreeSelectionModel, path: string): void {
  const item = model.getItem(path);
  if (!item) {
    return;
  }

  for (const selectedPath of model.getSelectedPaths()) {
    if (selectedPath !== path) {
      model.getItem(selectedPath)?.deselect();
    }
  }

  item.select();
  item.focus();
}

async function loadTreePaths(directoryPath: string): Promise<{
  paths: string[];
  preparedInput: FileTreePreparedInput;
  shapefileDirectories: string[];
  truncated: boolean;
}> {
  const { paths, shapefileDirectories, truncated } =
    await readFileTree(directoryPath);
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
  const directoryLabel = useWorkspaceSidebar((store) => store.directory?.label);
  const itemActions = useWorkspaceSidebar((store) => store.itemActions);
  const itemActionsRef = useRef<WorkspaceItemActions>({});
  const shapefileDirectorySetRef = useRef(new Set<string>());
  const { model } = useFileTree({
    paths: [],
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "both",
        buttonVisibility: "when-needed",
      },
    },
    density: "compact",
    flattenEmptyDirectories: true,
    icons: "standard",
    initialExpansion: "open",
    search: true,
    fileTreeSearchMode: "hide-non-matches",
    renderRowDecoration: ({ item }) =>
      shapefileDirectorySetRef.current.has(item.path)
        ? { text: "shp", title: "Shapefile" }
        : null,
    renaming: {
      canRename: (item) => item.path !== "config.toml",
      onError: (message) => {
        console.error("[sidebar] Failed to rename tree item:", message);
      },
      onRename: (event) => {
        void handleRename(event);
      },
    },
    dragAndDrop: {
      onDropComplete: (event) => {
        void handleDropComplete(event);
      },
      onDropError: (message) => {
        console.error("[sidebar] Failed to move tree item:", message);
      },
    },
  });
  const loadedPaths = state.status === "ready" ? state.paths.join("\n") : "";
  const currentPaths = state.status === "ready" ? state.paths : [];

  useEffect(() => {
    itemActionsRef.current = itemActions;
  }, [itemActions]);

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

    const handleWindowFocus = () => {
      void reload();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void reload();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      unlisten();
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [directoryPath, model]);

  const reloadTree = async () => {
    setState({ status: "loading" });
    const next = await loadTreePaths(directoryPath);
    shapefileDirectorySetRef.current = new Set(next.shapefileDirectories);
    model.resetPaths(next.paths, { preparedInput: next.preparedInput });
    setState({ status: "ready", ...next });
  };

  async function handleMoveFailure(message: string, err: unknown) {
    console.error(message, err);
    await reloadTree();
  }

  async function handleRename(event: FileTreeRenameEvent) {
    try {
      await moveFileSystemEntry(
        joinTreePath(directoryPath, event.sourcePath),
        joinTreePath(directoryPath, event.destinationPath),
      );
    } catch (err) {
      await handleMoveFailure("[sidebar] Failed to persist rename:", err);
    }
  }

  async function handleDropComplete(event: FileTreeDropResult) {
    try {
      for (const sourcePath of event.draggedPaths) {
        await moveFileSystemEntry(
          joinTreePath(directoryPath, sourcePath),
          joinTreePath(
            directoryPath,
            getDropDestinationTreePath(sourcePath, event.target.directoryPath),
          ),
        );
      }
    } catch (err) {
      await handleMoveFailure(
        "[sidebar] Failed to persist drag/drop move:",
        err,
      );
    }
  }

  const handleCreateFile = async () => {
    const targetDirectory = getSelectedTargetDirectory(model);
    const nextPath = getUniquePath(
      currentPaths,
      `${targetDirectory}untitled`,
      ".txt",
    );
    await writeNetworkFile(joinTreePath(directoryPath, nextPath), "");
    await reloadTree();
    model.focusPath(nextPath);
  };

  const handleCreateFolder = async () => {
    const targetDirectory = getSelectedTargetDirectory(model);
    const nextPath = getUniquePath(
      currentPaths,
      `${targetDirectory}untitled-folder`,
    );
    await createDirectory(joinTreePath(directoryPath, nextPath));
    await reloadTree();
    model.focusPath(`${nextPath}/`);
  };

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
        header={
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              {directoryLabel ?? "Files"}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-sm p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title="New file"
                onClick={() => void handleCreateFile()}
              >
                <FilePlus2 className="size-3.5" />
                <span className="sr-only">New file</span>
              </button>
              <button
                type="button"
                className="rounded-sm p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title="New folder"
                onClick={() => void handleCreateFolder()}
              >
                <FolderPlus className="size-3.5" />
                <span className="sr-only">New folder</span>
              </button>
            </div>
          </div>
        }
        model={model}
        renderContextMenu={(item, context) => {
          const treePath = item.path;
          const isShapefileDirectory =
            shapefileDirectorySetRef.current.has(treePath);
          const canEdit = isBranchOrGroupFile(treePath) || isShapefileDirectory;
          const canView = isBranchOrGroupFile(treePath);

          return (
            <SidebarFileTreeContextMenu
              actions={itemActionsRef.current}
              context={context}
              model={model}
              target={{
                absolutePath: joinTreePath(directoryPath, treePath),
                canEdit,
                canRename: !isConfigFile(treePath),
                canView,
                isConfig: isConfigFile(treePath),
                treePath,
              }}
            />
          );
        }}
        className="min-h-0 flex-1 text-sm"
        style={
          {
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
            "--trees-padding-inline-override": "0rem",
            "--trees-context-menu-trigger-inline-offset":
              "calc(var(--trees-padding-inline) + var(--trees-item-padding-x) + 0.5rem)",
            "--trees-theme-git-added-fg": "var(--rose-pine-foam)",
            "--trees-theme-git-modified-fg": "var(--rose-pine-rose)",
            "--trees-theme-git-renamed-fg": "var(--rose-pine-pine)",
            "--trees-theme-git-deleted-fg": "var(--rose-pine-love)",
          } as CSSProperties
        }
      />
      {state.status === "ready" && state.truncated ? (
        <div className="border-t border-sidebar-border px-2 py-2 text-xs text-sidebar-foreground/60">
          Showing first {MAX_TREE_PATHS.toLocaleString()} paths.
        </div>
      ) : null}
    </div>
  );
}

function SidebarFileTreeContextMenu({
  actions,
  context,
  model,
  target,
}: {
  actions: WorkspaceItemActions;
  context: ContextMenuOpenContext;
  model: TreeSelectionModel;
  target: TreeContextMenuTarget;
}) {
  const { anchorRect } = context;
  const closeAndRun = (run: (() => void) | undefined) => {
    context.close();
    run?.();
  };

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      data-file-tree-context-menu-root="true"
      className="fixed z-50 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      style={{
        left: anchorRect.right + 4,
        top: anchorRect.top,
      }}
    >
      <FileTreeContextMenuButton
        disabled={!target.canView || !actions.viewPath}
        onClick={() =>
          closeAndRun(() => {
            selectTreePath(model, target.treePath);
            actions.viewPath?.(target.treePath);
          })
        }
      >
        View
      </FileTreeContextMenuButton>
      <FileTreeContextMenuButton
        disabled={!target.canRename}
        onClick={() =>
          closeAndRun(() => {
            selectTreePath(model, target.treePath);
            model.startRenaming(target.treePath);
          })
        }
      >
        Rename
      </FileTreeContextMenuButton>
      <FileTreeContextMenuButton
        disabled={target.isConfig || !target.canEdit || !actions.editPath}
        onClick={() => closeAndRun(() => actions.editPath?.(target.treePath))}
      >
        Edit
      </FileTreeContextMenuButton>
      <div className="-mx-1 my-1 h-px bg-border" />
      <FileTreeContextMenuButton
        disabled={!actions.openInFinder}
        onClick={() =>
          closeAndRun(() => actions.openInFinder?.(target.absolutePath))
        }
      >
        Open in Finder
      </FileTreeContextMenuButton>
    </div>,
    document.body,
  );
}

function FileTreeContextMenuButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
      )}
    >
      {children}
    </button>
  );
}
