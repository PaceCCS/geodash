import { createContext, useContext } from "react";
import type { Block, BranchNodeData } from "@/lib/api-client";
import { getSelectedBlockPath } from "@/lib/flow-selection";

type BranchGeoBlock = {
  branchId: string;
  blockIndex: number;
  routeGeometry: unknown | null;
};

type BranchNodeContextValue = {
  node: BranchNodeData;
  blocks: Block[];
  geoBlocks: BranchGeoBlock[];
  selectedBlock: ReturnType<typeof getSelectedBlockPath>;
  selectBlock: (blockIndex: number) => void;
  addBlock: () => void;
};

const BranchNodeContext = createContext<BranchNodeContextValue | null>(null);

export function BranchNodeProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: BranchNodeContextValue;
}) {
  return (
    <BranchNodeContext.Provider value={value}>
      {children}
    </BranchNodeContext.Provider>
  );
}

export function useBranchNode() {
  const context = useContext(BranchNodeContext);

  if (!context) {
    throw new Error("useBranchNode must be used within BranchNodeProvider");
  }

  return context;
}
