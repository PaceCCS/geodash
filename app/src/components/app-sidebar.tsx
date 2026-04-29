import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/use-theme";
import { useCommands } from "@/contexts/keybind-provider";
import { SidebarFileTree } from "@/components/sidebar-file-tree";
import { useWorkspaceSidebar } from "@/lib/stores/workspace-sidebar";

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const [hasMounted, setHasMounted] = useState(false);
  const displayTheme = hasMounted ? theme : "light";
  const label = displayTheme === "light" ? "Dark mode" : "Light mode";

  useEffect(() => {
    setHasMounted(true);
  }, []);

  useCommands([
    {
      id: "toggle-theme",
      label:
        displayTheme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode",
      run: (dialog) => {
        toggle();
        dialog.close();
      },
      group: "View",
      icon: displayTheme === "light" ? <Moon /> : <Sun />,
      separatorBefore: true,
      menuOrder: 1000,
    },
  ]);

  return (
    <SidebarMenuButton onClick={toggle} tooltip={label}>
      {displayTheme === "light" ? <Moon /> : <Sun />}
      <span>{label}</span>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const directory = useWorkspaceSidebar((state) => state.directory);

  return (
    <Sidebar side="left" collapsible="icon">
      <SidebarContent>
        <SidebarGroup className="min-h-0 flex-1">
          {directory ? null : <SidebarGroupLabel>Workspace</SidebarGroupLabel>}
          <SidebarGroupContent className="flex min-h-0 flex-1 flex-col">
            {directory ? (
              <SidebarFileTree directoryPath={directory.path} />
            ) : (
              <div className="px-2 py-2 text-sm text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden">
                Select a directory to browse its files.
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <ThemeToggle />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
