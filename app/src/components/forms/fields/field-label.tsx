"use client";

import type {
  PropertyMetadata,
  AggregatedPropertyMetadata,
  ResolvedValue,
} from "@/hooks/use-schema-properties";
import { cn } from "@/lib/utils";

type FieldLabelProps = {
  metadata: PropertyMetadata;
  htmlFor?: string;
  className?: string;
};

export function FieldLabel({ metadata, htmlFor, className }: FieldLabelProps) {
  const label = metadata.title ?? metadata.property;
  const isRequired = metadata.required;

  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className
      )}
    >
      {label}
      {isRequired && <span className="text-destructive ml-1">*</span>}
    </label>
  );
}

export function FieldDescription({
  description,
  className,
}: {
  description?: string;
  className?: string;
}) {
  if (!description) return null;

  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {description}
    </p>
  );
}

export function FieldError({
  error,
  className,
}: {
  error?: string;
  className?: string;
}) {
  if (!error) return null;

  return (
    <p className={cn("text-sm text-destructive", className)}>{error}</p>
  );
}

type InheritedIndicatorProps = {
  inheritedValue?: ResolvedValue;
  hasLocalValue: boolean;
  className?: string;
};

/**
 * Shows where a value is inherited from when the field doesn't have a local value.
 * Only displayed when the value is inherited (scope !== "block") and there's no local override.
 */
export function InheritedIndicator({
  inheritedValue,
  hasLocalValue,
  className,
}: InheritedIndicatorProps) {
  // Don't show if there's a local value or no inherited value
  if (hasLocalValue || !inheritedValue?.scope || inheritedValue.scope === "block") {
    return null;
  }

  return (
    <p className={cn("text-xs text-muted-foreground italic", className)}>
      Inherited from {inheritedValue.scope}
    </p>
  );
}

/**
 * Helper to check if metadata is aggregated (has affected block info).
 */
function isAggregatedMetadata(
  metadata: PropertyMetadata | AggregatedPropertyMetadata
): metadata is AggregatedPropertyMetadata {
  return "affectedBlockTypes" in metadata;
}

type AffectedBlocksIndicatorProps = {
  metadata: AggregatedPropertyMetadata;
  className?: string;
};

/**
 * Shows which blocks are affected by a property in outer scope forms.
 * Format: "Affects: Pipe*, Compressor (2 blocks)"
 * The asterisk (*) indicates the property is required in that block type.
 */
export function AffectedBlocksIndicator({
  metadata,
  className,
}: AffectedBlocksIndicatorProps) {
  const { affectedBlockTypes, requiredInBlockTypes, affectedBlockPaths } =
    metadata;

  if (!affectedBlockTypes.length) return null;

  // Build display with asterisks for required types
  const typesDisplay = affectedBlockTypes
    .map((type) => {
      const isRequired = requiredInBlockTypes.includes(type);
      return isRequired ? `${type}*` : type;
    })
    .join(", ");

  const blockCount = affectedBlockPaths.length;
  const blocksLabel = blockCount === 1 ? "block" : "blocks";

  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      Affects: {typesDisplay} ({blockCount} {blocksLabel})
    </p>
  );
}

type FieldLabelWithAffectedProps = {
  metadata: PropertyMetadata | AggregatedPropertyMetadata;
  htmlFor?: string;
  className?: string;
  showAffectedBlocks?: boolean;
};

/**
 * Enhanced field label that optionally shows affected blocks indicator
 * for aggregated metadata.
 */
export function FieldLabelWithAffected({
  metadata,
  htmlFor,
  className,
  showAffectedBlocks = false,
}: FieldLabelWithAffectedProps) {
  const label = metadata.title ?? metadata.property;
  const isRequired = isAggregatedMetadata(metadata)
    ? metadata.universallyRequired
    : metadata.required;

  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className={cn(
          "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
          className
        )}
      >
        {label}
        {isRequired && <span className="text-destructive ml-1">*</span>}
      </label>
      {showAffectedBlocks && isAggregatedMetadata(metadata) && (
        <AffectedBlocksIndicator metadata={metadata} />
      )}
    </div>
  );
}
