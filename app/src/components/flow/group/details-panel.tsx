import type { FlowResolvedSelection } from "@/lib/flow-selection";
import { PropertyList } from "@/components/flow/shared/property-list";

type GroupDetailsPanelProps = {
  selection: Extract<FlowResolvedSelection, { kind: "group" }>;
  value: Record<string, unknown>;
};

export function GroupDetailsPanel({
  selection,
  value,
}: GroupDetailsPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-border sticky top-0 bg-background">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Group
        </p>
        <p className="text-sm font-medium">
          {selection.node.data.label || selection.node.id}
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
          {selection.query}
        </p>
      </div>
      <PropertyList value={value} />
    </div>
  );
}
