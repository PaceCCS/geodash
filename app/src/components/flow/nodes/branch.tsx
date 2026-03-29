import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { BranchNodeData } from "@/lib/api-client";

export function BranchNode({ data }: NodeProps) {
  const nodeData = data as BranchNodeData;
  const { label, blocks } = nodeData;

  return (
    <div className="bg-card text-card-foreground border border-border rounded-lg shadow-sm p-3 min-w-[200px]">
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
              <div key={index} className="text-xs flex items-center gap-2">
                <span className="text-muted-foreground">×{block.quantity}</span>
                <span>{block.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
