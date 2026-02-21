"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
} from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type OpenDialogOptions = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  showCloseButton?: boolean;
  className?: string;
};

export type DialogOpenContent =
  | React.ReactNode
  | ((api: { close: () => void }) => React.ReactNode);

export type DialogController = {
  open: (content: DialogOpenContent, options?: OpenDialogOptions) => void;
  close: () => void;
  isOpen: boolean;
};

type DialogContextValue = DialogController;

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogController {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within a DialogProvider");
  return ctx;
}

let globalController: DialogController | null = null;

export function openDialog(
  content: DialogOpenContent,
  options?: OpenDialogOptions
) {
  globalController?.open(content, options);
}

export function closeDialog() {
  globalController?.close();
}

export default function DialogProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<DialogOpenContent | null>(null);
  const [options, setOptions] = useState<OpenDialogOptions | undefined>();

  const close = useCallback(() => setOpen(false), []);

  const openDialogInternal = useCallback<DialogController["open"]>(
    (c, opts) => {
      setContent(() => c);
      setOptions(opts);
      setOpen(true);
    },
    []
  );

  const value = useMemo<DialogContextValue>(
    () => ({ open: openDialogInternal, close, isOpen: open }),
    [openDialogInternal, close, open]
  );

  useEffect(() => {
    globalController = value;
    return () => {
      if (globalController === value) globalController = null;
    };
  }, [value]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : close())}>
        <DialogContent
          showCloseButton={options?.showCloseButton ?? true}
          className={cn("lg:max-w-4xl", options?.className)}
        >
          {options?.title || options?.description ? (
            <DialogHeader className="">
              {options?.title ? (
                <DialogTitle>{options.title}</DialogTitle>
              ) : null}
              {options?.description ? (
                <DialogDescription>{options.description}</DialogDescription>
              ) : null}
            </DialogHeader>
          ) : null}
          {typeof content === "function" ? content({ close }) : content}
        </DialogContent>
      </Dialog>
    </DialogContext.Provider>
  );
}
