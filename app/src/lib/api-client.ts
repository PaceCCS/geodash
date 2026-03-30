import { getApiBaseUrl } from "./api-proxy";

export type Position = {
  x: number;
  y: number;
};

export type NetworkValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | NetworkValue[]
  | { [key: string]: NetworkValue };

export type NetworkConfigMetadata = {
  propertyDimensions: Record<string, string>;
  dimensionUnits: Record<string, string>;
  blockTypeUnits: Record<string, Record<string, string>>;
};

export type Block = {
  quantity: number;
  type: string;
  kind: string;
  label: string;
  [key: string]: NetworkValue;
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
  [key: string]: NetworkValue;
};

export type GroupNodeData = {
  id: string;
  label?: string | null;
  [key: string]: NetworkValue;
};

export type GeographicNodeData = {
  id: string;
  label?: string | null;
  [key: string]: NetworkValue;
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
  config?: NetworkConfigMetadata;
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  warnings?: string[];
};

async function apiGet<T>(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = new URL(path, baseUrl);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }
  }

  // File-backed endpoints should always reflect the latest on-disk state.
  url.searchParams.set("_ts", Date.now().toString());

  const response = await fetch(url.toString(), {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string; error?: string }).message
        ?? (body as { error?: string }).error
        ?? `Failed to load data (${response.status})`,
    );
  }

  return response.json() as Promise<T>;
}

export async function getNetworkFromPath(
  networkIdentifier: string,
): Promise<NetworkResponse> {
  return apiGet<NetworkResponse>("/api/network", {
    network: networkIdentifier,
  });
}
