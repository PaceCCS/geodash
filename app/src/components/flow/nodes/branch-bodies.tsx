import { Map } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBranchNode } from "./branch-context";
import { Branch } from "./branch-parts";

export function SchematicBranchBody() {
  const { addBlock, blocks, geoBlocks, node, selectBlock, selectedBlock } =
    useBranchNode();

  return (
    <>
      {blocks.length ? (
        <div className="space-y-1 px-0.5">
          {blocks.map((block, index) => {
            const hasOwnRouteGeometry = geoBlocks.some(
              (b) =>
                b.branchId === node.id &&
                b.blockIndex === index &&
                b.routeGeometry !== null,
            );

            return (
              <button
                key={index}
                type="button"
                className={cn(
                  "w-full rounded-md px-2 py-1 text-left text-xs flex items-center gap-2 hover:bg-accent hover:text-accent-foreground",
                  selectedBlock?.nodeId === node.id &&
                    selectedBlock.blockIndex === index &&
                    "bg-accent text-accent-foreground",
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  selectBlock(index);
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
      ) : null}
      <Branch.AddBlockButton onClick={addBlock} />
    </>
  );
}

export function FluidBranchBody() {
  return (
    <div className="mx-0.5 h-28 rounded-b-md border border-dashed border-border bg-muted/30" />
  );
}
