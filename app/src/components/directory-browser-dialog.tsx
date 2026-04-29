import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Folder, FolderOpen, File } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/hooks/use-app-settings";
import {
  browseDirectory,
  createDirectory,
  pickFileSystemPath,
  type BrowseMode,
  type FileSystemBrowseResult,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";

const PATH_SEPARATOR = "/";

export type FileSystemBrowserDialogProps = {
  open: boolean;
  mode?: BrowseMode;
  title: string;
  description: string;
  confirmLabel?: string;
  allowCreate?: boolean;
  createTitle?: string;
  createLabel?: string;
  nativePickerLabel?: string;
  openInFileManagerLabel?: string;
  initialPath?: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void | Promise<void>;
  onCreate?: (path: string) => void | Promise<void>;
  onNativePick?: () => void | string | null | Promise<void | string | null>;
};

export type DirectoryBrowserDialogProps = Omit<
  FileSystemBrowserDialogProps,
  "mode"
>;

export type FileBrowserDialogProps = Omit<
  FileSystemBrowserDialogProps,
  "mode" | "allowCreate" | "onCreate" | "createTitle" | "createLabel"
>;

type BrowserEntry = FileSystemBrowseResult["entries"][number];

function hasTrailingPathSeparator(path: string): boolean {
  return path.endsWith("/") || path.endsWith("\\");
}

function ensureTrailingPathSeparator(path: string): string {
  return hasTrailingPathSeparator(path) ? path : `${path}${PATH_SEPARATOR}`;
}

function splitBrowseQuery(query: string): {
  directoryQuery?: string;
  filter: string;
} {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return { directoryQuery: undefined, filter: "" };
  }

  if (hasTrailingPathSeparator(trimmedQuery)) {
    return { directoryQuery: trimmedQuery, filter: "" };
  }

  const slashIndex = Math.max(
    trimmedQuery.lastIndexOf("/"),
    trimmedQuery.lastIndexOf("\\"),
  );

  if (slashIndex === -1) {
    return { directoryQuery: undefined, filter: trimmedQuery };
  }

  return {
    directoryQuery: trimmedQuery.slice(0, slashIndex + 1),
    filter: trimmedQuery.slice(slashIndex + 1),
  };
}

function getPersistedPreferredDirectory(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const stored = window.localStorage.getItem("app-settings");
    if (!stored) {
      return "";
    }

    const parsed = JSON.parse(stored) as {
      state?: {
        preferredDirectory?: unknown;
      };
    };
    return typeof parsed.state?.preferredDirectory === "string"
      ? parsed.state.preferredDirectory
      : "";
  } catch {
    return "";
  }
}

export function DirectoryBrowserDialog({
  mode = "directory",
  ...props
}: DirectoryBrowserDialogProps & { mode?: BrowseMode }) {
  return <FileSystemBrowserDialog mode={mode} {...props} />;
}

export function FileBrowserDialog(props: FileBrowserDialogProps) {
  return <FileSystemBrowserDialog mode="file" {...props} />;
}

function FileSystemBrowserDialog({
  open,
  mode = "directory",
  title,
  description,
  confirmLabel = "Use Directory",
  allowCreate = false,
  createTitle = "Create a new directory?",
  createLabel = "Create Folder",
  nativePickerLabel = "Native Picker",
  openInFileManagerLabel = "Choose with Finder",
  initialPath,
  onOpenChange,
  onSelect,
  onCreate,
  onNativePick,
}: FileSystemBrowserDialogProps) {
  const preferredDirectory = useAppSettings((state) => state.preferredDirectory);
  const recordDirectorySelection = useAppSettings(
    (state) => state.recordDirectorySelection,
  );
  const startPath = initialPath || preferredDirectory || getPersistedPreferredDirectory();
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [result, setResult] = useState<FileSystemBrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingPath, setMissingPath] = useState<string | null>(null);
  const requestedDirectoryRef = useRef<string | undefined>(undefined);

  const { directoryQuery, filter } = useMemo(
    () => splitBrowseQuery(query),
    [query],
  );
  const visibleEntries = useMemo(() => {
    const entries = result?.entries ?? [];
    const normalizedFilter = filter.trim().toLowerCase();
    if (!normalizedFilter) return entries;
    return entries.filter((entry) =>
      entry.name.toLowerCase().includes(normalizedFilter),
    );
  }, [filter, result]);
  const selectedEntry = visibleEntries[highlightedIndex] ?? null;
  const selectedPath = mode === "file" ? selectedEntry?.path : result?.path;
  const canSelect = Boolean(selectedPath) && !isLoading && !missingPath;
  const canCreate = allowCreate && Boolean(missingPath) && !isLoading;

  const loadDirectory = useCallback(
    async (path?: string, updateQuery = true) => {
      if (!path) {
        requestedDirectoryRef.current = undefined;
        setResult(null);
        setIsLoading(false);
        return;
      }

      requestedDirectoryRef.current = path
        ? ensureTrailingPathSeparator(path)
        : undefined;
      setIsLoading(true);
      setError(null);
      setMissingPath(null);
      try {
        const nextResult = await browseDirectory(path, mode);
        setResult(nextResult);
        if (updateQuery || !path) {
          setQuery(ensureTrailingPathSeparator(nextResult.path));
        }
        setHighlightedIndex(0);
      } catch (err) {
        setMissingPath(allowCreate ? (path ?? null) : null);
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("ENOENT")) {
          setError(message);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [allowCreate, mode],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResult(null);
      setError(null);
      setMissingPath(null);
      requestedDirectoryRef.current = undefined;
      return;
    }

    if (!startPath) return;

    const nextQuery = ensureTrailingPathSeparator(startPath);
    setQuery(nextQuery);
    void loadDirectory(startPath, false);
  }, [loadDirectory, open, startPath]);

  useEffect(() => {
    if (!open || directoryQuery === requestedDirectoryRef.current) return;
    if (!startPath && !directoryQuery) return;
    void loadDirectory(directoryQuery, false);
  }, [directoryQuery, loadDirectory, open, startPath]);

  useEffect(() => {
    setHighlightedIndex((current) =>
      Math.min(current, Math.max(visibleEntries.length - 1, 0)),
    );
  }, [visibleEntries.length]);

  const handleSelectPath = async (path: string) => {
    if (mode === "directory") {
      recordDirectorySelection(path);
    }
    await onSelect(path);
    onOpenChange(false);
  };

  const handleSubmit = async () => {
    if (!canSelect) return;
    setError(null);
    try {
      if (!selectedPath) return;
      await handleSelectPath(selectedPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCreateDirectory = async () => {
    if (!missingPath) return;
    setIsLoading(true);
    setError(null);
    try {
      const nextResult = await createDirectory(missingPath);
      setResult(nextResult);
      setQuery(ensureTrailingPathSeparator(nextResult.path));
      setMissingPath(null);
      setHighlightedIndex(0);
      await onCreate?.(nextResult.path);
      recordDirectorySelection(nextResult.path);
      await onSelect(nextResult.path);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelCreateDirectory = () => {
    setMissingPath(null);
    setError(null);
  };

  const handleNativePick = async () => {
    setError(null);
    try {
      const pickedPath = onNativePick
        ? await onNativePick()
        : await pickFileSystemPath(mode, startPath || undefined);
      if (typeof pickedPath === "string") {
        await handleSelectPath(pickedPath);
        return;
      }
      if (pickedPath !== null) {
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenInFileManager = async () => {
    await handleNativePick();
  };

  const handleBrowserKeyDown = (event: React.KeyboardEvent) => {
    if (missingPath) {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleCreateDirectory();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleCancelCreateDirectory();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        visibleEntries.length === 0 ? 0 : (current + 1) % visibleEntries.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) =>
        visibleEntries.length === 0
          ? 0
          : (current - 1 + visibleEntries.length) % visibleEntries.length,
      );
      return;
    }

    if (event.key === "Enter" && visibleEntries[highlightedIndex]) {
      event.preventDefault();
      const entry = visibleEntries[highlightedIndex];
      if (entry.type === "file") {
        void handleSelectPath(entry.path);
      } else {
        void loadDirectory(entry.path);
      }
      return;
    }

    if (
      event.key === "Backspace" &&
      filter.length === 0 &&
      result?.parentPath
    ) {
      event.preventDefault();
      void loadDirectory(result.parentPath);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0"
        onEscapeKeyDown={(event) => {
          if (missingPath) {
            event.preventDefault();
            handleCancelCreateDirectory();
          }
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <DirectoryPathForm
            query={query}
            onQueryChange={setQuery}
            onKeyDown={handleBrowserKeyDown}
            onSubmit={() => {
              const highlightedEntry = visibleEntries[highlightedIndex];
              if (highlightedEntry?.type === "file") {
                void handleSelectPath(highlightedEntry.path);
              } else {
                void loadDirectory(highlightedEntry?.path ?? query);
              }
            }}
          />

          <DirectoryBrowserError message={error} />

          {missingPath ? (
            <CreateDirectoryConfirmation
              path={missingPath}
              canCreate={canCreate}
              title={createTitle}
              createLabel={createLabel}
              onCancel={handleCancelCreateDirectory}
              onCreate={handleCreateDirectory}
              onKeyDown={handleBrowserKeyDown}
            />
          ) : (
            <DirectoryListPanel
              parentPath={result?.parentPath ?? null}
              entries={visibleEntries}
              highlightedIndex={highlightedIndex}
              isLoading={isLoading}
              isFiltered={filter.trim().length > 0}
              mode={mode}
              openInFileManagerLabel={openInFileManagerLabel}
              showNativePicker
              onOpenInFileManager={handleOpenInFileManager}
              onParent={() =>
                void loadDirectory(result?.parentPath ?? undefined)
              }
              onEntryHover={setHighlightedIndex}
              onEntryOpen={(entry) => {
                if (entry.type === "file") {
                  void handleSelectPath(entry.path);
                } else {
                  void loadDirectory(entry.path);
                }
              }}
              onKeyDown={handleBrowserKeyDown}
            />
          )}
        </div>

        <DirectoryBrowserFooter
          confirmLabel={confirmLabel}
          canSelect={canSelect}
          showNativePicker
          nativePickerLabel={nativePickerLabel}
          onNativePick={handleNativePick}
          onSelect={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function DirectoryPathForm({
  query,
  onQueryChange,
  onKeyDown,
  onSubmit,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Documents/"
        aria-label="Directory path"
      />
    </form>
  );
}

function DirectoryBrowserError({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

function CreateDirectoryConfirmation({
  path,
  canCreate,
  title,
  createLabel,
  onCancel,
  onCreate,
  onKeyDown,
}: {
  path: string;
  canCreate: boolean;
  title: string;
  createLabel: string;
  onCancel: () => void;
  onCreate: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <div
      className="flex h-119.5 flex-col items-center justify-center rounded-md border border-border px-8 text-center"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <Folder className="h-12 w-12 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 max-w-lg break-all text-sm text-muted-foreground">
        {path}
      </p>
      <div className="mt-6 flex items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <ShortcutKey>Esc</ShortcutKey>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Button type="button" onClick={onCreate} disabled={!canCreate}>
            {createLabel}
          </Button>
          <ShortcutKey>Enter</ShortcutKey>
        </div>
      </div>
    </div>
  );
}

function DirectoryListPanel({
  parentPath,
  entries,
  highlightedIndex,
  isLoading,
  isFiltered,
  mode,
  openInFileManagerLabel,
  showNativePicker,
  onOpenInFileManager,
  onParent,
  onEntryHover,
  onEntryOpen,
  onKeyDown,
}: {
  parentPath: string | null;
  entries: BrowserEntry[];
  highlightedIndex: number;
  isLoading: boolean;
  isFiltered: boolean;
  mode: BrowseMode;
  openInFileManagerLabel: string;
  showNativePicker: boolean;
  onOpenInFileManager: () => void;
  onParent: () => void;
  onEntryHover: (index: number) => void;
  onEntryOpen: (entry: BrowserEntry) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <DirectoryListHeader
        parentPath={parentPath}
        isLoading={isLoading}
        openInFileManagerLabel={openInFileManagerLabel}
        showNativePicker={showNativePicker}
        onOpenInFileManager={onOpenInFileManager}
        onParent={onParent}
      />
      <DirectoryListBody
        entries={entries}
        highlightedIndex={highlightedIndex}
        isLoading={isLoading}
        mode={mode}
        onEntryHover={onEntryHover}
        onEntryOpen={onEntryOpen}
        onKeyDown={onKeyDown}
      />
      <DirectoryListCount
        count={entries.length}
        isFiltered={isFiltered}
        mode={mode}
      />
    </div>
  );
}

function DirectoryListHeader({
  parentPath,
  isLoading,
  openInFileManagerLabel,
  showNativePicker,
  onOpenInFileManager,
  onParent,
}: {
  parentPath: string | null;
  isLoading: boolean;
  openInFileManagerLabel: string;
  showNativePicker: boolean;
  onOpenInFileManager: () => void;
  onParent: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!parentPath || isLoading}
        onClick={onParent}
      >
        <ChevronLeft className="mr-1 h-3 w-3" />
        Parent
      </Button>
      {showNativePicker ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isLoading}
          onClick={onOpenInFileManager}
        >
          <FolderOpen className="mr-1 h-3 w-3" />
          {openInFileManagerLabel}
        </Button>
      ) : null}
    </div>
  );
}

function DirectoryListBody({
  entries,
  highlightedIndex,
  isLoading,
  mode,
  onEntryHover,
  onEntryOpen,
  onKeyDown,
}: {
  entries: BrowserEntry[];
  highlightedIndex: number;
  isLoading: boolean;
  mode: BrowseMode;
  onEntryHover: (index: number) => void;
  onEntryOpen: (entry: BrowserEntry) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  let content: React.ReactNode = null;

  if (entries.length > 0) {
    content = entries.map((entry, index) => (
      <DirectoryListItem
        key={entry.path}
        entry={entry}
        isHighlighted={index === highlightedIndex}
        mode={mode}
        onHover={() => onEntryHover(index)}
        onOpen={() => onEntryOpen(entry)}
      />
    ));
  } else if (!isLoading) {
    content = <DirectoryListEmpty mode={mode} />;
  }

  return (
    <div className="relative h-80 overflow-auto p-1" onKeyDown={onKeyDown}>
      {content}
      {isLoading ? <DirectoryListLoading /> : null}
    </div>
  );
}

function DirectoryListItem({
  entry,
  isHighlighted,
  mode,
  onHover,
  onOpen,
}: {
  entry: BrowserEntry;
  isHighlighted: boolean;
  mode: BrowseMode;
  onHover: () => void;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        isHighlighted && "bg-accent text-accent-foreground",
      )}
      onMouseEnter={onHover}
      onClick={onOpen}
    >
      {entry.type === "directory" ? (
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <File className="h-4 w-4 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{entry.name}</span>
      {mode === "file" && entry.type === "directory" ? (
        <span className="ml-auto text-xs text-muted-foreground">Browse</span>
      ) : null}
    </button>
  );
}

function DirectoryListEmpty({ mode }: { mode: BrowseMode }) {
  return (
    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
      {mode === "file"
        ? "No files or subdirectories found."
        : "No subdirectories found."}
    </div>
  );
}

function DirectoryListLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/70 text-sm text-muted-foreground backdrop-blur-[1px]">
      Loading directories...
    </div>
  );
}

function DirectoryListCount({
  count,
  isFiltered,
  mode,
}: {
  count: number;
  isFiltered: boolean;
  mode: BrowseMode;
}) {
  let suffix = "ies";
  if (mode === "file") {
    suffix = count === 1 ? "" : "s";
  } else if (count === 1) {
    suffix = "y";
  }
  const label = mode === "file" ? "item" : "director";

  return (
    <div className="border-t border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      {count} {label}
      {suffix}
      {isFiltered ? " match" : ""}
    </div>
  );
}

function DirectoryBrowserFooter({
  confirmLabel,
  canSelect,
  showNativePicker,
  nativePickerLabel,
  onNativePick,
  onSelect,
}: {
  confirmLabel: string;
  canSelect: boolean;
  showNativePicker: boolean;
  nativePickerLabel: string;
  onNativePick: () => void;
  onSelect: () => void;
}) {
  return (
    <DialogFooter className="border-t border-border px-5 py-4">
      <div className="mr-auto hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        <ShortcutKey>↑</ShortcutKey>
        <ShortcutKey>↓</ShortcutKey>
        <span>navigate</span>
        <ShortcutKey>Backspace</ShortcutKey>
        <span>back</span>
        <ShortcutKey>Esc</ShortcutKey>
        <span>close</span>
      </div>
      {showNativePicker ? (
        <Button type="button" variant="outline" onClick={onNativePick}>
          <FolderOpen className="mr-1 h-3 w-3" />
          {nativePickerLabel}
        </Button>
      ) : null}
      <Button type="button" onClick={onSelect} disabled={!canSelect}>
        {confirmLabel}
      </Button>
    </DialogFooter>
  );
}

function ShortcutKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-muted-foreground pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100">
      {children}
    </kbd>
  );
}
