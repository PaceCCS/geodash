import { describe, expect, test } from "bun:test";

import type { FlowNode } from "@/lib/collections/flow-nodes";
import {
  getSelectedBlockPath,
  getSelectedNodeIdFromQuery,
  normalizeFlowSelectionQuery,
  resolveFlowSelection,
} from "./flow-selection";

const nodes: FlowNode[] = [
  {
    id: "branch-1",
    type: "branch",
    position: { x: 0, y: 0 },
    data: {
      id: "branch-1",
      label: "Branch 1",
      blocks: [
        {
          quantity: 1,
          type: "Source",
          kind: "source",
          label: "Source block",
        },
      ],
    },
  },
  {
    id: "group-1",
    type: "labeledGroup",
    position: { x: 10, y: 10 },
    data: {
      id: "group-1",
      label: "Group 1",
    },
  },
];

describe("flow selection query helpers", () => {
  test("normalizes query selections", () => {
    expect(normalizeFlowSelectionQuery("branch-1/blocks/0")).toBe(
      "branch-1/blocks/0",
    );
    expect(normalizeFlowSelectionQuery("node:branch-1")).toBe("branch-1");
    expect(normalizeFlowSelectionQuery("edge:branch-1->branch-2")).toBeUndefined();
  });

  test("extracts selected node id from a query path", () => {
    expect(getSelectedNodeIdFromQuery("branch-1")).toBe("branch-1");
    expect(getSelectedNodeIdFromQuery("branch-1/blocks/0/type")).toBe(
      "branch-1",
    );
  });

  test("extracts the selected block path from a query path", () => {
    expect(getSelectedBlockPath("branch-1/blocks/0/type")).toEqual({
      nodeId: "branch-1",
      blockIndex: 0,
      query: "branch-1/blocks/0",
    });
    expect(getSelectedBlockPath("branch-1")).toBeUndefined();
  });

  test("resolves branch, group, and block selections", () => {
    expect(resolveFlowSelection("branch-1", nodes)).toMatchObject({
      kind: "branch",
      nodeId: "branch-1",
    });

    expect(resolveFlowSelection("group-1/label", nodes)).toMatchObject({
      kind: "group",
      nodeId: "group-1",
    });

    expect(resolveFlowSelection("branch-1/blocks/0/type", nodes)).toMatchObject({
      kind: "block",
      nodeId: "branch-1",
      blockIndex: 0,
      blockQuery: "branch-1/blocks/0",
    });
  });
});
