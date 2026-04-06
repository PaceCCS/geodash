import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildShapefileDocument,
  getShapefileDocument,
  getShapefileSummaries,
  type ShapefileDocument,
  type ShapefileSummary,
} from "@/lib/api-client";
import { appendActivityLogEntry } from "@/contexts/activity-log-context";
import { deleteFile, writeBinaryFile } from "@/lib/desktop";

type IdleState = { status: "idle" };
type LoadingState = { status: "loading" };
type ErrorState = { status: "error"; error: string };
type EmptyState = { status: "empty" };
type ReadyState = {
  status: "ready";
  summary: ShapefileSummary;
  loaded: ShapefileDocument;
};

type LoadState = IdleState | LoadingState | ErrorState | EmptyState | ReadyState;

export function useShapefileEditor(open: boolean, directoryPath: string) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "idle" });
  const [draft, setDraft] = useState<ShapefileDocument | null>(null);
  const isDirtyRef = useRef(false);

  // Single ref for save-time data — avoids sync effects.
  const saveRef = useRef<{
    draft: ShapefileDocument | null;
    hasPrj: boolean;
  }>({ draft: null, hasPrj: false });

  // Keep saveRef in sync without a separate useEffect per field.
  saveRef.current.draft = draft;
  if (loadState.status === "ready") {
    saveRef.current.hasPrj = loadState.loaded.hasPrj;
  }

  useEffect(() => {
    if (!open) {
      setLoadState({ status: "idle" });
      setDraft(null);
      isDirtyRef.current = false;
      return;
    }

    let cancelled = false;
    setLoadState({ status: "loading" });

    async function loadInitialDocument() {
      try {
        const summaries = await getShapefileSummaries(directoryPath);
        const selectable = summaries.filter((s) => !s.error);
        if (cancelled) return;

        if (!selectable[0]) {
          setLoadState({ status: "empty" });
          return;
        }

        const doc = await getShapefileDocument(selectable[0].stemPath);
        if (cancelled) return;

        setLoadState({ status: "ready", summary: selectable[0], loaded: doc });
        setDraft(structuredClone(doc));
        isDirtyRef.current = false;
      } catch (err) {
        if (cancelled) return;
        setLoadState({
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    void loadInitialDocument();

    return () => {
      cancelled = true;
    };
  }, [open, directoryPath]);

  const save = useCallback(async () => {
    const { draft: current, hasPrj } = saveRef.current;
    if (!current || !isDirtyRef.current) return;

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

      isDirtyRef.current = false;

      const name =
        current.name ?? current.stemPath.split("/").pop() ?? "shapefile";
      appendActivityLogEntry({
        source: "details",
        kind: "change",
        message: `Saved shapefile ${name}`,
        changedPaths: [
          `${current.stemPath}.shp`,
          `${current.stemPath}.shx`,
          `${current.stemPath}.dbf`,
        ],
      });
    } catch (err) {
      console.error("[shapefile-editor-dialog] save failed:", err);
    }
  }, []);

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
      isDirtyRef.current = true;
    },
    [],
  );

  return { loadState, draft, save, updateDraft };
}
