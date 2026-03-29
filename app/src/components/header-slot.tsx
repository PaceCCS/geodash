import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const HeaderSlotContext = createContext<{
  el: HTMLElement | null;
  setEl: (el: HTMLElement | null) => void;
}>({ el: null, setEl: () => {} });

export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);

  return (
    <HeaderSlotContext.Provider value={{ el, setEl }}>
      {children}
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
