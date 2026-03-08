import * as TOML from "@iarna/toml";
import type { FlowNode, FlowEdge } from "@/lib/collections/flow-nodes";
import type { NetworkNode } from "@/lib/api-client";
import { toNetworkNode } from "@/lib/utils/filter-reactflow-props";
import { writeNetworkFile } from "@/lib/desktop";

export function serializeNodeToToml(
  node: NetworkNode,
  outgoing?: Array<{ target: string; weight: number }>,
): string {
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
      obj.block = node.data.blocks.map((block) => {
        const blockObj: Record<string, unknown> = {};
        if (block.quantity !== undefined && block.quantity !== 1) {
          blockObj.quantity = block.quantity;
        }
        blockObj.type = block.type;
        Object.keys(block).forEach((key) => {
          if (!["type", "quantity", "kind", "label"].includes(key)) {
            blockObj[key] = (block as Record<string, unknown>)[key];
          }
        });
        return blockObj;
      });
    }
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

  return TOML.stringify(obj as TOML.JsonMap);
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

export async function exportNetworkToToml(
  nodes: FlowNode[],
  edges: FlowEdge[],
  directoryPath: string,
): Promise<void> {
  const files = buildTomlFiles(nodes, edges, directoryPath);
  await Promise.all(
    files.map(({ path, content }) => writeNetworkFile(path, content)),
  );
}
