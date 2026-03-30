import type { FlowResolvedSelection } from "@/lib/flow-selection";
import { PropertyList } from "@/components/flow/shared/property-list";
import { SelectionHeader } from "@/components/flow/shared/selection-header";

type BranchDetailsPanelProps = {
  selection: Extract<FlowResolvedSelection, { kind: "branch" }>;
  value: Record<string, unknown>;
  onEdit?: () => void;
  editLabel?: string;
  editShortcut?: string;
};

export function BranchDetailsPanel({
  selection,
  value,
  onEdit,
  editLabel,
  editShortcut,
}: BranchDetailsPanelProps) {
  return (
    <div className="flex flex-col">
      <SelectionHeader
        kindLabel="Branch"
        title={selection.node.data.label || selection.node.id}
        query={selection.query}
        onEdit={onEdit}
        editLabel={editLabel}
        editShortcut={editShortcut}
      />
      <PropertyList value={value} />
    </div>
  );
}
