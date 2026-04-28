"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../ui/input";
import { checkUnitCompatibility, type DimEvalResult } from "@/lib/dim/dim";
import { Badge } from "../ui/badge";
import { CheckIcon, XIcon } from "lucide-react";
import { useDim } from "@/lib/dim/use-dim";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { getCompatibilityTooltipLines } from "@/lib/quantity-tooltip";

export default function QuantityInput({
  unit,
  handleExpression: handleExpression,
  ...props
}: {
  unit: string;
  handleExpression: (value: string | undefined) => void;
} & React.ComponentProps<typeof Input>) {
  const [inputValue, setInputValue] = useState<string | undefined>(
    typeof props.defaultValue === "string" ? props.defaultValue : undefined
  );

  const getExpression = useCallback(
    (value: string | undefined): string | undefined => {
      if (value === undefined) {
        return undefined;
      }
      if (!isNaN(Number(value))) {
        return `${value} ${unit}`;
      }
      return value;
    },
    [unit]
  );

  const expression = useMemo(
    () => getExpression(inputValue),
    [inputValue, getExpression]
  );

  const { status, results } = useDim(expression ? [expression] : [], {
    silenceErrors: true,
  });
  const lastEmittedValueRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let nextValue: string | undefined;

    if (inputValue === undefined || inputValue === "") {
      nextValue = undefined;
    } else if (status === "idle" || status === "loading") {
      return;
    } else if (status === "error") {
      nextValue = undefined;
    } else {
      const compatible =
        results.length === 1 &&
        !!expression &&
        checkUnitCompatibility(expression, unit);
      nextValue = compatible ? expression : undefined;
    }

    if (lastEmittedValueRef.current === nextValue) {
      return;
    }

    lastEmittedValueRef.current = nextValue;
    handleExpression(nextValue);
  }, [status, results, expression, handleExpression, inputValue, unit]);

  return (
    <div className="flex flex-row gap-1 items-center flex-1">
      <Input
        {...props}
        type="text"
        onChange={(e) => setInputValue(e.target.value)}
        autoComplete="off"
      />
      {status === "success" && (
        <ResultCheck results={results} unit={unit} expression={expression} />
      )}
      {status === "error" && (
        <Tooltip>
          <TooltipTrigger>
            <Badge variant="destructive" className="size-6 px-0.5">
              <XIcon className="size-4" />
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            <p>Not compatible with {unit}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function ResultCheck({
  results,
  unit,
  expression,
  dimension,
  property,
}: {
  results: DimEvalResult[];
  unit: string;
  expression?: string;
  dimension?: string;
  property?: string;
}) {
  if (results.length !== 1) {
    return <XIcon className="size-4" />;
  }
  // Use the original expression for compatibility checking rather than the
  // dim-normalized result, because normalized unit strings do not always parse.
  const compatible = !!expression && checkUnitCompatibility(expression, unit);
  if (!compatible) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <Badge variant="destructive" className="size-6 px-0.5">
            <XIcon className="size-4" />
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p>Not compatible with {unit}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  const tooltipLines = getCompatibilityTooltipLines({
    expression,
    unit,
    dimension,
    property,
  });

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge variant="default" className="size-6 px-0.5">
          <CheckIcon className="size-4" />
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1">
          {tooltipLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
