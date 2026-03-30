import type { Block } from "@/lib/api-client";
import type {
  FlowBranchNode,
  FlowGroupNode,
  FlowNode,
} from "@/lib/collections/flow-nodes";
import { isBranchNode, isLabeledGroupNode } from "@/lib/collections/flow-nodes";

export const FLOW_SELECTION_QUERY_PARAM = "selected";
export const FLOW_EDITOR_QUERY_PARAM = "edit";
export const EDIT_SELECTION_SHORTCUT = "Mod+E";

export type FlowResolvedSelection =
  | {
      kind: "branch";
      query: string;
      nodeId: string;
      node: FlowBranchNode;
    }
  | {
      kind: "group";
      query: string;
      nodeId: string;
      node: FlowGroupNode;
    }
  | {
      kind: "block";
      query: string;
      blockQuery: string;
      nodeId: string;
      node: FlowBranchNode;
      blockIndex: number;
      block: Block | null;
    }
  | {
      kind: "unsupported";
      query: string;
      nodeId: string;
      node: FlowNode;
    };

type ParsedBlockSelection = {
  nodeId: string;
  blockIndex: number;
  query: string;
};

function getSelectionPathSegments(query: string | null | undefined): string[] {
  const normalized = normalizeFlowSelectionQuery(query);
  if (!normalized) {
    return [];
  }

  const [pathPart] = normalized.split("?");
  return pathPart.split("/").filter(Boolean);
}

export function normalizeFlowSelectionQuery(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  if (trimmedValue.startsWith("node:")) {
    const legacyNodeId = trimmedValue.slice("node:".length).trim();
    return legacyNodeId || undefined;
  }

  if (trimmedValue.startsWith("edge:")) {
    return undefined;
  }

  return trimmedValue;
}

export function normalizeFlowEditorQuery(
  value: unknown,
): "1" | undefined {
  if (value === true || value === "true" || value === "1") {
    return "1";
  }

  return undefined;
}

export function getSelectedNodeIdFromQuery(
  query: string | null | undefined,
): string | undefined {
  return getSelectionPathSegments(query)[0];
}

export function getSelectedBlockPath(
  query: string | null | undefined,
): ParsedBlockSelection | undefined {
  const segments = getSelectionPathSegments(query);

  if (segments.length < 3 || segments[1] !== "blocks") {
    return undefined;
  }

  const blockIndex = Number.parseInt(segments[2] ?? "", 10);
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    return undefined;
  }

  return {
    nodeId: segments[0]!,
    blockIndex,
    query: `${segments[0]}/blocks/${blockIndex}`,
  };
}

export function resolveFlowSelection(
  query: string | null | undefined,
  nodes: FlowNode[],
): FlowResolvedSelection | undefined {
  const normalizedQuery = normalizeFlowSelectionQuery(query);
  const nodeId = getSelectedNodeIdFromQuery(normalizedQuery);

  if (!normalizedQuery || !nodeId) {
    return undefined;
  }

  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    return undefined;
  }

  if (isBranchNode(node)) {
    const blockSelection = getSelectedBlockPath(normalizedQuery);
    if (blockSelection && blockSelection.nodeId === node.id) {
      return {
        kind: "block",
        query: normalizedQuery,
        blockQuery: blockSelection.query,
        nodeId: node.id,
        node,
        blockIndex: blockSelection.blockIndex,
        block: node.data.blocks?.[blockSelection.blockIndex] ?? null,
      };
    }

    return {
      kind: "branch",
      query: normalizedQuery,
      nodeId: node.id,
      node,
    };
  }

  if (isLabeledGroupNode(node)) {
    return {
      kind: "group",
      query: normalizedQuery,
      nodeId: node.id,
      node,
    };
  }

  return {
    kind: "unsupported",
    query: normalizedQuery,
    nodeId: node.id,
    node,
  };
}
