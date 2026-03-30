import type { FlowResolvedSelection } from "@/lib/flow-selection";
import { PropertyList } from "@/components/flow/shared/property-list";
import { SelectionHeader } from "@/components/flow/shared/selection-header";

type GroupDetailsPanelProps = {
  selection: Extract<FlowResolvedSelection, { kind: "group" }>;
  value: Record<string, unknown>;
  onEdit?: () => void;
  editLabel?: string;
  editShortcut?: string;
};

export function GroupDetailsPanel({
  selection,
  value,
  onEdit,
  editLabel,
  editShortcut,
}: GroupDetailsPanelProps) {
  return (
    <div className="flex flex-col">
      <SelectionHeader
        kindLabel="Group"
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
