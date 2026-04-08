import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleHelp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

type AccentTone = "foam" | "gold" | "pine" | "iris" | "rose";

type HeroBlock = {
  type: string;
  detail?: string;
  highlight?: boolean;
};

type HeroGroupData = {
  label: string;
  propertyLabel: string;
  propertyValue: string;
  helpText?: string;
};

type HeroBranchData = {
  branchId: string;
  title: string;
  tone: AccentTone;
  blocks: HeroBlock[];
  branchProperty?: {
    label: string;
    value: string;
  };
  helpText?: string;
  featured?: boolean;
};

type HeroGroupNode = Node<HeroGroupData, "heroGroup">;
type HeroBranchNode = Node<HeroBranchData, "heroBranch">;
type HeroFlowNode = HeroGroupNode | HeroBranchNode;

const accentStyles: Record<AccentTone, { color: string; shadow: string }> = {
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
  heroGroup: HeroGroupNodeView as NodeTypes["default"],
  heroBranch: HeroBranchNodeView as NodeTypes["default"],
};

const heroNodes: HeroFlowNode[] = [
  {
    id: "group-1",
    type: "heroGroup",
    position: { x: 360, y: 36 },
    width: 980,
    height: 332,
    data: {
      label: "group-1",
      propertyLabel: "ambientTemperature",
      propertyValue: "8 C",
      helpText:
        "Groups are for defining properties that are shared by multiple branches. E.g. ambient temperature",
    },
  },
  {
    id: "branch-1",
    type: "heroBranch",
    position: { x: 210, y: 64 },
    parentId: "group-1",
    extent: "parent",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      branchId: "branch-1",
      title: "Feed A",
      tone: "foam",
      blocks: [
        {
          type: "Source",
          detail: "Q 1 kg/s",
        },
      ],
    },
  },
  {
    id: "branch-4",
    type: "heroBranch",
    position: { x: 210, y: 202 },
    parentId: "group-1",
    extent: "parent",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      branchId: "branch-4",
      title: "Feed B",
      tone: "pine",
      branchProperty: {
        label: "diameter",
        value: "0.8 m",
      },
      blocks: [
        {
          type: "Source",
          detail: "P 15.5 bar | Q 3 kg/s",
          highlight: true,
        },
      ],
      helpText:
        "This branch contains the selected Source block. Its pressure resolves from block scope, while diameter resolves from branch scope.",
      featured: true,
    },
  },
  {
    id: "branch-2",
    type: "heroBranch",
    position: { x: 500, y: 106 },
    parentId: "group-1",
    extent: "parent",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      branchId: "branch-2",
      title: "Junction",
      tone: "iris",
      blocks: [
        {
          type: "Pipe",
          detail: "split weights 1:3",
        },
      ],
      helpText:
        "This junction uses outgoing edge weights to split the combined upstream flow before downstream propagation continues.",
    },
  },
  {
    id: "branch-3",
    type: "heroBranch",
    position: { x: 760, y: 48 },
    parentId: "group-1",
    extent: "parent",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      branchId: "branch-3",
      title: "Delivery",
      tone: "foam",
      blocks: [
        {
          type: "Pipe",
          detail: "Q 1 kg/s",
        },
      ],
    },
  },
  {
    id: "branch-8",
    type: "heroBranch",
    position: { x: 500, y: 226 },
    parentId: "group-1",
    extent: "parent",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      branchId: "branch-8",
      title: "Feed C",
      tone: "gold",
      blocks: [
        {
          type: "Source",
          detail: "Q 2 kg/s",
        },
      ],
    },
  },
  {
    id: "branch-5",
    type: "heroBranch",
    position: { x: 760, y: 222 },
    parentId: "group-1",
    extent: "parent",
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: {
      branchId: "branch-5",
      title: "Blend",
      tone: "rose",
      blocks: [
        {
          type: "Pipe",
          detail: "Q 5 kg/s",
          highlight: true,
        },
      ],
      helpText:
        "branch-5 receives 3 kg/s from the weighted split plus 2 kg/s from Feed C, so the merged downstream flow is 5 kg/s.",
    },
  },
];

const edgeLabelStyle = {
  fill: "var(--foreground)",
  fontSize: 9,
  fontWeight: 700,
};

function makeFlowEdge({
  id,
  source,
  target,
  label,
  tone,
  animated = false,
}: {
  id: string;
  source: string;
  target: string;
  label: string;
  tone: AccentTone;
  animated?: boolean;
}): Edge {
  const accent = accentStyles[tone].color;

  return {
    id,
    source,
    target,
    label,
    type: "smoothstep",
    animated,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: accent,
      strokeWidth: 1.7,
    },
    labelStyle: edgeLabelStyle,
    labelShowBg: true,
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 999,
    labelBgStyle: {
      fill: "color-mix(in oklch, var(--card) 94%, transparent)",
      stroke: `color-mix(in oklch, ${accent} 24%, var(--border))`,
      strokeWidth: 1,
    },
  };
}

const heroEdges: Edge[] = [
  makeFlowEdge({
    id: "branch-1-branch-2",
    source: "branch-1",
    target: "branch-2",
    label: "1 kg/s",
    tone: "foam",
    animated: true,
  }),
  makeFlowEdge({
    id: "branch-4-branch-2",
    source: "branch-4",
    target: "branch-2",
    label: "3 kg/s",
    tone: "pine",
    animated: true,
  }),
  makeFlowEdge({
    id: "branch-2-branch-3",
    source: "branch-2",
    target: "branch-3",
    label: "w=1 | 1 kg/s",
    tone: "foam",
    animated: true,
  }),
  makeFlowEdge({
    id: "branch-2-branch-5",
    source: "branch-2",
    target: "branch-5",
    label: "w=3 | 3 kg/s",
    tone: "iris",
    animated: true,
  }),
  makeFlowEdge({
    id: "branch-8-branch-5",
    source: "branch-8",
    target: "branch-5",
    label: "2 kg/s",
    tone: "gold",
    animated: true,
  }),
];

export function HomeHero() {
  const theme = useTheme((state) => state.theme);
  const colorMode = theme === "dark" ? "dark" : "light";
  const [nodes, , onNodesChange] = useNodesState(heroNodes);
  const [edges] = useEdgesState(heroEdges);

  return (
    <TooltipProvider>
      <section className="relative overflow-hidden border border-border bg-card">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--rose-pine-foam)_18%,transparent),transparent_38%),radial-gradient(circle_at_right,color-mix(in_oklch,var(--rose-pine-iris)_14%,transparent),transparent_32%),linear-gradient(180deg,color-mix(in_oklch,var(--card)_92%,transparent),color-mix(in_oklch,var(--background)_84%,transparent))]" />

        <div className="relative h-[420px]">
          <div className="absolute inset-0">
            <ReactFlow<HeroFlowNode, Edge>
              nodes={nodes}
              edges={edges}
              nodeTypes={heroNodeTypes}
              colorMode={colorMode}
              onNodesChange={onNodesChange}
              fitView
              fitViewOptions={{ padding: 0.16, minZoom: 0.66 }}
              nodesDraggable
              nodesConnectable={false}
              nodesFocusable
              elementsSelectable
              zoomOnDoubleClick
              zoomOnPinch
              zoomOnScroll
              panOnDrag
              panOnScroll={false}
              preventScrolling
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1.1} color="var(--border)" />
              <Controls showInteractive={false} position="bottom-right" />
            </ReactFlow>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-[linear-gradient(180deg,transparent,color-mix(in_oklch,var(--card)_96%,transparent))]" />
        </div>
      </section>
    </TooltipProvider>
  );
}

function HeroGroupNodeView({ data, width, height }: NodeProps<HeroGroupNode>) {
  return (
    <div
      className="overflow-hidden rounded-[1.9rem] border border-dashed border-primary/35 bg-card/20 p-4 shadow-[inset_0_1px_0_color-mix(in_oklch,var(--primary)_12%,transparent)] backdrop-blur-[2px]"
      style={{ width: width ?? "100%", height: height ?? "100%" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Group scope
            {data.helpText ? <NodeTooltip text={data.helpText} /> : null}
          </div>
          <div className="mt-1 text-sm font-semibold text-foreground">
            {data.label}
          </div>
        </div>

        <div className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[9px] font-mono text-foreground">
          {data.propertyLabel} = {data.propertyValue}
        </div>
      </div>
    </div>
  );
}

function HeroBranchNodeView({ data }: NodeProps<HeroBranchNode>) {
  const accent = accentStyles[data.tone];

  return (
    <div
      className={cn(
        "relative rounded-[1.2rem] border px-3 py-2.5 backdrop-blur-sm",
        data.featured ? "min-w-[184px]" : "min-w-[164px]",
        data.featured && "ring-2 ring-primary/20",
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
        className="h-3! w-3! border-0!"
        style={{
          background: accent.color,
          boxShadow: "0 0 0 2px var(--card)",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="h-3! w-3! border-0!"
        style={{
          background: accent.color,
          boxShadow: "0 0 0 2px var(--card)",
        }}
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
            {data.branchId}
            {data.helpText ? <NodeTooltip text={data.helpText} /> : null}
          </div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">
            {data.title}
          </div>
        </div>

        {data.branchProperty ? (
          <div className="rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] font-mono text-foreground">
            {data.branchProperty.label} {data.branchProperty.value}
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 space-y-1.5">
        {data.blocks.map((block) => (
          <div
            key={`${data.branchId}-${block.type}-${block.detail ?? "block"}`}
            className={cn(
              "rounded-lg border border-border/60 bg-background/60 px-1 py-1.5 text-[10px]",
              block.highlight && "border-primary/45 bg-background/88",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground">{block.type}</span>
              {block.detail ? (
                <span className="font-mono text-[9px] text-muted-foreground">
                  {block.detail}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NodeTooltip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex size-4 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Show explanation"
        >
          <CircleHelp className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-64 leading-5">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
