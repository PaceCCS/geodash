import { create } from "zustand";
import { persist } from "zustand/middleware";

type AppSettingsState = {
  preferredDirectory: string;
  useLastSelectionParent: boolean;
  setPreferredDirectory: (path: string) => void;
  setUseLastSelectionParent: (enabled: boolean) => void;
  recordDirectorySelection: (path: string) => void;
  resetSettings: () => void;
};

const defaultSettings = {
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
      setPreferredDirectory: (path) => set({ preferredDirectory: path }),
      setUseLastSelectionParent: (enabled) =>
        set({ useLastSelectionParent: enabled }),
      recordDirectorySelection: (path) => {
        if (!get().useLastSelectionParent) return;
        set({ preferredDirectory: getParentPath(path) });
      },
      resetSettings: () => set(defaultSettings),
    }),
    {
      name: "app-settings",
      partialize: (state) => ({
        preferredDirectory: state.preferredDirectory,
        useLastSelectionParent: state.useLastSelectionParent,
      }),
    },
  ),
);
