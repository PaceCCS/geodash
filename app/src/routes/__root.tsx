import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import appCss from "../styles.css?url";
import { DimProvider } from "@/contexts/dim-context";
import DialogProvider from "@/contexts/dialog-provider";
import KeybindProvider from "@/contexts/keybind-provider";
import {
  SidebarProvider,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { RightSidebarProvider } from "@/contexts/right-sidebar-context";
import { useRightSidebar } from "@/contexts/right-sidebar-context";
import { RightSidebar } from "@/components/right-sidebar";
import {
  HeaderSlotProvider,
  HeaderSlotTarget,
  useHeaderFileActions,
} from "@/components/header-slot";
import { DirectoryBrowserDialog } from "@/components/directory-browser-dialog";
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar";
import { cn } from "@/lib/utils";
import { GlobalCommandDialog } from "@/components/command-dialog";
import {
  formatShortcutForDisplay,
  useCommands,
} from "@/contexts/keybind-provider";
import type { CommandItem, DialogAPI } from "@/contexts/keybind-provider";
import { useTheme } from "@/hooks/use-theme";
import { queryClient } from "@/lib/query-client";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "geodash",
        description: "Geospatial pipeline data tools",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <QueryClientProvider client={queryClient}>
      <DimProvider>
        <RootDocument>
          <DialogProvider>
            <KeybindProvider>
              <SidebarProvider className="flex-col min-h-0! h-screen">
                <RightSidebarProvider>
                  <HeaderSlotProvider>
                    <header className="flex h-10 shrink-0 items-center border-b border-border bg-sidebar px-2">
                      <AppMenubar />
                    </header>
                    <div className="flex flex-1 min-h-0">
                      <AppSidebar />
                      <SidebarInset>
                        <div className="flex flex-1 min-h-0 w-full">
                          <div className="flex flex-col flex-1 min-w-0">
                            <Outlet />
                          </div>
                          <RightSidebar />
                        </div>
                      </SidebarInset>
                    </div>
                  </HeaderSlotProvider>
                </RightSidebarProvider>
              </SidebarProvider>
            </KeybindProvider>
          </DialogProvider>
        </RootDocument>
      </DimProvider>
    </QueryClientProvider>
  );
}

function AppMenubar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { actions } = useHeaderFileActions();
  const [isNetworkDirectoryBrowserOpen, setIsNetworkDirectoryBrowserOpen] =
    useState(false);
  const canClose = Boolean(actions.close) || pathname !== "/";

  const handleOpenDirectory = useCallback(() => {
    if (actions.openDirectory) {
      actions.openDirectory();
      return;
    }
    setIsNetworkDirectoryBrowserOpen(true);
  }, [actions]);

  const handleClose = useCallback(() => {
    if (actions.close) {
      actions.close();
      return;
    }
    void navigate({ to: "/" });
  }, [actions, navigate]);

  const fileCommands = useMemo<CommandItem[]>(() => {
    const commands: CommandItem[] = [
      {
        id: "open-directory",
        label: "Open Directory",
        run: (dialog: DialogAPI) => {
          handleOpenDirectory();
          dialog.close();
        },
        shortcut: pathname === "/shapefiles/watch" ? undefined : "Mod+O",
        group: "File",
      },
      {
        id: "open-shapefile",
        label: "Open Shapefile",
        run: (dialog: DialogAPI) => {
          if (actions.openShapefile) {
            actions.openShapefile();
          } else {
            void navigate({ to: "/shapefiles/watch" });
          }
          dialog.close();
        },
        shortcut: actions.openShapefile ? "Mod+O" : undefined,
        group: "File",
      },
    ];

    if (canClose) {
      commands.push({
        id: "close",
        label: "Close",
        run: (dialog: DialogAPI) => {
          handleClose();
          dialog.close();
        },
        group: "File",
      });
    }

    return commands;
  }, [
    actions.openShapefile,
    canClose,
    handleClose,
    handleOpenDirectory,
    navigate,
    pathname,
  ]);

  const { commands, runCommand } = useCommands(fileCommands);
  const menuGroups = useMemo(
    () =>
      ["File", "Edit", "View", "Run"]
        .map((group) => ({
          group,
          commands: commands.filter((command) => command.group === group),
        }))
        .filter((group) => group.commands.length > 0),
    [commands],
  );

  return (
    <>
      <Menubar className="h-8 w-full rounded-none border-0 bg-transparent p-0 shadow-none">
        {menuGroups.map(({ group, commands: groupCommands }) => (
          <MenubarMenu key={group}>
            <MenubarTrigger>{group}</MenubarTrigger>
            <MenubarContent>
              {groupCommands.map((command, index) => (
                <MenubarCommandItem
                  key={command.id}
                  command={command}
                  separatorBefore={command.id === "close" && index > 0}
                  onRun={runCommand}
                />
              ))}
            </MenubarContent>
          </MenubarMenu>
        ))}
        <GlobalCommandDialog />
        <HeaderSlotTarget className="justify-end" />
      </Menubar>
      <DirectoryBrowserDialog
        open={isNetworkDirectoryBrowserOpen}
        title="Select Network Directory"
        description="Browse to the folder containing your TOML network files. Large folders are rejected before watching starts."
        confirmLabel="Watch Directory"
        onOpenChange={setIsNetworkDirectoryBrowserOpen}
        onSelect={(directory) => {
          void navigate({
            to: "/network/watch",
            search: { directory },
          });
        }}
      />
    </>
  );
}

function MenubarCommandItem({
  command,
  separatorBefore,
  onRun,
}: {
  command: CommandItem;
  separatorBefore?: boolean;
  onRun: ReturnType<typeof useCommands>["runCommand"];
}) {
  const { open: leftOpen } = useSidebar();
  const { open: rightOpen } = useRightSidebar();
  const isCheckbox =
    command.id === "toggle-left-sidebar" ||
    command.id === "toggle-right-sidebar";
  const checked = command.id === "toggle-left-sidebar" ? leftOpen : rightOpen;
  const item = isCheckbox ? (
    <MenubarCheckboxItem
      checked={checked}
      onCheckedChange={() => void onRun(command)}
    >
      {command.icon}
      {command.label}
      {command.shortcut ? (
        <MenubarShortcut>
          {formatShortcutForDisplay(command.shortcut)}
        </MenubarShortcut>
      ) : null}
    </MenubarCheckboxItem>
  ) : (
    <MenubarItem onSelect={() => void onRun(command)}>
      {command.icon}
      {command.label}
      {command.shortcut ? (
        <MenubarShortcut>
          {formatShortcutForDisplay(command.shortcut)}
        </MenubarShortcut>
      ) : null}
    </MenubarItem>
  );

  return (
    <>
      {separatorBefore ? <MenubarSeparator /> : null}
      {item}
    </>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  const theme = useTheme((state) => state.theme);

  return (
    <html
      lang="en"
      className={cn("h-full", theme === "dark" && "dark")}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const storedTheme = localStorage.getItem('theme');
                const parsedTheme = storedTheme ? JSON.parse(storedTheme) : null;
                const theme = parsedTheme?.state?.theme === 'dark' ? 'dark' : 'light';
                document.documentElement.classList.toggle('dark', theme === 'dark');
              } catch {}
            `,
          }}
        />
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof global === 'undefined') {
                var global = globalThis;
              }
            `,
          }}
        />
      </head>
      <body className="h-full">
        <div className="w-full h-screen text-foreground">{children}</div>
        <Scripts />
      </body>
    </html>
  );
}
