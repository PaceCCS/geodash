import { useMemo } from "react";

type PropertyRow = {
  path: string;
  value: string;
};

function formatPropertyValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }

  if (value === null) {
    return "null";
  }

  return String(value);
}

function flattenProperties(
  value: unknown,
  prefix = "",
): PropertyRow[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return prefix ? [{ path: prefix, value: "[]" }] : [];
    }

    return value.flatMap((item, index) =>
      flattenProperties(item, `${prefix}[${index}]`),
    );
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([key, nestedValue]) => !key.startsWith("$") && nestedValue !== undefined,
    );
    if (entries.length === 0) {
      return prefix ? [{ path: prefix, value: "{}" }] : [];
    }

    return entries.flatMap(([key, nestedValue]) =>
      flattenProperties(nestedValue, prefix ? `${prefix}.${key}` : key),
    );
  }

  if (!prefix) {
    return [];
  }

  return [
    {
      path: prefix,
      value: formatPropertyValue(value),
    },
  ];
}

export function PropertyList({
  value,
}: {
  value: unknown;
}) {
  const rows = useMemo(() => flattenProperties(value), [value]);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        No properties to show.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <div
          key={row.path}
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2 border-b border-border/60 text-xs"
        >
          <span className="font-mono text-muted-foreground break-all">
            {row.path}
          </span>
          <span className="font-mono text-right break-all">{row.value}</span>
        </div>
      ))}
    </div>
  );
}
