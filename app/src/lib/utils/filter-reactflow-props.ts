import type { FlowNode } from "@/lib/collections/flow-nodes";
import type { NetworkNode } from "@/lib/api-client";

const REACTFLOW_UI_PROPERTIES = [
  "draggable",
  "selectable",
  "selected",
  "zIndex",
  "focusable",
  "resizing",
  "style",
  "className",
] as const;

/** Strip ReactFlow UI-only properties so the result is safe to serialize. */
export function filterReactFlowProperties<T extends Record<string, unknown>>(
  node: T
): Omit<T, (typeof REACTFLOW_UI_PROPERTIES)[number]> {
  const filtered = { ...node };
  REACTFLOW_UI_PROPERTIES.forEach((prop) => {
    delete filtered[prop];
  });
  return filtered as Omit<T, (typeof REACTFLOW_UI_PROPERTIES)[number]>;
}

/** Convert a FlowNode back to a NetworkNode (removes UI-only fields). */
export function toNetworkNode(node: FlowNode): NetworkNode {
  const filtered = filterReactFlowProperties(node);
  return {
    ...filtered,
    parentId: filtered.parentId ?? null,
    width: filtered.width ?? null,
    height: filtered.height ?? null,
  } as NetworkNode;
}
