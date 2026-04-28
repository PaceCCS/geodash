import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ExternalLink,
  Folder,
  FolderOpen,
  RefreshCcw,
} from "lucide-react";

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
import {
  browseDirectory,
  createDirectory,
  openDirectory,
  type DirectoryBrowseResult,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";

const PATH_SEPARATOR = "/";

type DirectoryBrowserDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  initialPath?: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void | Promise<void>;
  onCreatedDirectory?: (path: string) => void | Promise<void>;
  onNativePick?: () => void | Promise<void>;
};

type DirectoryEntry = DirectoryBrowseResult["entries"][number];

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

export function DirectoryBrowserDialog({
  open,
  title,
  description,
  confirmLabel = "Use Directory",
  initialPath,
  onOpenChange,
  onSelect,
  onCreatedDirectory,
  onNativePick,
}: DirectoryBrowserDialogProps) {
  const [query, setQuery] = useState(
    initialPath ? ensureTrailingPathSeparator(initialPath) : "",
  );
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [result, setResult] = useState<DirectoryBrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingPath, setMissingPath] = useState<string | null>(null);
  const requestedDirectoryRef = useRef<string | undefined>(undefined);

  const currentPath = result?.path ?? query.trim();
  const canSelect = Boolean(result?.path) && !isLoading && !missingPath;
  const canCreate = Boolean(missingPath) && !isLoading;
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

  const loadDirectory = useCallback(
    async (path?: string, updateQuery = true) => {
      requestedDirectoryRef.current = path
        ? ensureTrailingPathSeparator(path)
        : undefined;
      setIsLoading(true);
      setError(null);
      setMissingPath(null);
      try {
        const nextResult = await browseDirectory(path);
        setResult(nextResult);
        if (updateQuery || !path) {
          setQuery(ensureTrailingPathSeparator(nextResult.path));
        }
        setHighlightedIndex(0);
      } catch (err) {
        setMissingPath(path ?? null);
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("ENOENT")) {
          setError(message);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    const nextQuery = initialPath
      ? ensureTrailingPathSeparator(initialPath)
      : "";
    setQuery(nextQuery);
    const nextDirectoryQuery = splitBrowseQuery(nextQuery).directoryQuery;
    void loadDirectory(nextDirectoryQuery, false);
  }, [initialPath, loadDirectory, open]);

  useEffect(() => {
    if (!open || directoryQuery === requestedDirectoryRef.current) return;
    void loadDirectory(directoryQuery, false);
  }, [directoryQuery, loadDirectory, open]);

  useEffect(() => {
    setHighlightedIndex((current) =>
      Math.min(current, Math.max(visibleEntries.length - 1, 0)),
    );
  }, [visibleEntries.length]);

  const handleSubmit = async () => {
    if (!canSelect) return;
    setError(null);
    try {
      await onSelect(currentPath);
      onOpenChange(false);
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
      await onCreatedDirectory?.(nextResult.path);
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
    if (!onNativePick) return;
    setError(null);
    try {
      await onNativePick();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenInFileManager = async () => {
    if (!currentPath) return;
    try {
      await openDirectory(currentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
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
      void loadDirectory(visibleEntries[highlightedIndex].path);
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
            isLoading={isLoading}
            onQueryChange={setQuery}
            onKeyDown={handleBrowserKeyDown}
            onSubmit={() => {
              const highlightedEntry = visibleEntries[highlightedIndex];
              void loadDirectory(highlightedEntry?.path ?? query);
            }}
          />

          <DirectoryBrowserError message={error} />

          {missingPath ? (
            <CreateDirectoryConfirmation
              path={missingPath}
              canCreate={canCreate}
              onCancel={handleCancelCreateDirectory}
              onCreate={handleCreateDirectory}
              onKeyDown={handleBrowserKeyDown}
            />
          ) : (
            <DirectoryListPanel
              currentPath={result?.path ?? null}
              parentPath={result?.parentPath ?? null}
              entries={visibleEntries}
              highlightedIndex={highlightedIndex}
              isLoading={isLoading}
              isFiltered={filter.trim().length > 0}
              onOpenInFileManager={handleOpenInFileManager}
              onParent={() => void loadDirectory(result?.parentPath ?? undefined)}
              onEntryHover={setHighlightedIndex}
              onEntryOpen={(path) => void loadDirectory(path)}
              onKeyDown={handleBrowserKeyDown}
            />
          )}
        </div>

        <DirectoryBrowserFooter
          confirmLabel={confirmLabel}
          canSelect={canSelect}
          showNativePicker={Boolean(onNativePick)}
          onNativePick={handleNativePick}
          onSelect={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

function DirectoryPathForm({
  query,
  isLoading,
  onQueryChange,
  onKeyDown,
  onSubmit,
}: {
  query: string;
  isLoading: boolean;
  onQueryChange: (query: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex gap-2"
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
      <Button type="submit" variant="outline" disabled={isLoading}>
        <RefreshCcw className="mr-1 h-3 w-3" />
        Browse
      </Button>
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
  onCancel,
  onCreate,
  onKeyDown,
}: {
  path: string;
  canCreate: boolean;
  onCancel: () => void;
  onCreate: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <div
      className="flex h-[29.875rem] flex-col items-center justify-center rounded-md border border-border px-8 text-center"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <Folder className="h-12 w-12 text-muted-foreground" />
      <h3 className="mt-4 text-lg font-semibold">Create a new directory?</h3>
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
            Create Folder
          </Button>
          <ShortcutKey>Enter</ShortcutKey>
        </div>
      </div>
    </div>
  );
}

function DirectoryListPanel({
  currentPath,
  parentPath,
  entries,
  highlightedIndex,
  isLoading,
  isFiltered,
  onOpenInFileManager,
  onParent,
  onEntryHover,
  onEntryOpen,
  onKeyDown,
}: {
  currentPath: string | null;
  parentPath: string | null;
  entries: DirectoryEntry[];
  highlightedIndex: number;
  isLoading: boolean;
  isFiltered: boolean;
  onOpenInFileManager: () => void;
  onParent: () => void;
  onEntryHover: (index: number) => void;
  onEntryOpen: (path: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <DirectoryListHeader
        currentPath={currentPath}
        parentPath={parentPath}
        isLoading={isLoading}
        onOpenInFileManager={onOpenInFileManager}
        onParent={onParent}
      />
      <DirectoryListBody
        entries={entries}
        highlightedIndex={highlightedIndex}
        isLoading={isLoading}
        onEntryHover={onEntryHover}
        onEntryOpen={onEntryOpen}
        onKeyDown={onKeyDown}
      />
      <DirectoryListCount count={entries.length} isFiltered={isFiltered} />
    </div>
  );
}

function DirectoryListHeader({
  currentPath,
  parentPath,
  isLoading,
  onOpenInFileManager,
  onParent,
}: {
  currentPath: string | null;
  parentPath: string | null;
  isLoading: boolean;
  onOpenInFileManager: () => void;
  onParent: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
      <div className="min-w-0 truncate text-sm text-muted-foreground">
        {currentPath ?? "Loading..."}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!currentPath || isLoading}
          onClick={onOpenInFileManager}
        >
          <ExternalLink className="mr-1 h-3 w-3" />
          Open in Finder
        </Button>
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
      </div>
    </div>
  );
}

function DirectoryListBody({
  entries,
  highlightedIndex,
  isLoading,
  onEntryHover,
  onEntryOpen,
  onKeyDown,
}: {
  entries: DirectoryEntry[];
  highlightedIndex: number;
  isLoading: boolean;
  onEntryHover: (index: number) => void;
  onEntryOpen: (path: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  let content: React.ReactNode = null;

  if (entries.length > 0) {
    content = entries.map((entry, index) => (
      <DirectoryListItem
        key={entry.path}
        entry={entry}
        isHighlighted={index === highlightedIndex}
        onHover={() => onEntryHover(index)}
        onOpen={() => onEntryOpen(entry.path)}
      />
    ));
  } else if (!isLoading) {
    content = <DirectoryListEmpty />;
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
  onHover,
  onOpen,
}: {
  entry: DirectoryEntry;
  isHighlighted: boolean;
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
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

function DirectoryListEmpty() {
  return (
    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
      No subdirectories found.
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
}: {
  count: number;
  isFiltered: boolean;
}) {
  return (
    <div className="border-t border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      {count} director{count === 1 ? "y" : "ies"}
      {isFiltered ? " match" : ""}
    </div>
  );
}

function DirectoryBrowserFooter({
  confirmLabel,
  canSelect,
  showNativePicker,
  onNativePick,
  onSelect,
}: {
  confirmLabel: string;
  canSelect: boolean;
  showNativePicker: boolean;
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
          Native Picker
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
