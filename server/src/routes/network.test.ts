/**
 * Integration tests for GET /api/network.
 *
 * These run against the real WASM and real preset1 data, so they document the
 * actual current shape of the response — not an assumed future shape.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { networkRoutes } from "./network";
import { Hono } from "hono";

const PRESET1 = resolve(
  import.meta.dir,
  "../../../core/network-engine/test-data/preset1"
);

type Position = { x: number; y: number };
type Block = {
  type: string;
  kind: string;
  label: string;
  quantity: number;
  [key: string]: unknown;
};
type NodeData = {
  id: string;
  label?: string;
  blocks?: Block[];
  path?: string;
  [key: string]: unknown;
};
type Node = {
  id: string;
  type: string;
  position: Position;
  parentId?: string;
  width?: number;
  height?: number;
  data: NodeData;
};
type EdgeData = { weight: number };
type Edge = { id: string; source: string; target: string; data: EdgeData };
type NetworkResponse = { nodes: Node[]; edges: Edge[]; warnings?: string[] };

function createApp() {
  const app = new Hono();
  app.route("/api/network", networkRoutes);
  return app;
}

describe("GET /api/network", () => {
  const app = createApp();

  // ── Error cases ────────────────────────────────────────────────────────────

  test("missing network param returns 400", async () => {
    const res = await app.request("/api/network");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("network");
  });

  test("invalid network dir returns 500", async () => {
    const res = await app.request("/api/network?network=/nonexistent/path");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Failed to load network");
  });

  // ── Response shape ─────────────────────────────────────────────────────────

  test("valid network dir returns 200", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    expect(res.status).toBe(200);
  });

  test("response contains nodes and edges arrays", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const body = (await res.json()) as NetworkResponse;
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });

  // ── Node shape ─────────────────────────────────────────────────────────────

  test("every node has a string id and string type", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.type).toBe("string");
    }
  });

  test("every node has position with numeric x and y", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    for (const node of nodes) {
      expect(typeof node.position).toBe("object");
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
    }
  });

  test("every node has a data object with a string id", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    for (const node of nodes) {
      expect(typeof node.data).toBe("object");
      expect(node.data.id).toBe(node.id);
    }
  });

  test("preset1 includes all five expected node types", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    const types = new Set(nodes.map((n) => n.type));
    for (const expected of [
      "branch",
      "labeledGroup",
      "geographicAnchor",
      "geographicWindow",
      "image",
    ]) {
      expect(types.has(expected)).toBe(true);
    }
  });

  test("preset1 has nine branch nodes (one per branch-N.toml)", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    const branches = nodes.filter((n) => n.type === "branch");
    expect(branches.length).toBe(9);
  });

  test("branch nodes have a label in data", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    const branches = nodes.filter((n) => n.type === "branch");
    for (const branch of branches) {
      expect(typeof branch.data.label).toBe("string");
      expect((branch.data.label as string).length).toBeGreaterThan(0);
    }
  });

  test("branch node in labeled group has parentId", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    // branch-1 is inside group-1 in preset1
    const branch1 = nodes.find((n) => n.id === "branch-1");
    expect(branch1).toBeDefined();
    expect(branch1!.parentId).toBe("group-1");
  });

  test("branch nodes have a data.blocks array", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    const branches = nodes.filter((n) => n.type === "branch");
    for (const branch of branches) {
      expect(Array.isArray(branch.data.blocks)).toBe(true);
    }
  });

  test("branch blocks have type, kind, label, and numeric quantity", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    const branches = nodes.filter((n) => n.type === "branch");
    for (const branch of branches) {
      for (const block of branch.data.blocks!) {
        expect(typeof block.type).toBe("string");
        expect(typeof block.kind).toBe("string");
        expect(typeof block.label).toBe("string");
        expect(typeof block.quantity).toBe("number");
        // kind must be lowercase of type
        expect(block.kind).toBe(block.type.toLowerCase());
      }
    }
  });

  test("block extra properties (e.g. pressure) are preserved", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    // branch-1 has a Compressor block with pressure = "120 bar"
    const branch1 = nodes.find((n) => n.id === "branch-1")!;
    const compressor = branch1.data.blocks!.find((b) => b.type === "Compressor");
    expect(compressor).toBeDefined();
    expect(compressor!.pressure).toBe("120 bar");
  });

  test("labeled group has width and height", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    const group = nodes.find((n) => n.type === "labeledGroup");
    expect(group).toBeDefined();
    expect(typeof group!.width).toBe("number");
    expect(typeof group!.height).toBe("number");
  });

  test("image node has data.path", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes } = (await res.json()) as NetworkResponse;
    const image = nodes.find((n) => n.type === "image");
    expect(image).toBeDefined();
    expect(typeof image!.data.path).toBe("string");
    expect((image!.data.path as string).length).toBeGreaterThan(0);
  });

  // ── Edge shape ─────────────────────────────────────────────────────────────

  test("every edge has string id, source, and target", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { edges } = (await res.json()) as NetworkResponse;
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(typeof edge.id).toBe("string");
      expect(typeof edge.source).toBe("string");
      expect(typeof edge.target).toBe("string");
    }
  });

  test("every edge has data.weight as a number", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { edges } = (await res.json()) as NetworkResponse;
    for (const edge of edges) {
      expect(typeof edge.data).toBe("object");
      expect(typeof edge.data.weight).toBe("number");
    }
  });

  test("edge sources and targets reference real node ids", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { nodes, edges } = (await res.json()) as NetworkResponse;
    const nodeIds = new Set(nodes.map((n) => n.id));
    for (const edge of edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  test("no self-referencing edges", async () => {
    const res = await app.request(
      `/api/network?network=${encodeURIComponent(PRESET1)}`
    );
    const { edges } = (await res.json()) as NetworkResponse;
    for (const edge of edges) {
      expect(edge.source).not.toBe(edge.target);
    }
  });
});
