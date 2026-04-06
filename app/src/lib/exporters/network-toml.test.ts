/**
 * Unit tests for the TOML network serializer.
 *
 * These tests cover the pure serialization logic (buildTomlFiles /
 * serializeNodeToToml) independently of any desktop-bridge or file-system I/O.
 */
import { describe, test, expect } from "bun:test";
import TOML from "smol-toml";
import {
  buildTomlFiles,
  getTomlPathsToDelete,
  serializeNodeToToml,
} from "./network-toml";
import type { FlowNode, FlowEdge } from "@/lib/collections/flow-nodes";
import type { NetworkNode } from "@/lib/api-client";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBranchNode(
  id = "branch-1",
  overrides: Partial<FlowNode> = {},
): FlowNode {
  return {
    id,
    type: "branch",
    position: { x: 20, y: 30 },
    data: {
      id,
      label: "Branch One",
      blocks: [
        { quantity: 2, type: "Pipe", kind: "pipe", label: "Pipe" },
        {
          quantity: 1,
          type: "Compressor",
          kind: "compressor",
          label: "Compressor",
          pressure: "120 bar",
        },
      ],
    },
    ...overrides,
  } as FlowNode;
}

function makeGroupNode(id = "group-1"): FlowNode {
  return {
    id,
    type: "labeledGroup",
    position: { x: 0, y: 0 },
    width: 700,
    height: 300,
    data: { id, label: "Group A" },
  } as FlowNode;
}

function makeGeographicAnchorNode(id = "anchor-1"): FlowNode {
  return {
    id,
    type: "geographicAnchor",
    position: { x: -180, y: -170 },
    width: 1000,
    height: 500,
    data: { id },
  } as FlowNode;
}

function makeGeographicWindowNode(id = "window-1"): FlowNode {
  return {
    id,
    type: "geographicWindow",
    position: { x: 50, y: 60 },
    width: 400,
    height: 200,
    data: { id },
  } as FlowNode;
}

function makeImageNode(id = "image-1"): FlowNode {
  return {
    id,
    type: "image",
    position: { x: 400, y: -100 },
    width: 300,
    height: 200,
    data: { id, label: "Pipeline Map", path: "assets/diagram.svg" },
  } as FlowNode;
}

function makeEdge(source: string, target: string, weight = 1): FlowEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    data: { weight },
  };
}

// ── serializeNodeToToml ───────────────────────────────────────────────────────

describe("serializeNodeToToml", () => {
  test("branch: type and label appear at top level", () => {
    const node = makeBranchNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.type).toBe("branch");
    expect(parsed.label).toBe("Branch One");
  });

  test("branch: position serializes as [position] table", () => {
    const node = makeBranchNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.position).toEqual({ x: 20, y: 30 });
  });

  test("branch: blocks serialize as [[block]] array-of-tables", () => {
    const node = makeBranchNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    const blocks = parsed.block as Record<string, unknown>[];
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("Pipe");
    expect(blocks[0].quantity).toBe(2);
    // Quantity=1 is default and omitted
    expect(blocks[1].quantity).toBeUndefined();
    expect(blocks[1].type).toBe("Compressor");
  });

  test("branch: extra block properties are preserved", () => {
    const node = makeBranchNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    const blocks = parsed.block as Record<string, unknown>[];
    expect(blocks[1].pressure).toBe("120 bar");
  });

  test("branch: computed block fields (kind, label) are stripped", () => {
    const node = makeBranchNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    const blocks = parsed.block as Record<string, unknown>[];
    expect(blocks[0].kind).toBeUndefined();
    expect(blocks[0].label).toBeUndefined();
  });

  test("branch: authored extras are preserved while derived fluid values are omitted", () => {
    const node = makeBranchNode("branch-1", {
      data: {
        ...makeBranchNode("branch-1").data,
        roughness: "0.05 mm",
        flow_rate: "10 kg/s",
        composition: { CO2: 1 },
      },
    });
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;

    expect(parsed.roughness).toBe("0.05 mm");
    expect(parsed.flow_rate).toBeUndefined();
    expect(parsed.composition).toBeUndefined();
  });

  test("branch: outgoing edges serialize as [[outgoing]] array-of-tables", () => {
    const node = makeBranchNode();
    const outgoing = [
      { target: "branch-2", weight: 1 },
      { target: "branch-3", weight: 2 },
    ];
    const toml = serializeNodeToToml(node as unknown as NetworkNode, outgoing);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    const out = parsed.outgoing as Record<string, unknown>[];
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out[0].target).toBe("branch-2");
    expect(out[1].weight).toBe(2);
  });

  test("branch: no outgoing key when no edges", () => {
    const node = makeBranchNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode, []);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.outgoing).toBeUndefined();
  });

  test("branch: parentId is written when present", () => {
    const node = makeBranchNode("branch-1", { parentId: "group-1" });
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.parentId).toBe("group-1");
  });

  test("labeledGroup: width and height at top level", () => {
    const node = makeGroupNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.type).toBe("labeledGroup");
    expect(parsed.label).toBe("Group A");
    expect(parsed.width).toBe(700);
    expect(parsed.height).toBe(300);
    expect(parsed.position).toEqual({ x: 0, y: 0 });
  });

  test("geographicAnchor: type and dimensions", () => {
    const node = makeGeographicAnchorNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.type).toBe("geographicAnchor");
    expect(parsed.width).toBe(1000);
    expect(parsed.height).toBe(500);
    expect(parsed.position).toEqual({ x: -180, y: -170 });
  });

  test("geographicWindow: type and dimensions", () => {
    const node = makeGeographicWindowNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.type).toBe("geographicWindow");
    expect(parsed.width).toBe(400);
    expect(parsed.height).toBe(200);
  });

  test("image: path field is preserved", () => {
    const node = makeImageNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.type).toBe("image");
    expect(parsed.path).toBe("assets/diagram.svg");
    expect(parsed.label).toBe("Pipeline Map");
  });

  test("image: no block or outgoing keys", () => {
    const node = makeImageNode();
    const toml = serializeNodeToToml(node as unknown as NetworkNode);
    const parsed = TOML.parse(toml) as Record<string, unknown>;
    expect(parsed.block).toBeUndefined();
    expect(parsed.outgoing).toBeUndefined();
  });
});

// ── buildTomlFiles ────────────────────────────────────────────────────────────

describe("buildTomlFiles", () => {
  test("returns one file per node", () => {
    const nodes = [makeBranchNode("b1"), makeGroupNode("g1")];
    const files = buildTomlFiles(nodes, [], "/net");
    expect(files).toHaveLength(2);
  });

  test("file paths use node id as filename", () => {
    const nodes = [makeBranchNode("branch-1"), makeGroupNode("group-1")];
    const files = buildTomlFiles(nodes, [], "/net");
    const paths = files.map((f) => f.path);
    expect(paths).toContain("/net/branch-1.toml");
    expect(paths).toContain("/net/group-1.toml");
  });

  test("trailing slash in directory path is handled", () => {
    const nodes = [makeBranchNode("b1")];
    const files = buildTomlFiles(nodes, [], "/net/");
    expect(files[0].path).toBe("/net/b1.toml");
  });

  test("edges appear as [[outgoing]] inside the source branch file", () => {
    const nodes = [makeBranchNode("b1"), makeBranchNode("b2")];
    const edges = [makeEdge("b1", "b2", 3)];
    const files = buildTomlFiles(nodes, edges, "/net");

    const b1File = files.find((f) => f.path.endsWith("b1.toml"))!;
    const b2File = files.find((f) => f.path.endsWith("b2.toml"))!;

    const b1 = TOML.parse(b1File.content) as Record<string, unknown>;
    const b2 = TOML.parse(b2File.content) as Record<string, unknown>;

    const outgoing = b1.outgoing as Record<string, unknown>[];
    expect(Array.isArray(outgoing)).toBe(true);
    expect(outgoing[0].target).toBe("b2");
    expect(outgoing[0].weight).toBe(3);

    // b2 has no outgoing
    expect(b2.outgoing).toBeUndefined();
  });

  test("ReactFlow UI properties are stripped from output", () => {
    const node: FlowNode = {
      ...makeBranchNode("b1"),
      draggable: true,
      selectable: true,
      selected: false,
      zIndex: 0,
    };
    const files = buildTomlFiles([node], [], "/net");
    const parsed = TOML.parse(files[0].content) as Record<string, unknown>;

    expect(parsed.draggable).toBeUndefined();
    expect(parsed.selectable).toBeUndefined();
    expect(parsed.selected).toBeUndefined();
    expect(parsed.zIndex).toBeUndefined();
  });

  test("round-trip: serialized TOML re-parses to original values", () => {
    const node = makeBranchNode("b1", { parentId: "group-1" });
    const files = buildTomlFiles([node], [], "/net");
    const parsed = TOML.parse(files[0].content) as Record<string, unknown>;

    expect(parsed.type).toBe("branch");
    expect(parsed.label).toBe("Branch One");
    expect(parsed.parentId).toBe("group-1");
    expect((parsed.position as Record<string, number>).x).toBe(20);
    expect((parsed.position as Record<string, number>).y).toBe(30);
  });
});

describe("getTomlPathsToDelete", () => {
  test("preserves config.toml and other non-node TOMLs", () => {
    const nextFiles = buildTomlFiles([makeBranchNode("branch-1")], [], "/net");
    const existingFiles = [
      ...nextFiles,
      {
        path: "/net/config.toml",
        content: [
          "[properties]",
          "ambientTemperature = 20",
          "",
          "[inheritance]",
          'general = ["block", "global"]',
          "",
        ].join("\n"),
      },
    ];

    expect(getTomlPathsToDelete(existingFiles, nextFiles)).toEqual([]);
  });

  test("deletes stale node TOMLs that are no longer generated", () => {
    const nextFiles = buildTomlFiles([makeBranchNode("branch-1")], [], "/net");
    const existingFiles = [
      ...nextFiles,
      {
        path: "/net/branch-9.toml",
        content: serializeNodeToToml(
          makeBranchNode("branch-9") as unknown as NetworkNode,
        ),
      },
    ];

    expect(getTomlPathsToDelete(existingFiles, nextFiles)).toEqual([
      "/net/branch-9.toml",
    ]);
  });
});
