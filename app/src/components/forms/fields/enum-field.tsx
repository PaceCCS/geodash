"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { FieldLabelWithAffected, FieldDescription, FieldError, InheritedIndicator } from "./field-label";
import type { BaseFieldProps } from "./types";
import { cn } from "@/lib/utils";

export function EnumField({
  metadata,
  field,
  disabled,
  className,
  showAffectedBlocks = false,
  inheritedValue,
  onClear,
}: BaseFieldProps) {
  const fieldId = `field-${metadata.property}`;
  const enumValues = metadata.enumValues ?? [];

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
    ? field.state.value?.toString()
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
        <Select
          name={field.name}
          value={displayValue}
          onValueChange={(value) => {
            // Try to preserve the original type
            const originalValue = enumValues.find(
              (v) => v.toString() === value
            );
            field.handleChange(originalValue ?? value);
          }}
          disabled={disabled}
        >
          <SelectTrigger
            id={fieldId}
            className={cn(
              "w-full",
              // Dashed border for inherited values, solid for local
              isInherited && !hasLocalValue && "border-dashed border-muted-foreground/50"
            )}
          >
            <SelectValue placeholder={`Select ${metadata.title ?? metadata.property}`} />
          </SelectTrigger>
          <SelectContent>
            {enumValues.map((value) => (
              <SelectItem key={String(value)} value={String(value)}>
                {formatEnumValue(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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

/**
 * Format enum value for display.
 * Converts snake_case or camelCase to Title Case.
 */
function formatEnumValue(value: string | number | boolean): string {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (typeof value === "number") {
    return value.toString();
  }
  // Convert snake_case or camelCase to Title Case
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
