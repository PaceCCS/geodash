import type { FlowResolvedSelection } from "@/lib/flow-selection";
import { PropertyList } from "@/components/flow/shared/property-list";

type BlockDetailsPanelProps = {
  selection: Extract<FlowResolvedSelection, { kind: "block" }>;
  value: Record<string, unknown> | null;
};

export function BlockDetailsPanel({
  selection,
  value,
}: BlockDetailsPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="px-4 py-3 border-b border-border sticky top-0 bg-background">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Block
        </p>
        <p className="text-sm font-medium">
          {selection.block?.label ||
            selection.block?.type ||
            `${selection.node.id} block ${selection.blockIndex}`}
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
          {selection.query}
        </p>
      </div>
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
