"use client";

import {
  useState,
  useCallback,
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
} from "react";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { checkUnitCompatibility } from "@/lib/dim/dim";
import { useDimReady } from "@/lib/dim/use-dim-ready";
import {
  Command,
  CommandItem,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
} from "../ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "../ui/popover";
import { DimensionKey, getDimensionConfig } from "@/lib/stores/unitPreferencesSlice";


interface UnitSelectProps {
  id?: string;
  dimension: DimensionKey;
  value?: string;
  onValueChange?: (value: string) => void;
  onBlur?: () => void;
  onEnter?: () => void;
  showPlaceholder?: boolean;
  showSearchIcon?: boolean;
  className?: string;
}

/**
 * UnitSelect allows the user to select a unit from a list of compatible units.
 *
 * The dimension prop determines:
 * - Which dropdown options to show
 * - The base unit used for compatibility validation
 *
 * Users can also type custom units - any input compatible with the dimension's
 * base unit is accepted. Invalid units show red text with strikethrough and
 * display the base unit as a hint.
 */
export const UnitSelect = forwardRef<HTMLInputElement, UnitSelectProps>(
  function UnitSelect(
    {
      id,
      dimension,
      value = "",
      onValueChange,
      onBlur,
      onEnter,
      showPlaceholder = true,
      showSearchIcon = true,
      className,
    },
    ref
  ) {
    const [open, setOpen] = useState(false);
    const [inputValue, setInputValue] = useState(value);
    const [prevValue, setPrevValue] = useState(value);
    const [popoverWidth, setPopoverWidth] = useState<number>();
    const inputWrapperRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const { baseUnit, options } = getDimensionConfig(dimension);
    const dimReady = useDimReady();

    // Expose the input element via ref
    useImperativeHandle(ref, () => inputRef.current!, []);

    // Sync input value when external value changes (during render, not in effect)
    if (value !== prevValue) {
      setPrevValue(value);
      setInputValue(value);
    }

    // Check if current input is a valid unit for this dimension
    // Treat as compatible while dim is loading to avoid false invalid styling
    const isCompatible = useMemo(() => {
      if (!dimReady) return true;
      const trimmedInput = inputValue.trim();
      if (!trimmedInput) return false; // Empty is invalid
      // Check if the input unit is compatible with the dimension's base unit
      return checkUnitCompatibility(`1 ${trimmedInput}`, baseUnit);
    }, [dimReady, inputValue, baseUnit]);

    // Only show invalid styling when dropdown is closed (user has finished entering)
    const showInvalid = !open && !isCompatible;

    const handleOpen = useCallback(() => {
      if (inputWrapperRef.current) {
        const width = inputWrapperRef.current.offsetWidth;
        setPopoverWidth((prev) => (prev !== width ? width : prev));
      }
      setOpen(true);
    }, []);

    const handleSelect = useCallback(
      (selectedValue: string) => {
        // Find the original case from options (cmdk lowercases the value)
        const originalUnit = options.find(
          (opt) => opt.toLowerCase() === selectedValue.toLowerCase()
        );
        const unitValue = originalUnit ?? selectedValue;

        onValueChange?.(unitValue);
        setOpen(false);
        onBlur?.();
      },
      [options, onValueChange, onBlur]
    );

    const handleBlur = useCallback(
      (e: React.FocusEvent) => {
        // Don't close/commit if clicking inside the popover content
        if (e.relatedTarget?.closest("[data-slot='popover-content']")) {
          return;
        }

        setOpen(false);

        // Commit the current input value (trimmed), but only if valid
        const trimmedInput = inputValue.trim();
        const isValid =
          dimReady &&
          trimmedInput &&
          checkUnitCompatibility(`1 ${trimmedInput}`, baseUnit);

        if (isValid && trimmedInput !== value) {
          onValueChange?.(trimmedInput);
        } else if (!isValid && trimmedInput !== value) {
          // Invalid input - revert to previous value
          setInputValue(value);
        }

        onBlur?.();
      },
      [inputValue, value, onValueChange, onBlur, dimReady, baseUnit]
    );

    const handleInputChange = useCallback((newValue: string) => {
      setInputValue(newValue);
    }, []);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !open) {
          e.preventDefault();
          const trimmedInput = inputValue.trim();
          const isValid =
            dimReady &&
            trimmedInput &&
            checkUnitCompatibility(`1 ${trimmedInput}`, baseUnit);

          if (isValid && trimmedInput !== value) {
            onValueChange?.(trimmedInput);
          } else if (!isValid && trimmedInput !== value) {
            // Invalid input - revert to previous value
            setInputValue(value);
          }
          onEnter?.();
        }
      },
      [open, inputValue, value, onValueChange, onEnter, dimReady, baseUnit]
    );

    return (
      <Command
        className={cn("relative w-full rounded-none", className)}
        shouldFilter={open}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverAnchor asChild>
            <div ref={inputWrapperRef} className="flex items-center gap-1">
              <CommandInput
                id={id}
                ref={inputRef}
                value={inputValue}
                onValueChange={handleInputChange}
                placeholder={showPlaceholder ? "Select unit..." : undefined}
                showSearchIcon={showSearchIcon}
                showBorder={false}
                onFocus={handleOpen}
                onClick={handleOpen}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className={cn(
                  showInvalid && inputValue && "text-destructive line-through",
                  "flex-1"
                )}
              />
              {/* Show base unit hint when invalid */}
              {showInvalid && (
                <span className="text-muted-foreground text-sm shrink-0 pr-2">
                  ({baseUnit})
                </span>
              )}
              {/* Show check when valid and has value */}
              {!open && inputValue && isCompatible && (
                <CheckIcon className="size-4 text-green-600 shrink-0 pr-1" />
              )}
            </div>
          </PopoverAnchor>
          <PopoverContent
            className="p-0 rounded-none"
            align="start"
            sideOffset={0}
            style={{ width: popoverWidth }}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <CommandList>
              <CommandEmpty>No matching unit.</CommandEmpty>
              <CommandGroup>
                {options.map((unit) => (
                  <CommandItem key={unit} value={unit} onSelect={handleSelect}>
                    {unit}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </PopoverContent>
        </Popover>
      </Command>
    );
  }
);
