import { forwardRef } from "react";
import { Panel } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

const nodeLabelPanelStyle = {
  margin: 0,
} as const;

export const GeographicAnchorNode = forwardRef<HTMLDivElement, NodeProps>(
  ({ selected, width, height }, ref) => (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden bg-card/30 border border-primary p-0",
        selected && "ring-2 ring-primary"
      )}
      style={{ width: width ?? "100%", height: height ?? "100%" }}
    >
      <Panel className="p-0" position="top-left" style={nodeLabelPanelStyle}>
        <div className="w-fit bg-primary px-1 text-xs text-primary-foreground">
          Geographic Anchor
        </div>
      </Panel>
    </div>
  )
);

GeographicAnchorNode.displayName = "GeographicAnchorNode";
