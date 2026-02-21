import { forwardRef } from "react";
import { Panel } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export const GeographicWindowNode = forwardRef<HTMLDivElement, NodeProps>(
  ({ selected, width, height }, ref) => (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden bg-white/30 border border-brand-blue-1 p-0",
        selected && "ring-2 ring-brand-blue-1"
      )}
      style={{ width: width ?? "100%", height: height ?? "100%" }}
    >
      <Panel className="m-0 p-0" position="top-left">
        <div className="w-fit bg-brand-blue-1 px-1 text-xs text-brand-white">
          Geographic Window
        </div>
      </Panel>
    </div>
  )
);

GeographicWindowNode.displayName = "GeographicWindowNode";
