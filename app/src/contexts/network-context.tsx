import { createContext, useContext, type ReactNode } from "react";
import { getApiBaseUrl } from "@/lib/api-proxy";

export type NetworkContextValue = {
  networkId: string;
  getAssetUrl: (relativePath: string) => string;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({
  networkId,
  children,
}: {
  networkId: string;
  children: ReactNode;
}) {
  const getAssetUrl = (relativePath: string) => {
    const encodedNetwork = encodeURIComponent(networkId);
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/api/network/assets/${relativePath}?network=${encodedNetwork}`;
  };

  return (
    <NetworkContext.Provider value={{ networkId, getAssetUrl }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork(): NetworkContextValue {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error("useNetwork must be used within a NetworkProvider");
  }
  return context;
}

export function useNetworkOptional(): NetworkContextValue | null {
  return useContext(NetworkContext);
}
