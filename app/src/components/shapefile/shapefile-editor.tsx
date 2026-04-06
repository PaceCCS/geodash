import { useRef, useState } from "react";
import { Plus, Shapes, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ShapefileDocument,
  ShapefileField,
  ShapefileSummary,
} from "@/lib/api-client";
import {
  clampByte,
  createEmptyRow,
  createFieldDraft,
  createPointRecord,
  createPolyLineRecord,
  ensureCellCount,
  ensureRowCount,
  getDefaultFieldConfig,
  renumberRecords,
} from "@/lib/shapefile-utils";
import { DbfCellEditor } from "./dbf-cell-editor";
import { NumericInput } from "./numeric-input";
import { PointRecordTable } from "./point-record-table";
import { SectionCard } from "./section-card";

const POINT_RECORDS_PER_PAGE = 250;

export function ShapefileEditor({
  document: draftDocument,
  summary,
  onUpdate,
}: {
  document: ShapefileDocument;
  summary: ShapefileSummary | null;
  onUpdate: (updater: (draft: ShapefileDocument) => void) => void;
}) {
  const [pointPage, setPointPage] = useState(0);
  const prevStemRef = useRef(draftDocument.stemPath);

  let nextPointPage = pointPage;

  // Reset page when switching to a different shapefile.
  if (prevStemRef.current !== draftDocument.stemPath) {
    prevStemRef.current = draftDocument.stemPath;
    nextPointPage = 0;
  }

  // Clamp page to valid range during render.
  const maxPage =
    draftDocument.geometryType === "PointZ"
      ? Math.max(
          0,
          Math.ceil(draftDocument.records.length / POINT_RECORDS_PER_PAGE) - 1,
        )
      : 0;
  nextPointPage = Math.min(nextPointPage, maxPage);
  if (nextPointPage !== pointPage) {
    setPointPage(nextPointPage);
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                data-testid="shapefile-document-title"
                className="text-xl font-semibold"
              >
                {draftDocument.name}
              </h2>
              {draftDocument.geometryType ? (
                <Badge variant="outline">{draftDocument.geometryType}</Badge>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Edit geometry, DBF fields, and the optional PRJ text. Saves
              rebuild the full shapefile set from the current draft.
            </p>
          </div>

          <div className="grid gap-2 text-sm text-muted-foreground md:text-right">
            <span>{draftDocument.records.length} records</span>
            <span>{draftDocument.fields.length} DBF fields</span>
            <span>
              {summary?.hasPrj || draftDocument.prj ? "PRJ present" : "No PRJ"}
            </span>
          </div>
        </div>
      </section>

      <AttributesSection document={draftDocument} onUpdate={onUpdate} />

      {draftDocument.geometryType === "PointZ" ? (
        <SectionCard
          title="Points"
          description="Edit PointZ geometry and matching DBF row values."
          action={(
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onUpdate((draft) => {
                  draft.records.push(createPointRecord(draft.records.length + 1));
                  draft.rows = ensureRowCount(draft.rows, draft.records.length - 1);
                  draft.rows.push(createEmptyRow(draft.fields.length));
                });
              }}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Point
            </Button>
          )}
        >
          <PointRecordTable
            document={draftDocument}
            page={nextPointPage}
            pageSize={POINT_RECORDS_PER_PAGE}
            onPageChange={setPointPage}
            onDeleteRow={(rowIndex) => {
              onUpdate((draft) => {
                draft.records.splice(rowIndex, 1);
                draft.rows.splice(rowIndex, 1);
                renumberRecords(draft.records);
              });
            }}
            onPointChange={(rowIndex, key, value) => {
              onUpdate((draft) => {
                const record = draft.records[rowIndex];
                if (record.geometry.type !== "PointZ") {
                  return;
                }
                draft.records[rowIndex] = {
                  ...record,
                  geometry: { ...record.geometry, [key]: value },
                };
              });
            }}
            onCellChange={(rowIndex, fieldIndex, value) => {
              onUpdate((draft) => {
                draft.rows = ensureRowCount(draft.rows, draft.records.length);
                const row = [...ensureCellCount(draft.rows[rowIndex], draft.fields.length)];
                row[fieldIndex] = value;
                draft.rows[rowIndex] = row;
              });
            }}
          />
        </SectionCard>
      ) : draftDocument.geometryType === "PolyLineZ" ? (
        <PolyLineSection document={draftDocument} onUpdate={onUpdate} />
      ) : null}

      <SectionCard
        title="Projection"
        description="Optional PRJ WKT text written to the .prj sidecar."
        icon={Shapes}
      >
        <textarea
          value={draftDocument.prj ?? ""}
          onChange={(event) => {
            onUpdate((draft) => {
              draft.prj = event.target.value;
            });
          }}
          placeholder="Paste WKT here or leave blank to omit the PRJ file."
          className="min-h-48 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </SectionCard>
    </div>
  );
}

function AttributesSection({
  document: draftDocument,
  onUpdate,
}: {
  document: ShapefileDocument;
  onUpdate: (updater: (draft: ShapefileDocument) => void) => void;
}) {
  return (
    <SectionCard
      title="Attributes"
      description="DBF field definitions. Field names are limited to 11 characters."
      action={(
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onUpdate((draft) => {
              const nextField = createFieldDraft(draft.fields.length);
              draft.fields.push(nextField);
              draft.rows = ensureRowCount(draft.rows, draft.records.length).map((row) => [
                ...ensureCellCount(row, draft.fields.length - 1),
                null,
              ]);
            });
          }}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Field
        </Button>
      )}
    >
      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="border-b border-border px-3 py-2 font-medium">Name</th>
              <th className="border-b border-border px-3 py-2 font-medium">Type</th>
              <th className="border-b border-border px-3 py-2 font-medium">Length</th>
              <th className="border-b border-border px-3 py-2 font-medium">Decimals</th>
              <th className="border-b border-border px-3 py-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {draftDocument.fields.length > 0 ? (
              draftDocument.fields.map((field, fieldIndex) => (
                <FieldRow
                  key={`${field.name}-${fieldIndex}`}
                  field={field}
                  fieldIndex={fieldIndex}
                  onUpdate={onUpdate}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  No DBF fields yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function FieldRow({
  field,
  fieldIndex,
  onUpdate,
}: {
  field: ShapefileField;
  fieldIndex: number;
  onUpdate: (updater: (draft: ShapefileDocument) => void) => void;
}) {
  return (
    <tr>
      <td className="border-b border-border px-3 py-3 align-top">
        <Input
          value={field.name}
          maxLength={11}
          onChange={(event) => {
            const nextValue = event.target.value.toUpperCase();
            onUpdate((draft) => {
              draft.fields[fieldIndex].name = nextValue;
            });
          }}
        />
      </td>
      <td className="border-b border-border px-3 py-3 align-top">
        <select
          value={field.fieldType}
          onChange={(event) => {
            const nextType = event.target.value as ShapefileField["fieldType"];
            onUpdate((draft) => {
              draft.fields[fieldIndex] = {
                ...draft.fields[fieldIndex],
                ...getDefaultFieldConfig(nextType),
              };
              draft.rows.forEach((row) => {
                row[fieldIndex] = null;
              });
            });
          }}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow]"
        >
          <option value="C">Character</option>
          <option value="N">Number</option>
          <option value="F">Float</option>
          <option value="L">Logical</option>
          <option value="D">Date</option>
        </select>
      </td>
      <td className="border-b border-border px-3 py-3 align-top">
        <Input
          type="number"
          min={1}
          max={255}
          value={field.length}
          disabled={field.fieldType === "L" || field.fieldType === "D"}
          onChange={(event) => {
            onUpdate((draft) => {
              draft.fields[fieldIndex].length = clampByte(
                Number(event.target.value) || 0,
                field.fieldType === "L"
                  ? 1
                  : field.fieldType === "D"
                    ? 8
                    : 1,
              );
            });
          }}
        />
      </td>
      <td className="border-b border-border px-3 py-3 align-top">
        <Input
          type="number"
          min={0}
          max={255}
          value={field.decimalCount}
          disabled={field.fieldType !== "N" && field.fieldType !== "F"}
          onChange={(event) => {
            onUpdate((draft) => {
              draft.fields[fieldIndex].decimalCount =
                field.fieldType === "N" || field.fieldType === "F"
                  ? clampByte(Number(event.target.value) || 0, 0)
                  : 0;
            });
          }}
        />
      </td>
      <td className="border-b border-border px-3 py-3 text-right align-top">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onUpdate((draft) => {
              draft.fields.splice(fieldIndex, 1);
              draft.rows = ensureRowCount(
                draft.rows,
                draft.records.length,
              ).map((row) =>
                row.filter((_, cellIndex) => cellIndex !== fieldIndex),
              );
            });
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </td>
    </tr>
  );
}

function PolyLineSection({
  document: draftDocument,
  onUpdate,
}: {
  document: ShapefileDocument;
  onUpdate: (updater: (draft: ShapefileDocument) => void) => void;
}) {
  return (
    <SectionCard
      title="Line Features"
      description="Edit PolyLineZ vertices and per-feature DBF values. Multipart structures remain read-only in this first version."
      action={(
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onUpdate((draft) => {
              draft.records.push(createPolyLineRecord(draft.records.length + 1));
              draft.rows = ensureRowCount(draft.rows, draft.records.length - 1);
              draft.rows.push(createEmptyRow(draft.fields.length));
            });
          }}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Feature
        </Button>
      )}
    >
      <div className="space-y-4">
        {draftDocument.records.map((record, recordIndex) => (
          <PolyLineFeature
            key={`${record.number}-${recordIndex}`}
            document={draftDocument}
            recordIndex={recordIndex}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </SectionCard>
  );
}

function PolyLineFeature({
  document: draftDocument,
  recordIndex,
  onUpdate,
}: {
  document: ShapefileDocument;
  recordIndex: number;
  onUpdate: (updater: (draft: ShapefileDocument) => void) => void;
}) {
  const record = draftDocument.records[recordIndex];
  const geometry = record.geometry;
  if (geometry.type !== "PolyLineZ") {
    return null;
  }

  const isMultipart = geometry.parts.length > 1;

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Feature {record.number}</p>
            <Badge variant="secondary">{geometry.points.length} points</Badge>
            {isMultipart ? (
              <Badge variant="outline">Parts: {geometry.parts.join(", ")}</Badge>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {isMultipart
              ? "Multipart part boundaries are preserved while you edit coordinates."
              : "Single-part PolyLineZ feature."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (isMultipart) {
                return;
              }

              onUpdate((draft) => {
                const target = draft.records[recordIndex];
                if (target.geometry.type !== "PolyLineZ") {
                  return;
                }
                const lastPoint =
                  target.geometry.points[target.geometry.points.length - 1]
                  ?? { x: 0, y: 0, z: 0, m: 0 };
                target.geometry.points.push({ ...lastPoint });
              });
            }}
            disabled={isMultipart}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add Point
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onUpdate((draft) => {
                draft.records.splice(recordIndex, 1);
                draft.rows.splice(recordIndex, 1);
                renumberRecords(draft.records);
              });
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {draftDocument.fields.length > 0 ? (
        <div className="grid gap-3 border-b border-border px-4 py-4 md:grid-cols-2 xl:grid-cols-3">
          {draftDocument.fields.map((field, fieldIndex) => (
            <div key={`${field.name}-${fieldIndex}`} className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {field.name}
              </label>
              <DbfCellEditor
                field={field}
                value={draftDocument.rows[recordIndex]?.[fieldIndex] ?? null}
                onChange={(value) => {
                  onUpdate((draft) => {
                    draft.rows = ensureRowCount(
                      draft.rows,
                      draft.records.length,
                    );
                    draft.rows[recordIndex] = ensureCellCount(
                      draft.rows[recordIndex],
                      draft.fields.length,
                    );
                    draft.rows[recordIndex][fieldIndex] = value;
                  });
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="overflow-auto px-4 py-4">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="border-b border-border px-3 py-2 font-medium">Point</th>
              <th className="border-b border-border px-3 py-2 font-medium">X</th>
              <th className="border-b border-border px-3 py-2 font-medium">Y</th>
              <th className="border-b border-border px-3 py-2 font-medium">Z</th>
              <th className="border-b border-border px-3 py-2 font-medium">M</th>
              <th className="border-b border-border px-3 py-2 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {geometry.points.map((point, pointIndex) => (
              <tr key={`${record.number}-${pointIndex}`}>
                <td className="border-b border-border px-3 py-3 text-sm text-muted-foreground">
                  {pointIndex + 1}
                </td>
                {(["x", "y", "z", "m"] as const).map((key) => (
                  <td
                    key={key}
                    className="border-b border-border px-3 py-3 align-top"
                  >
                    <NumericInput
                      value={point[key]}
                      onChange={(value) => {
                        onUpdate((draft) => {
                          const target = draft.records[recordIndex];
                          if (target.geometry.type !== "PolyLineZ") {
                            return;
                          }
                          target.geometry.points[pointIndex][key] = value;
                        });
                      }}
                    />
                  </td>
                ))}
                <td className="border-b border-border px-3 py-3 text-right align-top">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onUpdate((draft) => {
                        const target = draft.records[recordIndex];
                        if (
                          target.geometry.type !== "PolyLineZ"
                          || target.geometry.parts.length > 1
                          || target.geometry.points.length <= 2
                        ) {
                          return;
                        }
                        target.geometry.points.splice(pointIndex, 1);
                      });
                    }}
                    disabled={isMultipart || geometry.points.length <= 2}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
