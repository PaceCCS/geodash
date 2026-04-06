"use client";

import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  FieldLabelWithAffected,
  FieldDescription,
  FieldError,
  InheritedIndicator,
} from "./field-label";
import type { BaseFieldProps } from "./types";
import { cn } from "@/lib/utils";
import { useDim } from "@/lib/dim/use-dim";
import { Badge } from "@/components/ui/badge";
import { XIcon, X } from "lucide-react";
import { ResultCheck } from "@/components/quantities/quantity-input";
import { convertExpr } from "@/lib/dim/dim";
import { usePreferredUnit } from "@/hooks/use-property-display";
import { resolveDimensionKey } from "@/lib/stores/unitPreferencesSlice";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * DimensionField handles dimensional quantities (values with units).
 *
 * Works like QuantityInput:
 * - User types a number -> we append the default unit for storage/validation
 * - User types "100 bar" -> we use that directly
 * - User types an expression "20*MW" -> we use that directly
 *
 * The stored value is always the full expression (e.g., "100 km").
 */
export function DimensionField({
  metadata,
  field,
  disabled,
  className,
  showAffectedBlocks = false,
  inheritedValue,
  onClear,
}: BaseFieldProps) {
  const fieldId = `field-${metadata.property}`;
  const defaultUnit = metadata.defaultUnit ?? "";
  const resolvedDimension = resolveDimensionKey(metadata.dimension);
  const preferredUnit = usePreferredUnit(
    (resolvedDimension ?? "dimensionless") as Parameters<
      typeof usePreferredUnit
    >[0],
  );
  const inputUnit = resolvedDimension ? preferredUnit : defaultUnit;

  // Determine if value is locally set vs inherited
  // A value is "local" if:
  // 1. User has typed into the form (field.state.value is set), OR
  // 2. The resolved value has scope="block" (stored at block level)
  const hasFormValue =
    field.state.value !== undefined && field.state.value !== "";
  const hasStoredBlockValue =
    inheritedValue?.scope === "block" && inheritedValue?.value != null;
  const hasLocalValue = hasFormValue || hasStoredBlockValue;

  // Value is inherited if scope exists and is NOT "block"
  const isInherited = inheritedValue?.scope && inheritedValue.scope !== "block";

  // Show clear button when there's a local value that can be cleared to inherit
  const showClearButton = onClear && hasLocalValue;

  // Helper to convert stored value to display value
  const getDisplayValue = (value: unknown): string => {
    if (value === undefined || value === null || value === "") {
      return "";
    }
    const strValue = String(value).trim();
    let rawNumber: number | null = null;
    if (typeof value === "number") {
      rawNumber = value;
    } else if (/^-?\d*\.?\d+(?:[eE][+-]?\d+)?$/.test(strValue)) {
      rawNumber = Number(strValue);
    }

    // Raw numeric values from the network are interpreted in the schema's
    // base/default unit, then displayed in the user's preferred unit.
    if (rawNumber !== null && defaultUnit && inputUnit) {
      try {
        const converted = convertExpr(`${rawNumber} ${defaultUnit}`, inputUnit);
        if (converted.unit === inputUnit) {
          return `${converted.value}`;
        }
      } catch {
        // Fall back to the raw string below.
      }
    }

    // If it's exactly "number unit", show just the numeric portion when the
    // stored unit matches the input unit.
    const match = strValue.match(/^(-?\d*\.?\d+(?:[eE][+-]?\d+)?)\s+(.+)$/);
    if (match && match[2] === inputUnit) {
      return match[1];
    }
    return strValue;
  };

  // Get the value to display: form value > stored block value > inherited value
  const effectiveValue = (
    hasFormValue ? field.state.value : inheritedValue?.value
  ) ?? "";

  // Track whether user has started typing (to avoid overwriting with inherited value)
  const [hasUserTyped, setHasUserTyped] = useState(false);

  // Local state for what the user is typing
  // Initialize from effective value, but only update from inherited if user hasn't typed
  const [inputValue, setInputValue] = useState(() =>
    getDisplayValue(effectiveValue),
  );

  // Sync with inherited value only if user hasn't typed yet
  const displayedValue = hasUserTyped
    ? inputValue
    : getDisplayValue(effectiveValue);

  // Build expression for validation: if just a number, append default unit
  const getExpression = useCallback(
    (value: string): string | undefined => {
      if (!value.trim()) return undefined;

      // If it's just a number, interpret it in the input/display unit.
      if (!isNaN(Number(value.trim())) && inputUnit) {
        return `${value.trim()} ${inputUnit}`;
      }

      // Otherwise use as-is (could be "100 bar" or "20*MW")
      return value.trim();
    },
    [inputUnit],
  );

  const expression = getExpression(displayedValue);

  // Validate using useDim hook
  const { status, results } = useDim(expression ? [expression] : [], {
    silenceErrors: true,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setHasUserTyped(true);
    setInputValue(newValue);

    // Update form value with the full expression
    const expr = getExpression(newValue);
    field.handleChange(expr);
  };

  const handleBlur = () => {
    const trimmedValue = displayedValue.trim();

    if (!trimmedValue) {
      field.handleChange(undefined);
      field.handleBlur();
      return;
    }

    field.handleChange(status === "success" ? expression : undefined);
    field.handleBlur();
  };

  const handleClear = () => {
    setHasUserTyped(false);
    setInputValue("");
    if (onClear) onClear();
  };

  // Get error message
  const errorMessage =
    field.state.meta.isTouched && field.state.meta.errors.length > 0
      ? field.state.meta.errors.filter(Boolean).join(", ")
      : undefined;

  return (
    <div className={cn("space-y-2", className)}>
      <FieldLabelWithAffected
        metadata={metadata}
        htmlFor={fieldId}
        showAffectedBlocks={showAffectedBlocks}
      />
      <div className="flex flex-row gap-1 items-center">
        <Input
          id={fieldId}
          type="text"
          value={displayedValue}
          onChange={handleChange}
          onBlur={handleBlur}
          disabled={disabled}
          placeholder={
            inputUnit ? `e.g., 100 or 100 ${inputUnit}` : "Enter value"
          }
          autoComplete="off"
          className={cn(
            "flex-1",
            // Dashed border for inherited values, solid for local
            isInherited &&
              !hasLocalValue &&
              "border-dashed border-muted-foreground/50",
          )}
        />
        {displayedValue && status === "success" && (
          <ResultCheck
            results={results}
            unit={inputUnit}
            expression={expression}
            dimension={metadata.dimension}
            property={metadata.property}
          />
        )}
        {displayedValue && status === "error" && (
          <Tooltip>
            <TooltipTrigger>
              <Badge variant="destructive" className="size-6 px-0.5">
                <XIcon className="size-4" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Not a valid unit</p>
            </TooltipContent>
          </Tooltip>
        )}
        {showClearButton && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={disabled}
            title="Clear to inherit from outer scope"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <InheritedIndicator
        inheritedValue={inheritedValue}
        hasLocalValue={hasLocalValue}
      />
      {defaultUnit && (
        <p className="text-xs text-muted-foreground">
          Default unit:{" "}
          {resolvedDimension === "pressure" && inputUnit === "bar"
            ? "bara"
            : inputUnit}
        </p>
      )}
      <FieldDescription description={metadata.description} />
      <FieldError error={errorMessage} />
    </div>
  );
}
