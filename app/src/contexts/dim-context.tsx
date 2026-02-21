"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { defineConst, initDim } from "../lib/dim/dim";

type DimConstant = { name: string; expr: string };

type DimContextValue = {
  ready: boolean;
};

const DimContext = createContext<DimContextValue>({ ready: false });

export function DimProvider(props: {
  constants?: DimConstant[];
  children: React.ReactNode;
}) {
  const { constants, children } = props;
  const [ready, setReady] = useState(false);

  const constantsKey = useMemo(
    () => JSON.stringify(constants ?? []),
    [constants]
  );

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await initDim();
      if (constants && constants.length > 0) {
        for (const c of constants) {
          defineConst(c.name, c.expr);
        }
      }
      if (!cancelled) setReady(true);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [constantsKey]);

  return (
    <DimContext.Provider value={{ ready }}>{children}</DimContext.Provider>
  );
}

export function useDimContext(): DimContextValue {
  return useContext(DimContext);
}
