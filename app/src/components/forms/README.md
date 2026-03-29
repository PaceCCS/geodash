# Schema-Driven Form Generation

This module provides dynamic form generation based on Effect Schema metadata from the backend API.

## Overview

The system works in three layers:

1. **Backend Schema Extraction** - Effect Schema annotations (dimension, defaultUnit, title, etc.) are extracted via the `/api/schema/properties` endpoint, which now includes `type`, `description`, and `enumValues` fields.

2. **Frontend Schema Hooks** - React Query hooks fetch and cache schema metadata, making it available to form components.

3. **Dynamic Form Rendering** - The `SchemaForm` component renders appropriate field types based on the schema metadata.

## Components

### SchemaForm

The main form component that fetches schema properties and renders fields.

```tsx
import { SchemaForm } from "@/components/forms";

<SchemaForm
  queryPath="branch-1/blocks/0"
  schemaVersion="v1.0-snapshot"
  values={{ phase: "gas", length: "100 km" }}
  onValuesChange={(values) => console.log("Changed:", values)}
  onSubmit={(values) => console.log("Submitted:", values)}
  autoSave={false}
  disabled={false}
/>
```

#### Props

| Prop | Type | Description |
|------|------|-------------|
| `queryPath` | `string` | Path to the block (e.g., `"branch-1/blocks/0"`) |
| `schemaVersion` | `string?` | Schema version override. If omitted, uses `OperationContext` |
| `values` | `Record<string, unknown>?` | Initial/controlled form values |
| `onValuesChange` | `(values) => void` | Callback when any field changes |
| `onSubmit` | `(values) => void` | Callback when form is submitted |
| `autoSave` | `boolean?` | Auto-trigger `onValuesChange` on every change (default: `false`) |
| `disabled` | `boolean?` | Disable all fields |
| `className` | `string?` | CSS class for the form container |

### FieldRenderer

Maps property metadata to the appropriate field component. Used internally by `SchemaForm` but can be used directly for custom layouts.

```tsx
import { FieldRenderer } from "@/components/forms";

<FieldRenderer
  metadata={propertyMetadata}
  field={tanstackFormField}
  disabled={false}
/>
```

### Field Components

Individual field components in `@/components/forms/fields/`:

- **DimensionField** - For properties with `dimension` (e.g., length, pressure). Shows value input + unit selector.
- **EnumField** - For `type === "enum"`. Renders a select dropdown with `enumValues`.
- **NumberField** - For `type === "number"`. Input with min/max validation.
- **BooleanField** - For `type === "boolean"`. Checkbox input.
- **StringField** - Default for `type === "string"`. Text input.

## Hooks

### useSchemaProperties

Fetches schema properties for a query path.

```tsx
import { useSchemaProperties } from "@/hooks/use-schema-properties";

const { data, isLoading, error } = useSchemaProperties("branch-1/blocks/0", {
  schemaVersion: "v1.0-snapshot", // Optional if using OperationContext
});
```

### useBlockForm

Manages form state synchronized with the TanStack React-DB collections. Provides bidirectional sync between form values and the `nodesCollection`.

```tsx
import { useBlockForm } from "@/hooks/use-block-form";

const {
  form,           // { values, reset }
  properties,     // Schema metadata for all fields
  blockData,      // Current block from collection
  isDirty,        // Whether form has unsaved changes
  saveToCollection,
  resetFromCollection,
  isSchemaLoading,
  isCollectionLoading,
} = useBlockForm("branch-1/blocks/0", {
  schemaVersion: "v1.0-snapshot",
  autoSave: true,
  autoSaveDebounce: 300,
});
```

### useBlockValues

Simplified read-only hook for getting block values without form management.

```tsx
import { useBlockValues } from "@/hooks/use-block-form";

const { blockData, isLoading, branchId, blockIndex } = useBlockValues("branch-1/blocks/0");
```

## Context Providers

### OperationProvider

Provides operation context including the schema version. Wrap your component tree when working within a specific operation.

```tsx
import { OperationProvider } from "@/contexts/operation-context";
import { getOperation } from "@/lib/operations/registry";

const operation = getOperation("snapshot");

<OperationProvider operation={operation}>
  {/* Children can use useOperation() or useSchemaProperties() without explicit schemaVersion */}
  <SchemaForm queryPath="branch-1/blocks/0" />
</OperationProvider>
```

The context exposes:
- `operation` - The full operation object
- `schemaVersion` - Convenience accessor for `operation.schemaVersion`

## Usage Examples

### Basic Form in a Dialog

```tsx
import { useState } from "react";
import { SchemaForm } from "@/components/forms";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

function BlockEditDialog({ blockPath, schemaVersion, onClose }) {
  const [values, setValues] = useState({});

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <SchemaForm
          queryPath={blockPath}
          schemaVersion={schemaVersion}
          values={values}
          onValuesChange={setValues}
          onSubmit={(finalValues) => {
            console.log("Save:", finalValues);
            onClose();
          }}
        />
        <Button type="submit" form="schema-form">
          Save
        </Button>
      </DialogContent>
    </Dialog>
  );
}
```

### Form with Collection Sync (Branch Node)

```tsx
import { useBlockForm } from "@/hooks/use-block-form";
import { FieldRenderer, toFieldApiLike } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";

function BlockEditor({ branchId, blockIndex, schemaVersion }) {
  const queryPath = `${branchId}/blocks/${blockIndex}`;

  const {
    form,
    properties,
    isDirty,
    saveToCollection,
    resetFromCollection,
    isSchemaLoading,
  } = useBlockForm(queryPath, { schemaVersion });

  if (isSchemaLoading || !properties) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      {Object.entries(properties).map(([propName, metadata]) => (
        <div key={propName}>
          {/* Manual field rendering - for custom layouts */}
          <label>{metadata.title ?? propName}</label>
          <input
            value={String(form.values[propName] ?? "")}
            onChange={(e) => {
              // Update form values manually
            }}
          />
        </div>
      ))}

      <div className="flex gap-2">
        <Button onClick={saveToCollection} disabled={!isDirty}>
          Save
        </Button>
        <Button variant="outline" onClick={resetFromCollection} disabled={!isDirty}>
          Reset
        </Button>
      </div>
    </div>
  );
}
```

### Inline Form in Flow Node

The branch node uses `useOperationOptional()` to get the schema version from context. The `OperationProvider` should wrap the flow canvas at a higher level (e.g., when an operation dialog is open).

```tsx
// In src/components/flow/nodes/branch.tsx
import { SchemaForm } from "@/components/forms";
import { useOperationOptional } from "@/contexts/operation-context";

function BlockForm({ branchId, blockIndex, block }) {
  const queryPath = `${branchId}/blocks/${blockIndex}`;
  const operationContext = useOperationOptional();

  // Extract current values from the block
  const initialValues = { /* ... */ };

  // If no operation context, show a message
  if (!operationContext) {
    return (
      <div className="text-xs text-muted-foreground">
        No operation selected. Wrap in OperationProvider to enable form editing.
      </div>
    );
  }

  // SchemaForm picks up schemaVersion from context automatically
  return (
    <SchemaForm
      queryPath={queryPath}
      values={initialValues}
      onValuesChange={(values) => console.log("Changed:", values)}
    />
  );
}
```

At a higher level, wrap with `OperationProvider` when an operation is active:

```tsx
// In a parent component or page
import { OperationProvider } from "@/contexts/operation-context";
import { getOperation } from "@/lib/operations/registry";

function OperationView({ operationId }) {
  const operation = getOperation(operationId);

  return (
    <OperationProvider operation={operation}>
      {/* Flow canvas and other components can now access operation context */}
      <FlowCanvas />
    </OperationProvider>
  );
}
```

## Property Type Resolution

The `FieldRenderer` resolves field types in this order:

1. **Has `dimension`** → `DimensionField` (quantity with unit)
2. **`type === "enum"` with `enumValues`** → `EnumField` (select dropdown)
3. **`type === "number"`** → `NumberField`
4. **`type === "boolean"`** → `BooleanField`
5. **Default** → `StringField`

## Backend Schema Annotations

The form fields are driven by Effect Schema annotations on the backend:

```typescript
// backend/src/schemas/v1.0-snapshot/pipe.ts
export const PipeSchema = Schema.Struct({
  phase: Schema.Literal("gas", "dense").pipe(
    Schema.annotations({
      title: "CO2 phase",
      description: "Gas phase or dense (supercritical) phase",
    })
  ),

  length: Schema.Number.pipe(
    Schema.greaterThan(0),
    Schema.annotations({
      dimension: "length",
      defaultUnit: "km",
      title: "Pipeline length",
    })
  ),
});
```

The API extracts:
- `type` - Inferred from AST (`"enum"` for literals, `"number"`, `"boolean"`, `"string"`)
- `enumValues` - Extracted from `Schema.Literal()` arguments
- `description` - From annotations
- `dimension` / `defaultUnit` - For dimensional quantities
- `title` - Human-readable label
- `min` / `max` - From `Schema.greaterThan()`, `Schema.lessThan()`, etc.
