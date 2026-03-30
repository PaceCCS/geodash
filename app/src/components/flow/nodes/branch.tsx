import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { BranchNodeData } from "@/lib/api-client";
import { useFlowSelection } from "@/components/flow/selection-context";
import { getSelectedBlockPath } from "@/lib/flow-selection";
import { cn } from "@/lib/utils";

export function BranchNode({ data, selected }: NodeProps) {
  const nodeData = data as BranchNodeData;
  const { label, blocks } = nodeData;
  const { selectedQuery, setSelectedQuery } = useFlowSelection();
  const selectedBlock = getSelectedBlockPath(selectedQuery);

  return (
    <div
      data-testid={`branch-node-${nodeData.id}`}
      className={cn(
        "bg-card text-card-foreground border border-border rounded-lg shadow-sm p-3 min-w-[200px]",
        selected && "ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 mb-2">
        <div className="w-3 h-3 bg-primary rounded-full" />
        <div className="text-sm font-medium">{label || nodeData.id}</div>
      </div>
      {blocks && blocks.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="text-xs text-muted-foreground mb-1">
            Blocks ({blocks.length})
          </div>
          <div className="space-y-1">
            {blocks.map((block, index) => (
              <button
                key={index}
                type="button"
                className={cn(
                  "w-full rounded-md px-2 py-1 text-left text-xs flex items-center gap-2 hover:bg-accent hover:text-accent-foreground",
                  selectedBlock?.nodeId === nodeData.id
                    && selectedBlock.blockIndex === index
                    && "bg-accent text-accent-foreground",
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedQuery?.(`${nodeData.id}/blocks/${index}`);
                }}
              >
                <span className="text-muted-foreground">#{index}</span>
                <span className="text-muted-foreground">×{block.quantity}</span>
                <span className="truncate">
                  {block.label || block.type || block.kind}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
