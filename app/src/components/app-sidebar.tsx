import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Network, Wrench, Sun, Moon } from "lucide-react";

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

const navItems = [
  { title: "Home", to: "/", icon: Home },
  { title: "Network Editor", to: "/network/watch", icon: Network },
] as const;

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
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar side="left" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.to}
                    tooltip={item.title}
                  >
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Tools</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled tooltip="Coming soon">
                  <Wrench />
                  <span>Shapefile Tools</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
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
