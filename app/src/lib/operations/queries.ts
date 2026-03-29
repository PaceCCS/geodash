/**
 * React Query hooks and query options for operations.
 */

import { getApiBaseUrl } from "@/lib/api-proxy";
import type {
  HealthStatus,
  MeasureResponse,
  NetworkSource,
  SnapshotResponse,
  SnapshotConditions,
  SnapshotValidation,
} from "./types";

// ============================================================================
// Measure API Functions
// ============================================================================

export async function runMeasure(
  source: NetworkSource,
  baseNetworkId?: string,
): Promise<MeasureResponse> {
  const baseUrl = getApiBaseUrl();
  const request = { source, baseNetworkId };

  const response = await fetch(`${baseUrl}/api/operations/measure/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unknown error",
      status: response.status,
    }));
    throw new Error(
      error.message ||
        error.error ||
        `Request failed with status ${response.status}`,
    );
  }

  return response.json();
}

export function measureQueryOptions(
  source: NetworkSource,
  queryKeyId?: string,
  baseNetworkId?: string,
) {
  const keyId =
    queryKeyId ?? (source.type === "networkId" ? source.networkId : "inline");
  return {
    queryKey: ["measure", keyId] as const,
    queryFn: () => runMeasure(source, baseNetworkId),
    staleTime: 1000 * 60 * 60,
    enabled:
      source.type === "networkId" ? !!source.networkId : !!source.network,
  };
}

// ============================================================================
// Snapshot API Functions
// ============================================================================

/**
 * Validate a network for snapshot readiness.
 * Returns which conditions can be extracted and which are missing.
 *
 * @param source - Network source (networkId or inline data from collections)
 * @param baseNetworkId - Optional networkId for inheritance when source is inline data
 */
export async function validateSnapshotNetwork(
  source: NetworkSource,
  baseNetworkId?: string,
): Promise<SnapshotValidation> {
  const baseUrl = getApiBaseUrl();

  const request = { source, baseNetworkId };

  const response = await fetch(`${baseUrl}/api/operations/snapshot/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unknown error",
      status: response.status,
    }));
    throw new Error(
      error.message ||
        error.error ||
        `Request failed with status ${response.status}`,
    );
  }

  return response.json();
}

/**
 * Network-level runtime parameters for snapshot simulation.
 */
export type NetworkConditions = {
  airMedium?: number; // Celsius
  soilMedium?: number; // Celsius
  waterMedium?: number; // Celsius
};

/**
 * Run a snapshot simulation for a network.
 * Conditions are automatically extracted from the network.
 * @param source - Network source (networkId or inline data from collections)
 * @param includeAllPipes - Whether to include all pipe segments in response
 * @param baseNetworkId - Optional networkId for inheritance when source is inline data
 * @param networkConditions - Optional network-level runtime parameters
 */
export async function runSnapshot(
  source: NetworkSource,
  includeAllPipes?: boolean,
  baseNetworkId?: string,
  networkConditions?: NetworkConditions,
): Promise<SnapshotResponse> {
  const baseUrl = getApiBaseUrl();

  const request = {
    source,
    baseNetworkId,
    includeAllPipes,
    networkConditions,
  };

  const response = await fetch(`${baseUrl}/api/operations/snapshot/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unknown error",
      status: response.status,
    }));
    throw new Error(
      error.message ||
        error.error ||
        `Request failed with status ${response.status}`,
    );
  }

  return response.json();
}

/**
 * Run a raw snapshot request (pass-through to Scenario Modeller API).
 */
export async function runSnapshotRaw(
  conditions: SnapshotConditions,
  includeAllPipes?: boolean,
): Promise<unknown> {
  const baseUrl = getApiBaseUrl();

  const request = { conditions, includeAllPipes };

  const response = await fetch(`${baseUrl}/api/operations/snapshot/raw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      error: "Unknown error",
      status: response.status,
    }));
    throw new Error(
      error.message ||
        error.error ||
        `Request failed with status ${response.status}`,
    );
  }

  return response.json();
}

/**
 * Check snapshot server health.
 */
export async function checkSnapshotHealth(): Promise<HealthStatus> {
  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}/api/operations/snapshot/health`);

  // Health endpoint always returns JSON, even on error
  return response.json();
}

// ============================================================================
// Snapshot React Query Options
// ============================================================================

/**
 * Query options for snapshot validation.
 * @param source - Network source (networkId or inline data)
 * @param queryKeyId - Optional ID for query caching (defaults to networkId if source is networkId)
 * @param baseNetworkId - Optional networkId for inheritance when source is inline data
 */
export function snapshotValidationQueryOptions(
  source: NetworkSource,
  queryKeyId?: string,
  baseNetworkId?: string,
) {
  const keyId =
    queryKeyId ?? (source.type === "networkId" ? source.networkId : "inline");
  return {
    queryKey: ["snapshot", "validation", keyId] as const,
    queryFn: () => validateSnapshotNetwork(source, baseNetworkId),
    staleTime: 1000 * 30, // 30 seconds
    enabled:
      source.type === "networkId" ? !!source.networkId : !!source.network,
  };
}

/**
 * Query options for snapshot health check.
 */
export function snapshotHealthQueryOptions() {
  return {
    queryKey: ["snapshot", "health"] as const,
    queryFn: () => checkSnapshotHealth(),
    staleTime: 1000 * 10, // 10 seconds
    refetchInterval: 1000 * 30, // Refetch every 30 seconds
  };
}
