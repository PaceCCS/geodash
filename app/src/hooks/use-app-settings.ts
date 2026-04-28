import { create } from "zustand";
import { persist } from "zustand/middleware";

type AppSettingsState = {
  hasHydrated: boolean;
  preferredDirectory: string;
  useLastSelectionParent: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  setPreferredDirectory: (path: string) => void;
  setUseLastSelectionParent: (enabled: boolean) => void;
  recordDirectorySelection: (path: string) => void;
  resetSettings: () => void;
};

const defaultSettings = {
  hasHydrated: false,
  preferredDirectory: "",
  useLastSelectionParent: false,
};

function getParentPath(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(
    normalizedPath.lastIndexOf("/"),
    normalizedPath.lastIndexOf("\\"),
  );

  if (separatorIndex <= 0) {
    return normalizedPath;
  }

  return normalizedPath.slice(0, separatorIndex);
}

export const useAppSettings = create<AppSettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
      setPreferredDirectory: (path) => set({ preferredDirectory: path }),
      setUseLastSelectionParent: (enabled) =>
        set({ useLastSelectionParent: enabled }),
      recordDirectorySelection: (path) => {
        if (!get().useLastSelectionParent) return;
        set({ preferredDirectory: getParentPath(path) });
      },
      resetSettings: () =>
        set((state) => ({ ...defaultSettings, hasHydrated: state.hasHydrated })),
    }),
    {
      name: "app-settings",
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state) => ({
        preferredDirectory: state.preferredDirectory,
        useLastSelectionParent: state.useLastSelectionParent,
      }),
    },
  ),
);
