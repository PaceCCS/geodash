import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Folder, FolderOpen, RefreshCcw } from "lucide-react";

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
import { browseDirectory, type DirectoryBrowseResult } from "@/lib/desktop";

type DirectoryBrowserDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  initialPath?: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void | Promise<void>;
  onNativePick?: () => void | Promise<void>;
};

export function DirectoryBrowserDialog({
  open,
  title,
  description,
  confirmLabel = "Use Directory",
  initialPath,
  onOpenChange,
  onSelect,
  onNativePick,
}: DirectoryBrowserDialogProps) {
  const [query, setQuery] = useState(initialPath ?? "");
  const [result, setResult] = useState<DirectoryBrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPath = result?.path ?? query.trim();
  const canSelect = currentPath.length > 0 && !isLoading;
  const visibleEntries = useMemo(() => result?.entries ?? [], [result]);

  const loadDirectory = useCallback(async (path?: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const nextResult = await browseDirectory(path);
      setResult(nextResult);
      setQuery(nextResult.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadDirectory(initialPath ?? undefined);
  }, [initialPath, loadDirectory, open]);

  const handleSubmit = async () => {
    if (!canSelect) return;
    await onSelect(currentPath);
    onOpenChange(false);
  };

  const handleNativePick = async () => {
    if (!onNativePick) return;
    await onNativePick();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void loadDirectory(query);
            }}
          >
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="~/Documents/geodash-data"
              aria-label="Directory path"
            />
            <Button type="submit" variant="outline" disabled={isLoading}>
              <RefreshCcw className="mr-1 h-3 w-3" />
              Browse
            </Button>
          </form>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <div className="overflow-hidden rounded-md border border-border">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
              <div className="min-w-0 truncate text-sm text-muted-foreground">
                {result?.path ?? "Loading..."}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!result?.parentPath || isLoading}
                onClick={() => void loadDirectory(result?.parentPath ?? undefined)}
              >
                <ChevronLeft className="mr-1 h-3 w-3" />
                Parent
              </Button>
            </div>

            <div className="max-h-80 overflow-auto p-1">
              {isLoading ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Loading directories...
                </div>
              ) : visibleEntries.length > 0 ? (
                visibleEntries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                    onClick={() => void loadDirectory(entry.path)}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))
              ) : (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No subdirectories found.
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-5 py-4">
          {onNativePick ? (
            <Button type="button" variant="outline" onClick={handleNativePick}>
              <FolderOpen className="mr-1 h-3 w-3" />
              Native Picker
            </Button>
          ) : null}
          <Button type="button" onClick={handleSubmit} disabled={!canSelect}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
