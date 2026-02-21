import { forwardRef } from "react";
import { Panel } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { GroupNodeData } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export const LabeledGroupNode = forwardRef<HTMLDivElement, NodeProps>(
  ({ data, selected, width, height }, ref) => {
    const { label } = data as GroupNodeData;

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden bg-white/30 border border-brand-blue-1 p-0",
          selected && "ring-2 ring-brand-blue-1"
        )}
        style={{ width: width ?? "100%", height: height ?? "100%" }}
      >
        <Panel className="m-0 p-0" position="top-left">
          {label && (
            <div className="w-fit bg-brand-blue-1 px-1 text-xs text-brand-white">
              {label}
            </div>
          )}
        </Panel>
      </div>
    );
  }
);

LabeledGroupNode.displayName = "LabeledGroupNode";
