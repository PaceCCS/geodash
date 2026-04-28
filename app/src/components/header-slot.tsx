import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export type HeaderFileActions = {
  openDirectory?: () => void;
  openShapefile?: () => void;
  close?: () => void;
};

const HeaderSlotContext = createContext<{
  el: HTMLElement | null;
  setEl: (el: HTMLElement | null) => void;
}>({ el: null, setEl: () => {} });

const HeaderFileActionsContext = createContext<{
  actions: HeaderFileActions;
  setActions: (actions: HeaderFileActions) => void;
}>({ actions: {}, setActions: () => {} });

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [actions, setActions] = useState<HeaderFileActions>({});

  return (
    <HeaderSlotContext.Provider value={{ el, setEl }}>
      <HeaderFileActionsContext.Provider value={{ actions, setActions }}>
        {children}
      </HeaderFileActionsContext.Provider>
    </HeaderSlotContext.Provider>
  );
}

export function HeaderSlotTarget({ className }: { className?: string }) {
  const { setEl } = useContext(HeaderSlotContext);

  return (
    <div
      ref={setEl}
      className={cn("flex-1 flex items-center", className)}
    />
  );
}

export function HeaderSlot({ children }: { children: ReactNode }) {
  const { el } = useContext(HeaderSlotContext);
  if (!el) return null;
  return createPortal(children, el);
}

export function useHeaderFileActions() {
  return useContext(HeaderFileActionsContext);
}
