"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "../ui/input";
import { checkUnitCompatibility } from "@/lib/dim/dim";
import { Badge } from "../ui/badge";
import { CheckIcon, XIcon } from "lucide-react";
import { useDim } from "@/lib/dim/use-dim";

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

  // Keep the ref in sync via an effect so we never write to it during render.
  // The expression effect below only depends on expression/inputValue, not
  // on the callback identity — preventing stale input values from being
  // written back to the store when external updates change the callback.
  const handleExpressionRef = useRef(handleExpression);
  useEffect(() => {
    handleExpressionRef.current = handleExpression;
  }, [handleExpression]);

  useEffect(() => {
    if (inputValue === undefined || inputValue === "") {
      return handleExpressionRef.current(undefined);
    }

    handleExpressionRef.current(expression);
  }, [expression, inputValue]);

  const { status, results } = useDim(expression ? [expression] : [], {
    silenceErrors: true,
  });

  return (
    <div className="flex flex-row gap-1 items-center flex-1">
      <Input
        {...props}
        type="text"
        onChange={(e) => setInputValue(e.target.value)}
        autoComplete="off"
      />
      {status === "success" && (
        <Badge variant="default" className="size-6 px-0.5">
          <ResultCheck results={results} unit={unit} />
        </Badge>
      )}
      {status === "error" && (
        <Badge variant="destructive" className="size-6 px-0.5">
          <XIcon />
        </Badge>
      )}
    </div>
  );
}

export function ResultCheck({
  results,
  unit,
}: {
  results: string[];
  unit: string;
  expression?: string | undefined;
  dimension?: string | undefined;
  property?: string | undefined;
}) {
  if (results.length !== 1) {
    return <XIcon />;
  }
  const result = results[0];
  const compatible = checkUnitCompatibility(result, unit);
  if (!compatible) {
    console.log(
      "[QuantityInput] result",
      result,
      "not compatible with unit",
      unit
    );
    return <XIcon />;
  }

  console.log("[QuantityInput] result", result, "compatible", compatible);

  return <CheckIcon />;
}
