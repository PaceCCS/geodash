import { useCallback } from "react";
import { RefreshCcw, TableProperties } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ShapefileEditor } from "./shapefile-editor";
import { useShapefileEditor } from "./use-shapefile-editor";

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
  const { loadState, draft, save, updateDraft } = useShapefileEditor(
    open,
    directoryPath,
  );

  const handleOpenChange = useCallback(
    async (nextOpen: boolean) => {
      if (!nextOpen) {
        await save();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, save],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] max-w-6xl flex-col overflow-hidden"
        showCloseButton
      >
        <DialogHeader>
          <DialogTitle>{draft?.name ?? "Shapefile Editor"}</DialogTitle>
          <DialogDescription>
            {directoryPath.replace(/^\/+/, "")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          {loadState.status === "loading" ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <RefreshCcw className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
                <p className="mt-3 text-sm text-muted-foreground">
                  Loading shapefile...
                </p>
              </div>
            </div>
          ) : loadState.status === "error" ? (
            <div className="py-12 text-center">
              <p className="text-sm text-destructive">{loadState.error}</p>
            </div>
          ) : loadState.status === "ready" && draft ? (
            <ShapefileEditor
              document={draft}
              summary={loadState.summary}
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
