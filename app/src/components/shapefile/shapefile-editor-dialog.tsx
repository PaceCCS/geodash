import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw, TableProperties } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildShapefileDocument,
  getShapefileDocument,
  getShapefileSummaries,
  type ShapefileDocument,
  type ShapefileSummary,
} from "@/lib/api-client";
import { deleteFile, writeBinaryFile } from "@/lib/desktop";
import { ShapefileEditor } from "./shapefile-editor";

type ShapefileEditorDialogProps = {
  open: boolean;
  directoryPath: string;
  onOpenChange: (open: boolean) => void;
};

export function ShapefileEditorDialog({
  open,
  directoryPath,
  onOpenChange,
}: ShapefileEditorDialogProps) {
  const [summaries, setSummaries] = useState<ShapefileSummary[]>([]);
  const [selectedStemPath, setSelectedStemPath] = useState<string | null>(null);
  const [loadedDocument, setLoadedDocument] = useState<ShapefileDocument | null>(null);
  const [draftDocument, setDraftDocument] = useState<ShapefileDocument | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDirtyRef = useRef(false);
  const draftRef = useRef<ShapefileDocument | null>(null);
  const loadedRef = useRef<ShapefileDocument | null>(null);

  useEffect(() => {
    draftRef.current = draftDocument;
  }, [draftDocument]);

  useEffect(() => {
    loadedRef.current = loadedDocument;
  }, [loadedDocument]);

  const selectedSummary = summaries.find(
    (s) => s.stemPath === selectedStemPath,
  ) ?? null;

  const loadDirectory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const nextSummaries = await getShapefileSummaries(directoryPath);
      setSummaries(nextSummaries);

      const selectable = nextSummaries.filter((s) => !s.error);
      const firstStem = selectable[0]?.stemPath ?? null;
      setSelectedStemPath(firstStem);

      if (firstStem) {
        const doc = await getShapefileDocument(firstStem);
        setLoadedDocument(doc);
        setDraftDocument(structuredClone(doc));
        isDirtyRef.current = false;
      } else {
        setLoadedDocument(null);
        setDraftDocument(null);
        isDirtyRef.current = false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [directoryPath]);

  useEffect(() => {
    if (open) {
      void loadDirectory();
    }

    return () => {
      setSummaries([]);
      setSelectedStemPath(null);
      setLoadedDocument(null);
      setDraftDocument(null);
      isDirtyRef.current = false;
    };
  }, [open, loadDirectory]);

  const saveDocument = useCallback(async () => {
    const draft = draftRef.current;
    const loaded = loadedRef.current;
    if (!draft || !isDirtyRef.current) {
      return;
    }

    try {
      const built = await buildShapefileDocument({
        records: draft.records,
        fields: draft.fields,
        rows: draft.rows,
        prj: draft.prj,
      });

      await writeBinaryFile(`${draft.stemPath}.shp`, built.shp_b64);
      await writeBinaryFile(`${draft.stemPath}.shx`, built.shx_b64);
      await writeBinaryFile(`${draft.stemPath}.dbf`, built.dbf_b64);

      if (built.prj_b64) {
        await writeBinaryFile(`${draft.stemPath}.prj`, built.prj_b64);
      } else if (loaded?.hasPrj) {
        await deleteFile(`${draft.stemPath}.prj`);
      }

      isDirtyRef.current = false;
    } catch (err) {
      console.error("[shapefile-editor-dialog] save failed:", err);
    }
  }, []);

  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen && isDirtyRef.current) {
        await saveDocument();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, saveDocument],
  );

  const updateDraft = useCallback(
    (updater: (draft: ShapefileDocument) => void) => {
      setDraftDocument((current) => {
        if (!current) {
          return current;
        }
        const next = structuredClone(current);
        updater(next);
        return next;
      });
      isDirtyRef.current = true;
    },
    [],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>
            {draftDocument?.name ?? "Shapefile Editor"}
          </DialogTitle>
          <DialogDescription>
            {directoryPath.replace(/^\/+/, "")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <RefreshCcw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">Loading shapefile...</p>
              </div>
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          ) : draftDocument ? (
            <ShapefileEditor
              document={draftDocument}
              summary={selectedSummary}
              onUpdate={updateDraft}
            />
          ) : (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <TableProperties className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No shapefiles found in this directory.
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
