import { Link } from "@tanstack/react-router";
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowRight,
  ChartNoAxesCombined,
  GitBranch,
  MapPinned,
  Ruler,
  ScanSearch,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

type AccentTone = "foam" | "gold" | "pine" | "iris" | "rose";

type HeroNodeData = {
  eyebrow: string;
  title: string;
  body: string;
  accent: AccentTone;
  icon: LucideIcon;
  featured?: boolean;
};

type HeroFlowNode = Node<HeroNodeData, "heroCard">;

const accentStyles: Record<
  AccentTone,
  { color: string; shadow: string }
> = {
  foam: {
    color: "var(--rose-pine-foam)",
    shadow:
      "0 24px 72px -36px color-mix(in oklch, var(--rose-pine-foam) 72%, transparent)",
  },
  gold: {
    color: "var(--rose-pine-gold)",
    shadow:
      "0 24px 72px -36px color-mix(in oklch, var(--rose-pine-gold) 68%, transparent)",
  },
  pine: {
    color: "var(--rose-pine-pine)",
    shadow:
      "0 24px 72px -36px color-mix(in oklch, var(--rose-pine-pine) 68%, transparent)",
  },
  iris: {
    color: "var(--rose-pine-iris)",
    shadow:
      "0 24px 72px -36px color-mix(in oklch, var(--rose-pine-iris) 66%, transparent)",
  },
  rose: {
    color: "var(--rose-pine-rose)",
    shadow:
      "0 24px 72px -36px color-mix(in oklch, var(--rose-pine-rose) 66%, transparent)",
  },
};

const heroNodeTypes: NodeTypes = {
  heroCard: HeroCardNode as NodeTypes["default"],
};

const heroNodes: HeroFlowNode[] = [
  {
    id: "shapefiles",
    type: "heroCard",
    position: { x: 0, y: 188 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      eyebrow: "Input",
      title: "Shapefiles",
      body: "Inspect and edit PointZ and PolyLineZ data without leaving the app.",
      accent: "foam",
      icon: MapPinned,
    },
  },
  {
    id: "crs",
    type: "heroCard",
    position: { x: 276, y: 42 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      eyebrow: "Transform",
      title: "CRS Reprojection",
      body: "Align coordinate systems before the rest of the pipeline takes over.",
      accent: "gold",
      icon: ScanSearch,
    },
  },
  {
    id: "flow",
    type: "heroCard",
    position: { x: 316, y: 290 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      eyebrow: "Core",
      title: "Flow Network",
      body: "Compose branches, weights, and propagation rules in a directed graph.",
      accent: "pine",
      icon: GitBranch,
      featured: true,
    },
  },
  {
    id: "quantities",
    type: "heroCard",
    position: { x: 650, y: 110 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      eyebrow: "Verify",
      title: "Unit Checks",
      body: "Carry dimensional information through the model with fewer silent mistakes.",
      accent: "iris",
      icon: Ruler,
    },
  },
  {
    id: "outputs",
    type: "heroCard",
    position: { x: 948, y: 198 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      eyebrow: "Deliver",
      title: "Maps & Outputs",
      body: "Review results, compare runs, and move quickly from inputs to insight.",
      accent: "rose",
      icon: ChartNoAxesCombined,
    },
  },
];

const heroEdges: Edge[] = [
  {
    id: "shapefiles-crs",
    source: "shapefiles",
    target: "crs",
    type: "smoothstep",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: "var(--rose-pine-foam)",
      strokeWidth: 1.6,
    },
  },
  {
    id: "shapefiles-flow",
    source: "shapefiles",
    target: "flow",
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: "color-mix(in oklch, var(--rose-pine-foam) 50%, var(--border))",
      strokeWidth: 1.5,
    },
  },
  {
    id: "crs-quantities",
    source: "crs",
    target: "quantities",
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: "var(--rose-pine-gold)",
      strokeWidth: 1.5,
    },
  },
  {
    id: "flow-quantities",
    source: "flow",
    target: "quantities",
    type: "smoothstep",
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: "var(--rose-pine-pine)",
      strokeWidth: 1.7,
    },
  },
  {
    id: "quantities-outputs",
    source: "quantities",
    target: "outputs",
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: "var(--rose-pine-iris)",
      strokeWidth: 1.6,
    },
  },
];

export function HomeHero() {
  const theme = useTheme((state) => state.theme);
  const colorMode = theme === "dark" ? "dark" : "light";

  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-border bg-card">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--rose-pine-foam)_18%,transparent),transparent_38%),radial-gradient(circle_at_right,color-mix(in_oklch,var(--rose-pine-iris)_14%,transparent),transparent_32%),linear-gradient(180deg,color-mix(in_oklch,var(--card)_92%,transparent),color-mix(in_oklch,var(--background)_84%,transparent))]" />

      <div className="relative h-[380px] sm:h-[420px]">
        <div className="absolute inset-0">
          <ReactFlow
            nodes={heroNodes}
            edges={heroEdges}
            nodeTypes={heroNodeTypes}
            colorMode={colorMode}
            fitView
            fitViewOptions={{ padding: 0.18, minZoom: 0.72 }}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            elementsSelectable={false}
            zoomOnDoubleClick={false}
            zoomOnPinch={false}
            zoomOnScroll={false}
            panOnDrag={false}
            panOnScroll={false}
            preventScrolling={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={24} size={1.1} color="var(--border)" />
          </ReactFlow>
        </div>

        <div className="pointer-events-none absolute inset-0 flex items-start p-4 sm:p-6">
          <div className="pointer-events-auto max-w-sm rounded-[1.75rem] border border-border/80 bg-background/88 p-5 shadow-xl backdrop-blur-md sm:p-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-primary" />
              In-Memory Preview
            </div>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              geodash
            </h1>

            <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-[15px]">
              A predefined flow network lives right on the homepage, so we can
              hint at the editor without depending on a watched directory or
              any local files.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/network/watch" search={{}}>
                  Open Network Editor
                  <ArrowRight />
                </Link>
              </Button>

              <Button asChild size="sm" variant="outline">
                <Link to="/shapefiles/watch">Open Shapefile Tools</Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,transparent,color-mix(in_oklch,var(--card)_96%,transparent))]" />
      </div>
    </section>
  );
}

function HeroCardNode({ data }: NodeProps<HeroFlowNode>) {
  const accent = accentStyles[data.accent];
  const Icon = data.icon;

  return (
    <div
      className={cn(
        "relative rounded-[1.35rem] border px-4 py-3 backdrop-blur-sm",
        data.featured ? "min-w-[250px]" : "min-w-[220px]",
      )}
      style={{
        borderColor: `color-mix(in oklch, ${accent.color} 34%, var(--border))`,
        background: `linear-gradient(180deg, color-mix(in oklch, ${accent.color} 10%, var(--card)) 0%, color-mix(in oklch, var(--card) 96%, transparent) 100%)`,
        boxShadow: `0 0 0 1px color-mix(in oklch, ${accent.color} 14%, transparent), ${accent.shadow}`,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-0 !bg-transparent opacity-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-0 !bg-transparent opacity-0"
      />

      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: `color-mix(in oklch, ${accent.color} 18%, var(--muted))`,
            color: accent.color,
          }}
        >
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            {data.eyebrow}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {data.title}
          </div>
        </div>
      </div>

      <p className="mt-3 max-w-[26ch] text-xs leading-5 text-muted-foreground">
        {data.body}
      </p>
    </div>
  );
}
