import type { Node, Edge } from "@xyflow/react";
import type {
  NetworkNode,
  NetworkEdge,
  BranchNode,
  GroupNode,
  GeographicAnchorNode,
  GeographicWindowNode,
  ImageNode,
} from "@/lib/api-client";

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

export type FlowBranchNode = BranchNode &
  Partial<
    Pick<Node, "selected" | "zIndex" | "focusable" | "resizing" | "style" | "className">
  > & {
    draggable?: boolean;
    selectable?: boolean;
    parentId?: string;
    width?: number;
    height?: number;
    extent?: "parent";
  };

export type FlowGroupNode = GroupNode &
  Partial<
    Pick<Node, "selected" | "zIndex" | "focusable" | "resizing" | "style" | "className">
  > & {
    draggable?: boolean;
    selectable?: boolean;
    parentId?: string;
    width?: number;
    height?: number;
    extent?: "parent";
  };

export type FlowGeographicAnchorNode = GeographicAnchorNode &
  Partial<
    Pick<Node, "selected" | "zIndex" | "focusable" | "resizing" | "style" | "className">
  > & {
    draggable?: boolean;
    selectable?: boolean;
    parentId?: string;
    width?: number;
    height?: number;
    extent?: "parent";
  };

export type FlowGeographicWindowNode = GeographicWindowNode &
  Partial<
    Pick<Node, "selected" | "zIndex" | "focusable" | "resizing" | "style" | "className">
  > & {
    draggable?: boolean;
    selectable?: boolean;
    parentId?: string;
    width?: number;
    height?: number;
    extent?: "parent";
  };

export type FlowImageNode = ImageNode &
  Partial<
    Pick<Node, "selected" | "zIndex" | "focusable" | "resizing" | "style" | "className">
  > & {
    draggable?: boolean;
    selectable?: boolean;
    parentId?: string;
    width?: number;
    height?: number;
    extent?: "parent";
  };

// ── Type guards ───────────────────────────────────────────────────────────────

export function isBranchNode(
  node: FlowNode
): node is FlowBranchNode {
  return node.type === "branch";
}

export function isLabeledGroupNode(
  node: FlowNode
): node is FlowGroupNode {
  return node.type === "labeledGroup";
}

export function isGeographicAnchorNode(
  node: FlowNode
): node is FlowGeographicAnchorNode {
  return node.type === "geographicAnchor";
}

export function isGeographicWindowNode(
  node: FlowNode
): node is FlowGeographicWindowNode {
  return node.type === "geographicWindow";
}
