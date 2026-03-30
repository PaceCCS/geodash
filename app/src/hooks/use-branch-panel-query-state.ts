"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  EXPANDED_BLOCK_QUERY_PARAM,
  buildBranchPanelSearch,
  getBranchPanelState,
  parseBlockPath,
} from "@/lib/branch-panel-query";

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
  };
}

function getSnapshot() {
  if (typeof window === "undefined") {
    return { pathname: "", search: "" };
  }

  return {
    pathname: window.location.pathname,
    search: window.location.search,
  };
}

export function useBranchPanelQueryState() {
  const location = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const pathname = location.pathname;
  const currentSearch = location.search.replace(/^\?/, "");

  const state = useMemo(
    () => getBranchPanelState(new URLSearchParams(currentSearch)),
    [currentSearch],
  );

  const replaceSearch = useCallback(
    (nextSearchParams: URLSearchParams) => {
      const nextSearch = nextSearchParams.toString();
      const nextUrl = nextSearch ? `${pathname}?${nextSearch}` : pathname;
      const currentUrl = currentSearch ? `${pathname}?${currentSearch}` : pathname;

      if (typeof window !== "undefined" && nextUrl !== currentUrl) {
        window.history.replaceState(window.history.state, "", nextUrl);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    },
    [currentSearch, pathname],
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
