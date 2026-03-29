import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { nodesCollection } from "@/lib/collections/flow";
import type { FlowBranchNode } from "@/lib/collections/flow-nodes";
import type { Block } from "@/lib/api-client";
import {
  useSchemaProperties,
  groupPropertiesByBlock,
  type PropertyMetadata,
} from "./use-schema-properties";

export type UseBlockFormOptions = {
  /** Schema version override (otherwise uses OperationContext) */
  schemaVersion?: string;
  /** Whether to auto-save changes to the collection */
  autoSave?: boolean;
  /** Debounce time in ms for auto-save (default: 300) */
  autoSaveDebounce?: number;
};

/**
 * Form state type for block editing.
 * Represents a form managing key-value pairs.
 */
export type BlockFormState = {
  values: Record<string, unknown>;
  reset: (values: Record<string, unknown>) => void;
};

export type UseBlockFormReturn = {
  /** TanStack Form instance - provides form state and methods */
  form: BlockFormState;
  /** Property metadata for all fields */
  properties: Record<string, PropertyMetadata> | null;
  /** Whether schema is loading */
  isSchemaLoading: boolean;
  /** Schema loading error */
  schemaError: Error | null;
  /** Current block data from collection */
  blockData: Block | null;
  /** Whether collection data is loading */
  isCollectionLoading: boolean;
  /** Save current form values to collection */
  saveToCollection: () => Promise<void>;
  /** Reset form to collection values */
  resetFromCollection: () => void;
  /** Whether form has unsaved changes */
  isDirty: boolean;
};

/**
 * Parse a query path to extract branch ID and block index.
 * Format: "branch-1/blocks/0" -> { branchId: "branch-1", blockIndex: 0 }
 */
function parseQueryPath(queryPath: string): {
  branchId: string;
  blockIndex: number;
} | null {
  const match = queryPath.match(/^(.+)\/blocks\/(\d+)$/);
  if (!match) return null;

  return {
    branchId: match[1],
    blockIndex: parseInt(match[2], 10),
  };
}

/**
 * Get block data from the nodes collection.
 */
function getBlockFromCollection(
  branchId: string,
  blockIndex: number
): Block | null {
  const node = nodesCollection.get(branchId) as FlowBranchNode | undefined;
  if (!node || node.type !== "branch") return null;
  return node.data?.blocks?.[blockIndex] ?? null;
}

/**
 * Hook for managing form state synchronized with TanStack React-DB collections.
 *
 * Features:
 * - Initializes form with current block values from collection
 * - Updates collection on form submit/change (if autoSave enabled)
 * - Tracks dirty state for unsaved changes
 */
export function useBlockForm(
  queryPath: string,
  options: UseBlockFormOptions = {}
): UseBlockFormReturn {
  const { schemaVersion, autoSave = false, autoSaveDebounce = 300 } = options;

  // Parse query path
  const parsedPath = useMemo(() => parseQueryPath(queryPath), [queryPath]);

  // Fetch schema properties
  const {
    data: schemaProperties,
    isLoading: isSchemaLoading,
    error: schemaError,
  } = useSchemaProperties(queryPath, { schemaVersion });

  // Get block properties from schema
  const properties = useMemo(() => {
    if (!schemaProperties) return null;
    const grouped = groupPropertiesByBlock(schemaProperties);
    const blockPath = Object.keys(grouped).find(
      (path) => path === queryPath || queryPath.startsWith(path)
    );
    return blockPath ? grouped[blockPath] : null;
  }, [schemaProperties, queryPath]);

  // Track collection loading state
  const [isCollectionLoading, setIsCollectionLoading] = useState(true);
  const [blockData, setBlockData] = useState<Block | null>(null);

  // Track save count to determine dirty state
  const [saveCount, setSaveCount] = useState(0);
  const formResetCountRef = useRef(0);

  // Load initial block data from collection
  useEffect(() => {
    const loadBlockData = async () => {
      setIsCollectionLoading(true);
      await nodesCollection.preload();

      if (parsedPath) {
        const data = getBlockFromCollection(
          parsedPath.branchId,
          parsedPath.blockIndex
        );
        setBlockData(data);
      }
      setIsCollectionLoading(false);
    };

    loadBlockData();
  }, [parsedPath]);

  // Get initial values from block data
  const initialValues = useMemo(() => {
    if (!blockData || !properties) return {};

    const values: Record<string, unknown> = {};
    for (const propName of Object.keys(properties)) {
      if (propName in blockData) {
        values[propName] = (blockData as Record<string, unknown>)[propName];
      }
    }
    return values;
  }, [blockData, properties]);

  // Serialize initial values for comparison
  const initialValuesJson = useMemo(
    () => JSON.stringify(initialValues),
    [initialValues]
  );

  // Initialize form with initial values
  const form = useForm({
    defaultValues: initialValues,
  });

  // Track when initial values change to reset form
  const prevInitialValuesJsonRef = useRef(initialValuesJson);

  // Reset form when initial values change (from collection updates)
  // Use layout effect to run before paint
  useEffect(() => {
    if (
      initialValuesJson !== prevInitialValuesJsonRef.current &&
      Object.keys(initialValues).length > 0
    ) {
      form.reset(initialValues);
      formResetCountRef.current += 1;
      prevInitialValuesJsonRef.current = initialValuesJson;
    }
  }, [initialValuesJson, initialValues, form]);

  // Check if form is dirty by comparing current values to initial values
  // This compares against the serialized initial values (safe during render)
  const isDirty = useMemo(() => {
    const currentValuesJson = JSON.stringify(form.state.values);
    return currentValuesJson !== initialValuesJson;
  }, [form.state.values, initialValuesJson]);

  // Save to collection
  const saveToCollection = useCallback(async () => {
    if (!parsedPath || !blockData) return;

    const { branchId, blockIndex } = parsedPath;
    const formValues = form.state.values;

    // Update the branch node in the collection
    nodesCollection.update(branchId, (draft) => {
      if (draft.type !== "branch") return;
      const blocks = [...(draft.data.blocks ?? [])];
      if (blocks[blockIndex]) {
        // Merge form values into the block
        const updatedBlock = {
          ...blocks[blockIndex],
        };
        for (const [key, value] of Object.entries(formValues)) {
          (updatedBlock as Record<string, unknown>)[key] = value;
        }
        blocks[blockIndex] = updatedBlock;
        draft.data.blocks = blocks;
      }
    });

    // Increment save count and refresh block data
    setSaveCount((c) => c + 1);
    const newBlockData = getBlockFromCollection(branchId, blockIndex);
    setBlockData(newBlockData);
  }, [parsedPath, blockData, form.state.values]);

  // Reset from collection
  const resetFromCollection = useCallback(() => {
    form.reset(initialValues);
    formResetCountRef.current += 1;
  }, [form, initialValues]);

  // Auto-save with debounce
  useEffect(() => {
    if (!autoSave || !isDirty) return;

    const timeout = setTimeout(() => {
      saveToCollection();
    }, autoSaveDebounce);

    return () => clearTimeout(timeout);
  }, [autoSave, isDirty, saveToCollection, autoSaveDebounce, saveCount]);

  // Create a typed form state object
  const formState: BlockFormState = {
    values: form.state.values,
    reset: form.reset,
  };

  return {
    form: formState,
    properties,
    isSchemaLoading,
    schemaError: schemaError ?? null,
    blockData,
    isCollectionLoading,
    saveToCollection,
    resetFromCollection,
    isDirty,
  };
}

/**
 * Simplified hook for just getting block values without form management.
 * Useful for read-only displays.
 */
export function useBlockValues(queryPath: string) {
  const parsedPath = useMemo(() => parseQueryPath(queryPath), [queryPath]);
  const [blockData, setBlockData] = useState<Block | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadBlockData = async () => {
      setIsLoading(true);
      await nodesCollection.preload();

      if (parsedPath) {
        const data = getBlockFromCollection(
          parsedPath.branchId,
          parsedPath.blockIndex
        );
        setBlockData(data);
      }
      setIsLoading(false);
    };

    loadBlockData();
  }, [parsedPath]);

  return {
    blockData,
    isLoading,
    branchId: parsedPath?.branchId ?? null,
    blockIndex: parsedPath?.blockIndex ?? null,
  };
}
