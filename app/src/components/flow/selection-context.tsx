import { createContext, useContext } from "react";

type FlowSelectionContextValue = {
  viewMode?: "schematic" | "fluid";
  selectedQuery?: string;
  setSelectedQuery?: (query: string | null) => void;
  onAddBlockToBranch?: (branchId: string) => void;
};

const FlowSelectionContext = createContext<FlowSelectionContextValue>({});

export function FlowSelectionProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FlowSelectionContextValue;
}) {
  return (
    <FlowSelectionContext.Provider value={value}>
      {children}
    </FlowSelectionContext.Provider>
  );
}

export function useFlowSelection() {
  return useContext(FlowSelectionContext);
}
