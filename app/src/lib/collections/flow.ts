import {
  createCollection,
  localOnlyCollectionOptions,
} from "@tanstack/react-db";
import type { FlowNode, FlowEdge } from "./flow-nodes";
import type { NetworkResponse } from "@/lib/api-client";

// ── Z-index helpers ───────────────────────────────────────────────────────────

function getNodeZIndex(nodeType: string): number {
  switch (nodeType) {
    case "geographicWindow":
    case "geographicAnchor":
      return -2;
    case "image":
      return -1;
    default:
      return 0;
  }
}

// ── Sort helper ───────────────────────────────────────────────────────────────

/**
 * Sort nodes so parent nodes come before their children.
 * ReactFlow requires this ordering when nodes have parentId.
 */
export function sortNodesWithParentsFirst(nodes: FlowNode[]): FlowNode[] {
  const nodeMap = new Map<string, FlowNode>();
  const sorted: FlowNode[] = [];
  const visited = new Set<string>();

  nodes.forEach((node) => nodeMap.set(node.id, node));

  const addNode = (node: FlowNode) => {
    if (visited.has(node.id)) return;

    if (node.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent) addNode(parent);
    }

    sorted.push({
      ...node,
      zIndex: node.zIndex ?? getNodeZIndex(node.type),
    });
    visited.add(node.id);
  };

  nodes.forEach((node) => addNode(node));
  return sorted;
}

// ── Collections ───────────────────────────────────────────────────────────────

export const nodesCollection = createCollection(
  localOnlyCollectionOptions<FlowNode>({
    id: "flow:nodes",
    getKey: (node) => node.id,
  })
);

export const edgesCollection = createCollection(
  localOnlyCollectionOptions<FlowEdge>({
    id: "flow:edges",
    getKey: (edge) => edge.id,
  })
);

// ── Write helpers ─────────────────────────────────────────────────────────────

export function writeNodesToCollection(updated: FlowNode[]): void {
  const prevKeys = new Set<string>(Array.from(nodesCollection.keys()) as string[]);
  const updatedKeys = new Set<string>(updated.map((n) => n.id));

  const toDelete: string[] = [];
  prevKeys.forEach((k) => {
    if (!updatedKeys.has(k)) toDelete.push(k);
  });
  if (toDelete.length) nodesCollection.delete(toDelete);

  updated.forEach((node) => {
    if (nodesCollection.has(node.id)) {
      nodesCollection.update(node.id, (draft) => {
        Object.assign(draft, node);
      });
    } else {
      nodesCollection.insert(node);
    }
  });
}

export function writeEdgesToCollection(updated: FlowEdge[]): void {
  const prevKeys = new Set<string>(Array.from(edgesCollection.keys()) as string[]);
  const updatedKeys = new Set<string>(updated.map((e) => e.id));

  const toDelete: string[] = [];
  prevKeys.forEach((k) => {
    if (!updatedKeys.has(k)) toDelete.push(k);
  });
  if (toDelete.length) edgesCollection.delete(toDelete);

  updated.forEach((edge) => {
    if (edgesCollection.has(edge.id)) {
      edgesCollection.update(edge.id, (draft) => {
        Object.assign(draft, edge);
      });
    } else {
      edgesCollection.insert(edge);
    }
  });
}

// ── Network loader ────────────────────────────────────────────────────────────

export async function clearFlowCollections(): Promise<void> {
  await Promise.all([nodesCollection.preload(), edgesCollection.preload()]);

  // Clear edges first to preserve referential integrity during updates.
  const edgeKeys = Array.from(edgesCollection.keys()) as string[];
  if (edgeKeys.length) {
    const tx = edgesCollection.delete(edgeKeys);
    await tx.isPersisted.promise;
  }

  const nodeKeys = Array.from(nodesCollection.keys()) as string[];
  if (nodeKeys.length) {
    const tx = nodesCollection.delete(nodeKeys);
    await tx.isPersisted.promise;
  }
}

/**
 * Replace collection contents with a fresh network response from the API.
 * Handles null→undefined conversions and z-index assignment.
 */
export async function resetFlowToNetwork(
  network: NetworkResponse
): Promise<void> {
  await clearFlowCollections();

  const flowNodes: FlowNode[] = network.nodes.map((node) => ({
    ...node,
    width: node.width ?? undefined,
    height: node.height ?? undefined,
    parentId: node.parentId ?? undefined,
    extent: node.extent === "parent" ? "parent" : undefined,
    draggable: node.type !== "image",
    selectable: true,
    zIndex: getNodeZIndex(node.type),
  }));

  const validEdges = network.edges.filter((edge) => {
    const src = flowNodes.find((n) => n.id === edge.source);
    const tgt = flowNodes.find((n) => n.id === edge.target);
    return (
      src?.type === "branch" &&
      tgt?.type === "branch" &&
      edge.source !== edge.target
    );
  });

  const sortedNodes = sortNodesWithParentsFirst(flowNodes);

  const nodesTx = nodesCollection.insert(sortedNodes);
  const edgesTx = edgesCollection.insert(validEdges);
  await Promise.all([nodesTx.isPersisted.promise, edgesTx.isPersisted.promise]);
}
