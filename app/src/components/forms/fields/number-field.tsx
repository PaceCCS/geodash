"use client";

import { useState, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { X } from "lucide-react";
import {
  FieldLabelWithAffected,
  FieldDescription,
  FieldError,
  InheritedIndicator,
} from "./field-label";
import type { BaseFieldProps } from "./types";
import { cn } from "@/lib/utils";

export function NumberField({
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
  const hasFormValue =
    field.state.value !== undefined && field.state.value !== "";
  const hasStoredBlockValue =
    inheritedValue?.scope === "block" && inheritedValue?.value != null;
  const hasLocalValue = hasFormValue || hasStoredBlockValue;

  // Value is inherited if scope exists and is NOT "block"
  const isInherited = inheritedValue?.scope && inheritedValue.scope !== "block";

  // Show clear button when there's a local value that can be cleared to inherit
  const showClearButton = onClear && hasLocalValue;

  // Display value priority: form value > stored block value > inherited value
  const displayValue = hasFormValue
    ? String(field.state.value)
    : inheritedValue?.value != null
      ? String(inheritedValue.value)
      : "";

  const [rawValue, setRawValue] = useState(displayValue);
  const [prevDisplayValue, setPrevDisplayValue] = useState(displayValue);
  // Skip the next external sync after our own onBlur commits a value
  const [skipNextSync, setSkipNextSync] = useState(false);
  const hasSuffix = Boolean(metadata.suffix);

  // Sync rawValue when displayValue changes externally (e.g. clear button, inherited update).
  // Using setState during render is the React-recommended pattern for derived state:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  if (prevDisplayValue !== displayValue) {
    setPrevDisplayValue(displayValue);
    if (skipNextSync) {
      setSkipNextSync(false);
    } else {
      setRawValue(displayValue);
    }
  }

  const inputProps = {
    id: fieldId,
    name: field.name,
    type: "text" as const,
    inputMode: "decimal" as const,
    value: rawValue,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setRawValue(e.target.value),
    onBlur: () => {
      const parsed = Number(rawValue);
      const isValid = rawValue !== "" && !isNaN(parsed);
      setSkipNextSync(true);
      setRawValue(isValid ? String(parsed) : "");
      field.handleChange(isValid ? parsed : undefined);
      field.handleBlur();
    },
    disabled,
    placeholder: metadata.description,
    className: cn(
      isInherited && !hasLocalValue && "border-dashed border-muted-foreground/50",
    ),
  };

  return (
    <div className={cn("space-y-2", className)}>
      <FieldLabelWithAffected
        metadata={metadata}
        htmlFor={fieldId}
        showAffectedBlocks={showAffectedBlocks}
      />
      <div className="flex gap-2">
        {hasSuffix ? (
          <InputGroup className="flex-1">
            <InputGroupInput {...inputProps} />
            <InputGroupAddon align="end">
              <InputGroupText>{metadata.suffix}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        ) : (
          <Input {...inputProps} />
        )}
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
      <InheritedIndicator
        inheritedValue={inheritedValue}
        hasLocalValue={hasLocalValue}
      />
      <div className="flex flex-col">
        {(metadata.min !== undefined || metadata.max !== undefined) && (
          <span className="text-xs text-muted-foreground">
            {metadata.min !== undefined && `Min: ${metadata.min}`}
            {metadata.min !== undefined && metadata.max !== undefined && " | "}
            {metadata.max !== undefined && `Max: ${metadata.max}`}
          </span>
        )}
        <FieldDescription description={metadata.description} />
      </div>
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
