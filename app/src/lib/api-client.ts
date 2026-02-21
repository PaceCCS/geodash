// ── Network data types ────────────────────────────────────────────────────────

export type Position = {
  x: number;
  y: number;
};

export type Block = {
  quantity: number;
  type: string;
  kind: string;
  label: string;
  [key: string]: string | number | boolean | null | undefined;
};

export type BaseNodeProperties = {
  id: string;
  type: string;
  position: Position;
  parentId?: string | null;
  extent?: "parent";
  width?: number | null;
  height?: number | null;
};

export type BranchNodeData = {
  id: string;
  label: string;
  blocks: Block[];
};

export type GroupNodeData = {
  id: string;
  label?: string | null;
  [key: string]: string | number | boolean | null | undefined;
};

export type GeographicNodeData = {
  id: string;
  label?: string | null;
  [key: string]: string | number | boolean | null | undefined;
};

export type ImageNodeData = {
  id: string;
  label?: string | null;
  path: string;
};

export type BranchNode = BaseNodeProperties & {
  type: "branch";
  data: BranchNodeData;
};

export type GroupNode = BaseNodeProperties & {
  type: "labeledGroup";
  data: GroupNodeData;
};

export type GeographicAnchorNode = BaseNodeProperties & {
  type: "geographicAnchor";
  data: GeographicNodeData;
};

export type GeographicWindowNode = BaseNodeProperties & {
  type: "geographicWindow";
  data: GeographicNodeData;
};

export type ImageNode = BaseNodeProperties & {
  type: "image";
  data: ImageNodeData;
};

export type NetworkNode =
  | BranchNode
  | GroupNode
  | GeographicAnchorNode
  | GeographicWindowNode
  | ImageNode;

export type EdgeData = {
  weight: number;
};

export type NetworkEdge = {
  id: string;
  source: string;
  target: string;
  data: EdgeData;
};

export type NetworkResponse = {
  id: string;
  label: string;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
};

// ── API calls ─────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:3001";

/**
 * Load a network from an absolute directory path or preset name.
 * The server's resolveNetworkPath handles both absolute paths and relative preset names.
 */
export async function getNetworkFromPath(
  networkIdentifier: string
): Promise<NetworkResponse> {
  const url = `${API_BASE}/api/network?network=${encodeURIComponent(networkIdentifier)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ??
        `Failed to load network (${response.status})`
    );
  }
  return response.json() as Promise<NetworkResponse>;
}
