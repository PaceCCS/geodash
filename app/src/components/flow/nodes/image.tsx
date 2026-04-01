import { forwardRef } from "react";
import { Panel } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import type { ImageNodeData } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useNetworkOptional } from "@/contexts/network-context";

const nodeLabelPanelStyle = {
  margin: 0,
} as const;

export const ImageNode = forwardRef<HTMLDivElement, NodeProps>(
  ({ data, selected, width, height }, ref) => {
    const { label, path } = data as ImageNodeData;
    const network = useNetworkOptional();
    const imageUrl = network?.getAssetUrl(path);

    return (
      <div
        ref={ref}
        className={cn(
          "overflow-hidden bg-card border border-primary",
          selected && "ring-2 ring-primary"
        )}
        style={{ width: width ?? "auto", height: height ?? "auto" }}
      >
        {label && (
          <Panel className="p-0" position="top-left" style={nodeLabelPanelStyle}>
            <div className="w-fit bg-primary px-1 text-xs text-primary-foreground">
              {label}
            </div>
          </Panel>
        )}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={label || "Network image"}
            className="w-full h-full object-contain"
            style={{ minWidth: width ?? 100, minHeight: height ?? 100 }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = "none";
              const placeholder = document.createElement("div");
              placeholder.className =
                "flex items-center justify-center w-full h-full bg-muted text-muted-foreground text-sm p-4";
              placeholder.textContent = `Failed to load: ${path}`;
              target.parentElement?.appendChild(placeholder);
            }}
          />
        ) : (
          <div
            className="flex items-center justify-center w-full h-full bg-muted text-muted-foreground text-sm p-4"
            style={{ minWidth: width ?? 100, minHeight: height ?? 100 }}
          >
            <div className="text-center">
              <div className="font-medium text-xs">{path}</div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

ImageNode.displayName = "ImageNode";
