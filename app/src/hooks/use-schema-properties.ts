import { useQuery } from "@tanstack/react-query";
import { getApiBaseUrl } from "@/lib/api-proxy";
import { useNetwork } from "@/contexts/network-context";
import { useOperationOptional } from "@/contexts/operation-context";
import { getNetworkSourceFromCollections } from "@/lib/collections/flow";

/**
 * Scope level for property editing.
 * - "block": Single block (most specific)
 * - "branch": All blocks within a branch
 * - "group": All blocks within a group
 * - "global": All blocks in the network
 */
export type PropertyScope = "block" | "branch" | "group" | "global";

/**
 * Property metadata from the schema API
 */
export type PropertyMetadata = {
  block_type: string;
  property: string;
  required: boolean;
  type: "number" | "string" | "enum" | "boolean" | "object";
  title?: string;
  suffix?: string;
  description?: string;
  dimension?: string;
  defaultUnit?: string;
  min?: number;
  max?: number;
  enumValues?: (string | number | boolean)[];
  hidden?: boolean;
};

/**
 * Aggregated property metadata for outer scopes (branch, group, global).
 * Contains information about which blocks are affected by this property.
 */
export type AggregatedPropertyMetadata = PropertyMetadata & {
  /** Block types that have this property (e.g., ["Pipe", "Compressor"]) */
  affectedBlockTypes: string[];
  /** Human-readable labels for affected blocks (e.g., ["Block 0 (Pipe)", "Block 1 (Compressor)"]) */
  affectedBlockLabels: string[];
  /** Full paths to affected blocks (e.g., ["branch-1/blocks/0", "branch-1/blocks/1"]) */
  affectedBlockPaths: string[];
  /** Block types where this property is required */
  requiredInBlockTypes: string[];
  /** True if this property is required in ALL affected block types */
  universallyRequired: boolean;
};

/**
 * Schema properties response - flattened format
 * Keys are paths like "branch-1/blocks/0/length"
 */
export type SchemaPropertiesResponse = Record<string, PropertyMetadata>;

/**
 * Fetch schema properties for a specific query path
 */
async function fetchSchemaProperties(
  networkId: string,
  queryPath: string,
  schemaVersion: string
): Promise<SchemaPropertiesResponse> {
  const baseUrl = getApiBaseUrl();
  const params = new URLSearchParams({
    network: networkId,
    q: queryPath,
    version: schemaVersion,
  });

  const response = await fetch(`${baseUrl}/api/schema/properties?${params}`);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch schema properties: ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * Hook to fetch schema properties for a query path.
 * Uses networkId from NetworkContext and schemaVersion from OperationContext.
 *
 * @param queryPath - The query path (e.g., "branch-1/blocks/0")
 * @param options - Optional overrides and query options
 */
export function useSchemaProperties(
  queryPath: string,
  options?: {
    schemaVersion?: string;
    enabled?: boolean;
  }
) {
  const { networkId } = useNetwork();
  const operationContext = useOperationOptional();

  const schemaVersion =
    options?.schemaVersion ?? operationContext?.schemaVersion;

  return useQuery({
    queryKey: ["schema-properties", networkId, queryPath, schemaVersion],
    queryFn: () => {
      if (!schemaVersion) {
        throw new Error(
          "schemaVersion is required. Either provide it via options or use within an OperationProvider."
        );
      }
      return fetchSchemaProperties(networkId, queryPath, schemaVersion);
    },
    enabled: options?.enabled !== false && !!schemaVersion,
  });
}

/**
 * Extract block-level properties from schema properties response.
 * Groups properties by block path.
 */
export function groupPropertiesByBlock(
  properties: SchemaPropertiesResponse
): Record<string, Record<string, PropertyMetadata>> {
  const grouped: Record<string, Record<string, PropertyMetadata>> = {};

  for (const [path, metadata] of Object.entries(properties)) {
    // Path format: "branch-1/blocks/0/propertyName"
    // Extract block path: "branch-1/blocks/0"
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash === -1) continue;

    const blockPath = path.substring(0, lastSlash);
    const propertyName = path.substring(lastSlash + 1);

    if (!grouped[blockPath]) {
      grouped[blockPath] = {};
    }
    grouped[blockPath][propertyName] = metadata;
  }

  return grouped;
}

/**
 * Hook to fetch all schema properties for a network.
 * Uses networkId from NetworkContext and schemaVersion from OperationContext.
 */
export function useNetworkSchemaProperties(options?: {
  schemaVersion?: string;
  enabled?: boolean;
}) {
  const { networkId } = useNetwork();
  const operationContext = useOperationOptional();

  const schemaVersion =
    options?.schemaVersion ?? operationContext?.schemaVersion;

  return useQuery({
    queryKey: ["network-schema-properties", networkId, schemaVersion],
    queryFn: async () => {
      if (!schemaVersion) {
        throw new Error(
          "schemaVersion is required. Either provide it via options or use within an OperationProvider."
        );
      }

      const baseUrl = getApiBaseUrl();
      const params = new URLSearchParams({
        network: networkId,
        version: schemaVersion,
      });

      const response = await fetch(
        `${baseUrl}/api/schema/network/properties?${params}`
      );

      if (!response.ok) {
        throw new Error(
          `Failed to fetch network schema properties: ${response.statusText}`
        );
      }

      return response.json() as Promise<SchemaPropertiesResponse>;
    },
    enabled: options?.enabled !== false && !!schemaVersion,
  });
}

/**
 * Parse a property path to extract block path, block index, and property name.
 * Path format: "branch-1/blocks/0/propertyName"
 */
function parsePropertyPath(path: string): {
  blockPath: string;
  blockIndex: number;
  propertyName: string;
} | null {
  // Match pattern: something/blocks/{index}/propertyName
  const match = path.match(/^(.+\/blocks\/(\d+))\/([^/]+)$/);
  if (!match) return null;

  return {
    blockPath: match[1],
    blockIndex: parseInt(match[2], 10),
    propertyName: match[3],
  };
}

/**
 * Aggregate properties across multiple blocks for outer scope editing.
 * Groups by property name and tracks which blocks are affected.
 *
 * @param properties - Schema properties response (flattened path -> metadata)
 * @param options - Optional filtering by block types
 * @returns Record of property name -> AggregatedPropertyMetadata
 */
export function aggregatePropertiesForScope(
  properties: SchemaPropertiesResponse,
  options?: { blockTypeFilter?: string[] }
): Record<string, AggregatedPropertyMetadata> {
  // Intermediate map: propertyName -> { metadata variants, block info }
  const propertyMap = new Map<
    string,
    {
      metadata: PropertyMetadata;
      blockTypes: Set<string>;
      blockLabels: string[];
      blockPaths: string[];
      requiredInTypes: Set<string>;
    }
  >();

  for (const [path, metadata] of Object.entries(properties)) {
    // Filter by block type if specified
    if (options?.blockTypeFilter?.length) {
      if (!options.blockTypeFilter.includes(metadata.block_type)) {
        continue;
      }
    }

    const parsed = parsePropertyPath(path);
    if (!parsed) continue;

    const { blockPath, blockIndex, propertyName } = parsed;

    // Create or update property entry
    const existing = propertyMap.get(propertyName);

    if (!existing) {
      // First occurrence of this property
      propertyMap.set(propertyName, {
        metadata: { ...metadata },
        blockTypes: new Set([metadata.block_type]),
        blockLabels: [`Block ${blockIndex} (${metadata.block_type})`],
        blockPaths: [blockPath],
        requiredInTypes: metadata.required
          ? new Set([metadata.block_type])
          : new Set(),
      });
    } else {
      // Property already exists - aggregate
      existing.blockTypes.add(metadata.block_type);
      existing.blockLabels.push(`Block ${blockIndex} (${metadata.block_type})`);
      existing.blockPaths.push(blockPath);

      if (metadata.required) {
        existing.requiredInTypes.add(metadata.block_type);
      }

      // Merge metadata: use first encountered values, but take wider constraints
      // For min, use the smaller (more permissive) value
      if (metadata.min !== undefined) {
        existing.metadata.min =
          existing.metadata.min !== undefined
            ? Math.min(existing.metadata.min, metadata.min)
            : metadata.min;
      }
      // For max, use the larger (more permissive) value
      if (metadata.max !== undefined) {
        existing.metadata.max =
          existing.metadata.max !== undefined
            ? Math.max(existing.metadata.max, metadata.max)
            : metadata.max;
      }
      // Merge enum values (union)
      if (metadata.enumValues?.length) {
        const existingEnums = new Set(
          existing.metadata.enumValues?.map(String) ?? []
        );
        for (const v of metadata.enumValues) {
          existingEnums.add(String(v));
        }
        existing.metadata.enumValues = Array.from(existingEnums);
      }
    }
  }

  // Convert to final format
  const result: Record<string, AggregatedPropertyMetadata> = {};

  for (const [propertyName, entry] of propertyMap) {
    const affectedBlockTypes = Array.from(entry.blockTypes);
    const requiredInBlockTypes = Array.from(entry.requiredInTypes);

    result[propertyName] = {
      ...entry.metadata,
      affectedBlockTypes,
      affectedBlockLabels: entry.blockLabels,
      affectedBlockPaths: entry.blockPaths,
      requiredInBlockTypes,
      // Universally required if required in ALL affected block types
      universallyRequired:
        affectedBlockTypes.length > 0 &&
        requiredInBlockTypes.length === affectedBlockTypes.length,
    };
  }

  return result;
}

/**
 * Filter schema properties by scope path and optional branch filter.
 * For branch scope: only properties within that branch
 * For group scope: only properties within branches specified in branchFilter
 */
function filterPropertiesByScopePath(
  properties: SchemaPropertiesResponse,
  scope: PropertyScope,
  scopePath: string,
  branchFilter?: string[]
): SchemaPropertiesResponse {
  if (scope === "global" && !branchFilter?.length) {
    // Global scope includes all properties
    return properties;
  }

  if (scope === "block") {
    // Block scope: filter to exact block path
    const filtered: SchemaPropertiesResponse = {};
    for (const [path, metadata] of Object.entries(properties)) {
      if (path.startsWith(`${scopePath}/`)) {
        filtered[path] = metadata;
      }
    }
    return filtered;
  }

  if (scope === "branch") {
    // Branch scope: filter to all blocks within the branch
    // scopePath format: "branch-1" or "some-branch-id"
    const filtered: SchemaPropertiesResponse = {};
    for (const [path, metadata] of Object.entries(properties)) {
      // Path format: "branch-1/blocks/0/propertyName"
      // Check if path starts with the branch ID
      if (path.startsWith(`${scopePath}/`)) {
        filtered[path] = metadata;
      }
    }
    return filtered;
  }

  if (scope === "group" && branchFilter?.length) {
    // Group scope: filter to branches specified in branchFilter
    const filtered: SchemaPropertiesResponse = {};
    for (const [path, metadata] of Object.entries(properties)) {
      // Path format: "branch-1/blocks/0/propertyName"
      // Check if path starts with any of the branch IDs in the filter
      const matchesBranch = branchFilter.some((branchId) =>
        path.startsWith(`${branchId}/`)
      );
      if (matchesBranch) {
        filtered[path] = metadata;
      }
    }
    return filtered;
  }

  // Global scope or group without filter: return all properties
  return properties;
}

/**
 * Result type for useScopedSchemaProperties hook.
 */
export type ScopedSchemaPropertiesResult = {
  /** Aggregated properties for the scope */
  properties: Record<string, AggregatedPropertyMetadata> | null;
  /** Whether the query is loading */
  isLoading: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** The scope being queried */
  scope: PropertyScope;
  /** The scope path being queried */
  scopePath: string;
};

/**
 * Hook to fetch and aggregate schema properties for a specific scope.
 *
 * - For "block" scope: Returns properties for a single block (not aggregated)
 * - For "branch" scope: Aggregates properties across all blocks in the branch
 * - For "group" scope: Aggregates properties across all blocks in the group
 * - For "global" scope: Aggregates properties across all blocks in the network
 *
 * @param scope - The scope level ("block" | "branch" | "group" | "global")
 * @param scopePath - The path to the scope (e.g., "branch-1" for branch, "branch-1/blocks/0" for block)
 * @param options - Optional settings
 */
export function useScopedSchemaProperties(
  scope: PropertyScope,
  scopePath: string,
  options?: {
    schemaVersion?: string;
    blockTypeFilter?: string[];
    branchFilter?: string[];
    enabled?: boolean;
  }
): ScopedSchemaPropertiesResult {
  const operationContext = useOperationOptional();

  const schemaVersion =
    options?.schemaVersion ?? operationContext?.schemaVersion;

  // For block scope, use the existing single-block query
  const blockQuery = useSchemaProperties(scopePath, {
    schemaVersion,
    enabled: options?.enabled !== false && scope === "block",
  });

  // For outer scopes, use the network-wide query
  const networkQuery = useNetworkSchemaProperties({
    schemaVersion,
    enabled: options?.enabled !== false && scope !== "block",
  });

  // Select the appropriate query based on scope
  const activeQuery = scope === "block" ? blockQuery : networkQuery;

  // Compute aggregated properties
  let properties: Record<string, AggregatedPropertyMetadata> | null = null;

  if (activeQuery.data) {
    if (scope === "block") {
      // For block scope, convert PropertyMetadata to AggregatedPropertyMetadata
      const blockProps = groupPropertiesByBlock(activeQuery.data);
      const blockPath = Object.keys(blockProps).find(
        (path) => path === scopePath || scopePath.startsWith(path)
      );

      if (blockPath && blockProps[blockPath]) {
        properties = {};
        // Extract block index from path
        const indexMatch = blockPath.match(/\/blocks\/(\d+)/);
        const blockIndex = indexMatch ? parseInt(indexMatch[1], 10) : 0;

        for (const [propName, metadata] of Object.entries(
          blockProps[blockPath]
        )) {
          properties[propName] = {
            ...metadata,
            affectedBlockTypes: [metadata.block_type],
            affectedBlockLabels: [
              `Block ${blockIndex} (${metadata.block_type})`,
            ],
            affectedBlockPaths: [blockPath],
            requiredInBlockTypes: metadata.required
              ? [metadata.block_type]
              : [],
            universallyRequired: metadata.required,
          };
        }
      }
    } else {
      // For outer scopes, filter and aggregate
      const filtered = filterPropertiesByScopePath(
        activeQuery.data,
        scope,
        scopePath,
        options?.branchFilter
      );
      properties = aggregatePropertiesForScope(filtered, {
        blockTypeFilter: options?.blockTypeFilter,
      });
    }
  }

  return {
    properties,
    isLoading: activeQuery.isLoading,
    error: activeQuery.error,
    scope,
    scopePath,
  };
}

// ============================================================================
// Resolved Values API (from /api/schema/network/validate)
// ============================================================================

/**
 * Validation result from the schema validate endpoint.
 * Includes resolved values with their source scope.
 */
export type ValidationResult = {
  is_valid: boolean;
  severity?: "error" | "warning";
  message?: string;
  /** Formatted value for display (with units) */
  value?: string;
  /** Raw resolved value */
  rawValue?: string | number | null;
  /** Where the property was resolved from: "block", "branch", "group", "global" */
  scope?: string;
};

/**
 * Response from /api/schema/network/validate endpoint.
 * Keys are paths like "branch-1/blocks/0/length"
 */
export type ValidationResponse = Record<string, ValidationResult>;

/**
 * Resolved value with its source scope.
 */
export type ResolvedValue = {
  /** The resolved value (formatted for display) */
  value: string | undefined;
  /** The raw value */
  rawValue: string | number | null | undefined;
  /** Which scope the value came from */
  scope: string | undefined;
  /** Whether the value is valid */
  isValid: boolean;
  /** Validation error message if invalid */
  error?: string;
};

/**
 * Fetch validation results (resolved values) for a network.
 * POSTs inline network data from collections to include user modifications.
 */
async function fetchValidationResults(
  networkId: string,
  schemaVersion: string
): Promise<ValidationResponse> {
  const baseUrl = getApiBaseUrl();

  // Get the current network state from collections (includes user modifications)
  const networkSource = await getNetworkSourceFromCollections();

  // getNetworkSourceFromCollections always returns type: "data"
  if (networkSource.type !== "data") {
    throw new Error("Expected data source from collections");
  }

  // POST inline data so WASM can resolve properties with user modifications
  const response = await fetch(`${baseUrl}/api/schema/network/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      network: networkSource.network,
      version: schemaVersion,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch validation results: ${response.statusText}`
    );
  }

  return response.json();
}

/**
 * Hook to fetch resolved values for all blocks in a network.
 * Uses the validate endpoint which returns values with their resolution scope.
 */
export function useResolvedValues(options?: {
  schemaVersion?: string;
  enabled?: boolean;
}) {
  const { networkId } = useNetwork();
  const operationContext = useOperationOptional();

  const schemaVersion =
    options?.schemaVersion ?? operationContext?.schemaVersion;

  return useQuery({
    queryKey: ["schema-validation", networkId, schemaVersion],
    queryFn: () => {
      if (!schemaVersion) {
        throw new Error(
          "schemaVersion is required. Either provide it via options or use within an OperationProvider."
        );
      }
      return fetchValidationResults(networkId, schemaVersion);
    },
    enabled: options?.enabled !== false && !!schemaVersion,
    staleTime: 1000 * 30, // 30 seconds - validation can be expensive
    retry: false, // Don't retry on failure - 404s indicate backend needs restart
  });
}

/**
 * Extract resolved values for a specific block path.
 *
 * @param validationResults - Full validation results from useResolvedValues
 * @param blockPath - Block path (e.g., "branch-1/blocks/0")
 * @returns Record of property name -> ResolvedValue
 */
export function getResolvedValuesForBlock(
  validationResults: ValidationResponse | undefined,
  blockPath: string
): Record<string, ResolvedValue> {
  if (!validationResults) return {};

  const resolved: Record<string, ResolvedValue> = {};
  const prefix = `${blockPath}/`;

  for (const [path, result] of Object.entries(validationResults)) {
    if (path.startsWith(prefix)) {
      const propertyName = path.slice(prefix.length);
      // Skip nested paths
      if (!propertyName.includes("/")) {
        resolved[propertyName] = {
          value: result.value,
          rawValue: result.rawValue,
          scope: result.scope,
          isValid: result.is_valid,
          error: result.is_valid ? undefined : result.message,
        };
      }
    }
  }

  return resolved;
}

/**
 * Get inherited values for a property across multiple blocks.
 * Used for outer scope forms to show what value would be inherited.
 *
 * @param validationResults - Full validation results
 * @param blockPaths - Block paths to check
 * @param propertyName - Property name to look up
 * @returns Array of resolved values from each block
 */
export function getInheritedValuesForProperty(
  validationResults: ValidationResponse | undefined,
  blockPaths: string[],
  propertyName: string
): ResolvedValue[] {
  if (!validationResults) return [];

  return blockPaths.map((blockPath) => {
    const path = `${blockPath}/${propertyName}`;
    const result = validationResults[path];
    if (result) {
      return {
        value: result.value,
        rawValue: result.rawValue,
        scope: result.scope,
        isValid: result.is_valid,
        error: result.is_valid ? undefined : result.message,
      };
    }
    return {
      value: undefined,
      rawValue: undefined,
      scope: undefined,
      isValid: true,
    };
  });
}
