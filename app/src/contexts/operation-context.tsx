import { createContext, useContext, type ReactNode } from "react";
import type { Operation } from "@/lib/operations/types";

export type OperationContextValue = {
  /**
   * The current operation
   */
  operation: Operation;
  /**
   * The schema version from the operation (e.g., "v1.0-snapshot")
   */
  schemaVersion: string;
};

const OperationContext = createContext<OperationContextValue | null>(null);

export function OperationProvider({
  operation,
  children,
}: {
  operation: Operation;
  children: ReactNode;
}) {
  return (
    <OperationContext.Provider
      value={{ operation, schemaVersion: operation.schemaVersion }}
    >
      {children}
    </OperationContext.Provider>
  );
}

export function useOperation(): OperationContextValue {
  const context = useContext(OperationContext);
  if (!context) {
    throw new Error("useOperation must be used within an OperationProvider");
  }
  return context;
}

/**
 * Optional hook that returns null if not within an OperationProvider
 * Useful for components that may be used outside of an operation context
 */
export function useOperationOptional(): OperationContextValue | null {
  return useContext(OperationContext);
}
