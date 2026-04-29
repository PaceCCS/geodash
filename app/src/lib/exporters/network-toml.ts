import TOML from "smol-toml";
import type { FlowNode, FlowEdge } from "@/lib/collections/flow-nodes";
import type { Block, NetworkNode } from "@/lib/api-client";
import { toNetworkNode } from "@/lib/utils/filter-reactflow-props";
import {
  deleteNetworkFile,
  readNetworkDirectory,
  writeNetworkFile,
} from "@/lib/desktop";

export function buildTomlBlockObject(block: Block): Record<string, unknown> {
  const blockObj: Record<string, unknown> = {};

  if (block.quantity !== undefined && block.quantity !== 1) {
    blockObj.quantity = block.quantity;
  }
  blockObj.type = block.type;
  if (block.label && block.label !== block.type) {
    blockObj.label = block.label;
  }
  Object.keys(block).forEach((key) => {
    if (!["type", "quantity", "kind", "label"].includes(key)) {
      blockObj[key] = (block as Record<string, unknown>)[key];
    }
  });

  return blockObj;
}

export function buildTomlNodeObject(
  node: NetworkNode,
  outgoing?: Array<{ target: string; weight: number }>,
): Record<string, unknown> {
  const obj: Record<string, unknown> = { type: node.type };

  if (node.data.label) obj.label = node.data.label;
  if (node.parentId) obj.parentId = node.parentId;
  if (node.width != null) obj.width = node.width;
  if (node.height != null) obj.height = node.height;

  obj.position = { x: node.position.x, y: node.position.y };

  if (node.type === "branch") {
    if (outgoing && outgoing.length > 0) {
      obj.outgoing = outgoing;
    }
    if (node.data.blocks && node.data.blocks.length > 0) {
      obj.block = node.data.blocks.map(buildTomlBlockObject);
    }

    Object.keys(node.data).forEach((key) => {
      if (
        ![
          "id",
          "label",
          "blocks",
          "flow_rate",
          "composition",
        ].includes(key) &&
        node.data[key] != null
      ) {
        obj[key] = node.data[key];
      }
    });
  }

  if (
    node.type === "labeledGroup"
    || node.type === "geographicAnchor"
    || node.type === "geographicWindow"
  ) {
    Object.keys(node.data).forEach((key) => {
      if (key !== "id" && key !== "label" && node.data[key] != null) {
        obj[key] = node.data[key];
      }
    });
  }

  if (node.type === "image" && "path" in node.data) {
    obj.path = node.data.path;
  }

  return obj;
}

export function serializeNodeToToml(
  node: NetworkNode,
  outgoing?: Array<{ target: string; weight: number }>,
): string {
  return TOML.stringify(buildTomlNodeObject(node, outgoing));
}

export function buildTomlFiles(
  nodes: FlowNode[],
  edges: FlowEdge[],
  directoryPath: string,
): Array<{ path: string; content: string }> {
  const edgesBySource = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    if (!edgesBySource.has(edge.source)) edgesBySource.set(edge.source, []);
    edgesBySource.get(edge.source)!.push(edge);
  });

  const base = directoryPath.endsWith("/")
    ? directoryPath
    : `${directoryPath}/`;

  return nodes.map((node) => {
    const networkNode = toNetworkNode(node);
    const outgoing =
      networkNode.type === "branch"
        ? (edgesBySource.get(node.id) ?? []).map((edge) => ({
            target: edge.target,
            weight: edge.data.weight,
          }))
        : undefined;

    return {
      path: `${base}${node.id}.toml`,
      content: serializeNodeToToml(networkNode, outgoing),
    };
  });
}

const MANAGED_NODE_TYPES = new Set([
  "branch",
  "labeledGroup",
  "geographicAnchor",
  "geographicWindow",
  "image",
]);

export function getTomlPathsToDelete(
  existingFiles: Array<{ path: string; content: string }>,
  nextFiles: Array<{ path: string; content: string }>,
): string[] {
  const nextContentByPath = new Map(
    nextFiles.map(({ path, content }) => [path, content]),
  );

  return existingFiles
    .filter(({ path, content }) => {
      if (nextContentByPath.has(path)) {
        return false;
      }

      try {
        const parsed = TOML.parse(content);
        return (
          typeof parsed?.type === "string"
          && MANAGED_NODE_TYPES.has(parsed.type)
        );
      } catch {
        return false;
      }
    })
    .map(({ path }) => path);
}

export async function exportNetworkToToml(
  nodes: FlowNode[],
  edges: FlowEdge[],
  directoryPath: string,
): Promise<void> {
  const nextFiles = buildTomlFiles(nodes, edges, directoryPath);
  const existingFiles = await readNetworkDirectory(directoryPath);
  const existingContentByPath = new Map(
    existingFiles.map(({ path, content }) => [path, content]),
  );

  const writes = nextFiles
    .filter(({ path, content }) => {
      const existingContent = existingContentByPath.get(path);
      return existingContent !== content;
    })
    .map(({ path, content }) => writeNetworkFile(path, content));

  const deletes = getTomlPathsToDelete(existingFiles, nextFiles)
    .map((path) => deleteNetworkFile(path));

  await Promise.all([...writes, ...deletes]);
}
