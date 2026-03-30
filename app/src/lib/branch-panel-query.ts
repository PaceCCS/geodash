export const BRANCH_QUERY_PARAM = "branch";
export const EXPANDED_BLOCK_QUERY_PARAM = "block";

export type ParsedBlockPath = {
  branchId: string;
  blockIndex: number;
  blockPath: string;
};

export function parseBlockPath(value: string | null | undefined) {
  if (!value) return null;

  const match = value.match(/^(.*)\/blocks\/(\d+)$/);
  if (!match) return null;

  const branchId = match[1];
  const blockIndex = Number.parseInt(match[2], 10);

  if (!branchId || Number.isNaN(blockIndex)) {
    return null;
  }

  return {
    branchId,
    blockIndex,
    blockPath: `${branchId}/blocks/${blockIndex}`,
  } satisfies ParsedBlockPath;
}

export function getBranchPanelState(searchParams: URLSearchParams) {
  const expandedBlock = parseBlockPath(
    searchParams.get(EXPANDED_BLOCK_QUERY_PARAM),
  );
  const selectedBranchId =
    searchParams.get(BRANCH_QUERY_PARAM) ?? expandedBlock?.branchId ?? null;

  return {
    selectedBranchId,
    expandedBlockPath:
      expandedBlock && expandedBlock.branchId === selectedBranchId
        ? expandedBlock.blockPath
        : null,
  };
}

export function buildBranchPanelSearch(
  currentSearchParams: URLSearchParams,
  nextState: {
    selectedBranchId?: string | null;
    expandedBlockPath?: string | null;
  },
) {
  const searchParams = new URLSearchParams(currentSearchParams);

  if (nextState.selectedBranchId === undefined) {
    // Preserve current value unless the next block path implies a different branch.
  } else if (nextState.selectedBranchId) {
    searchParams.set(BRANCH_QUERY_PARAM, nextState.selectedBranchId);
  } else {
    searchParams.delete(BRANCH_QUERY_PARAM);
  }

  if (nextState.expandedBlockPath === undefined) {
    return searchParams;
  }

  const expandedBlock = parseBlockPath(nextState.expandedBlockPath);

  if (expandedBlock) {
    searchParams.set(EXPANDED_BLOCK_QUERY_PARAM, expandedBlock.blockPath);
    searchParams.set(BRANCH_QUERY_PARAM, expandedBlock.branchId);
    return searchParams;
  }

  searchParams.delete(EXPANDED_BLOCK_QUERY_PARAM);
  return searchParams;
}

export function sourceBlockIdToBlockPath(sourceBlockId: string | undefined) {
  if (!sourceBlockId) return null;

  const match = sourceBlockId.match(/^(.*)_blocks_(\d+)$/);
  if (!match) return null;

  return `${match[1]}/blocks/${match[2]}`;
}
