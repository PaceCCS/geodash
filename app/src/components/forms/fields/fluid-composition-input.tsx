"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  FieldDescription,
  FieldError,
  FieldLabelWithAffected,
  InheritedIndicator,
} from "./field-label";
import type { BaseFieldProps } from "./types";
import { cn } from "@/lib/utils";

type AmountUnit = "%" | "ppm" | "ppb";

type FluidCompositionValue = Record<string, number>;

type CompositionRow = {
  id: string;
  component: string;
  amount: number | undefined;
  unit: AmountUnit;
};

const FLUID_COMPONENTS = [
  {
    key: "nitrogenFraction",
    symbol: "N₂",
    aliases: ["nitrogen", "N2"],
  },
  {
    key: "waterFraction",
    symbol: "H₂O",
    aliases: ["water", "H2O"],
  },
  {
    key: "hydrogenSulfideFraction",
    symbol: "H₂S",
    aliases: ["hydrogen sulfide", "H2S"],
  },
  {
    key: "carbonMonoxideFraction",
    symbol: "CO",
    aliases: ["carbon monoxide"],
  },
  {
    key: "argonFraction",
    symbol: "Ar",
    aliases: ["argon"],
  },
  {
    key: "methaneFraction",
    symbol: "CH₄",
    aliases: ["methane", "CH4"],
  },
  {
    key: "hydrogenFraction",
    symbol: "H₂",
    aliases: ["hydrogen", "H2"],
  },
  {
    key: "oxygenFraction",
    symbol: "O₂",
    aliases: ["oxygen", "O2"],
  },
] as const;

const COMPONENT_KEY_BY_SYMBOL = Object.fromEntries(
  FLUID_COMPONENTS.flatMap((component) => [
    [component.symbol, component.key] as const,
    ...component.aliases
      .filter((alias) => /^[A-Za-z0-9]+$/.test(alias))
      .map((alias) => [alias, component.key] as const),
  ]),
) as Record<string, (typeof FLUID_COMPONENTS)[number]["key"]>;

const FLUID_COMPOSITION_PRESETS = [
  {
    label: "Pure CO2",
    previewLines: ["100% CO₂"],
    rows: [] as Array<Pick<CompositionRow, "component" | "amount" | "unit">>,
  },
  {
    label: "Worst case",
    previewLines: ["96% CO₂", "0.75% H₂", "3.25% N₂"],
    rows: [
      { component: "H₂", amount: 0.75, unit: "%" },
      { component: "N₂", amount: 3.25, unit: "%" },
    ] as Array<Pick<CompositionRow, "component" | "amount" | "unit">>,
  },
] as const;

function createEmptyRow(): CompositionRow {
  return {
    id: crypto.randomUUID(),
    component: "",
    amount: undefined,
    unit: "ppm",
  };
}

function isRowEmpty(row: CompositionRow): boolean {
  return !row.component && row.amount === undefined;
}

function isCompositionValue(value: unknown): value is FluidCompositionValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createRowsFromPreset(
  presetRows: ReadonlyArray<
    Pick<CompositionRow, "component" | "amount" | "unit">
  >,
): CompositionRow[] {
  return [
    ...presetRows.map((row) => ({
      id: crypto.randomUUID(),
      component: row.component,
      amount: row.amount,
      unit: row.unit,
    })),
    createEmptyRow(),
  ];
}

function normaliseComposition(value: unknown): FluidCompositionValue {
  if (!isCompositionValue(value)) return {};

  const entries = Object.entries(value).flatMap(([key, raw]) => {
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      return [];
    }

    return [[key, raw] as const];
  });

  return Object.fromEntries(entries);
}

function toPercentage(value: number, unit: AmountUnit): number {
  switch (unit) {
    case "%":
      return value;
    case "ppm":
      return value / 10000;
    case "ppb":
      return value / 10000000;
  }
}

function percentageToFraction(value: number, unit: AmountUnit): number {
  return toPercentage(value, unit) / 100;
}

function fractionToPercentage(value: number, unit: AmountUnit): number {
  switch (unit) {
    case "%":
      return value * 100;
    case "ppm":
      return value * 1000000;
    case "ppb":
      return value * 1000000000;
  }
}

function getAmountFractionDigits(value: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }

  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  return Math.max(0, Math.min(6, 6 - magnitude - 1));
}

function normaliseAmount(value: number): number {
  return Number(value.toFixed(getAmountFractionDigits(value)));
}

function formatAmount(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: getAmountFractionDigits(value),
    useGrouping: false,
  });
}

function getCanonicalSymbol(value: string): string {
  if (!value) return value;
  const normalized = value.toLowerCase();
  const match = FLUID_COMPONENTS.find(
    (component) =>
      component.symbol.toLowerCase() === normalized ||
      component.aliases.some((alias) => alias.toLowerCase() === normalized),
  );
  return match?.symbol ?? value;
}

function compositionToRows(
  value: FluidCompositionValue,
  preferredUnits: Partial<Record<string, AmountUnit>> = {},
): CompositionRow[] {
  const rows = FLUID_COMPONENTS.flatMap((component) => {
    const fraction = value[component.key];
    if (fraction === undefined || fraction === 0) {
      return [];
    }

    const unit = preferredUnits[component.symbol] ?? "ppm";

    return [
      {
        id: crypto.randomUUID(),
        component: component.symbol,
        amount: fractionToPercentage(fraction, unit),
        unit,
      },
    ];
  });

  return rows.length > 0 ? [...rows, createEmptyRow()] : [createEmptyRow()];
}

function getPreferredUnits(
  rows: CompositionRow[],
): Partial<Record<string, AmountUnit>> {
  return Object.fromEntries(
    rows.flatMap((row) => {
      if (!row.component) {
        return [];
      }

      return [[getCanonicalSymbol(row.component), row.unit] as const];
    }),
  );
}

function rowsToFieldValue(
  rows: CompositionRow[],
): FluidCompositionValue | undefined {
  const impurities = Object.fromEntries(
    rows.flatMap((row) => {
      if (!row.component || row.amount === undefined) {
        return [];
      }
      const componentKey =
        COMPONENT_KEY_BY_SYMBOL[getCanonicalSymbol(row.component)];
      if (!componentKey) {
        return [];
      }
      return [
        [componentKey, percentageToFraction(row.amount, row.unit)] as const,
      ];
    }),
  ) as FluidCompositionValue;

  const impurityTotal = Object.values(impurities).reduce(
    (sum, fraction) => sum + fraction,
    0,
  );
  const carbonDioxideFraction = Math.max(0, 1 - impurityTotal);

  if (Object.keys(impurities).length === 0 && carbonDioxideFraction >= 1) {
    return undefined;
  }

  return {
    carbonDioxideFraction,
    ...impurities,
  };
}

function getCompositionSignature(value: FluidCompositionValue): string {
  return JSON.stringify(
    Object.entries(value)
      .filter(
        ([, fraction]) =>
          typeof fraction === "number" && !Number.isNaN(fraction),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

const ComponentSelect = forwardRef<
  HTMLInputElement,
  {
    value?: string;
    onValueChange?: (value: string) => void;
    onBlur?: () => void;
    onEnter?: () => void;
    showSearchIcon?: boolean;
    className?: string;
  }
>(function ComponentSelect(
  {
    value = "",
    onValueChange,
    onBlur,
    onEnter,
    showSearchIcon = true,
    className,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const [popoverWidth, setPopoverWidth] = useState<number>();
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => inputRef.current!, []);
  const inputValue = open ? draftValue : value;

  const handleOpen = useCallback(() => {
    if (inputWrapperRef.current) {
      const width = inputWrapperRef.current.offsetWidth;
      setPopoverWidth((prev) => (prev !== width ? width : prev));
    }
    setOpen(true);
  }, []);

  const handleSelect = useCallback(
    (selectedValue: string) => {
      const canonicalValue = getCanonicalSymbol(selectedValue);
      setDraftValue(canonicalValue);
      onValueChange?.(canonicalValue);
      setOpen(false);
      onBlur?.();
    },
    [onBlur, onValueChange],
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent) => {
      if (e.relatedTarget?.closest("[data-slot='popover-content']")) {
        return;
      }

      setOpen(false);
      const canonicalValue = getCanonicalSymbol(draftValue);
      if (canonicalValue !== value) {
        setDraftValue(canonicalValue);
        onValueChange?.(canonicalValue);
      }
      onBlur?.();
    },
    [draftValue, onBlur, onValueChange, value],
  );

  const isValid =
    open ||
    !inputValue ||
    FLUID_COMPONENTS.some(
      (component) =>
        component.symbol.toLowerCase() === inputValue.toLowerCase() ||
        component.aliases.some(
          (alias) => alias.toLowerCase() === inputValue.toLowerCase(),
        ),
    );

  return (
    <Command
      className={cn("relative w-full rounded-none", className)}
      shouldFilter={open}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div ref={inputWrapperRef} className="w-full">
            <CommandInput
              ref={inputRef}
              value={inputValue}
              onValueChange={setDraftValue}
              showSearchIcon={showSearchIcon}
              showBorder={false}
              onFocus={() => {
                setDraftValue(value);
                handleOpen();
              }}
              onClick={handleOpen}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !open) {
                  e.preventDefault();
                  const canonicalValue = getCanonicalSymbol(draftValue);
                  if (canonicalValue !== value) {
                    setDraftValue(canonicalValue);
                    onValueChange?.(canonicalValue);
                  }
                  onEnter?.();
                }
              }}
              className={cn(
                "h-10 w-full min-w-0",
                !isValid && "text-destructive line-through",
              )}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="rounded-none p-0"
          align="start"
          sideOffset={0}
          style={{ width: popoverWidth }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
        >
          <CommandList>
            <CommandEmpty>No component found.</CommandEmpty>
            <CommandGroup>
              {FLUID_COMPONENTS.map((component) => (
                <CommandItem
                  key={component.symbol}
                  value={component.symbol}
                  keywords={[...component.aliases]}
                  onSelect={handleSelect}
                >
                  {component.symbol}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
});

const ComponentAmount = forwardRef<
  HTMLInputElement,
  {
    value?: number;
    unit?: AmountUnit;
    onValueChange?: (value: number | undefined) => void;
    onUnitChange?: (unit: AmountUnit) => void;
    onBlur?: () => void;
    onEnter?: () => void;
    readOnly?: boolean;
    placeholder?: string;
    className?: string;
  }
>(function ComponentAmount(
  {
    value,
    unit = "ppm",
    onValueChange,
    onUnitChange,
    onBlur,
    onEnter,
    readOnly = false,
    placeholder = "0",
    className,
  },
  ref,
) {
  const [draftValue, setDraftValue] = useState(() =>
    value !== undefined ? formatAmount(value) : "",
  );
  const [isEditing, setIsEditing] = useState(false);
  const formattedValue = value !== undefined ? formatAmount(value) : "";
  const inputValue = isEditing ? draftValue : formattedValue;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "" || /^-?\d*\.?\d*$/.test(raw)) {
      setDraftValue(raw);
    }
  }, []);

  const handleBlur = useCallback(() => {
    const parsed = parseFloat(draftValue);
    const nextValue = Number.isNaN(parsed)
      ? undefined
      : normaliseAmount(parsed);

    if (nextValue !== value) {
      onValueChange?.(nextValue);
    }

    setDraftValue(nextValue !== undefined ? formatAmount(nextValue) : "");
    setIsEditing(false);
    onBlur?.();
  }, [draftValue, onBlur, onValueChange, value]);

  const cycleUnit = useCallback(() => {
    if (readOnly) return;
    const units: AmountUnit[] = ["%", "ppm", "ppb"];
    const currentIndex = units.indexOf(unit);
    onUnitChange?.(units[(currentIndex + 1) % units.length]);
  }, [onUnitChange, readOnly, unit]);

  return (
    <div
      className={cn(
        "flex h-10 w-full items-center gap-2",
        readOnly && "bg-muted/50",
        className,
      )}
    >
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={inputValue}
        onFocus={() => {
          setDraftValue(value !== undefined ? formatAmount(value) : "");
          setIsEditing(true);
        }}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const parsed = parseFloat(draftValue);
            const nextValue = Number.isNaN(parsed)
              ? undefined
              : normaliseAmount(parsed);
            if (nextValue !== value) {
              onValueChange?.(nextValue);
            }
            setDraftValue(
              nextValue !== undefined ? formatAmount(nextValue) : "",
            );
            setIsEditing(false);
            onEnter?.();
          }
        }}
        readOnly={readOnly}
        placeholder={placeholder}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-right text-sm outline-none",
          "placeholder:text-muted-foreground",
          readOnly && "cursor-default",
        )}
      />
      <button
        type="button"
        onClick={cycleUnit}
        disabled={readOnly}
        className={cn(
          "bg-primary hover:bg-primary/50 h-full p-1 text-primary-foreground min-w-10 shrink-0 text-left text-sm",
          !readOnly && "cursor-pointer hover:text-foreground",
          readOnly && "cursor-default",
        )}
      >
        {unit}
      </button>
    </div>
  );
});

export function FluidCompositionInput({
  metadata,
  field,
  disabled,
  className,
  inheritedValue,
  onClear,
}: BaseFieldProps) {
  const [preferredUnits, setPreferredUnits] = useState<
    Partial<Record<string, AmountUnit>>
  >({});
  const hasFormValue = isCompositionValue(field.state.value);
  const hasStoredBlockValue =
    inheritedValue?.scope === "block" && inheritedValue?.value != null;
  const hasLocalValue = hasFormValue || hasStoredBlockValue;
  const isInherited =
    inheritedValue?.scope !== undefined && inheritedValue.scope !== "block";
  const showClearButton = Boolean(onClear && hasLocalValue);
  const compositionSourceValue = hasFormValue
    ? field.state.value
    : inheritedValue?.value;

  const effectiveValue = useMemo(
    () => normaliseComposition(compositionSourceValue),
    [compositionSourceValue],
  );

  const compositionSignature = useMemo(
    () => getCompositionSignature(effectiveValue),
    [effectiveValue],
  );
  const initialRows = useMemo(
    () => compositionToRows(effectiveValue, preferredUnits),
    [effectiveValue, preferredUnits],
  );
  const editorKey = hasFormValue ? "local-composition" : compositionSignature;

  return (
    <FluidCompositionEditor
      key={editorKey}
      metadata={metadata}
      field={field}
      disabled={disabled}
      className={className}
      inheritedValue={inheritedValue}
      onClear={onClear}
      hasLocalValue={hasLocalValue}
      isInherited={isInherited}
      showClearButton={showClearButton}
      initialRows={initialRows}
      onRowsChange={(rows) => setPreferredUnits(getPreferredUnits(rows))}
    />
  );
}

function FluidCompositionEditor({
  metadata,
  field,
  disabled,
  className,
  inheritedValue,
  onClear,
  hasLocalValue,
  isInherited,
  showClearButton,
  initialRows,
  onRowsChange,
}: BaseFieldProps & {
  hasLocalValue: boolean;
  isInherited: boolean | undefined;
  showClearButton: boolean;
  initialRows: CompositionRow[];
  onRowsChange?: (rows: CompositionRow[]) => void;
}) {
  const componentRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const amountRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const [rows, setRows] = useState<CompositionRow[]>(initialRows);
  const rowsRef = useRef(rows);

  const impurityTotal = useMemo(() => {
    return rows.reduce((sum, row) => {
      if (row.amount === undefined || !row.component) return sum;
      return sum + toPercentage(row.amount, row.unit);
    }, 0);
  }, [rows]);
  const co2Percentage = Math.max(0, 100 - impurityTotal);

  const findRowByComponent = useCallback(
    (component: string): { row: CompositionRow; index: number } | null => {
      const canonical = getCanonicalSymbol(component);
      const index = rows.findIndex(
        (row) =>
          getCanonicalSymbol(row.component) === canonical && row.component,
      );
      if (index === -1) return null;
      return { row: rows[index], index };
    },
    [rows],
  );

  const focusComponent = useCallback((rowId: string) => {
    setTimeout(() => componentRefs.current.get(rowId)?.focus(), 0);
  }, []);

  const focusAmount = useCallback((rowId: string) => {
    setTimeout(() => amountRefs.current.get(rowId)?.focus(), 0);
  }, []);

  const updateRows = useCallback(
    (updater: (previous: CompositionRow[]) => CompositionRow[]) => {
      const nextRows = updater(rowsRef.current);
      const nextValue = rowsToFieldValue(nextRows);
      rowsRef.current = nextRows;
      setRows(nextRows);
      onRowsChange?.(nextRows);
      field.handleChange(nextValue);
    },
    [field, onRowsChange],
  );

  const handleComponentChange = useCallback(
    (currentRowId: string, newValue: string) => {
      if (!newValue) {
        updateRows((previous) =>
          previous.map((row) =>
            row.id === currentRowId ? { ...row, component: "" } : row,
          ),
        );
        return;
      }

      const canonical = getCanonicalSymbol(newValue);
      const existing = findRowByComponent(canonical);

      if (existing && existing.row.id !== currentRowId) {
        const currentRow = rows.find((row) => row.id === currentRowId);
        if (currentRow && currentRow.amount === undefined) {
          flushSync(() => {
            updateRows((previous) =>
              previous.map((row) =>
                row.id === currentRowId ? { ...row, component: "" } : row,
              ),
            );
          });
          focusComponent(existing.row.id);
          return;
        }
      }

      updateRows((previous) => {
        const nextRows = previous.map((row) =>
          row.id === currentRowId ? { ...row, component: canonical } : row,
        );
        return nextRows.some(isRowEmpty)
          ? nextRows
          : [...nextRows, createEmptyRow()];
      });
    },
    [findRowByComponent, focusComponent, rows, updateRows],
  );

  const handleRowBlur = useCallback(() => {
    updateRows((previous) => {
      let lastNonEmptyIndex = -1;
      for (let index = previous.length - 1; index >= 0; index -= 1) {
        if (!isRowEmpty(previous[index])) {
          lastNonEmptyIndex = index;
          break;
        }
      }

      const rowsToKeep = previous.slice(0, lastNonEmptyIndex + 1);
      const emptyRowsAfter = previous
        .slice(lastNonEmptyIndex + 1)
        .filter(isRowEmpty);

      if (emptyRowsAfter.length === 0) {
        rowsToKeep.push(createEmptyRow());
      } else {
        rowsToKeep.push(emptyRowsAfter[0]);
      }

      return rowsToKeep;
    });
    field.handleBlur();
  }, [field, updateRows]);

  const handleAmountEnter = useCallback(
    (rowId: string) => {
      const currentIndex = rows.findIndex((row) => row.id === rowId);
      if (currentIndex === -1) return;
      if (currentIndex < rows.length - 1) {
        focusComponent(rows[currentIndex + 1].id);
        return;
      }

      const newRow = createEmptyRow();
      updateRows((previous) => [...previous, newRow]);
      focusComponent(newRow.id);
    },
    [focusComponent, rows, updateRows],
  );

  const errorMessage =
    field.state.meta.isTouched && field.state.meta.errors.length > 0
      ? field.state.meta.errors.filter(Boolean).join(", ")
      : undefined;

  const applyPreset = useCallback(
    (
      presetRows: ReadonlyArray<
        Pick<CompositionRow, "component" | "amount" | "unit">
      >,
    ) => {
      const nextRows = createRowsFromPreset(presetRows);
      rowsRef.current = nextRows;
      setRows(nextRows);
      onRowsChange?.(nextRows);
      field.handleChange(rowsToFieldValue(nextRows));
      field.handleBlur();
    },
    [field, onRowsChange],
  );

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-start justify-between gap-3">
        <FieldLabelWithAffected
          metadata={metadata}
          showAffectedBlocks={false}
        />
        {showClearButton && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const nextRows = [createEmptyRow()];
              rowsRef.current = nextRows;
              setRows(nextRows);
              onRowsChange?.(nextRows);
              onClear?.();
            }}
            disabled={disabled}
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {FLUID_COMPOSITION_PRESETS.map((preset) => (
          <Tooltip key={preset.label}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => applyPreset(preset.rows)}
                disabled={disabled}
              >
                {preset.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64">
              <div className="flex flex-col gap-1">
                {preset.previewLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div
        className={cn(
          "w-full overflow-hidden rounded-md border",
          isInherited &&
            !hasLocalValue &&
            "border-dashed border-muted-foreground/50",
        )}
      >
        <div className="grid grid-cols-2 border-b text-xs font-medium text-muted-foreground">
          <div className="px-3 py-2">Component</div>
          <div className="px-3 py-2 text-right">Amount</div>
        </div>

        <div className="grid grid-cols-2 bg-muted/30">
          <div className="flex h-10 items-center px-3 text-sm font-medium">
            CO₂
          </div>
          <div className="flex h-10 items-center justify-end px-3 text-sm">
            {co2Percentage.toFixed(2)}%
          </div>
        </div>

        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-2 border-t">
            <div className="min-w-0 w-full">
              <ComponentSelect
                value={row.component}
                onValueChange={(value) => handleComponentChange(row.id, value)}
                onBlur={handleRowBlur}
                onEnter={() => focusAmount(row.id)}
                className={cn(
                  "w-full",
                  disabled && "pointer-events-none opacity-50",
                )}
                ref={(node) => {
                  if (node) {
                    componentRefs.current.set(row.id, node);
                  } else {
                    componentRefs.current.delete(row.id);
                  }
                }}
              />
            </div>

            <div className="min-w-0 border-l">
              <ComponentAmount
                value={row.amount}
                unit={row.unit}
                onValueChange={(amount) =>
                  updateRows((previous) =>
                    previous.map((entry) =>
                      entry.id === row.id ? { ...entry, amount } : entry,
                    ),
                  )
                }
                onUnitChange={(unit) =>
                  updateRows((previous) =>
                    previous.map((entry) =>
                      entry.id === row.id
                        ? {
                            ...entry,
                            amount:
                              entry.amount !== undefined
                                ? normaliseAmount(
                                    fractionToPercentage(
                                      percentageToFraction(
                                        entry.amount,
                                        entry.unit,
                                      ),
                                      unit,
                                    ),
                                  )
                                : undefined,
                            unit,
                          }
                        : entry,
                    ),
                  )
                }
                onBlur={handleRowBlur}
                onEnter={() => handleAmountEnter(row.id)}
                className={
                  disabled ? "pointer-events-none opacity-50" : undefined
                }
                ref={(node) => {
                  if (node) {
                    amountRefs.current.set(row.id, node);
                  } else {
                    amountRefs.current.delete(row.id);
                  }
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <InheritedIndicator
        inheritedValue={inheritedValue}
        hasLocalValue={hasLocalValue}
      />
      <FieldDescription description={metadata.description} />
      <FieldError error={errorMessage} />
    </div>
  );
}
