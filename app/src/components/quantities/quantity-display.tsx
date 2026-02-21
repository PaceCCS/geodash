import { useDim } from "@/lib/dim/use-dim";

export default function QuantityDisplay({
  children: expression,
  unit,
  precision = 3,
}: {
  children: string;
  unit: string;
  precision?: number;
}) {
  const { status, results } = useDim(
    expression ? [`${expression} as ${unit}`] : []
  );

  if (status === "error") {
    return <span className="text-destructive">{expression}</span>;
  }

  if (status === "success") {
    if (precision !== undefined) {
      const [value, resultUnit] = results[0].split(" ");
      const roundedValue = Number(value).toFixed(precision);
      return (
        <span>
          {roundedValue} {resultUnit}
        </span>
      );
    }
    return <span>{results[0]}</span>;
  }

  return null;
}
