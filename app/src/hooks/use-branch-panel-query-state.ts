"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EXPANDED_BLOCK_QUERY_PARAM,
  buildBranchPanelSearch,
  getBranchPanelState,
  parseBlockPath,
} from "@/lib/branch-panel-query";

export function useBranchPanelQueryState() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.toString();

  const state = useMemo(
    () => getBranchPanelState(new URLSearchParams(currentSearch)),
    [currentSearch],
  );

  const replaceSearch = useCallback(
    (nextSearchParams: URLSearchParams) => {
      const nextSearch = nextSearchParams.toString();
      const nextUrl = nextSearch ? `${pathname}?${nextSearch}` : pathname;
      const currentUrl = currentSearch ? `${pathname}?${currentSearch}` : pathname;

      if (nextUrl !== currentUrl) {
        router.replace(nextUrl, { scroll: false });
      }
    },
    [currentSearch, pathname, router],
  );

  const setSelectedBranchId = useCallback(
    (branchId: string | null) => {
      const nextSearchParams = buildBranchPanelSearch(
        new URLSearchParams(currentSearch),
        {
          selectedBranchId: branchId,
          expandedBlockPath: null,
        },
      );

      if (!branchId) {
        nextSearchParams.delete(EXPANDED_BLOCK_QUERY_PARAM);
      }

      replaceSearch(nextSearchParams);
    },
    [currentSearch, replaceSearch],
  );

  const clearSelection = useCallback(() => {
    const nextSearchParams = buildBranchPanelSearch(
      new URLSearchParams(currentSearch),
      {
        selectedBranchId: null,
        expandedBlockPath: null,
      },
    );

    replaceSearch(nextSearchParams);
  }, [currentSearch, replaceSearch]);

  const openBlock = useCallback(
    (blockPath: string) => {
      const parsedBlock = parseBlockPath(blockPath);
      if (!parsedBlock) return;

      const nextSearchParams = buildBranchPanelSearch(
        new URLSearchParams(currentSearch),
        {
          selectedBranchId: parsedBlock.branchId,
          expandedBlockPath: parsedBlock.blockPath,
        },
      );

      replaceSearch(nextSearchParams);
    },
    [currentSearch, replaceSearch],
  );

  const clearExpandedBlock = useCallback(() => {
    const nextSearchParams = buildBranchPanelSearch(
      new URLSearchParams(currentSearch),
      {
        expandedBlockPath: null,
      },
    );

    replaceSearch(nextSearchParams);
  }, [currentSearch, replaceSearch]);

  return {
    selectedBranchId: state.selectedBranchId,
    expandedBlockPath: state.expandedBlockPath,
    setSelectedBranchId,
    clearSelection,
    openBlock,
    clearExpandedBlock,
  };
}
