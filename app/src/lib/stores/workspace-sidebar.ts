import { create } from "zustand";

type WorkspaceSidebarDirectory = {
  path: string;
  label: string;
};

type WorkspaceSidebarState = {
  directory: WorkspaceSidebarDirectory | null;
  setDirectory: (directory: WorkspaceSidebarDirectory | null) => void;
};

export const useWorkspaceSidebar = create<WorkspaceSidebarState>((set) => ({
  directory: null,
  setDirectory: (directory) => set({ directory }),
}));
