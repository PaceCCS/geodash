/**
 * Types for operations and their results.
 * These mirror the backend types for the frontend.
 */

// ============================================================================
// Operation Registry Types
// ============================================================================

/**
 * Definition of an available operation.
 */
export type Operation = {
  /** Unique operation ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what this operation does */
  description: string;

  /** Schema version to validate against (e.g., "v1.0-snapshot") */
  schemaVersion: string;

  /** API endpoint path (e.g., "/api/operations/snapshot/run") */
  endpoint: string;

  /** Validation endpoint path */
  validateEndpoint: string;

  /** Health check endpoint path */
  healthEndpoint?: string;
};

// ============================================================================
// Network Data Types (shared across operations)
// ============================================================================

/**
 * Block data for network operations.
 */
export type NetworkValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | NetworkValue[]
  | { [key: string]: NetworkValue };

export type NetworkBlock = {
  type: string;
  quantity?: number;
  [key: string]: NetworkValue;
};

/**
 * Branch data for network operations.
 */
export type NetworkBranch = {
  id: string;
  label?: string;
  parentId?: string;
  blocks: NetworkBlock[];
};

/**
 * Group data for network operations.
 */
export type NetworkGroup = {
  id: string;
  label?: string;
  branchIds: string[];
  /** Group-level properties that can be inherited by branches/blocks */
  [key: string]: NetworkValue;
};

/**
 * Edge connecting two branches in the network.
 */
export type NetworkEdge = {
  id: string;
  source: string;
  target: string;
};

/**
 * Network data structure for inline operations.
 */
export type NetworkData = {
  groups: NetworkGroup[];
  branches: NetworkBranch[];
  edges: NetworkEdge[];
  /** Global defaults that can be inherited by all blocks */
  defaults?: Record<string, NetworkValue>;
};

/**
 * Network source - either inline data or a network ID reference.
 */
export type NetworkSource =
  | { type: "networkId"; networkId: string }
  | { type: "data"; network: NetworkData };

// ============================================================================
// Health Check Types
// ============================================================================

export type HealthStatus = {
  status: "ok" | "degraded" | "error";
  snapshotServer?: string;
  serverStatus: "reachable" | "unhealthy" | "unreachable";
  statusCode?: number;
  message?: string;
};

// ============================================================================
// Measure Types
// ============================================================================

export type SegmentOffset = {
  segIndex: number;
  offsetMeters: number;
  lengthMeters: number;
};

export type BranchOffset = {
  branchId: string;
  offsetMeters: number;
  lengthMeters: number;
};

export type PipeMeasurement = {
  networkId: string;
  branchId: string;
  blockId: number;
  blockType: string;
  blockLabel?: string;
  elevationProfile: string;
  length: string;
  segmentCount: number;
  segments: SegmentOffset[];
};

export type ComponentOffset = {
  id: string;
  branchId: string;
  blockId: number;
  blockType: string;
  blockLabel?: string;
  offsetMeters: number;
};

export type MeasureResponse = {
  measurements: PipeMeasurement[];
  offsets: BranchOffset[];
  componentOffsets: ComponentOffset[];
  totalLengthMeters: number;
};

// ============================================================================
// Snapshot Types
// ============================================================================

/**
 * Unit value wrapper - a value with its unit specified.
 * e.g., { "bara": 35 } or { "celsius": 55 } or { "mtpa": 1.7 }
 */
export type UnitValue = {
  [unit: string]: number | boolean;
};

export type DimValue = string;

/**
 * Conditions are a flat map of pipe-separated keys to unit values.
 * Key format: "componentType|componentId|property"
 */
export type SnapshotConditions = Record<string, UnitValue>;

/**
 * Request body for snapshot run.
 */
export type SnapshotRequest =
  | {
      type: "direct";
      conditions: SnapshotConditions;
      includeAllPipes?: boolean;
    }
  | {
      type: "network";
      networkId: string;
      includeAllPipes?: boolean;
    };

/**
 * Fluid properties at a point in the network, expressed as dim-compatible strings.
 */
export type FluidProperties = {
  pressure?: DimValue;
  temperature?: DimValue;
  flowrate?: DimValue;
  density?: DimValue;
  enthalpy?: DimValue;
  entropy?: DimValue;
  molarMass?: DimValue;
  molarVolume?: DimValue;
  velocity?: DimValue;
  viscosity?: DimValue;
  volumetricFlowrate?: DimValue;
  vapourFraction?: DimValue;
  composition?: Record<string, DimValue>;
};

/**
 * A single pipe segment's fluid properties for profile data.
 */
export type ProfileSegment = {
  length: number;
  inlet?: FluidProperties;
  outlet?: FluidProperties;
};

/**
 * Component result in the response.
 */
export type SnapshotComponentResult = {
  id: string;
  scenarioId?: string;
  type: string;
  label: string;
  enabled?: boolean;
  inlet?: FluidProperties;
  outlet?: FluidProperties;
  workDone?: DimValue;
  duty?: DimValue;
  profile?: ProfileSegment[];
};

/**
 * Thresholds from the response.
 */
export type SnapshotThresholds = {
  maxWaterContentInPipeline?: { molFraction: number; molPercent: number };
  minTemperatureInPipeline?: { kelvin: number; celsius: number };
  maxPressureInOffshorePipeline?: { pascal: number; bara: number };
  maxPressureInOnshore?: { pascal: number; bara: number };
  temperatureInWell?: { kelvin: number; celsius: number };
  corrosionPotential?: 0 | 1 | 2;
};

/**
 * Response from the snapshot run endpoint.
 */
export type SnapshotResponse = {
  success: boolean;
  components: SnapshotComponentResult[];
  thresholds?: SnapshotThresholds;
  metadata?: Record<string, unknown>;
  report?: string;
  error?: {
    type?: string;
    message?: string;
    severity?: string;
    errorCode?: string;
  };
  validation?: SnapshotValidation;
};

// ============================================================================
// Snapshot Validation Types
// ============================================================================

/**
 * Status of an extracted condition.
 */
export type ConditionStatus = "extracted" | "missing";

/**
 * A single extracted condition with validation metadata.
 */
export type ExtractedCondition = {
  key: string;
  value: UnitValue | null;
  status: ConditionStatus;
  property: string;
  unit: string;
  sourceBlockId?: string;
};

/**
 * Validation result for a single component.
 */
export type SnapshotComponentValidation = {
  componentType: string;
  componentId: string;
  label?: string;
  sourceBlockId: string;
  conditions: ExtractedCondition[];
  extractedCount: number;
  missingCount: number;
};

/**
 * Overall snapshot validation result.
 */
export type SnapshotValidation = {
  isReady: boolean;
  summary: {
    componentCount: number;
    totalConditions: number;
    extractedConditions: number;
    missingConditions: number;
  };
  components: SnapshotComponentValidation[];
};
