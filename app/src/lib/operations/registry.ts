/**
 * Operation Registry
 *
 * Defines available operations that can be run on networks.
 * Each operation has validation requirements and API endpoints.
 */

import type { Operation } from "./types";

/**
 * Available operations.
 * Add new operations here as they are implemented.
 */
export const OPERATIONS: Operation[] = [
  {
    id: "snapshot",
    name: "Snapshot",
    description: "Run a snapshot using the Scenario Modeller",
    schemaVersion: "v1.0-snapshot",
    endpoint: "/api/operations/snapshot/run",
    validateEndpoint: "/api/operations/snapshot/run",
    healthEndpoint: "/api/operations/snapshot/health",
  },
];

/**
 * Get an operation by ID.
 */
export function getOperation(id: string): Operation | undefined {
  return OPERATIONS.find((op) => op.id === id);
}

/**
 * Get all available operations.
 */
export function getOperations(): Operation[] {
  return OPERATIONS;
}

/**
 * Check if an operation exists.
 */
export function hasOperation(id: string): boolean {
  return OPERATIONS.some((op) => op.id === id);
}
