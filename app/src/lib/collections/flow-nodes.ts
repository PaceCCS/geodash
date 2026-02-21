import type { Node, Edge } from "@xyflow/react";
import type { NetworkNode, NetworkEdge } from "@/lib/api-client";

/**
 * FlowNode extends NetworkNode with ReactFlow UI properties.
 * These UI properties are runtime-only and never written to TOML.
 */
export type FlowNode = Omit<
  NetworkNode,
  "parentId" | "width" | "height" | "extent"
> &
  Partial<
    Pick<Node, "selected" | "zIndex" | "focusable" | "resizing" | "style" | "className">
  > & {
    draggable?: boolean;
    selectable?: boolean;
    // API returns null; ReactFlow expects undefined
    parentId?: string;
    width?: number;
    height?: number;
    extent?: "parent";
  };

export type FlowEdge = NetworkEdge & Partial<Edge>;

// ── Type guards ───────────────────────────────────────────────────────────────

export function isBranchNode(
  node: FlowNode
): node is FlowNode & { type: "branch" } {
  return node.type === "branch";
}

export function isLabeledGroupNode(
  node: FlowNode
): node is FlowNode & { type: "labeledGroup" } {
  return node.type === "labeledGroup";
}

export function isGeographicAnchorNode(
  node: FlowNode
): node is FlowNode & { type: "geographicAnchor" } {
  return node.type === "geographicAnchor";
}

export function isGeographicWindowNode(
  node: FlowNode
): node is FlowNode & { type: "geographicWindow" } {
  return node.type === "geographicWindow";
}
