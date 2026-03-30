import { createContext, useContext } from "react";

type FlowSelectionContextValue = {
  selectedQuery?: string;
  setSelectedQuery?: (query: string | null) => void;
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
