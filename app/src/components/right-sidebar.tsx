import { Info, Activity, PanelRightClose, PanelRightOpen } from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useRightSidebar } from "@/contexts/right-sidebar-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center px-4 py-2">
        <span className="text-sm font-semibold">Details</span>
      </div>
      <Separator />
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Info className="size-4 shrink-0" />
            Properties
          </div>
          <p className="text-xs text-muted-foreground">
            Select an item to view its properties.
          </p>
        </div>

        <Separator />

        <div className="flex flex-col gap-1 p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Activity className="size-4 shrink-0" />
            Activity Log
          </div>
          <p className="text-xs text-muted-foreground">No recent activity.</p>
        </div>
      </div>
    </div>
  );
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
