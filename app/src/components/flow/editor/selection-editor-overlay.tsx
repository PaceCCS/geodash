import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { Plus, TableProperties, ToyBrick, Trash2, X } from "lucide-react";
import QuantityDisplay from "@/components/quantities/quantity-display";

import { FluidCompositionInput } from "@/components/forms/fields/fluid-composition-input";
import type { FieldApiLike } from "@/components/forms/fields/types";
import { PropertyList } from "@/components/flow/shared/property-list";
import { ShapefileEditorDialog } from "@/components/shapefile/shapefile-editor-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNetworkOptional } from "@/contexts/network-context";
import { geoCollection } from "@/lib/collections/geo";
import type { PropertyMetadata } from "@/hooks/use-schema-properties";
import type { NetworkConfigMetadata, NetworkValue } from "@/lib/api-client";
import type { FlowEdge } from "@/lib/collections/flow-nodes";
import {
  applySelectionEditorAuthoredValues,
  getConfigUnitFallback,
  getSelectionEditorAuthoredValues,
  getSelectionEditorDerivedValues,
  getSelectionEditorKindLabel,
  getSelectionEditorTitle,
  type EditableFlowSelection,
} from "@/lib/selection-editor";
import {
  getDimensionConfig,
  resolveDimensionKey,
} from "@/lib/stores/unitPreferencesSlice";
import QuantityInput from "@/components/quantities/quantity-input";

type EditorFieldKind =
  | "text"
  | "number"
  | "boolean"
  | "json"
  | "quantity"
  | "composition";

type AddFieldKind = "text" | "number" | "boolean" | "json";

type EditorFieldDraft = {
  key: string;
  kind: EditorFieldKind;
  textValue: string;
  booleanValue: boolean;
  compositionValue: NetworkValue;
  removable: boolean;
  required: boolean;
  dimension?: string;
  defaultUnit?: string;
};

type OutgoingDraft = {
  edgeId: string;
  target: string;
  weightText: string;
  removed: boolean;
};

type SelectionEditorOverlayProps = {
  open: boolean;
  selection?: EditableFlowSelection;
  edges: FlowEdge[];
  configMetadata: NetworkConfigMetadata | null;
  onClose: () => void;
  onSave: (
    nextNode: ReturnType<typeof applySelectionEditorAuthoredValues>,
    nextEdges?: FlowEdge[],
  ) => Promise<void>;
  onAddBlock?: (branchId: string) => void;
  onDelete?: (selection: EditableFlowSelection) => Promise<void>;
};

export function SelectionEditorOverlay({
  open,
  selection,
  edges,
  configMetadata,
  onClose,
  onSave,
  onAddBlock,
  onDelete,
}: SelectionEditorOverlayProps) {
  const derivedValues = useMemo(
    () => (selection ? getSelectionEditorDerivedValues(selection) : {}),
    [selection],
  );
  const [fields, setFields] = useState<EditorFieldDraft[]>([]);
  const [outgoingDrafts, setOutgoingDrafts] = useState<OutgoingDraft[]>([]);
  const [outgoingErrors, setOutgoingErrors] = useState<
    Record<string, string>
  >({});
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldKind, setNewFieldKind] = useState<AddFieldKind>("text");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const branchSourceId =
    selection?.kind === "branch" ? selection.node.id : null;

  useEffect(() => {
    if (!open || !selection) {
      setFields([]);
      setFieldErrors({});
      setOutgoingDrafts([]);
      setOutgoingErrors({});
      setSaveError(null);
      setAddError(null);
      setIsConfirmingDelete(false);
      setDeleteError(null);
      return;
    }

    const initialAuthoredValues = getSelectionEditorAuthoredValues(selection);
    const orderedKeys = getOrderedFieldKeys(
      selection,
      Object.keys(initialAuthoredValues),
    );
    setFields(
      orderedKeys.map((key) =>
        createFieldDraft(
          key,
          initialAuthoredValues[key],
          selection,
          configMetadata,
        ),
      ),
    );
    if (branchSourceId) {
      setOutgoingDrafts(
        edges
          .filter((edge) => edge.source === branchSourceId)
          .map((edge) => ({
            edgeId: edge.id,
            target: edge.target,
            weightText: String(edge.data.weight),
            removed: false,
          })),
      );
    } else {
      setOutgoingDrafts([]);
    }
    setOutgoingErrors({});
    setFieldErrors({});
    setSaveError(null);
    setAddError(null);
    setIsConfirmingDelete(false);
    setDeleteError(null);
    setResetToken((previous) => previous + 1);
  }, [
    open,
    selection?.query,
    selection?.kind === "block" ? selection.block?.type : undefined,
    configMetadata,
    branchSourceId,
    edges,
  ]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !selection) {
    return null;
  }

  const title = getSelectionEditorTitle(selection);
  const kindLabel = getSelectionEditorKindLabel(selection);
  const hasDerivedValues = Object.keys(derivedValues).length > 0;

  const updateField = (
    key: string,
    updater: (field: EditorFieldDraft) => EditorFieldDraft,
  ) => {
    setFields((previous) =>
      previous.map((field) => (field.key === key ? updater(field) : field)),
    );
    setFieldErrors((previous) => {
      if (!(key in previous)) {
        return previous;
      }

      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const updateOutgoingWeight = (edgeId: string, weightText: string) => {
    setOutgoingDrafts((previous) =>
      previous.map((draft) =>
        draft.edgeId === edgeId ? { ...draft, weightText } : draft,
      ),
    );
    setOutgoingErrors((previous) => {
      if (!(edgeId in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[edgeId];
      return next;
    });
  };

  const toggleOutgoingRemoved = (edgeId: string) => {
    setOutgoingDrafts((previous) =>
      previous.map((draft) =>
        draft.edgeId === edgeId ? { ...draft, removed: !draft.removed } : draft,
      ),
    );
    setOutgoingErrors((previous) => {
      if (!(edgeId in previous)) {
        return previous;
      }
      const next = { ...previous };
      delete next[edgeId];
      return next;
    });
  };

  const handleAddField = () => {
    const key = newFieldName.trim();
    if (!key) {
      setAddError("Enter a property name.");
      return;
    }

    if (fields.some((field) => field.key === key)) {
      setAddError("That property already exists on this selection.");
      return;
    }

    const nextField = createEmptyFieldDraft(
      key,
      selection,
      configMetadata,
      newFieldKind,
    );
    setFields((previous) => [...previous, nextField]);
    setNewFieldName("");
    setNewFieldKind("text");
    setAddError(null);
  };

  const handleDelete = async () => {
    if (!selection || !onDelete) {
      return;
    }

    setDeleteError(null);
    setIsDeleting(true);

    try {
      await onDelete(selection);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete selection.",
      );
      setIsConfirmingDelete(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSave = async () => {
    if (!selection) {
      return;
    }

    const nextFieldErrors: Record<string, string> = {};
    const nextAuthoredValues: Record<string, NetworkValue> = {};

    for (const field of fields) {
      const result = materializeFieldDraft(field);
      if (result.error) {
        nextFieldErrors[field.key] = result.error;
        continue;
      }

      if (result.value !== undefined) {
        nextAuthoredValues[field.key] = result.value;
      }
    }

    const nextOutgoingErrors: Record<string, string> = {};
    const validatedOutgoing: Array<{
      edgeId: string;
      target: string;
      weight: number;
      removed: boolean;
    }> = [];

    if (branchSourceId) {
      for (const draft of outgoingDrafts) {
        if (draft.removed) {
          validatedOutgoing.push({ ...draft, weight: 0 });
          continue;
        }

        const trimmed = draft.weightText.trim();
        if (!trimmed) {
          nextOutgoingErrors[draft.edgeId] = "Weight is required.";
          continue;
        }

        const parsed = Number(trimmed);
        if (!Number.isFinite(parsed)) {
          nextOutgoingErrors[draft.edgeId] = "Enter a valid number.";
          continue;
        }

        validatedOutgoing.push({ ...draft, weight: parsed });
      }
    }

    if (
      Object.keys(nextFieldErrors).length > 0 ||
      Object.keys(nextOutgoingErrors).length > 0
    ) {
      setFieldErrors(nextFieldErrors);
      setOutgoingErrors(nextOutgoingErrors);
      setSaveError("Fix the highlighted fields before applying changes.");
      return;
    }

    setFieldErrors({});
    setOutgoingErrors({});
    setSaveError(null);
    setIsSaving(true);

    let nextEdges: FlowEdge[] | undefined;
    if (branchSourceId) {
      const originalById = new Map(
        edges
          .filter((edge) => edge.source === branchSourceId)
          .map((edge) => [edge.id, edge]),
      );

      const branchEdgesChanged = validatedOutgoing.some((draft) => {
        if (draft.removed) {
          return true;
        }
        const original = originalById.get(draft.edgeId);
        return !original || original.data.weight !== draft.weight;
      });

      if (branchEdgesChanged) {
        const otherEdges = edges.filter(
          (edge) => edge.source !== branchSourceId,
        );
        const updatedBranchEdges = validatedOutgoing
          .filter((draft) => !draft.removed)
          .map((draft) => {
            const original = originalById.get(draft.edgeId);
            if (!original) {
              return null;
            }
            return {
              ...original,
              data: { ...original.data, weight: draft.weight },
            };
          })
          .filter((edge): edge is FlowEdge => edge !== null);
        nextEdges = [...otherEdges, ...updatedBranchEdges];
      }
    }

    try {
      await onSave(
        applySelectionEditorAuthoredValues(selection, nextAuthoredValues),
        nextEdges,
      );
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Failed to apply selection changes.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-30 bg-background/75 backdrop-blur-sm p-4 md:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        role="dialog"
        aria-modal="false"
        aria-label={`${kindLabel} editor: ${title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Edit {kindLabel}
            </p>
            <h2 className="text-lg font-semibold wrap-break-word">{title}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
              {selection.query}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selection.kind === "branch" && onAddBlock ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => onAddBlock(selection.node.id)}
              >
                <ToyBrick className="size-4" />
                Add Block
              </Button>
            ) : null}
            <Button type="button" size="icon" variant="ghost" onClick={onClose}>
              <X className="size-4" />
              <span className="sr-only">Close editor</span>
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
          <div className="min-h-0 overflow-y-auto">
            <div className="border-b border-border px-5 py-4">
              <p className="text-sm font-medium">Authored</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Edit the saved values for this selection. Derived values stay
                read-only.
              </p>
            </div>

            <div className="divide-y divide-border/60">
              {fields.map((field) => (
                <EditorFieldRow
                  key={field.key}
                  field={field}
                  selection={selection}
                  error={fieldErrors[field.key]}
                  resetToken={resetToken}
                  onChange={updateField}
                  onRemove={
                    field.removable
                      ? () => {
                          setFields((previous) =>
                            previous.filter(
                              (candidate) => candidate.key !== field.key,
                            ),
                          );
                          setFieldErrors((previous) => {
                            if (!(field.key in previous)) {
                              return previous;
                            }

                            const next = { ...previous };
                            delete next[field.key];
                            return next;
                          });
                        }
                      : undefined
                  }
                />
              ))}
            </div>

            {branchSourceId ? (
              <div className="border-t border-border">
                <div className="px-5 py-4">
                  <p className="text-sm font-medium">Outgoing</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Connections from this branch. Drag from the right handle in
                    the canvas to add new ones.
                  </p>
                </div>
                {outgoingDrafts.length === 0 ? (
                  <p className="px-5 pb-4 text-xs text-muted-foreground">
                    No outgoing connections.
                  </p>
                ) : (
                  <div className="divide-y divide-border/60">
                    {outgoingDrafts.map((draft) => (
                      <div
                        key={draft.edgeId}
                        className="grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] md:items-start"
                      >
                        <div className="space-y-1">
                          <p
                            className={
                              draft.removed
                                ? "font-mono text-sm break-all line-through text-muted-foreground"
                                : "font-mono text-sm break-all"
                            }
                          >
                            {draft.target}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {draft.removed ? "Will be removed" : "Weight"}
                          </p>
                        </div>
                        <div className="space-y-2 min-w-0">
                          <Input
                            type="number"
                            step="any"
                            value={draft.weightText}
                            disabled={draft.removed}
                            onChange={(event) =>
                              updateOutgoingWeight(
                                draft.edgeId,
                                event.target.value,
                              )
                            }
                          />
                          {outgoingErrors[draft.edgeId] ? (
                            <p className="text-xs text-destructive">
                              {outgoingErrors[draft.edgeId]}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => toggleOutgoingRemoved(draft.edgeId)}
                            title={
                              draft.removed
                                ? "Restore connection"
                                : "Remove connection"
                            }
                          >
                            <Trash2 className="size-4" />
                            <span className="sr-only">
                              {draft.removed
                                ? "Restore connection"
                                : "Remove connection"}
                            </span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="border-t border-border px-5 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Add Property
                  </label>
                  <Input
                    value={newFieldName}
                    onChange={(event) => setNewFieldName(event.target.value)}
                    placeholder="propertyName"
                    className="font-mono text-sm"
                  />
                </div>
                <div className="w-full md:w-40 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">
                    Value Type
                  </label>
                  <Select
                    value={newFieldKind}
                    onValueChange={(value) =>
                      setNewFieldKind(value as AddFieldKind)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">Text</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="boolean">Boolean</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  className="gap-2"
                  onClick={handleAddField}
                >
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>
              {addError ? (
                <p className="mt-2 text-xs text-destructive">{addError}</p>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto border-t border-border xl:border-t-0 xl:border-l">
            <div className="border-b border-border px-5 py-4">
              <p className="text-sm font-medium">Derived</p>
              <p className="mt-1 text-xs text-muted-foreground">
                These values come from propagation or runtime shaping and
                aren&apos;t editable here.
              </p>
            </div>
            {hasDerivedValues ? (
              <PropertyList value={derivedValues} />
            ) : (
              <p className="px-5 py-4 text-xs text-muted-foreground">
                No derived values for this selection.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="flex min-h-5 items-center gap-2">
            {onDelete ? (
              isConfirmingDelete ? (
                <>
                  <span className="text-xs text-muted-foreground">
                    Delete this {kindLabel.toLowerCase()}?
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsConfirmingDelete(false)}
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 text-destructive hover:text-destructive"
                  onClick={() => {
                    setDeleteError(null);
                    setIsConfirmingDelete(true);
                  }}
                  disabled={isSaving || isDeleting}
                >
                  <Trash2 className="size-4" />
                  Delete
                </Button>
              )
            ) : null}
            {saveError ? (
              <p className="text-xs text-destructive">{saveError}</p>
            ) : deleteError ? (
              <p className="text-xs text-destructive">{deleteError}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving || isDeleting}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isDeleting}
            >
              {isSaving ? "Applying..." : "Apply Changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditorFieldRow({
  field,
  selection,
  error,
  resetToken,
  onChange,
  onRemove,
}: {
  field: EditorFieldDraft;
  selection: EditableFlowSelection;
  error?: string;
  resetToken: number;
  onChange: (
    key: string,
    updater: (field: EditorFieldDraft) => EditorFieldDraft,
  ) => void;
  onRemove?: () => void;
}) {
  const dimensionLabel = useMemo(() => {
    const resolvedDimension = resolveDimensionKey(field.dimension);
    if (!resolvedDimension) {
      return field.dimension ?? null;
    }

    return getDimensionConfig(resolvedDimension).label;
  }, [field.dimension]);

  const { data: geoBlocks = [] } = useLiveQuery(geoCollection);
  const network = useNetworkOptional();
  const [shapefileDialogOpen, setShapefileDialogOpen] = useState(false);

  const geoBlock = useMemo(() => {
    if (
      field.key !== "route" ||
      !field.textValue.trim() ||
      selection.kind !== "block"
    ) {
      return null;
    }

    return (
      geoBlocks.find(
        (b) =>
          b.branchId === selection.node.id &&
          b.blockIndex === selection.blockIndex,
      ) ?? null
    );
  }, [field.key, field.textValue, geoBlocks, selection]);

  const shapefileDirectoryPath = useMemo(() => {
    if (!geoBlock || geoBlock.format !== "shapefile" || !network) {
      return null;
    }
    return `${network.networkId}/${field.textValue.trim()}`;
  }, [geoBlock, network, field.textValue]);

  if (field.kind === "composition") {
    const metadata = createEditorMetadata(
      selection.kind === "block"
        ? (selection.block?.type ?? "Source")
        : "Source",
      field.key,
      "object",
    );
    const compositionFieldApi: FieldApiLike = {
      name: field.key,
      state: {
        value: field.compositionValue,
        meta: {
          isTouched: true,
          errors: error ? [error] : [],
        },
      },
      handleChange: (value) => {
        onChange(field.key, (current) => ({
          ...current,
          compositionValue: value as NetworkValue,
        }));
      },
      handleBlur: () => {},
    };

    return (
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm">{field.key}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Source composition uses the dedicated fluid editor.
            </p>
          </div>
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
              <span className="sr-only">Remove property</span>
            </Button>
          ) : null}
        </div>
        <FluidCompositionInput
          metadata={metadata}
          field={compositionFieldApi}
        />
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] md:items-start">
      <div className="space-y-1">
        <p className="font-mono text-sm break-all">{field.key}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <RouteFieldLabel
            fieldKey={field.key}
            fieldKind={field.kind}
            geoBlock={geoBlock}
          />
          {dimensionLabel ? (
            <span>
              {dimensionLabel}
              {field.defaultUnit ? ` (${field.defaultUnit})` : ""}
            </span>
          ) : null}
          {field.required ? <span>Required</span> : null}
        </div>
      </div>

      <div className="space-y-2 min-w-0">
        {field.kind === "text" ? (
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={field.textValue}
              onChange={(event) =>
                onChange(field.key, (current) => ({
                  ...current,
                  textValue: event.target.value,
                }))
              }
            />
            {shapefileDirectoryPath ? (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShapefileDialogOpen(true)}
                title="Edit shapefile"
              >
                <TableProperties className="size-4" />
              </Button>
            ) : null}
          </div>
        ) : null}

        {field.kind === "number" ? (
          <Input
            type="number"
            step={field.key === "quantity" ? 1 : "any"}
            min={field.key === "quantity" ? 1 : undefined}
            value={field.textValue}
            onChange={(event) =>
              onChange(field.key, (current) => ({
                ...current,
                textValue: event.target.value,
              }))
            }
          />
        ) : null}

        {field.kind === "boolean" ? (
          <label className="flex h-10 items-center gap-3 rounded-md border border-input px-3 text-sm">
            <input
              type="checkbox"
              checked={field.booleanValue}
              onChange={(event) =>
                onChange(field.key, (current) => ({
                  ...current,
                  booleanValue: event.target.checked,
                }))
              }
            />
            <span>{field.booleanValue ? "True" : "False"}</span>
          </label>
        ) : null}

        {field.kind === "json" ? (
          <textarea
            value={field.textValue}
            onChange={(event) =>
              onChange(field.key, (current) => ({
                ...current,
                textValue: event.target.value,
              }))
            }
            rows={Math.max(4, field.textValue.split("\n").length)}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 min-h-28 w-full rounded-md border bg-transparent px-3 py-2 text-sm font-mono shadow-xs outline-none focus-visible:ring-[3px]"
          />
        ) : null}

        {field.kind === "quantity" ? (
          <QuantityInput
            key={`${selection.query}:${resetToken}:${field.key}:${field.defaultUnit ?? ""}`}
            unit={field.defaultUnit ?? ""}
            defaultValue={field.textValue}
            handleExpression={(value) =>
              onChange(field.key, (current) => ({
                ...current,
                textValue: value ?? "",
              }))
            }
          />
        ) : null}

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="flex justify-end">
        {onRemove ? (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
            <Trash2 className="size-4" />
            <span className="sr-only">Remove property</span>
          </Button>
        ) : null}
      </div>

      {shapefileDirectoryPath ? (
        <ShapefileEditorDialog
          open={shapefileDialogOpen}
          directoryPath={shapefileDirectoryPath}
          onOpenChange={setShapefileDialogOpen}
        />
      ) : null}
    </div>
  );
}

function createFieldDraft(
  key: string,
  value: NetworkValue,
  selection: EditableFlowSelection,
  configMetadata: NetworkConfigMetadata | null,
): EditorFieldDraft {
  const kind = inferFieldKind(key, value, selection, configMetadata);
  return createDraftForKind(key, value, kind, selection, configMetadata);
}

function createEmptyFieldDraft(
  key: string,
  selection: EditableFlowSelection,
  configMetadata: NetworkConfigMetadata | null,
  fallbackKind: AddFieldKind,
): EditorFieldDraft {
  const inferredKind = inferFieldKind(
    key,
    undefined,
    selection,
    configMetadata,
  );
  const kind =
    inferredKind === "quantity" || inferredKind === "composition"
      ? inferredKind
      : fallbackKind;

  const initialValue = getInitialValueForFieldKind(kind);

  return createDraftForKind(key, initialValue, kind, selection, configMetadata);
}

function createDraftForKind(
  key: string,
  value: NetworkValue,
  kind: EditorFieldKind,
  selection: EditableFlowSelection,
  configMetadata: NetworkConfigMetadata | null,
): EditorFieldDraft {
  const blockType =
    selection.kind === "block" ? selection.block?.type : undefined;
  const unitFallback = getConfigUnitFallback(configMetadata, key, blockType);

  return {
    key,
    kind,
    textValue: getDraftTextValue(kind, value),
    booleanValue: typeof value === "boolean" ? value : false,
    compositionValue: value,
    removable: isFieldRemovable(selection, key),
    required: isFieldRequired(selection, key),
    dimension: unitFallback?.dimension,
    defaultUnit: unitFallback?.defaultUnit,
  };
}

function getInitialValueForFieldKind(kind: EditorFieldKind): NetworkValue {
  switch (kind) {
    case "boolean":
      return false;
    case "json":
    case "composition":
      return {};
    default:
      return "";
  }
}

function getDraftTextValue(kind: EditorFieldKind, value: NetworkValue): string {
  if (kind === "json") {
    return JSON.stringify(value ?? {}, null, 2);
  }

  if (kind === "number" || kind === "quantity" || kind === "text") {
    return value == null ? "" : String(value);
  }

  return "";
}

function inferFieldKind(
  key: string,
  value: NetworkValue,
  selection: EditableFlowSelection,
  configMetadata: NetworkConfigMetadata | null,
): EditorFieldKind {
  if (
    selection.kind === "block" &&
    selection.block?.type === "Source" &&
    key === "composition"
  ) {
    return "composition";
  }

  const unitFallback = getConfigUnitFallback(
    configMetadata,
    key,
    selection.kind === "block" ? selection.block?.type : undefined,
  );
  if (unitFallback) {
    return "quantity";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (value !== null && value !== undefined && typeof value === "object") {
    return "json";
  }

  return "text";
}

function materializeFieldDraft(field: EditorFieldDraft): {
  value?: NetworkValue;
  error?: string;
} {
  switch (field.kind) {
    case "text":
      if (!field.textValue.trim() && field.required) {
        return { error: "This field is required." };
      }
      return { value: field.textValue };
    case "number": {
      if (!field.textValue.trim()) {
        return field.required
          ? { error: "This field is required." }
          : { value: undefined };
      }

      const parsed = Number(field.textValue);
      if (!Number.isFinite(parsed)) {
        return { error: "Enter a valid number." };
      }

      if (field.key === "quantity") {
        if (!Number.isInteger(parsed) || parsed < 1) {
          return {
            error: "Quantity must be a whole number greater than zero.",
          };
        }
      }

      return { value: parsed };
    }
    case "boolean":
      return { value: field.booleanValue };
    case "quantity":
      if (!field.textValue.trim()) {
        return field.required
          ? { error: "This field is required." }
          : { value: undefined };
      }
      return { value: field.textValue.trim() };
    case "composition":
      return { value: field.compositionValue };
    case "json": {
      if (!field.textValue.trim()) {
        return field.required
          ? { error: "This field is required." }
          : { value: undefined };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(field.textValue);
      } catch {
        return { error: "Enter valid JSON." };
      }

      if (field.key === "position") {
        const positionValue = parsed as Record<string, unknown>;
        if (
          !parsed ||
          typeof parsed !== "object" ||
          Array.isArray(parsed) ||
          typeof positionValue.x !== "number" ||
          typeof positionValue.y !== "number"
        ) {
          return {
            error: "Position must be a JSON object with numeric x and y.",
          };
        }
      }

      return { value: parsed as NetworkValue };
    }
  }
}

function isFieldRequired(
  selection: EditableFlowSelection,
  key: string,
): boolean {
  switch (selection.kind) {
    case "block":
      return key === "type" || key === "quantity";
    case "branch":
    case "group":
      return key === "position";
  }
}

function isFieldRemovable(
  selection: EditableFlowSelection,
  key: string,
): boolean {
  switch (selection.kind) {
    case "block":
      return key !== "type" && key !== "quantity";
    case "branch":
    case "group":
      return key !== "label" && key !== "position";
  }
}

function getOrderedFieldKeys(
  selection: EditableFlowSelection,
  keys: string[],
): string[] {
  const priority =
    selection.kind === "block"
      ? ["type", "quantity", "composition"]
      : ["label", "position", "parentId", "width", "height"];

  const remaining = keys
    .filter((key) => !priority.includes(key))
    .sort((left, right) => left.localeCompare(right));

  return [...priority.filter((key) => keys.includes(key)), ...remaining];
}

function getEditorFieldKindLabel(kind: EditorFieldKind): string {
  switch (kind) {
    case "text":
      return "Text";
    case "number":
      return "Number";
    case "boolean":
      return "Boolean";
    case "json":
      return "JSON";
    case "quantity":
      return "Quantity";
    case "composition":
      return "Fluid";
  }
}

function RouteFieldLabel({
  fieldKey,
  fieldKind,
  geoBlock,
}: {
  fieldKey: string;
  fieldKind: EditorFieldKind;
  geoBlock: { format: string; routeLength: string | null } | null;
}) {
  if (fieldKey !== "route") {
    return <span>{getEditorFieldKindLabel(fieldKind)}</span>;
  }

  if (!geoBlock) {
    return <span>Path to route specifier</span>;
  }

  return (
    <span className="inline-flex items-center">
      {getGeoFormatLabel(geoBlock.format)}
      {geoBlock.routeLength ? (
        <>
          {" ("}
          <QuantityDisplay dimension="length">
            {geoBlock.routeLength}
          </QuantityDisplay>
          {")"}
        </>
      ) : null}
    </span>
  );
}

function getGeoFormatLabel(format: string): string {
  switch (format) {
    case "shapefile":
      return "Shapefile";
    case "kmz":
      return "KMZ";
    case "csv":
      return "CSV";
    case "coordinates":
      return "Coordinates";
    default:
      return format;
  }
}

function createEditorMetadata(
  blockType: string,
  property: string,
  type: PropertyMetadata["type"],
): PropertyMetadata {
  return {
    block_type: blockType,
    property,
    required: false,
    type,
    title: property,
  };
}
