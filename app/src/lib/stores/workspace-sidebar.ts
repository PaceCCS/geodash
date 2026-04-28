import { create } from "zustand";

type WorkspaceSidebarDirectory = {
  path: string;
  label: string;
};

export type WorkspaceItemActions = {
  editPath?: (path: string) => void;
  openInFinder?: (path: string) => void;
  viewPath?: (path: string) => void;
};

type WorkspaceSidebarState = {
  directory: WorkspaceSidebarDirectory | null;
  itemActions: WorkspaceItemActions;
  setDirectory: (directory: WorkspaceSidebarDirectory | null) => void;
  setItemActions: (actions: WorkspaceItemActions) => void;
};

export const useWorkspaceSidebar = create<WorkspaceSidebarState>((set) => ({
  directory: null,
  itemActions: {},
  setDirectory: (directory) => set({ directory }),
  setItemActions: (itemActions) => set({ itemActions }),
}));
