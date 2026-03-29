"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type DimensionKey,
  getPreferredUnit,
  setPreferredUnit as storePreferredUnit,
} from "@/lib/stores/unitPreferencesSlice";

/**
 * Hook to get the preferred unit for a dimension.
 * Returns the stored preference or the default unit.
 */
export function usePreferredUnit(dimension: DimensionKey): string {
  const [unit, setUnit] = useState(() => getPreferredUnit(dimension));

  // Sync with storage on mount and when dimension changes
  useEffect(() => {
    setUnit(getPreferredUnit(dimension));
  }, [dimension]);

  return unit;
}

/**
 * Hook to get and set the preferred unit for a dimension.
 */
export function useUnitPreference(
  dimension: DimensionKey
): [string, (unit: string) => void] {
  const [unit, setUnitState] = useState(() => getPreferredUnit(dimension));

  // Sync with storage on mount and when dimension changes
  useEffect(() => {
    setUnitState(getPreferredUnit(dimension));
  }, [dimension]);

  const setUnit = useCallback(
    (newUnit: string) => {
      storePreferredUnit(dimension, newUnit);
      setUnitState(newUnit);
    },
    [dimension]
  );

  return [unit, setUnit];
}
