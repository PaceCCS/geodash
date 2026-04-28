import { Sun, Moon } from "lucide-react";

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

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label = theme === "light" ? "Dark mode" : "Light mode";

  useCommands([
    {
      id: "toggle-theme",
      label: theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode",
      run: (dialog) => {
        toggle();
        dialog.close();
      },
      group: "View",
      icon: theme === "light" ? <Moon /> : <Sun />,
    },
  ]);

  return (
    <SidebarMenuButton onClick={toggle} tooltip={label}>
      {theme === "light" ? <Moon /> : <Sun />}
      <span>{label}</span>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  return (
    <Sidebar side="left" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="px-2 py-2 text-sm text-sidebar-foreground/80 group-data-[collapsible=icon]:hidden">
              Sidebar content placeholder.
            </div>
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
