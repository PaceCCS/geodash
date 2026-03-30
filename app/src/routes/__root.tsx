import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import appCss from "../styles.css?url";
import { DimProvider } from "@/contexts/dim-context";
import DialogProvider from "@/contexts/dialog-provider";
import KeybindProvider from "@/contexts/keybind-provider";
import {
  SidebarProvider,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";
import { RightSidebarProvider } from "@/contexts/right-sidebar-context";
import { RightSidebar, RightSidebarTrigger } from "@/components/right-sidebar";
import { HeaderSlotProvider, HeaderSlotTarget } from "@/components/header-slot";
import { cn } from "@/lib/utils";
import { GlobalCommandDialog } from "@/components/command-dialog";
import { useTheme } from "@/hooks/use-theme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
    },
  },
});

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
                    <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-sidebar px-2">
                      <LeftSidebarTrigger />
                      <GlobalCommandDialog />
                      <HeaderSlotTarget />
                      <RightSidebarTrigger />
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

function LeftSidebarTrigger({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { open, toggleSidebar } = useSidebar();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("size-7", className)}
      onClick={toggleSidebar}
      {...props}
    >
      {open ? <PanelLeftClose /> : <PanelLeftOpen />}
      <span className="sr-only">Toggle Left Sidebar</span>
    </Button>
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
