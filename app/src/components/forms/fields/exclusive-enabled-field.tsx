"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import {
  FieldLabelWithAffected,
  FieldDescription,
  FieldError,
  InheritedIndicator,
} from "./field-label";
import type { BaseFieldProps } from "./types";
import { cn } from "@/lib/utils";

export function ExclusiveEnabledField({
  metadata,
  field,
  disabled,
  className,
  showAffectedBlocks = false,
  inheritedValue,
  onClear,
  exclusiveKey,
}: BaseFieldProps & { exclusiveKey?: string }) {
  const fieldId = `field-${metadata.property}`;

  const hasFormValue = field.state.value !== undefined;
  const hasStoredBlockValue =
    inheritedValue?.scope === "block" && inheritedValue?.rawValue != null;
  const hasLocalValue = hasFormValue || hasStoredBlockValue;
  const isInherited = inheritedValue?.scope && inheritedValue.scope !== "block";
  const showClearButton = onClear && hasLocalValue;

  const displayValueSource = hasFormValue
    ? field.state.value
    : inheritedValue?.rawValue;
  const displayValue = Boolean(displayValueSource);

  const description =
    metadata.description ??
    (exclusiveKey
      ? `Disables other exclusive ${exclusiveKey} blocks.`
      : undefined);

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
            isInherited &&
              !hasLocalValue &&
              "ring-1 ring-dashed ring-muted-foreground/50",
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
      <InheritedIndicator
        inheritedValue={inheritedValue}
        hasLocalValue={hasLocalValue}
      />
      <FieldDescription description={description} />
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
