import * as React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const KEYBOARD_SHORTCUT = ".";

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
  const toggle = useRightSidebar((s) => s.toggle);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === KEYBOARD_SHORTCUT && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return children;
}
