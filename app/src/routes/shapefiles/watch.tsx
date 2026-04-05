import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  buildShapefileDocument,
  getShapefileDocument,
  getShapefileSummaries,
  type ShapefileDocument,
  type ShapefileSummary,
} from "@/lib/api-client";
import {
  deleteFile,
  onFileChanged,
  pickShapefileDirectory,
  startWatchingDirectory,
  stopWatchingDirectory,
  writeBinaryFile,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";

const SHAPEFILE_WATCH_EXTENSIONS = [".shp", ".shx", ".dbf", ".prj"];

type ShapefileWatchSearch = {
  directory?: string;
};

export const Route = createFileRoute("/shapefiles/watch")({
  validateSearch: (search): ShapefileWatchSearch => ({
    directory: typeof search.directory === "string" ? search.directory : undefined,
  }),
  component: ShapefileWatchPage,
});

type WatchState = {
  enabled: boolean;
  directoryPath: string | null;
};

type ShapefileTestApi = {
  openDirectory: (directoryPath: string) => Promise<void>;
};

function ShapefileWatchPage() {
  const [watchState, setWatchState] = useState<WatchState>({
    enabled: false,
    directoryPath: null,
  });
  const [summaries, setSummaries] = useState<ShapefileSummary[]>([]);
  const [selectedStemPath, setSelectedStemPath] = useState<string | null>(null);
  const [loadedDocument, setLoadedDocument] = useState<ShapefileDocument | null>(null);
  const [draftDocument, setDraftDocument] = useState<ShapefileDocument | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingDocument, setIsLoadingDocument] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const watchStateRef = useRef(watchState);
  const autoOpenedDirectoryRef = useRef<string | null>(null);
  const directoryQuery =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("directory")
      : null;

  useEffect(() => {
    watchStateRef.current = watchState;
  }, [watchState]);

  useEffect(() => {
    return () => {
      if (watchStateRef.current.enabled) {
        void stopWatchingDirectory();
      }
    };
  }, []);

  const selectedSummary = useMemo(
    () => summaries.find((summary) => summary.stemPath === selectedStemPath) ?? null,
    [selectedStemPath, summaries],
  );
  const displayDirectoryPath = watchState.directoryPath?.replace(/^\/+/, "") ?? null;
  const canSave = watchState.enabled && draftDocument !== null && isDirty && !isSaving;

  const refreshSummaries = useCallback(
    async (
      directoryPath: string,
      {
        preferredStemPath = selectedStemPath,
        allowMissingSelection = false,
      }: {
        preferredStemPath?: string | null;
        allowMissingSelection?: boolean;
      } = {},
    ) => {
      const nextSummaries = await getShapefileSummaries(directoryPath);
      setSummaries(nextSummaries);

      const selectable = nextSummaries.filter((summary) => !summary.error);
      const selectableStemPaths = new Set(selectable.map((summary) => summary.stemPath));

      let nextSelectedStemPath = preferredStemPath ?? null;
      if (!nextSelectedStemPath) {
        nextSelectedStemPath = selectable[0]?.stemPath ?? null;
      } else if (!allowMissingSelection && !selectableStemPaths.has(nextSelectedStemPath)) {
        nextSelectedStemPath = selectable[0]?.stemPath ?? null;
      }

      setSelectedStemPath(nextSelectedStemPath);

      if (!nextSelectedStemPath && !allowMissingSelection) {
        setLoadedDocument(null);
        setDraftDocument(null);
        setIsDirty(false);
      }

      return {
        summaries: nextSummaries,
        selectedStemPath: nextSelectedStemPath,
      };
    },
    [selectedStemPath],
  );

  const loadDocument = useCallback(async (stemPath: string) => {
    setIsLoadingDocument(true);
    try {
      const nextDocument = await getShapefileDocument(stemPath);
      setLoadedDocument(nextDocument);
      setDraftDocument(structuredClone(nextDocument));
      setIsDirty(false);
      setHasExternalChanges(false);
      return nextDocument;
    } finally {
      setIsLoadingDocument(false);
    }
  }, []);

  const openDirectory = useCallback(
    async (directoryPath: string) => {
      setIsBusy(true);
      setErrorMessage(null);

      try {
        await startWatchingDirectory(directoryPath, SHAPEFILE_WATCH_EXTENSIONS);
        setWatchState({
          enabled: true,
          directoryPath,
        });

        const result = await refreshSummaries(directoryPath, {
          preferredStemPath: null,
        });
        if (result.selectedStemPath) {
          await loadDocument(result.selectedStemPath);
        } else {
          setLoadedDocument(null);
          setDraftDocument(null);
          setIsDirty(false);
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setIsBusy(false);
      }
    },
    [loadDocument, refreshSummaries],
  );

  const handleSelectDirectory = useCallback(async () => {
    const directoryPath = await pickShapefileDirectory();
    if (!directoryPath) {
      return;
    }
    await openDirectory(directoryPath);
  }, [openDirectory]);

  useEffect(() => {
    if (typeof window === "undefined" || !import.meta.env.DEV) {
      return;
    }

    const testWindow = window as Window & {
      __GEODASH_SHAPEFILE_TEST__?: ShapefileTestApi;
    };

    testWindow.__GEODASH_SHAPEFILE_TEST__ = {
      openDirectory,
    };

    return () => {
      delete testWindow.__GEODASH_SHAPEFILE_TEST__;
    };
  }, [openDirectory]);

  useEffect(() => {
    const directoryPath = directoryQuery;
    if (
      !directoryPath
      || watchState.enabled
      || isBusy
      || autoOpenedDirectoryRef.current === directoryPath
    ) {
      return;
    }

    let active = true;
    autoOpenedDirectoryRef.current = directoryPath;
    setIsBusy(true);
    setErrorMessage(null);

    void (async () => {
      try {
        await startWatchingDirectory(directoryPath, SHAPEFILE_WATCH_EXTENSIONS);
        if (!active) {
          return;
        }

        setWatchState({
          enabled: true,
          directoryPath,
        });

        const result = await refreshSummaries(directoryPath, {
          preferredStemPath: null,
        });
        if (!active) {
          return;
        }

        if (result.selectedStemPath) {
          await loadDocument(result.selectedStemPath);
        } else {
          setLoadedDocument(null);
          setDraftDocument(null);
          setIsDirty(false);
        }
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) {
          setIsBusy(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [directoryQuery, isBusy, loadDocument, refreshSummaries, watchState.enabled]);

  const handleStopWatching = useCallback(async () => {
    setIsBusy(true);
    try {
      await stopWatchingDirectory();
      setWatchState({
        enabled: false,
        directoryPath: null,
      });
      setSummaries([]);
      setSelectedStemPath(null);
      setLoadedDocument(null);
      setDraftDocument(null);
      setIsLoadingDocument(false);
      setErrorMessage(null);
      setIsDirty(false);
      setHasExternalChanges(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }, []);

  const handleReloadFromDisk = useCallback(async () => {
    if (!watchState.directoryPath) {
      return;
    }

    setIsBusy(true);
    setErrorMessage(null);

    try {
      const result = await refreshSummaries(watchState.directoryPath);
      if (result.selectedStemPath) {
        await loadDocument(result.selectedStemPath);
      } else {
        setLoadedDocument(null);
        setDraftDocument(null);
        setIsLoadingDocument(false);
        setIsDirty(false);
        setHasExternalChanges(false);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsBusy(false);
    }
  }, [loadDocument, refreshSummaries, watchState.directoryPath]);

  const handleSelectSummary = useCallback(
    async (summary: ShapefileSummary) => {
      if (summary.error || summary.stemPath === selectedStemPath) {
        return;
      }

      if (
        isDirty
        && typeof window !== "undefined"
        && !window.confirm("Discard unsaved changes and open another shapefile?")
      ) {
        return;
      }

      setIsBusy(true);
      setErrorMessage(null);

      try {
        setSelectedStemPath(summary.stemPath);
        await loadDocument(summary.stemPath);
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        setIsBusy(false);
      }
    },
    [isDirty, loadDocument, selectedStemPath],
  );

  const updateDraft = useCallback((updater: (draft: ShapefileDocument) => void) => {
    setDraftDocument((current) => {
      if (!current) {
        return current;
      }
      const next = structuredClone(current);
      updater(next);
      return next;
    });
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draftDocument || !watchState.directoryPath) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const built = await buildShapefileDocument({
        records: draftDocument.records,
        fields: draftDocument.fields,
        rows: draftDocument.rows,
        prj: draftDocument.prj,
      });

      await writeBinaryFile(`${draftDocument.stemPath}.shp`, built.shp_b64);
      await writeBinaryFile(`${draftDocument.stemPath}.shx`, built.shx_b64);
      await writeBinaryFile(`${draftDocument.stemPath}.dbf`, built.dbf_b64);

      if (built.prj_b64) {
        await writeBinaryFile(`${draftDocument.stemPath}.prj`, built.prj_b64);
      } else if (loadedDocument?.hasPrj) {
        await deleteFile(`${draftDocument.stemPath}.prj`);
      }

      const result = await refreshSummaries(watchState.directoryPath, {
        preferredStemPath: draftDocument.stemPath,
      });
      if (result.selectedStemPath) {
        await loadDocument(result.selectedStemPath);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [draftDocument, loadDocument, loadedDocument?.hasPrj, refreshSummaries, watchState.directoryPath]);

  useEffect(() => {
    const directoryPath = watchState.directoryPath;

    if (!watchState.enabled || !directoryPath) {
      return;
    }

    const unlisten = onFileChanged((changedPaths) => {
      const relevantPaths = changedPaths.filter((changedPath) =>
        SHAPEFILE_WATCH_EXTENSIONS.some((extension) =>
          changedPath.toLowerCase().endsWith(extension),
        ),
      );
      if (relevantPaths.length === 0) {
        return;
      }

      void (async () => {
        try {
          if (isDirty) {
            setHasExternalChanges(true);
            await refreshSummaries(directoryPath, {
              allowMissingSelection: true,
            });
            return;
          }

          const result = await refreshSummaries(directoryPath);
          if (result.selectedStemPath) {
            await loadDocument(result.selectedStemPath);
          } else {
            setLoadedDocument(null);
            setDraftDocument(null);
            setIsLoadingDocument(false);
            setIsDirty(false);
          }
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : String(error));
        }
      })();
    });

    return unlisten;
  }, [isDirty, loadDocument, refreshSummaries, watchState.directoryPath, watchState.enabled]);

  useCommands(
    watchState.enabled
      ? [
          {
            id: "select-shapefile-directory",
            label: "Change Shapefile Directory",
            run: (dialog) => {
              dialog.close();
              void handleSelectDirectory();
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
              void handleSave();
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
              void handleReloadFromDisk();
            },
            group: "Shapefile",
            icon: <RefreshCcw />,
          },
          {
            id: "stop-shapefile-watch",
            label: "Stop Watching Directory",
            run: (dialog) => {
              dialog.close();
              void handleStopWatching();
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
              void handleSelectDirectory();
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
        {watchState.enabled ? (
          <div className="flex w-full items-center justify-between gap-3 px-2">
            <div className="flex min-w-0 items-center gap-2">
              {draftDocument ? (
                <>
                  <span className="max-w-64 shrink-0 truncate text-sm font-medium">
                    {draftDocument.name}
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
                onClick={handleReloadFromDisk}
                disabled={isBusy || isSaving}
              >
                <RefreshCcw className="mr-1 h-3 w-3" />
                Reload
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!canSave}>
                <Save className="mr-1 h-3 w-3" />
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopWatching}
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
            <Button size="sm" onClick={handleSelectDirectory} disabled={isBusy}>
              <FolderOpen className="mr-1 h-3 w-3" />
              Select Directory
            </Button>
          </div>
        )}
      </HeaderSlot>

      {watchState.enabled && watchState.directoryPath ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {errorMessage ? (
            <div className="border-b border-border bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {errorMessage}
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
              summaries={summaries}
              selectedStemPath={selectedStemPath}
              onSelect={handleSelectSummary}
            />

            <main className="flex min-h-0 flex-1 flex-col overflow-auto">
              {isLoadingDocument ? (
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
              ) : draftDocument ? (
                <ShapefileEditor
                  document={draftDocument}
                  summary={selectedSummary}
                  onUpdate={updateDraft}
                />
              ) : (
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
              )}
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
            <Button size="lg" onClick={handleSelectDirectory} disabled={isBusy}>
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
