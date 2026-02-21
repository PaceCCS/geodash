import { createContext, useContext, type ReactNode } from "react";

export type NetworkContextValue = {
  /** The current network identifier (absolute directory path or preset name). */
  networkId: string;
  /**
   * Construct a URL to fetch a static asset from the current network directory.
   * @param relativePath - Path relative to the network directory (e.g. "assets/map.svg")
   */
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
    return `http://localhost:3001/api/network/assets/${relativePath}?network=${encodedNetwork}`;
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

/** Returns null when not inside a NetworkProvider. */
export function useNetworkOptional(): NetworkContextValue | null {
  return useContext(NetworkContext);
}
