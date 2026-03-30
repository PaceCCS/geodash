import type {
  NetworkEdge,
  NetworkNode,
  NetworkResponse,
} from "@/lib/api-client";
import { buildTomlBlockObject, buildTomlNodeObject } from "@/lib/exporters/network-toml";
import type { FlowEdge, FlowNode } from "@/lib/collections/flow-nodes";
import { toNetworkNode } from "@/lib/utils/filter-reactflow-props";
import type {
  ActivityLogEntryInput,
  ActivityLogSource,
} from "@/contexts/activity-log-context";

export type NetworkSnapshot = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
};

type LeafDiff = {
  path: string;
  before: unknown;
  after: unknown;
};

const MAX_ACTIVITY_ENTRIES_PER_MUTATION = 24;
export function createNetworkSnapshotFromFlow(
  nodes: FlowNode[],
  edges: FlowEdge[],
): NetworkSnapshot {
  return {
    nodes: nodes.map((node) => toNetworkNode(node)),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        weight: edge.data?.weight ?? 1,
      },
    })),
  };
}

export function createNetworkSnapshotFromResponse(
  network: NetworkResponse,
): NetworkSnapshot {
  return {
    nodes: network.nodes.map((node) => ({
      ...node,
      parentId: node.parentId ?? null,
      width: node.width ?? null,
      height: node.height ?? null,
    })),
    edges: network.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      data: {
        weight: edge.data.weight,
      },
    })),
  };
}

export function diffNetworkSnapshots(
  previous: NetworkSnapshot,
  next: NetworkSnapshot,
  options: {
    source: ActivityLogSource;
    maxEntries?: number;
  },
): ActivityLogEntryInput[] {
  const maxEntries = options.maxEntries ?? MAX_ACTIVITY_ENTRIES_PER_MUTATION;
  const entries: ActivityLogEntryInput[] = [];
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]));
  const nodeIds = Array.from(
    new Set([...previousNodes.keys(), ...nextNodes.keys()]),
  ).sort();
  const addedOrRemovedNodeIds = new Set<string>();

  for (const nodeId of nodeIds) {
    const previousNode = previousNodes.get(nodeId);
    const nextNode = nextNodes.get(nodeId);

    if (!previousNode && nextNode) {
      addedOrRemovedNodeIds.add(nodeId);
      entries.push({
        source: options.source,
        kind: "change",
        message: `${formatNodeKind(nextNode)} ${formatNodeDisplayName(nextNode)} added`,
      });
      continue;
    }

    if (previousNode && !nextNode) {
      addedOrRemovedNodeIds.add(nodeId);
      entries.push({
        source: options.source,
        kind: "change",
        message: `${formatNodeKind(previousNode)} ${formatNodeDisplayName(previousNode)} removed`,
      });
      continue;
    }

    if (!previousNode || !nextNode) {
      continue;
    }

    if (
      previousNode.position.x !== nextNode.position.x
      || previousNode.position.y !== nextNode.position.y
    ) {
      entries.push({
        source: options.source,
        kind: "change",
        message: `${formatNodeKind(nextNode)} ${formatNodeDisplayName(nextNode)} moved: ${formatPosition(previousNode.position)} -> ${formatPosition(nextNode.position)}`,
      });
    }

    entries.push(...diffNodeProperties(previousNode, nextNode, options.source));
    entries.push(...diffBranchBlocks(previousNode, nextNode, options.source));
  }

  entries.push(
    ...diffEdges(previous.edges, next.edges, options.source, addedOrRemovedNodeIds),
  );

  if (entries.length <= maxEntries) {
    return entries;
  }

  const visibleEntries = entries.slice(0, maxEntries);
  visibleEntries.push({
    source: options.source,
    kind: "change",
    message: `${entries.length - maxEntries} additional changes omitted`,
  });
  return visibleEntries;
}

function diffNodeProperties(
  previousNode: NetworkNode,
  nextNode: NetworkNode,
  source: ActivityLogSource,
): ActivityLogEntryInput[] {
  const previousObject = { ...buildTomlNodeObject(previousNode) };
  const nextObject = { ...buildTomlNodeObject(nextNode) };

  delete previousObject.block;
  delete previousObject.outgoing;
  delete nextObject.block;
  delete nextObject.outgoing;

  return diffFlatObjects(previousObject, nextObject)
    .filter((diff) => !diff.path.startsWith("position."))
    .map((diff) => ({
      source,
      kind: "change" as const,
      message: `${formatNodeKind(nextNode)} ${formatNodeDisplayName(nextNode)} ${formatPropertyPath(diff.path)}: ${formatDiffValue(diff.before)} -> ${formatDiffValue(diff.after)}`,
    }));
}

function diffBranchBlocks(
  previousNode: NetworkNode,
  nextNode: NetworkNode,
  source: ActivityLogSource,
): ActivityLogEntryInput[] {
  if (previousNode.type !== "branch" || nextNode.type !== "branch") {
    return [];
  }

  const previousBlocks = previousNode.data.blocks ?? [];
  const nextBlocks = nextNode.data.blocks ?? [];
  const entryDrafts: ActivityLogEntryInput[] = [];
  const blockCount = Math.max(previousBlocks.length, nextBlocks.length);

  for (let index = 0; index < blockCount; index += 1) {
    const previousBlock = previousBlocks[index];
    const nextBlock = nextBlocks[index];

    if (!previousBlock && nextBlock) {
      entryDrafts.push({
        source,
        kind: "change",
        message: `${formatNodeKind(nextNode)} ${formatNodeDisplayName(nextNode)} ${formatBlockDisplayName(nextBlock, index)} added`,
      });
      continue;
    }

    if (previousBlock && !nextBlock) {
      entryDrafts.push({
        source,
        kind: "change",
        message: `${formatNodeKind(previousNode)} ${formatNodeDisplayName(previousNode)} ${formatBlockDisplayName(previousBlock, index)} removed`,
      });
      continue;
    }

    if (!previousBlock || !nextBlock) {
      continue;
    }

    const previousBlockObject = buildTomlBlockObject(previousBlock);
    const nextBlockObject = buildTomlBlockObject(nextBlock);
    const blockLabel = formatBlockDisplayName(nextBlock, index);

    for (const diff of diffFlatObjects(previousBlockObject, nextBlockObject)) {
      entryDrafts.push({
        source,
        kind: "change",
        message: `${formatNodeKind(nextNode)} ${formatNodeDisplayName(nextNode)} ${blockLabel} ${formatPropertyPath(diff.path)}: ${formatDiffValue(diff.before)} -> ${formatDiffValue(diff.after)}`,
      });
    }
  }

  return entryDrafts;
}

function diffEdges(
  previousEdges: NetworkEdge[],
  nextEdges: NetworkEdge[],
  source: ActivityLogSource,
  ignoredNodeIds: Set<string>,
): ActivityLogEntryInput[] {
  const previousEdgeMap = new Map(
    previousEdges.map((edge) => [getEdgeKey(edge), edge]),
  );
  const nextEdgeMap = new Map(nextEdges.map((edge) => [getEdgeKey(edge), edge]));
  const edgeKeys = Array.from(
    new Set([...previousEdgeMap.keys(), ...nextEdgeMap.keys()]),
  ).sort();
  const entries: ActivityLogEntryInput[] = [];

  for (const edgeKey of edgeKeys) {
    const previousEdge = previousEdgeMap.get(edgeKey);
    const nextEdge = nextEdgeMap.get(edgeKey);
    const edge = nextEdge ?? previousEdge;

    if (!edge) {
      continue;
    }

    if (
      ignoredNodeIds.has(edge.source)
      || ignoredNodeIds.has(edge.target)
    ) {
      continue;
    }

    const connectionLabel = `Connection ${edge.source} -> ${edge.target}`;

    if (!previousEdge && nextEdge) {
      entries.push({
        source,
        kind: "change",
        message: `${connectionLabel} added`,
      });
      continue;
    }

    if (previousEdge && !nextEdge) {
      entries.push({
        source,
        kind: "change",
        message: `${connectionLabel} removed`,
      });
      continue;
    }

    if (
      previousEdge
      && nextEdge
      && previousEdge.data.weight !== nextEdge.data.weight
    ) {
      entries.push({
        source,
        kind: "change",
        message: `${connectionLabel} weight: ${formatDiffValue(previousEdge.data.weight)} -> ${formatDiffValue(nextEdge.data.weight)}`,
      });
    }
  }

  return entries;
}

function getEdgeKey(edge: NetworkEdge): string {
  return `${edge.source}->${edge.target}`;
}

function diffFlatObjects(
  previousValue: unknown,
  nextValue: unknown,
): LeafDiff[] {
  const previousFlat = flattenValue(previousValue);
  const nextFlat = flattenValue(nextValue);
  const paths = Array.from(
    new Set([...previousFlat.keys(), ...nextFlat.keys()]),
  ).sort();
  const diffs: LeafDiff[] = [];

  for (const path of paths) {
    const before = previousFlat.get(path);
    const after = nextFlat.get(path);

    if (Object.is(before, after)) {
      continue;
    }

    diffs.push({ path, before, after });
  }

  return diffs;
}

function flattenValue(
  value: unknown,
  prefix = "",
  output = new Map<string, unknown>(),
): Map<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) {
        output.set(prefix, "[]");
      }
      return output;
    }

    value.forEach((item, index) => {
      const nextPrefix = prefix ? `${prefix}[${index}]` : `[${index}]`;
      flattenValue(item, nextPrefix, output);
    });
    return output;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key, nestedValue]) => key !== "outgoing" && nestedValue !== undefined,
    );

    if (entries.length === 0) {
      if (prefix) {
        output.set(prefix, "{}");
      }
      return output;
    }

    for (const [key, nestedValue] of entries) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      flattenValue(nestedValue, nextPrefix, output);
    }

    return output;
  }

  if (prefix) {
    output.set(prefix, value);
  }

  return output;
}

function formatNodeKind(node: NetworkNode): string {
  switch (node.type) {
    case "branch":
      return "Branch";
    case "labeledGroup":
      return "Group";
    case "geographicAnchor":
      return "Geographic anchor";
    case "geographicWindow":
      return "Geographic window";
    case "image":
      return "Image";
  }
}

function formatNodeDisplayName(node: NetworkNode): string {
  const label =
    typeof node.data.label === "string" ? node.data.label.trim() : "";

  if (!label || label === node.id) {
    return node.id;
  }

  return `${label} (${node.id})`;
}

function formatBlockDisplayName(
  block: Record<string, unknown>,
  index: number,
): string {
  const type =
    typeof block.type === "string" && block.type.trim().length > 0
      ? block.type.trim()
      : "Block";

  return `${type}[${index}]`;
}

function formatPropertyPath(path: string): string {
  return path.replace(/^block\[\d+\]\./, "");
}

function formatDiffValue(value: unknown): string {
  if (value === undefined) {
    return "unset";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function formatPosition(position: { x: number; y: number }): string {
  return `(${formatRoundedCoordinate(position.x)}, ${formatRoundedCoordinate(position.y)})`;
}

function formatRoundedCoordinate(value: number): string {
  return String(Math.round(value));
}
