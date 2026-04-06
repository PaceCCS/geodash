import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { inspectGeoBlocks, type MappableBlock } from "@/lib/api-client";
import { queryClient } from "@/lib/query-client";

let activeNetworkId: string | null = null;

export const geoCollection = createCollection(
  queryCollectionOptions<MappableBlock>({
    id: "geo:blocks",
    queryKey: ["geo"],
    queryFn: async () => {
      if (!activeNetworkId) {
        return [];
      }
      const result = await inspectGeoBlocks(activeNetworkId);
      return result.blocks;
    },
    queryClient,
    getKey: (block) => `${block.branchId}/${block.blockIndex}`,
  }),
);

/**
 * Set the active network and trigger a geo inspect refresh.
 * Call this after every network load/reload.
 */
export async function refreshGeoCollection(networkId: string): Promise<void> {
  activeNetworkId = networkId;
  await geoCollection.utils.refetch();
}

/**
 * Clear geo data when network is unloaded.
 */
export function clearGeoCollection(): void {
  activeNetworkId = null;
  const keys = Array.from(geoCollection.keys()) as string[];
  if (keys.length) {
    geoCollection.utils.writeBatch(() => {
      for (const key of keys) {
        geoCollection.utils.writeDelete(key);
      }
    });
  }
}
