import type { FlowResolvedSelection } from "@/lib/flow-selection";
import { PropertyList } from "@/components/flow/shared/property-list";
import { SelectionHeader } from "@/components/flow/shared/selection-header";

type BlockDetailsPanelProps = {
  selection: Extract<FlowResolvedSelection, { kind: "block" }>;
  value: Record<string, unknown> | null;
  onEdit?: () => void;
  editLabel?: string;
  editShortcut?: string;
};

export function BlockDetailsPanel({
  selection,
  value,
  onEdit,
  editLabel,
  editShortcut,
}: BlockDetailsPanelProps) {
  return (
    <div className="flex flex-col">
      <SelectionHeader
        kindLabel="Block"
        title={
          selection.block?.label ||
          selection.block?.type ||
          `${selection.node.id} block ${selection.blockIndex}`
        }
        query={selection.query}
        onEdit={onEdit}
        editLabel={editLabel}
        editShortcut={editShortcut}
      />
      {value ? (
        <PropertyList value={value} />
      ) : (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          This block query does not resolve to a block in the current branch.
        </p>
      )}
    </div>
  );
}
