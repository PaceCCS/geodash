import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import { ToyBrick } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const HEADER_HANDLE_TOP = 20;

function Root({
  children,
  nodeId,
  selected,
}: {
  children: ReactNode;
  nodeId: string;
  selected?: boolean;
}) {
  return (
    <div
      data-testid={`branch-node-${nodeId}`}
      className={cn(
        "bg-card text-card-foreground border border-border rounded-lg shadow-sm pt-2 pb-0.5 min-w-[200px]",
        selected && "ring-2 ring-primary",
      )}
    >
      {children}
    </div>
  );
}

function ConnectionHandle({ type }: { type: "source" | "target" }) {
  return (
    <Handle
      type={type}
      position={type === "target" ? Position.Left : Position.Right}
      style={{ top: HEADER_HANDLE_TOP }}
    />
  );
}

function Header({ title, blockCount }: { title: string; blockCount: number }) {
  return (
    <div className="flex items-center gap-2 mb-0.5 px-2.5 justify-between border-b border-border pb-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="flex items-center gap-2">
        <Badge className="text-xs rounded-full p-0.5 w-5 h-5 flex items-center justify-center">
          {blockCount}
        </Badge>
      </div>
    </div>
  );
}

function AddBlockButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="px-0.5">
      <button
        type="button"
        className="w-full rounded-md px-2 py-1 text-left text-xs flex items-center gap-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
      >
        <ToyBrick className="h-3 w-3 shrink-0" />
        <span>Add block</span>
      </button>
    </div>
  );
}

export const Branch = {
  Root,
  Handle: ConnectionHandle,
  Header,
  AddBlockButton,
};
