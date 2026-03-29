"use client";

import type {
  PropertyMetadata,
  AggregatedPropertyMetadata,
  ResolvedValue,
} from "@/hooks/use-schema-properties";
import type { BaseFieldProps, FieldApiLike } from "./fields/types";
import {
  StringField,
  NumberField,
  BooleanField,
  EnumField,
  DimensionField,
} from "./fields";
import { FluidCompositionInput } from "./fields/fluid-composition-input";
import { ExclusiveEnabledField } from "./fields/exclusive-enabled-field";
import { UValueInput } from "@/components/u-values/u-value-input";

export type FieldRendererProps = {
  /** Property metadata (can be regular or aggregated) */
  metadata: PropertyMetadata | AggregatedPropertyMetadata;
  /** TanStack Form field API */
  field: FieldApiLike;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Whether to show affected blocks indicator (for aggregated metadata) */
  showAffectedBlocks?: boolean;
  /** Inherited value from outer scope (for block scope forms) */
  inheritedValue?: ResolvedValue;
  /** Callback to clear value and inherit from outer scope */
  onClear?: () => void;
  /**
   * Inner pipe diameter expression (e.g. "150 mm") passed to UValueInput
   * so it can warn when the selected catalogue entry has a different Di.
   * Only used when the field has `dimension === "uValue"`.
   */
  pipeDi?: string;
  /** Optional exclusivity key for boolean enabled fields */
  exclusiveKey?: string;
};

/**
 * FieldRenderer maps PropertyMetadata to the appropriate field component.
 *
 * Resolution order:
 * 1. `dimension === "uValue"` -> UValueInput (catalogue search + direct entry)
 * 2. Has any other `dimension`  -> DimensionField
 * 3. `type === "enum"`          -> EnumField
 * 4. `type === "number"`        -> NumberField
 * 5. `type === "boolean"`       -> BooleanField
 * 6. Default                    -> StringField
 */
export function FieldRenderer({
  metadata,
  field,
  disabled,
  className,
  showAffectedBlocks = false,
  inheritedValue,
  onClear,
  pipeDi,
  exclusiveKey,
}: FieldRendererProps) {
  // Common props for all field components
  const fieldProps: BaseFieldProps & { showAffectedBlocks?: boolean } = {
    metadata: metadata as PropertyMetadata,
    field,
    disabled,
    className,
    showAffectedBlocks,
    inheritedValue,
    onClear,
  };

  // Priority 1: U-Value fields get the catalogue + direct-entry widget
  if (metadata.dimension === "uValue") {
    return <UValueInput {...fieldProps} pipeDi={pipeDi} />;
  }

  if (metadata.type === "object" && metadata.property === "fluidComposition") {
    return <FluidCompositionInput {...fieldProps} />;
  }

  if (
    metadata.property === "enabled" &&
    metadata.type === "boolean" &&
    exclusiveKey
  ) {
    return <ExclusiveEnabledField {...fieldProps} exclusiveKey={exclusiveKey} />;
  }

  // Priority 2: Other dimension fields
  if (metadata.dimension) {
    return <DimensionField {...fieldProps} />;
  }

  // Priority 2: Enum fields (have enumValues)
  if (metadata.type === "enum" && metadata.enumValues?.length) {
    return <EnumField {...fieldProps} />;
  }

  // Priority 3: Type-based field selection
  switch (metadata.type) {
    case "number":
      return <NumberField {...fieldProps} />;

    case "boolean":
      return <BooleanField {...fieldProps} />;

    case "string":
    default:
      return <StringField {...fieldProps} />;
  }
}

/**
 * Utility to get a human-readable field type description.
 */
export function getFieldTypeLabel(metadata: PropertyMetadata): string {
  if (metadata.dimension) {
    return `Dimension (${metadata.dimension})`;
  }
  if (metadata.type === "enum") {
    return "Selection";
  }
  switch (metadata.type) {
    case "number":
      return "Number";
    case "boolean":
      return "Yes/No";
    case "object":
      return "Object";
    case "string":
    default:
      return "Text";
  }
}
