import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Block, NetworkValue } from "@/lib/api-client";
import type {
  FlowBranchNode,
  FlowNode,
} from "@/lib/collections/flow-nodes";

type ExtraFieldKind = "text" | "number" | "boolean" | "json";

type ExtraFieldDraft = {
  key: string;
  kind: ExtraFieldKind;
  textValue: string;
  booleanValue: boolean;
};

type BlockCreatorDialogProps = {
  open: boolean;
  branch?: FlowBranchNode;
  onClose: () => void;
  onSave: (nextNode: FlowNode) => Promise<void>;
};

export function BlockCreatorDialog({
  open,
  branch,
  onClose,
  onSave,
}: BlockCreatorDialogProps) {
  const [typeValue, setTypeValue] = useState("");
  const [typeError, setTypeError] = useState<string | null>(null);
  const [extraFields, setExtraFields] = useState<ExtraFieldDraft[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldKind, setNewFieldKind] = useState<ExtraFieldKind>("text");
  const [addError, setAddError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    setTypeValue("");
    setTypeError(null);
    setExtraFields([]);
    setFieldErrors({});
    setNewFieldName("");
    setNewFieldKind("text");
    setAddError(null);
    setSaveError(null);
    setIsSaving(false);
  }, [open, branch?.id]);

  const updateField = (
    key: string,
    updater: (field: ExtraFieldDraft) => ExtraFieldDraft,
  ) => {
    setExtraFields((previous) =>
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

  const handleAddField = () => {
    const key = newFieldName.trim();
    if (!key) {
      setAddError("Enter a property name.");
      return;
    }

    if (key === "type") {
      setAddError("Type is already set above.");
      return;
    }

    if (extraFields.some((field) => field.key === key)) {
      setAddError("That property already exists on this block.");
      return;
    }

    setExtraFields((previous) => [
      ...previous,
      {
        key,
        kind: newFieldKind,
        textValue: "",
        booleanValue: false,
      },
    ]);
    setNewFieldName("");
    setNewFieldKind("text");
    setAddError(null);
  };

  const handleSave = async () => {
    if (!branch) {
      return;
    }

    const trimmedType = typeValue.trim();
    if (!trimmedType) {
      setTypeError("Type is required.");
      return;
    }

    const nextFieldErrors: Record<string, string> = {};
    const extras: Record<string, NetworkValue> = {};

    for (const field of extraFields) {
      const result = materializeExtraField(field);
      if (result.error) {
        nextFieldErrors[field.key] = result.error;
        continue;
      }

      if (result.value !== undefined) {
        extras[field.key] = result.value;
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setSaveError("Fix the highlighted fields before creating the block.");
      return;
    }

    setFieldErrors({});
    setSaveError(null);
    setTypeError(null);
    setIsSaving(true);

    try {
      await onSave(appendBlockToBranch(branch, trimmedType, extras));
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Failed to create the block.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !isSaving) {
      onClose();
    }
  };

  const branchLabel = branch ? branch.data.label || branch.id : "";

  return (
    <Dialog open={open && Boolean(branch)} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add Block</DialogTitle>
          <DialogDescription>
            {branchLabel
              ? `Create a new block in ${branchLabel}.`
              : "Create a new block."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 flex-1 overflow-y-auto border-t border-b border-border">
          <div className="grid gap-3 px-6 py-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] md:items-start">
            <div className="space-y-1">
              <p className="font-mono text-sm break-all">type</p>
              <p className="text-xs text-muted-foreground">Required</p>
            </div>
            <div className="space-y-2 min-w-0">
              <Input
                value={typeValue}
                onChange={(event) => {
                  setTypeValue(event.target.value);
                  if (typeError) {
                    setTypeError(null);
                  }
                }}
                placeholder="Source"
                autoFocus
              />
              {typeError ? (
                <p className="text-xs text-destructive">{typeError}</p>
              ) : null}
            </div>
          </div>

          {extraFields.map((field) => (
            <ExtraFieldRow
              key={field.key}
              field={field}
              error={fieldErrors[field.key]}
              onChange={updateField}
              onRemove={() => {
                setExtraFields((previous) =>
                  previous.filter((candidate) => candidate.key !== field.key),
                );
                setFieldErrors((previous) => {
                  if (!(field.key in previous)) {
                    return previous;
                  }

                  const next = { ...previous };
                  delete next[field.key];
                  return next;
                });
              }}
            />
          ))}

          <div className="border-t border-border px-6 py-4">
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
                    setNewFieldKind(value as ExtraFieldKind)
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
              <Button type="button" className="gap-2" onClick={handleAddField}>
                <Plus className="size-4" />
                Add
              </Button>
            </div>
            {addError ? (
              <p className="mt-2 text-xs text-destructive">{addError}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <div className="min-h-5">
            {saveError ? (
              <p className="text-xs text-destructive">{saveError}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !branch}
            >
              {isSaving ? "Creating..." : "Create Block"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtraFieldRow({
  field,
  error,
  onChange,
  onRemove,
}: {
  field: ExtraFieldDraft;
  error?: string;
  onChange: (
    key: string,
    updater: (field: ExtraFieldDraft) => ExtraFieldDraft,
  ) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid gap-3 border-t border-border/60 px-6 py-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] md:items-start">
      <div className="space-y-1">
        <p className="font-mono text-sm break-all">{field.key}</p>
        <p className="text-xs text-muted-foreground">
          {getExtraFieldKindLabel(field.kind)}
        </p>
      </div>

      <div className="space-y-2 min-w-0">
        {field.kind === "text" ? (
          <Input
            value={field.textValue}
            onChange={(event) =>
              onChange(field.key, (current) => ({
                ...current,
                textValue: event.target.value,
              }))
            }
          />
        ) : null}

        {field.kind === "number" ? (
          <Input
            type="number"
            step="any"
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

        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>

      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="size-4" />
          <span className="sr-only">Remove property</span>
        </Button>
      </div>
    </div>
  );
}

function materializeExtraField(field: ExtraFieldDraft): {
  value?: NetworkValue;
  error?: string;
} {
  switch (field.kind) {
    case "text":
      return { value: field.textValue };
    case "number": {
      if (!field.textValue.trim()) {
        return { value: undefined };
      }

      const parsed = Number(field.textValue);
      if (!Number.isFinite(parsed)) {
        return { error: "Enter a valid number." };
      }

      return { value: parsed };
    }
    case "boolean":
      return { value: field.booleanValue };
    case "json": {
      if (!field.textValue.trim()) {
        return { value: undefined };
      }

      try {
        return { value: JSON.parse(field.textValue) as NetworkValue };
      } catch {
        return { error: "Enter valid JSON." };
      }
    }
  }
}

function getExtraFieldKindLabel(kind: ExtraFieldKind): string {
  switch (kind) {
    case "text":
      return "Text";
    case "number":
      return "Number";
    case "boolean":
      return "Boolean";
    case "json":
      return "JSON";
  }
}

function appendBlockToBranch(
  branch: FlowBranchNode,
  type: string,
  extras: Record<string, NetworkValue>,
): FlowNode {
  const block: Block = {
    type,
    quantity:
      typeof extras.quantity === "number" && Number.isFinite(extras.quantity)
        ? extras.quantity
        : 1,
    kind: type.toLowerCase(),
    label: type,
  };

  for (const [key, value] of Object.entries(extras)) {
    if (key === "type" || key === "quantity" || value === undefined) {
      continue;
    }

    block[key] = structuredClone(value);
  }

  return {
    ...branch,
    data: {
      ...branch.data,
      blocks: [...branch.data.blocks, block],
    },
  };
}
