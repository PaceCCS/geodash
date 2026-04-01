import { describe, expect, test } from "bun:test";
import type { NodeChange } from "@xyflow/react";
import {
  shouldPersistNodeChanges,
  shouldRefreshDerivedDataForNodeChanges,
} from "./flow-change-persistence";

describe("shouldPersistNodeChanges", () => {
  test("ignores measurement-only dimension updates", () => {
    const changes: NodeChange[] = [
      {
        id: "branch-1",
        type: "dimensions",
        dimensions: { width: 240, height: 48 },
      },
    ];

    expect(shouldPersistNodeChanges(changes)).toBe(false);
  });

  test("persists committed width and height updates", () => {
    const changes: NodeChange[] = [
      {
        id: "group-1",
        type: "dimensions",
        dimensions: { width: 800, height: 320 },
        resizing: false,
        setAttributes: true,
      },
    ];

    expect(shouldPersistNodeChanges(changes)).toBe(true);
  });

  test("ignores in-progress resize updates", () => {
    const changes: NodeChange[] = [
      {
        id: "group-1",
        type: "dimensions",
        dimensions: { width: 800, height: 320 },
        resizing: true,
        setAttributes: true,
      },
    ];

    expect(shouldPersistNodeChanges(changes)).toBe(false);
  });
});

describe("shouldRefreshDerivedDataForNodeChanges", () => {
  test("ignores layout-only updates", () => {
    const changes: NodeChange[] = [
      {
        id: "branch-1",
        type: "position",
        position: { x: 120, y: 80 },
        dragging: false,
      },
      {
        id: "group-1",
        type: "dimensions",
        dimensions: { width: 800, height: 320 },
        resizing: false,
        setAttributes: true,
      },
    ];

    expect(shouldRefreshDerivedDataForNodeChanges(changes)).toBe(false);
  });

  test("reloads derived data for structural graph changes", () => {
    const changes: NodeChange[] = [
      {
        id: "branch-1",
        type: "remove",
      },
    ];

    expect(shouldRefreshDerivedDataForNodeChanges(changes)).toBe(true);
  });
});
