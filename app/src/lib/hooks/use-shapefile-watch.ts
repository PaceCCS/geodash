import { useCallback, useEffect, useRef, useState } from "react";

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

const WATCH_EXTENSIONS = [".shp", ".shx", ".dbf", ".prj"];

// ── State types ──────────────────────────────────────────────────────────────

type WatchIdle = { phase: "idle" };
type WatchActive = {
  phase: "active";
  directoryPath: string;
  summaries: ShapefileSummary[];
  selectedStemPath: string | null;
};

type WatchPhase = WatchIdle | WatchActive;

type DocumentIdle = { status: "idle" };
type DocumentLoading = { status: "loading" };
type DocumentReady = {
  status: "ready";
  loaded: ShapefileDocument;
};

type DocumentState = DocumentIdle | DocumentLoading | DocumentReady;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useShapefileWatch(autoOpenDirectory?: string | null) {
  const [watch, setWatch] = useState<WatchPhase>({ phase: "idle" });
  const [docState, setDocState] = useState<DocumentState>({ status: "idle" });
  const [draft, setDraft] = useState<ShapefileDocument | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [hasExternalChanges, setHasExternalChanges] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const watchRef = useRef(watch);
  watchRef.current = watch;
  const autoOpenedRef = useRef<string | null>(null);

  // Save needs current draft without stale closures.
  const saveRef = useRef<{
    draft: ShapefileDocument | null;
    hasPrj: boolean;
  }>({ draft: null, hasPrj: false });
  saveRef.current.draft = draft;
  if (docState.status === "ready") {
    saveRef.current.hasPrj = docState.loaded.hasPrj;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  const fetchSummaries = useCallback(
    async (
      directoryPath: string,
      preferredStem?: string | null,
      allowMissing = false,
    ) => {
      const summaries = await getShapefileSummaries(directoryPath);
      const selectable = summaries.filter((s) => !s.error);
      const stemSet = new Set(selectable.map((s) => s.stemPath));

      let selected = preferredStem ?? selectable[0]?.stemPath ?? null;
      if (selected && !allowMissing && !stemSet.has(selected)) {
        selected = selectable[0]?.stemPath ?? null;
      }

      setWatch({ phase: "active", directoryPath, summaries, selectedStemPath: selected });
      return selected;
    },
    [],
  );

  const loadDocument = useCallback(async (stemPath: string) => {
    setDocState({ status: "loading" });
    const doc = await getShapefileDocument(stemPath);
    setDocState({ status: "ready", loaded: doc });
    setDraft(structuredClone(doc));
    setIsDirty(false);
    setHasExternalChanges(false);
  }, []);

  const resetDocument = useCallback(() => {
    setDocState({ status: "idle" });
    setDraft(null);
    setIsDirty(false);
    setHasExternalChanges(false);
  }, []);

  // ── Public actions ───────────────────────────────────────────────────────

  const openDirectory = useCallback(
    async (directoryPath: string) => {
      setIsBusy(true);
      setError(null);
      try {
        await startWatchingDirectory(directoryPath, WATCH_EXTENSIONS);
        const selected = await fetchSummaries(directoryPath);
        if (selected) {
          await loadDocument(selected);
        } else {
          resetDocument();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsBusy(false);
      }
    },
    [fetchSummaries, loadDocument, resetDocument],
  );

  const pickAndOpen = useCallback(async () => {
    const path = await pickShapefileDirectory();
    if (path) await openDirectory(path);
  }, [openDirectory]);

  const stopWatching = useCallback(async () => {
    setIsBusy(true);
    try {
      await stopWatchingDirectory();
      setWatch({ phase: "idle" });
      resetDocument();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }, [resetDocument]);

  const reload = useCallback(async () => {
    if (watch.phase !== "active") return;
    setIsBusy(true);
    setError(null);
    try {
      const selected = await fetchSummaries(
        watch.directoryPath,
        watch.selectedStemPath,
      );
      if (selected) {
        await loadDocument(selected);
      } else {
        resetDocument();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsBusy(false);
    }
  }, [watch, fetchSummaries, loadDocument, resetDocument]);

  const selectStem = useCallback(
    async (summary: ShapefileSummary) => {
      if (summary.error || (watch.phase === "active" && summary.stemPath === watch.selectedStemPath)) {
        return;
      }
      if (isDirty && typeof window !== "undefined" && !window.confirm("Discard unsaved changes and open another shapefile?")) {
        return;
      }
      setIsBusy(true);
      setError(null);
      try {
        setWatch((prev) =>
          prev.phase === "active"
            ? { ...prev, selectedStemPath: summary.stemPath }
            : prev,
        );
        await loadDocument(summary.stemPath);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsBusy(false);
      }
    },
    [watch, isDirty, loadDocument],
  );

  const save = useCallback(async () => {
    const { draft: current, hasPrj } = saveRef.current;
    if (!current || watch.phase !== "active") return;

    setIsSaving(true);
    setError(null);
    try {
      const built = await buildShapefileDocument({
        records: current.records,
        fields: current.fields,
        rows: current.rows,
        prj: current.prj,
      });

      await writeBinaryFile(`${current.stemPath}.shp`, built.shp_b64);
      await writeBinaryFile(`${current.stemPath}.shx`, built.shx_b64);
      await writeBinaryFile(`${current.stemPath}.dbf`, built.dbf_b64);

      if (built.prj_b64) {
        await writeBinaryFile(`${current.stemPath}.prj`, built.prj_b64);
      } else if (hasPrj) {
        await deleteFile(`${current.stemPath}.prj`);
      }

      const selected = await fetchSummaries(
        watch.directoryPath,
        current.stemPath,
      );
      if (selected) {
        await loadDocument(selected);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }, [watch, fetchSummaries, loadDocument]);

  const updateDraft = useCallback(
    (updater: (draft: ShapefileDocument) => void) => {
      setDraft((current) => {
        if (!current) return current;
        const next: ShapefileDocument = {
          ...current,
          records: [...current.records],
          rows: [...current.rows],
          fields: [...current.fields],
        };
        updater(next);
        return next;
      });
      setIsDirty(true);
    },
    [],
  );

  // ── Effects ──────────────────────────────────────────────────────────────

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (watchRef.current.phase === "active") {
        void stopWatchingDirectory();
      }
    };
  }, []);

  // Auto-open from URL query param.
  useEffect(() => {
    if (!autoOpenDirectory || watch.phase === "active" || isBusy || autoOpenedRef.current === autoOpenDirectory) {
      return;
    }
    autoOpenedRef.current = autoOpenDirectory;
    void openDirectory(autoOpenDirectory);
  }, [autoOpenDirectory, watch.phase, isBusy, openDirectory]);

  // File watcher for external changes.
  useEffect(() => {
    if (watch.phase !== "active") return;
    const { directoryPath, selectedStemPath } = watch;

    const unlisten = onFileChanged((changedPaths) => {
      const relevant = changedPaths.some((p) =>
        WATCH_EXTENSIONS.some((ext) => p.toLowerCase().endsWith(ext)),
      );
      if (!relevant) return;

      async function handleRelevantFileChange() {
        try {
          if (isDirty) {
            setHasExternalChanges(true);
            await fetchSummaries(directoryPath, selectedStemPath, true);
            return;
          }
          const selected = await fetchSummaries(directoryPath, selectedStemPath);
          if (selected) {
            await loadDocument(selected);
          } else {
            resetDocument();
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }

      void handleRelevantFileChange();
    });

    return unlisten;
  }, [watch, isDirty, fetchSummaries, loadDocument, resetDocument]);

  // ── Derived ──────────────────────────────────────────────────────────────

  const selectedSummary =
    watch.phase === "active"
      ? watch.summaries.find((s) => s.stemPath === watch.selectedStemPath) ?? null
      : null;

  const canSave = watch.phase === "active" && draft !== null && isDirty && !isSaving;

  const editor = {
    state: docState,
    draft,
    selectedSummary,
  };

  const status = {
    isDirty,
    hasExternalChanges,
    isBusy,
    isSaving,
    canSave,
    error,
  };

  const actions = {
    pickAndOpen,
    openDirectory,
    stopWatching,
    reload,
    selectStem,
    save,
    updateDraft,
  };

  return {
    watch,
    editor,
    status,
    actions,
  };
}
