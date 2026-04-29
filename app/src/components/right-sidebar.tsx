import { Info, Activity, PanelRightClose, PanelRightOpen } from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useRightSidebar } from "@/contexts/right-sidebar-context";
import { useActivityLog } from "@/contexts/activity-log-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DetailsPanel } from "@/components/flow/details-panel";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

const RIGHT_SIDEBAR_WIDTH = "18rem";

export function RightSidebarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { open, toggle } = useRightSidebar();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={toggle}
      {...props}
    >
      {open ? <PanelRightClose /> : <PanelRightOpen />}
      <span className="sr-only">Toggle Right Sidebar</span>
    </Button>
  );
}

function RightSidebarContent() {
  const activityEntries = useActivityLog((state) => state.entries);

  return (
    <div className="flex h-full flex-col relative">
      <div className="flex items-center border-b border-border">
        <span className="text-sm font-semibold px-4 py-2">Status</span>
      </div>

      <div className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Evaluation status
        </p>
        <p className="mt-1 text-xs leading-5">
          After an operation is performed, the network will be evaluated and the
          status will be displayed here.
        </p>
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-sm font-medium px-4 py-2 border-b border-border">
          <Activity className="size-4 shrink-0" />
          Activity Log
        </div>
      </div>
      {activityEntries.length > 0 ? (
        <div className="max-h-64 overflow-auto">
          {activityEntries.map((entry, index) => (
            <div
              key={entry.id}
              className={cn(
                "px-4 py-3 border-b border-border/60 space-y-1",
                index === activityEntries.length - 1 && "border-b-0",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {entry.source}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatActivityTime(entry.timestamp)}
                </span>
              </div>
              <p className="text-xs leading-5">{entry.message}</p>
              {entry.kind === "reload" && entry.changedPaths?.length ? (
                <p className="text-[11px] text-muted-foreground break-all">
                  {entry.changedPaths.join(", ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          No recent activity.
        </p>
      )}
      <Separator />

      <div className="flex-1 overflow-auto relative">
        <div className="flex flex-col gap-1 border-b border-border">
          <div className="flex items-center gap-2 text-sm font-medium px-4 py-2">
            <Info className="size-4 shrink-0" />
            Properties
          </div>
        </div>
        <DetailsPanel />
      </div>
    </div>
  );
}

function formatActivityTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp);
}

export function RightSidebar() {
  const { open, setOpen } = useRightSidebar();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[18rem] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Details</SheetTitle>
            <SheetDescription>
              Properties and activity log panel.
            </SheetDescription>
          </SheetHeader>
          <RightSidebarContent />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div
      className="hidden md:block shrink-0 transition-[width] duration-200 ease-linear overflow-hidden border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={{ width: open ? RIGHT_SIDEBAR_WIDTH : 0 }}
    >
      <div
        className="h-full flex flex-col"
        style={{ width: RIGHT_SIDEBAR_WIDTH }}
      >
        <RightSidebarContent />
      </div>
    </div>
  );
}
