import { forwardRef } from "react";
import { Panel } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { GroupNodeData } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const nodeLabelPanelStyle = {
  margin: 0,
} as const;

export const LabeledGroupNode = forwardRef<HTMLDivElement, NodeProps>(
  ({ data, selected, width, height }, ref) => {
    const { label } = data as GroupNodeData;

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden bg-card/30 border border-primary p-0",
          selected && "ring-2 ring-primary"
        )}
        style={{ width: width ?? "100%", height: height ?? "100%" }}
      >
        <Panel className="p-0" position="top-left" style={nodeLabelPanelStyle}>
          {label && (
            <div className="w-fit bg-primary px-1 text-xs text-primary-foreground">
              {label}
            </div>
          )}
        </Panel>
      </div>
    );
  }
);

LabeledGroupNode.displayName = "LabeledGroupNode";
