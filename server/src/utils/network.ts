import { resolve } from "node:path";

/**
 * Resolve a network identifier to an absolute directory path.
 * Returns null if no identifier was provided.
 * Absolute paths are used as-is; relative paths resolve from
 * GEODASH_NETWORKS_DIR (env) or CWD.
 */
export function resolveNetworkPath(networkId: string | undefined): string | null {
  if (!networkId) return null;
  if (networkId.startsWith("/")) return networkId;
  const base = process.env.GEODASH_NETWORKS_DIR ?? process.cwd();
  return resolve(base, networkId);
}
