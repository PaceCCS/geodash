import type {
  PropertyMetadata,
  AggregatedPropertyMetadata,
  ResolvedValue,
} from "@/hooks/use-schema-properties";

/**
 * Generic field state type for TanStack Form compatibility.
 */
export type FieldState = {
  value: unknown;
  meta: {
    isTouched: boolean;
    errors: (string | undefined)[];
  };
};

/**
 * Generic field API type for TanStack Form compatibility.
 * This interface describes the minimum API surface we need from FieldApi.
 */
export interface FieldApiLike {
  name: string;
  state: FieldState;
  handleChange: (value: unknown) => void;
  handleBlur: () => void;
}

/**
 * Type-safe adapter function to extract the FieldApiLike interface from
 * TanStack Form's FieldApi. This ensures type safety without requiring
 * knowledge of all 23+ generic type parameters.
 *
 * @param field - The TanStack Form field object
 * @returns A normalized FieldApiLike interface
 */
export function toFieldApiLike(field: {
  name: string;
  state: {
    value: unknown;
    meta: {
      isTouched: boolean;
      errors: unknown[];
    };
  };
  handleChange: (value: unknown) => void;
  handleBlur: () => void;
}): FieldApiLike {
  return {
    name: field.name,
    state: {
      value: field.state.value,
      meta: {
        isTouched: field.state.meta.isTouched,
        errors: field.state.meta.errors.map((e) =>
          e === undefined ? undefined : String(e)
        ),
      },
    },
    handleChange: field.handleChange,
    handleBlur: field.handleBlur,
  };
}

/**
 * Common props for all field components.
 */
export type BaseFieldProps = {
  /** Property metadata from schema (can be regular or aggregated) */
  metadata: PropertyMetadata | AggregatedPropertyMetadata;
  /** TanStack Form field API */
  field: FieldApiLike;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Whether to show affected blocks indicator (only applies to aggregated metadata) */
  showAffectedBlocks?: boolean;
  /** Inherited value from outer scope (for block scope forms) */
  inheritedValue?: ResolvedValue;
  /** Callback to clear value and inherit from outer scope */
  onClear?: () => void;
};

/**
 * Props for field components with aggregated metadata (for outer scope forms).
 * Used when editing properties at branch, group, or global scope.
 */
export type AggregatedBaseFieldProps = {
  /** Aggregated property metadata with affected block information */
  metadata: AggregatedPropertyMetadata;
  /** TanStack Form field API */
  field: FieldApiLike;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Optional CSS class name */
  className?: string;
  /** Whether to show the affected blocks indicator */
  showAffectedBlocks?: boolean;
};

/**
 * Field label component props
 */
export type FieldLabelProps = {
  metadata: PropertyMetadata;
  htmlFor?: string;
};
