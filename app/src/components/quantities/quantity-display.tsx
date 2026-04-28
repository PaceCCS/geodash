"use client";

import { useDim } from "@/lib/dim/use-dim";
import { formatEvalResult } from "@/lib/dim/dim";
import { usePreferredUnit } from "@/hooks/use-property-display";
import { DimensionKey } from "@/lib/stores/unitPreferencesSlice";

/** Common props shared by both variants */
interface BaseProps {
  /** The expression to display (e.g., "100 bar", "25 degC") */
  children: string;
  /** Number of decimal places for display (default: 3) */
  precision?: number;
}

/** Props when using an explicit unit */
interface WithExplicitUnit extends BaseProps {
  /** Explicit unit to convert to (e.g., "bar", "degC") */
  unit: string;
  dimension?: never;
}

/** Props when using dimension-based preferred unit */
interface WithDimension extends BaseProps {
  unit?: never;
  /** Dimension type to look up the user's preferred unit */
  dimension: DimensionKey;
}

type QuantityDisplayProps = WithExplicitUnit | WithDimension;

/**
 * Display a quantity expression converted to a specified or preferred unit.
 * 
 * @example
 * // Explicit unit
 * <QuantityDisplay unit="bar">100 psi</QuantityDisplay>
 * 
 * // User's preferred unit for pressure
 * <QuantityDisplay dimension="pressure">100 psi</QuantityDisplay>
 */
export default function QuantityDisplay({
  children: expression,
  unit: explicitUnit,
  dimension,
  precision = 3,
}: QuantityDisplayProps) {
  // Get preferred unit if dimension is specified
  // We always call the hook to maintain consistent hook order
  const preferredUnit = usePreferredUnit(dimension ?? "pressure");
  
  // Use explicit unit if provided, otherwise use preferred unit from dimension
  const targetUnit = explicitUnit ?? preferredUnit;

  const { status, results } = useDim(
    expression ? [`${expression} as ${targetUnit}`] : []
  );

  if (status === "error") {
    return <span className="text-destructive">{expression}</span>;
  }

  if (status === "success") {
    const result = results[0];
    if (!result) {
      return null;
    }

    if (result.kind !== "quantity") {
      return <span>{formatEvalResult(result)}</span>;
    }

    if (precision !== undefined) {
      return (
        <span>
          {result.value.toFixed(precision)} {result.unit}
        </span>
      );
    }
    return <span>{formatEvalResult(result)}</span>;
  }

  // Loading state - show nothing or the expression
  return null;
}
