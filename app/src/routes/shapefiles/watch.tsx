import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  EyeOff,
  FolderOpen,
  RefreshCcw,
  Save,
  TableProperties,
} from "lucide-react";

import { HeaderSlot } from "@/components/header-slot";
import { ShapefileEditor } from "@/components/shapefile/shapefile-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCommands } from "@/contexts/keybind-provider";
import type { ShapefileSummary } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useShapefileWatch } from "@/lib/hooks/use-shapefile-watch";

type ShapefileWatchSearch = {
  directory?: string;
};

export const Route = createFileRoute("/shapefiles/watch")({
  validateSearch: (search): ShapefileWatchSearch => ({
    directory: typeof search.directory === "string" ? search.directory : undefined,
  }),
  component: ShapefileWatchPage,
});

type ShapefileTestApi = {
  openDirectory: (directoryPath: string) => Promise<void>;
};

function ShapefileWatchPage() {
  const directoryQuery =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("directory")
      : null;

  const {
    watch,
    docState,
    draft,
    selectedSummary,
    isDirty,
    hasExternalChanges,
    isBusy,
    isSaving,
    canSave,
    error,
    pickAndOpen,
    openDirectory,
    stopWatching,
    reload,
    selectStem,
    save,
    updateDraft,
  } = useShapefileWatch(directoryQuery);

  const displayDirectoryPath =
    watch.phase === "active" ? watch.directoryPath.replace(/^\/+/, "") : null;
  let mainContent = (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md text-center">
        <TableProperties className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="mt-4 text-xl font-semibold">No Shapefile Selected</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a `.shp` stem from the directory to inspect and edit its
          geometry, DBF rows, and projection text.
        </p>
      </div>
    </div>
  );
  if (docState.status === "loading") {
    mainContent = (
      <div
        data-testid="shapefile-loading"
        className="flex flex-1 items-center justify-center px-6"
      >
        <div className="max-w-md text-center">
          <RefreshCcw className="mx-auto h-12 w-12 animate-spin text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">Loading shapefile...</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Large point sets can take a moment to deserialize and prepare for
            editing.
          </p>
        </div>
      </div>
    );
  } else if (draft) {
    mainContent = (
      <ShapefileEditor
        document={draft}
        summary={selectedSummary}
        onUpdate={updateDraft}
      />
    );
  }

  // Expose test API in dev mode.
  useEffect(() => {
    if (typeof window === "undefined" || !import.meta.env.DEV) return;

    const testWindow = window as Window & {
      __GEODASH_SHAPEFILE_TEST__?: ShapefileTestApi;
    };
    testWindow.__GEODASH_SHAPEFILE_TEST__ = { openDirectory };
    return () => {
      delete testWindow.__GEODASH_SHAPEFILE_TEST__;
    };
  }, [openDirectory]);

  useCommands(
    watch.phase === "active"
      ? [
          {
            id: "select-shapefile-directory",
            label: "Change Shapefile Directory",
            run: (dialog) => {
              dialog.close();
              void pickAndOpen();
            },
            group: "Shapefile",
            icon: <FolderOpen />,
            shortcut: "Mod+O",
          },
          {
            id: "save-shapefile",
            label: "Save Shapefile",
            run: (dialog) => {
              dialog.close();
              void save();
            },
            group: "Shapefile",
            icon: <Save />,
            shortcut: "Mod+S",
          },
          {
            id: "reload-shapefile",
            label: "Reload From Disk",
            run: (dialog) => {
              dialog.close();
              void reload();
            },
            group: "Shapefile",
            icon: <RefreshCcw />,
          },
          {
            id: "stop-shapefile-watch",
            label: "Stop Watching Directory",
            run: (dialog) => {
              dialog.close();
              void stopWatching();
            },
            group: "Shapefile",
            icon: <EyeOff />,
          },
        ]
      : [
          {
            id: "select-shapefile-directory",
            label: "Select Shapefile Directory",
            run: (dialog) => {
              dialog.close();
              void pickAndOpen();
            },
            group: "Shapefile",
            icon: <FolderOpen />,
            shortcut: "Mod+O",
          },
        ],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <HeaderSlot>
        {watch.phase === "active" ? (
          <div className="flex w-full items-center justify-between gap-3 px-2">
            <div className="flex min-w-0 items-center gap-2">
              {draft ? (
                <>
                  <span className="max-w-64 shrink-0 truncate text-sm font-medium">
                    {draft.name}
                  </span>
                  <span className="text-xs text-muted-foreground">/</span>
                </>
              ) : null}
              <span className="truncate text-sm text-muted-foreground">
                {displayDirectoryPath}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {isDirty ? <Badge variant="secondary">Unsaved</Badge> : null}
              {hasExternalChanges ? (
                <Badge variant="destructive">Changed on disk</Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={reload}
                disabled={isBusy || isSaving}
              >
                <RefreshCcw className="mr-1 h-3 w-3" />
                Reload
              </Button>
              <Button size="sm" onClick={save} disabled={!canSave}>
                <Save className="mr-1 h-3 w-3" />
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={stopWatching}
                disabled={isBusy || isSaving}
              >
                <EyeOff className="mr-1 h-3 w-3" />
                Stop Watching
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex w-full items-center justify-between px-2">
            <span className="text-sm font-medium">Watch Shapefile Directory</span>
            <Button size="sm" onClick={pickAndOpen} disabled={isBusy}>
              <FolderOpen className="mr-1 h-3 w-3" />
              Select Directory
            </Button>
          </div>
        )}
      </HeaderSlot>

      {watch.phase === "active" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {error ? (
            <div className="border-b border-border bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {hasExternalChanges && isDirty ? (
            <div className="border-b border-border bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Disk changes were detected while you had unsaved edits open. Reload to
              refresh from disk or save to keep your current draft.
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <ShapefileSidebar
              summaries={watch.summaries}
              selectedStemPath={watch.selectedStemPath}
              onSelect={selectStem}
            />

            <main className="flex min-h-0 flex-1 flex-col overflow-auto">
              {mainContent}
            </main>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-4 text-center">
            <FolderOpen className="mx-auto h-16 w-16 text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold">No Directory Selected</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Choose a folder containing shapefile sidecars.
                <br />
                You'll be able to browse `.shp` stems and save edits back to disk.
              </p>
            </div>
            <Button size="lg" onClick={pickAndOpen} disabled={isBusy}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Select Directory
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShapefileSidebar({
  summaries,
  selectedStemPath,
  onSelect,
}: {
  summaries: ShapefileSummary[];
  selectedStemPath: string | null;
  onSelect: (summary: ShapefileSummary) => void;
}) {
  return (
    <aside className="w-full shrink-0 border-b border-border bg-sidebar md:w-80 md:border-b-0 md:border-r">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Shapefiles</p>
            <p className="text-xs text-muted-foreground">
              {summaries.length} found
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {summaries.length > 0 ? (
            <div className="flex flex-col">
              {summaries.map((summary) => (
                <button
                  key={summary.stemPath}
                  type="button"
                  data-testid={`shapefile-summary-${summary.name}`}
                  onClick={() => onSelect(summary)}
                  disabled={Boolean(summary.error)}
                  className={cn(
                    "border-b border-border px-4 py-3 text-left transition-colors",
                    summary.stemPath === selectedStemPath
                      ? "bg-primary/8"
                      : "hover:bg-accent/60",
                    summary.error && "cursor-not-allowed opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {summary.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {summary.recordCount} records
                      </p>
                    </div>
                    {summary.geometryType ? (
                      <Badge variant="outline">{summary.geometryType}</Badge>
                    ) : null}
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {summary.hasDbf ? (
                      <Badge variant="secondary">DBF</Badge>
                    ) : null}
                    {summary.hasShx ? (
                      <Badge variant="secondary">SHX</Badge>
                    ) : null}
                    {summary.hasPrj ? (
                      <Badge variant="secondary">PRJ</Badge>
                    ) : null}
                  </div>

                  {summary.error ? (
                    <p className="mt-2 text-xs text-destructive">
                      {summary.error}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No `.shp` files found in this directory yet.
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
