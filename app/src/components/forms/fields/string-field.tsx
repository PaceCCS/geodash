"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { FieldLabelWithAffected, FieldDescription, FieldError, InheritedIndicator } from "./field-label";
import type { BaseFieldProps } from "./types";
import { cn } from "@/lib/utils";

export function StringField({
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
  const hasFormValue = field.state.value !== undefined && field.state.value !== "";
  const hasStoredBlockValue = inheritedValue?.scope === "block" && inheritedValue?.value != null;
  const hasLocalValue = hasFormValue || hasStoredBlockValue;

  // Value is inherited if scope exists and is NOT "block"
  const isInherited = inheritedValue?.scope && inheritedValue.scope !== "block";

  // Show clear button when there's a local value that can be cleared to inherit
  const showClearButton = onClear && hasLocalValue;

  // Display value priority: form value > stored block value > inherited value
  const displayValue = hasFormValue
    ? (field.state.value as string)
    : inheritedValue?.value != null
      ? String(inheritedValue.value)
      : "";

  return (
    <div className={cn("space-y-2", className)}>
      <FieldLabelWithAffected
        metadata={metadata}
        htmlFor={fieldId}
        showAffectedBlocks={showAffectedBlocks}
      />
      <div className="flex gap-2">
        <Input
          id={fieldId}
          name={field.name}
          value={displayValue}
          onChange={(e) => field.handleChange(e.target.value)}
          onBlur={field.handleBlur}
          disabled={disabled}
          placeholder={metadata.description}
          className={cn(
            // Dashed border for inherited values, solid for local
            isInherited && !hasLocalValue && "border-dashed border-muted-foreground/50"
          )}
        />
        {showClearButton && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            disabled={disabled}
            title="Clear to inherit from outer scope"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <InheritedIndicator inheritedValue={inheritedValue} hasLocalValue={hasLocalValue} />
      <FieldDescription description={metadata.description} />
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
