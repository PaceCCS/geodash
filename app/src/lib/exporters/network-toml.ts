import * as TOML from "@iarna/toml";
import type { FlowNode, FlowEdge } from "@/lib/collections/flow-nodes";
import type { NetworkNode } from "@/lib/api-client";
import { toNetworkNode } from "@/lib/utils/filter-reactflow-props";
import { writeNetworkFile } from "@/lib/tauri";

/**
 * Serialize a NetworkNode (and its outgoing edges for branch nodes) to TOML.
 *
 * Structure mirrors the hand-authored preset TOML files:
 *   type, label, parentId, width, height, [position], [[outgoing]], [[block]]
 */
export function serializeNodeToToml(
  node: NetworkNode,
  outgoing?: Array<{ target: string; weight: number }>
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
        const b: Record<string, unknown> = {};
        // Omit quantity when it is the default (1) to match hand-authored style.
        if (block.quantity !== undefined && block.quantity !== 1) {
          b.quantity = block.quantity;
        }
        b.type = block.type;
        // Carry through any extra properties (e.g. pressure, diameter).
        // Exclude backend-computed fields (kind, label) which aren't in TOML.
        Object.keys(block).forEach((key) => {
          if (!["type", "quantity", "kind", "label"].includes(key)) {
            b[key] = (block as Record<string, unknown>)[key];
          }
        });
        return b;
      });
    }
  }

  // Group / geographic nodes may carry extra top-level properties.
  if (
    node.type === "labeledGroup" ||
    node.type === "geographicAnchor" ||
    node.type === "geographicWindow"
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

/**
 * Pure function: compute the TOML content for every node without performing
 * any I/O.  Returns `{ path, content }` pairs, one per node.
 *
 * Path is `{directoryPath}/{node.id}.toml`.
 * Edges are embedded as `[[outgoing]]` in the source branch file.
 */
export function buildTomlFiles(
  nodes: FlowNode[],
  edges: FlowEdge[],
  directoryPath: string
): Array<{ path: string; content: string }> {
  const edgesBySource = new Map<string, FlowEdge[]>();
  edges.forEach((edge) => {
    if (!edgesBySource.has(edge.source)) edgesBySource.set(edge.source, []);
    edgesBySource.get(edge.source)!.push(edge);
  });

  const base = directoryPath.endsWith("/")
    ? directoryPath
    : directoryPath + "/";

  return nodes.map((node) => {
    const networkNode = toNetworkNode(node);
    const outgoing =
      networkNode.type === "branch"
        ? (edgesBySource.get(node.id) ?? []).map((e) => ({
            target: e.target,
            weight: e.data.weight,
          }))
        : undefined;
    return {
      path: `${base}${node.id}.toml`,
      content: serializeNodeToToml(networkNode, outgoing),
    };
  });
}

/**
 * Persist all nodes to their corresponding TOML files.
 *
 * Each node maps to `{directoryPath}/{node.id}.toml`.
 * Edges are embedded as `[[outgoing]]` arrays inside the source branch file.
 *
 * The Tauri `write_network_file` command marks each path as a self-write so
 * the file watcher suppresses the resulting filesystem event.
 */
export async function exportNetworkToToml(
  nodes: FlowNode[],
  edges: FlowEdge[],
  directoryPath: string
): Promise<void> {
  const files = buildTomlFiles(nodes, edges, directoryPath);
  await Promise.all(
    files.map(({ path, content }) => writeNetworkFile(path, content))
  );
}
