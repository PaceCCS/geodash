import type { FlowResolvedSelection } from "@/lib/flow-selection";
import { PropertyList } from "@/components/flow/shared/property-list";

type BranchDetailsPanelProps = {
  selection: Extract<FlowResolvedSelection, { kind: "branch" }>;
  value: Record<string, unknown>;
};

export function BranchDetailsPanel({
  selection,
  value,
}: BranchDetailsPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Branch
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
