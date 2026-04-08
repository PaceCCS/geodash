import { Input } from "@/components/ui/input";
import type { ShapefileCell, ShapefileField } from "@/lib/api-client";

function getLogicalFieldValue(value: ShapefileCell): string {
  if (value === true) {
    return "true";
  }

  if (value === false) {
    return "false";
  }

  return "";
}

export function DbfCellEditor({
  field,
  value,
  onChange,
}: {
  field: ShapefileField;
  value: ShapefileCell;
  onChange: (value: ShapefileCell) => void;
}) {
  if (field.fieldType === "L") {
    return (
      <select
        value={getLogicalFieldValue(value)}
        onChange={(event) => {
          if (event.target.value === "") {
            onChange(null);
            return;
          }
          onChange(event.target.value === "true");
        }}
        className="flex h-9 w-full border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow]"
      >
        <option value="">Null</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (field.fieldType === "N" || field.fieldType === "F") {
    return (
      <Input
        type="number"
        step={field.decimalCount > 0 ? "any" : "1"}
        value={typeof value === "number" ? value : ""}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue === "" ? null : Number(nextValue));
        }}
      />
    );
  }

  return (
    <Input
      value={typeof value === "string" ? value : ""}
      placeholder={field.fieldType === "D" ? "YYYYMMDD" : undefined}
      maxLength={field.fieldType === "D" ? 8 : field.length}
      onChange={(event) =>
        onChange(event.target.value === "" ? null : event.target.value)
      }
    />
  );
}
