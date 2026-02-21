"use client";

import { useDimContext } from "@/contexts/dim-context";

export function useDimReady(): boolean {
  const { ready } = useDimContext();
  return ready;
}
