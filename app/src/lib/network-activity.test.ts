import { describe, expect, test } from "bun:test";
import { diffNetworkSnapshots } from "./network-activity";
import type { NetworkSnapshot } from "./network-activity";

function makeSnapshot(
  overrides: Partial<NetworkSnapshot> = {},
): NetworkSnapshot {
  return {
    nodes: [
      {
        id: "branch-1",
        type: "branch",
        position: { x: 10, y: 20 },
        parentId: null,
        width: null,
        height: null,
        data: {
          id: "branch-1",
          label: "Branch 1",
          blocks: [
            {
              quantity: 1,
              type: "Pipe",
              kind: "pipe",
              label: "Pipe",
              length: "10 m",
            },
          ],
        },
      },
      {
        id: "branch-2",
        type: "branch",
        position: { x: 100, y: 120 },
        parentId: null,
        width: null,
        height: null,
        data: {
          id: "branch-2",
          label: "Branch 2",
          blocks: [],
        },
      },
    ],
    edges: [],
    ...overrides,
  };
}

describe("diffNetworkSnapshots", () => {
  test("captures node movement as a single activity entry", () => {
    const previous = makeSnapshot();
    const next = makeSnapshot({
      nodes: previous.nodes.map((node) =>
        node.id === "branch-1" && node.type === "branch"
          ? ({ ...node, position: { x: 40.1234, y: 55.5 } } as typeof node)
          : node,
      ),
    });

    const entries = diffNetworkSnapshots(previous, next, {
      source: "canvas",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe(
      "Branch Branch 1 (branch-1) moved: (10, 20) -> (40, 56)",
    );
  });

  test("captures block property changes", () => {
    const previous = makeSnapshot();
    const next = makeSnapshot({
      nodes: previous.nodes.map((node) =>
        node.id === "branch-1" && node.type === "branch"
          ? {
              ...node,
              data: {
                ...node.data,
                blocks: [
                  {
                    ...node.data.blocks[0]!,
                    length: "120 m",
                  },
                ],
              },
            } as typeof node
          : node,
      ),
    });

    const entries = diffNetworkSnapshots(previous, next, {
      source: "details",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe(
      "Branch Branch 1 (branch-1) Pipe[0] length: 10 m -> 120 m",
    );
  });

  test("captures connection changes", () => {
    const previous = makeSnapshot();
    const next = makeSnapshot({
      edges: [
        {
          id: "branch-1-branch-2",
          source: "branch-1",
          target: "branch-2",
          data: { weight: 1 },
        },
      ],
    });

    const entries = diffNetworkSnapshots(previous, next, {
      source: "canvas",
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toBe(
      "Connection branch-1 -> branch-2 added",
    );
  });

  test("returns no entries when snapshots are identical", () => {
    const previous = makeSnapshot();
    const next = makeSnapshot();

    const entries = diffNetworkSnapshots(previous, next, {
      source: "filesystem",
    });

    expect(entries).toHaveLength(0);
  });
});
