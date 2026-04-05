import type { ShapefileCell, ShapefileField, ShapefileRecord } from "./api-client";

export function createFieldDraft(index: number): ShapefileField {
  const suffix = String(index + 1);
  return {
    name: `FIELD${suffix}`.slice(0, 11),
    ...getDefaultFieldConfig("C"),
  };
}

export function getDefaultFieldConfig(fieldType: ShapefileField["fieldType"]) {
  switch (fieldType) {
    case "N":
      return { fieldType, length: 18, decimalCount: 0 } as const;
    case "F":
      return { fieldType, length: 18, decimalCount: 6 } as const;
    case "L":
      return { fieldType, length: 1, decimalCount: 0 } as const;
    case "D":
      return { fieldType, length: 8, decimalCount: 0 } as const;
    case "C":
    default:
      return { fieldType: "C", length: 32, decimalCount: 0 } as const;
  }
}

export function createPointRecord(number: number): ShapefileRecord {
  return {
    number,
    geometry: {
      type: "PointZ",
      x: 0,
      y: 0,
      z: 0,
      m: 0,
    },
  };
}

export function createPolyLineRecord(number: number): ShapefileRecord {
  return {
    number,
    geometry: {
      type: "PolyLineZ",
      parts: [0],
      points: [
        { x: 0, y: 0, z: 0, m: 0 },
        { x: 1, y: 0, z: 0, m: 0 },
      ],
    },
  };
}

export function createEmptyRow(fieldCount: number): ShapefileCell[] {
  return Array.from({ length: fieldCount }, () => null);
}

export function ensureRowCount(rows: ShapefileCell[][], count: number): ShapefileCell[][] {
  const nextRows = rows.slice(0, count);
  while (nextRows.length < count) {
    nextRows.push([]);
  }
  return nextRows;
}

export function ensureCellCount(row: ShapefileCell[] | undefined, count: number): ShapefileCell[] {
  const nextRow = row ? row.slice(0, count) : [];
  while (nextRow.length < count) {
    nextRow.push(null);
  }
  return nextRow;
}

export function renumberRecords(records: ShapefileRecord[]) {
  records.forEach((record, index) => {
    record.number = index + 1;
  });
}

export function clampByte(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return Math.max(0, Math.min(255, Math.round(value)));
}
