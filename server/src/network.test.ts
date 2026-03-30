import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Elysia } from "elysia";
import { createGeodashServerConfig } from "./config";
import { networkModule } from "./modules/network";

const PRESET1 = resolve(
  import.meta.dir,
  "../../core/network-engine/test-data/preset1",
);
const EXAMPLE = resolve(import.meta.dir, "../../workingfiles/example");

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
type NetworkConfigMetadata = {
  propertyDimensions: Record<string, string>;
  dimensionUnits: Record<string, string>;
  blockTypeUnits: Record<string, Record<string, string>>;
};
type NetworkResponse = {
  id: string;
  label: string;
  config?: NetworkConfigMetadata;
  nodes: Node[];
  edges: Edge[];
  warnings?: string[];
};

function createApp() {
  const config = createGeodashServerConfig();
  return new Elysia().use(networkModule(config));
}

describe("GET /api/network", () => {
  const app = createApp();

  test("missing network param returns 400", async () => {
    const res = await app.handle(new Request("http://localhost/api/network"));
    expect(res.status).toBe(400);
    const body = await res.json() as { message: string };
    expect(body.message).toContain("network");
  });

  test("invalid network dir returns 500", async () => {
    const res = await app.handle(
      new Request("http://localhost/api/network?network=/nonexistent/path"),
    );
    expect(res.status).toBe(500);
    const body = await res.json() as { message: string };
    expect(body.message).toBe("Failed to load network");
  });

  test("valid network dir returns 200", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    expect(res.status).toBe(200);
  });

  test("response contains nodes and edges arrays", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const body = await res.json() as NetworkResponse;
    expect(body.id).toBe("preset1");
    expect(body.label).toBe("Preset 1");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.edges)).toBe(true);
  });

  test("every node has a string id and string type", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(typeof node.id).toBe("string");
      expect(typeof node.type).toBe("string");
    }
  });

  test("every node has position with numeric x and y", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    for (const node of nodes) {
      expect(typeof node.position).toBe("object");
      expect(typeof node.position.x).toBe("number");
      expect(typeof node.position.y).toBe("number");
    }
  });

  test("every node has a data object with a string id", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    for (const node of nodes) {
      expect(typeof node.data).toBe("object");
      expect(node.data.id).toBe(node.id);
    }
  });

  test("preset1 includes all five expected node types", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const types = new Set(nodes.map((node) => node.type));
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
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const branches = nodes.filter((node) => node.type === "branch");
    expect(branches.length).toBe(9);
  });

  test("branch nodes have a label in data", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const branches = nodes.filter((node) => node.type === "branch");
    for (const branch of branches) {
      expect(typeof branch.data.label).toBe("string");
      expect((branch.data.label as string).length).toBeGreaterThan(0);
    }
  });

  test("branch node in labeled group has parentId", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const branch1 = nodes.find((node) => node.id === "branch-1");
    expect(branch1).toBeDefined();
    expect(branch1!.parentId).toBe("group-1");
  });

  test("branch nodes have a data.blocks array", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const branches = nodes.filter((node) => node.type === "branch");
    for (const branch of branches) {
      expect(Array.isArray(branch.data.blocks)).toBe(true);
    }
  });

  test("branch blocks have type, kind, label, and numeric quantity", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const branches = nodes.filter((node) => node.type === "branch");
    for (const branch of branches) {
      for (const block of branch.data.blocks ?? []) {
        expect(typeof block.type).toBe("string");
        expect(typeof block.kind).toBe("string");
        expect(typeof block.label).toBe("string");
        expect(typeof block.quantity).toBe("number");
        expect(block.kind).toBe(block.type.toLowerCase());
      }
    }
  });

  test("block extra properties (e.g. pressure) are preserved", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const branch1 = nodes.find((node) => node.id === "branch-1");
    const compressor = branch1?.data.blocks?.find((block) => block.type === "Compressor");
    expect(compressor).toBeDefined();
    expect(compressor!.pressure).toBe("120 bar");
  });

  test("config unit metadata is exposed in the network response", async () => {
    const networkDir = await mkdtemp(join(tmpdir(), "geodash-network-"));

    try {
      await writeFile(
        join(networkDir, "config.toml"),
        [
          '[propertyDimensions]',
          'length = "length"',
          'pressure = "pressure"',
          "",
          '[unitPreferences.dimensions]',
          'length = "km"',
          "",
          '[unitPreferences.Source]',
          'length = "m"',
        ].join("\n"),
      );
      await writeFile(
        join(networkDir, "branch-1.toml"),
        [
          'type = "branch"',
          "",
          "[position]",
          "x = 0",
          "y = 0",
          "",
          "[[block]]",
          'type = "Source"',
        ].join("\n"),
      );

      const res = await app.handle(
        new Request(`http://localhost/api/network?network=${encodeURIComponent(networkDir)}`),
      );
      expect(res.status).toBe(200);

      const body = await res.json() as NetworkResponse;
      expect(body.config).toEqual({
        propertyDimensions: {
          length: "length",
          pressure: "pressure",
        },
        dimensionUnits: {
          length: "km",
        },
        blockTypeUnits: {
          Source: {
            length: "m",
          },
        },
      });
    } finally {
      await rm(networkDir, { recursive: true, force: true });
    }
  });

  test("nested block tables are preserved without dropping the branch", async () => {
    const networkDir = await mkdtemp(join(tmpdir(), "geodash-network-"));

    try {
      await writeFile(
        join(networkDir, "config.toml"),
        ['id = "nested-block-table"', 'label = "Nested Block Table"'].join("\n"),
      );
      await writeFile(
        join(networkDir, "branch-1.toml"),
        [
          'type = "branch"',
          'label = "Branch 1"',
          "",
          "[position]",
          "x = 100",
          "y = 200",
          "",
          "[[block]]",
          'type = "Source"',
          "pressure = 10",
          "",
          "[block.composition]",
          "carbonDioxideFraction = 0.96",
          "hydrogenFraction = 0.0075",
          "nitrogenFraction = 0.0325",
          "",
          "[[block]]",
          'type = "Pipe"',
        ].join("\n"),
      );

      const res = await app.handle(
        new Request(`http://localhost/api/network?network=${encodeURIComponent(networkDir)}`),
      );
      expect(res.status).toBe(200);

      const body = await res.json() as NetworkResponse;
      const branch1 = body.nodes.find((node) => node.id === "branch-1");
      const source = branch1?.data.blocks?.[0];

      expect(branch1).toBeDefined();
      expect(source?.composition).toEqual({
        carbonDioxideFraction: 0.96,
        hydrogenFraction: 0.0075,
        nitrogenFraction: 0.0325,
      });
      expect(body.warnings ?? []).not.toContain("Failed to parse branch-1.toml");
    } finally {
      await rm(networkDir, { recursive: true, force: true });
    }
  });

  test("propagated branch fluid data is included in branch node data", async () => {
    const networkDir = await mkdtemp(join(tmpdir(), "geodash-network-"));

    try {
      await writeFile(
        join(networkDir, "branch-1.toml"),
        [
          'type = "branch"',
          'label = "Feed"',
          "",
          "[position]",
          "x = 0",
          "y = 0",
          "",
          "[[outgoing]]",
          'target = "branch-2"',
          "",
          "[[block]]",
          'type = "Source"',
          "flow_rate = 10.0",
          "composition = {CO2 = 1.0}",
        ].join("\n"),
      );
      await writeFile(
        join(networkDir, "branch-2.toml"),
        [
          'type = "branch"',
          'label = "Downstream"',
          "",
          "[position]",
          "x = 100",
          "y = 0",
          "",
          "[[block]]",
          'type = "Pipe"',
        ].join("\n"),
      );

      const res = await app.handle(
        new Request(`http://localhost/api/network?network=${encodeURIComponent(networkDir)}`),
      );
      expect(res.status).toBe(200);

      const body = await res.json() as NetworkResponse;
      const feed = body.nodes.find((node) => node.id === "branch-1");
      const downstream = body.nodes.find((node) => node.id === "branch-2");

      expect(feed?.data.flow_rate).toBe(10);
      expect(feed?.data.composition).toEqual({ CO2: 1 });
      expect(downstream?.data.flow_rate).toBe(10);
      expect(downstream?.data.composition).toEqual({ CO2: 1 });
    } finally {
      await rm(networkDir, { recursive: true, force: true });
    }
  });

  test("labeled group has width and height", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const group = nodes.find((node) => node.type === "labeledGroup");
    expect(group).toBeDefined();
    expect(typeof group!.width).toBe("number");
    expect(typeof group!.height).toBe("number");
  });

  test("image node has data.path", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes } = await res.json() as NetworkResponse;
    const image = nodes.find((node) => node.type === "image");
    expect(image).toBeDefined();
    expect(typeof image!.data.path).toBe("string");
    expect((image!.data.path as string).length).toBeGreaterThan(0);
  });

  test("every edge has string id, source, and target", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { edges } = await res.json() as NetworkResponse;
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(typeof edge.id).toBe("string");
      expect(typeof edge.source).toBe("string");
      expect(typeof edge.target).toBe("string");
    }
  });

  test("every edge has data.weight as a number", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { edges } = await res.json() as NetworkResponse;
    for (const edge of edges) {
      expect(typeof edge.data).toBe("object");
      expect(typeof edge.data.weight).toBe("number");
    }
  });

  test("edge sources and targets reference real node ids", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { nodes, edges } = await res.json() as NetworkResponse;
    const nodeIds = new Set(nodes.map((node) => node.id));
    for (const edge of edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  test("no self-referencing edges", async () => {
    const res = await app.handle(
      new Request(`http://localhost/api/network?network=${encodeURIComponent(PRESET1)}`),
    );
    const { edges } = await res.json() as NetworkResponse;
    for (const edge of edges) {
      expect(edge.source).not.toBe(edge.target);
    }
  });

  test("assets route returns 200 for known asset", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/network/assets/assets/sample-diagram.svg?network=${encodeURIComponent(EXAMPLE)}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });

  test("assets route returns 404 for missing asset", async () => {
    const res = await app.handle(
      new Request(
        `http://localhost/api/network/assets/assets/missing.svg?network=${encodeURIComponent(PRESET1)}`,
      ),
    );
    expect(res.status).toBe(404);
  });
});
