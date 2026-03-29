"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { FieldLabelWithAffected, FieldError, InheritedIndicator } from "./field-label";
import type { BaseFieldProps } from "./types";
import { cn } from "@/lib/utils";

export function BooleanField({
  metadata,
  field,
  disabled,
  className,
  showAffectedBlocks = false,
  inheritedValue,
  onClear,
}: BaseFieldProps) {
  const fieldId = `field-${metadata.property}`;

  // Determine if value is locally set vs inherited
  // A value is "local" if:
  // 1. User has typed into the form (field.state.value is set), OR
  // 2. The resolved value has scope="block" (stored at block level)
  const hasFormValue = field.state.value !== undefined;
  const hasStoredBlockValue = inheritedValue?.scope === "block" && inheritedValue?.rawValue != null;
  const hasLocalValue = hasFormValue || hasStoredBlockValue;

  // Value is inherited if scope exists and is NOT "block"
  const isInherited = inheritedValue?.scope && inheritedValue.scope !== "block";

  // Show clear button when there's a local value that can be cleared to inherit
  const showClearButton = onClear && hasLocalValue;

  // Display value priority: form value > stored block value > inherited value
  const displayValue = hasFormValue
    ? Boolean(field.state.value)
    : inheritedValue?.rawValue != null
      ? Boolean(inheritedValue.rawValue)
      : false;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center space-x-2">
        <input
          id={fieldId}
          name={field.name}
          type="checkbox"
          checked={displayValue}
          onChange={(e) => field.handleChange(e.target.checked)}
          onBlur={field.handleBlur}
          disabled={disabled}
          className={cn(
            "h-4 w-4 rounded border-input text-primary focus:ring-ring focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
            // Dashed ring for inherited values
            isInherited && !hasLocalValue && "ring-1 ring-dashed ring-muted-foreground/50"
          )}
        />
        <FieldLabelWithAffected
          metadata={metadata}
          htmlFor={fieldId}
          showAffectedBlocks={showAffectedBlocks}
        />
        {showClearButton && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onClear}
            disabled={disabled}
            title="Clear to inherit from outer scope"
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <InheritedIndicator inheritedValue={inheritedValue} hasLocalValue={hasLocalValue} />
      <FieldError
        error={
          field.state.meta.isTouched && field.state.meta.errors.length > 0
            ? field.state.meta.errors.join(", ")
            : undefined
        }
      />
    </div>
  );
}
