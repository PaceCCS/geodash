import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ShapefileCell, ShapefileDocument } from "@/lib/api-client";
import { DbfCellEditor } from "./dbf-cell-editor";
import { NumericInput } from "./numeric-input";

export function PointRecordTable({
  document,
  page,
  pageSize,
  onPageChange,
  onDeleteRow,
  onPointChange,
  onCellChange,
}: {
  document: ShapefileDocument;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onDeleteRow: (rowIndex: number) => void;
  onPointChange: (
    rowIndex: number,
    key: "x" | "y" | "z" | "m",
    value: number,
  ) => void;
  onCellChange: (
    rowIndex: number,
    fieldIndex: number,
    value: ShapefileCell,
  ) => void;
}) {
  const totalRows = document.records.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const startIndex = safePage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalRows);
  const visibleRecords = document.records.slice(startIndex, endIndex);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-muted/20 px-4 py-3 md:flex-row md:items-center md:justify-between">
        <p
          data-testid="point-record-range"
          className="text-sm text-muted-foreground"
        >
          Showing {totalRows === 0 ? 0 : startIndex + 1}-{endIndex} of{" "}
          {totalRows} points
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safePage - 1)}
            disabled={safePage === 0}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {safePage + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(safePage + 1)}
            disabled={safePage >= totalPages - 1}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="border-b border-border px-3 py-2 font-medium">
                #
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                X
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Y
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                Z
              </th>
              <th className="border-b border-border px-3 py-2 font-medium">
                M
              </th>
              {document.fields.map((field, fieldIndex) => (
                <th
                  key={`${field.name}-${fieldIndex}`}
                  className="border-b border-border px-3 py-2 font-medium"
                >
                  {field.name}
                </th>
              ))}
              <th className="border-b border-border px-3 py-2 font-medium text-right">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRecords.map((record, visibleIndex) => {
              const rowIndex = startIndex + visibleIndex;
              const geometry = record.geometry;
              if (geometry.type !== "PointZ") {
                return null;
              }

              return (
                <tr
                  key={`${record.number}-${rowIndex}`}
                  className="*:p-px *:align-middle"
                >
                  <td className="text-right pr-2 text-sm text-muted-foreground">
                    {record.number}
                  </td>
                  {(["x", "y", "z", "m"] as const).map((key) => (
                    <td key={key} className=" align-top">
                      <NumericInput
                        value={geometry[key]}
                        onChange={(value) =>
                          onPointChange(rowIndex, key, value)
                        }
                      />
                    </td>
                  ))}
                  {document.fields.map((field, fieldIndex) => (
                    <td
                      key={`${field.name}-${fieldIndex}`}
                      data-testid={`dbf-cell-${rowIndex}-${field.name}`}
                      className=" align-top"
                    >
                      <DbfCellEditor
                        field={field}
                        value={document.rows[rowIndex]?.[fieldIndex] ?? null}
                        onChange={(value) =>
                          onCellChange(rowIndex, fieldIndex, value)
                        }
                      />
                    </td>
                  ))}
                  <td className=" text-center align-top">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeleteRow(rowIndex)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
