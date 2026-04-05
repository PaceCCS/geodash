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

export type ShapefileGeometryType = "PointZ" | "PolyLineZ";

export type ShapefileField = {
  name: string;
  fieldType: "C" | "N" | "F" | "L" | "D";
  length: number;
  decimalCount: number;
};

export type ShapefilePoint = {
  x: number;
  y: number;
  z: number;
  m: number;
};

export type ShapefileRecord =
  | {
      number: number;
      geometry: {
        type: "PointZ";
        x: number;
        y: number;
        z: number;
        m: number;
      };
    }
  | {
      number: number;
      geometry: {
        type: "PolyLineZ";
        parts: number[];
        points: ShapefilePoint[];
      };
    };

export type ShapefileCell = string | number | boolean | null;

export type ShapefileSummary = {
  stemPath: string;
  name: string;
  hasDbf: boolean;
  hasPrj: boolean;
  hasShx: boolean;
  geometryType: ShapefileGeometryType | null;
  recordCount: number;
  error?: string;
};

export type ShapefileDocument = {
  stemPath: string;
  name: string;
  hasDbf: boolean;
  hasPrj: boolean;
  hasShx: boolean;
  geometryType: ShapefileGeometryType | null;
  records: ShapefileRecord[];
  fields: ShapefileField[];
  rows: ShapefileCell[][];
  prj: string | null;
};

export type BuildShapefileResponse = {
  shp_b64: string;
  shx_b64: string;
  dbf_b64: string;
  prj_b64?: string;
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

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = new URL(path, baseUrl);
  url.searchParams.set("_ts", Date.now().toString());

  const response = await fetch(url.toString(), {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      (payload as { message?: string; error?: string }).message
        ?? (payload as { error?: string }).error
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

export async function getShapefileSummaries(
  directoryPath: string,
): Promise<ShapefileSummary[]> {
  const result = await apiGet<{ files: ShapefileSummary[] }>("/api/shapefiles", {
    directory: directoryPath,
  });
  return result.files;
}

export async function getShapefileDocument(
  stemPath: string,
): Promise<ShapefileDocument> {
  return apiGet<ShapefileDocument>("/api/shapefiles/file", {
    stem: stemPath,
  });
}

export async function buildShapefileDocument(
  document: Pick<ShapefileDocument, "records" | "fields" | "rows" | "prj">,
): Promise<BuildShapefileResponse> {
  return apiPost<BuildShapefileResponse>("/api/shapefiles/build", document);
}
