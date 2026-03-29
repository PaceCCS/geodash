import { create } from "zustand";
import { persist } from "zustand/middleware";

interface RightSidebarState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useRightSidebar = create<RightSidebarState>()(
  persist(
    (set) => ({
      open: true,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
    }),
    { name: "right-sidebar" }
  )
);

export function RightSidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
