/**
 * Operations module
 *
 * Provides the operation registry, types, and query functions for
 * running operations like snapshot on networks.
 */

// Types
export type {
  Operation,
  NetworkSource,
  NetworkData,
  NetworkBlock,
  NetworkBranch,
  NetworkGroup,
  HealthStatus,
  MeasureResponse,
  SegmentOffset,
  BranchOffset,
  ComponentOffset,
  // Snapshot types
  PipeMeasurement,
  UnitValue,
  DimValue,
  SnapshotConditions,
  SnapshotRequest,
  SnapshotResponse,
  SnapshotComponentResult,
  SnapshotThresholds,
  FluidProperties,
  // Snapshot validation types
  ConditionStatus,
  ExtractedCondition,
  SnapshotComponentValidation,
  SnapshotValidation,
} from "./types";

// Registry
export { OPERATIONS, getOperation, getOperations, hasOperation } from "./registry";

// Queries and API functions
export {
  // Snapshot API functions
  validateSnapshotNetwork,
  runMeasure,
  runSnapshot,
  runSnapshotRaw,
  checkSnapshotHealth,
  measureQueryOptions,
  // Snapshot Query options
  snapshotValidationQueryOptions,
  snapshotHealthQueryOptions,
  // Snapshot types
  type NetworkConditions,
} from "./queries";
