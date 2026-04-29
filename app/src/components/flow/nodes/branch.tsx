import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { useLiveQuery } from "@tanstack/react-db";
import { Map, ToyBrick } from "lucide-react";
import type { BranchNodeData } from "@/lib/api-client";
import { useFlowSelection } from "@/components/flow/selection-context";
import { geoCollection } from "@/lib/collections/geo";
import { getSelectedBlockPath } from "@/lib/flow-selection";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function BranchNode({ data, selected }: NodeProps) {
  const nodeData = data as BranchNodeData;
  const { label, blocks } = nodeData;
  const { selectedQuery, setSelectedQuery, onAddBlockToBranch } =
    useFlowSelection();
  const selectedBlock = getSelectedBlockPath(selectedQuery);
  const { data: geoBlocks = [] } = useLiveQuery(geoCollection);

  return (
    <div
      data-testid={`branch-node-${nodeData.id}`}
      className={cn(
        "bg-card text-card-foreground border border-border rounded-lg shadow-sm pt-2 pb-3 min-w-[200px]",
        selected && "ring-2 ring-primary",
      )}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 mb-2 px-2.5 justify-between border-b border-border pb-2">
        <div className="text-sm font-medium">{label || nodeData.id}</div>
        <div className="flex items-center gap-2">
          <Badge className="text-xs rounded-full p-0.5 w-5 h-5 flex items-center justify-center">
            {blocks.length}
          </Badge>
        </div>
      </div>
      {blocks && blocks.length > 0 && (
        <div className="space-y-1 px-0.5 mb-1">
          {blocks.map((block, index) => {
            const hasOwnRouteGeometry = geoBlocks.some(
              (b) => b.branchId === nodeData.id && b.blockIndex === index && b.routeGeometry !== null,
            );

            return (
              <button
                key={index}
                type="button"
                className={cn(
                  "w-full rounded-md px-2 py-1 text-left text-xs flex items-center gap-2 hover:bg-accent hover:text-accent-foreground",
                  selectedBlock?.nodeId === nodeData.id &&
                    selectedBlock.blockIndex === index &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setSelectedQuery?.(`${nodeData.id}/blocks/${index}`);
                }}
              >
                <span className="text-muted-foreground w-6">#{index}</span>

                <span className="truncate">
                  {block.label || block.type || block.kind}
                </span>

                {hasOwnRouteGeometry ? (
                  <Map className="h-3 w-3 shrink-0 text-muted-foreground" />
                ) : null}

                <span className="text-muted-foreground ml-auto">
                  ×{block.quantity}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {onAddBlockToBranch ? (
        <div className="px-0.5">
          <button
            type="button"
            className="w-full rounded-md px-2 py-1 text-left text-xs flex items-center gap-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddBlockToBranch(nodeData.id);
            }}
          >
            <ToyBrick className="h-3 w-3 shrink-0" />
            <span>Add block</span>
          </button>
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
