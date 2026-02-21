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
              <Outlet />
            </KeybindProvider>
          </DialogProvider>
        </RootDocument>
      </DimProvider>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
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
        <div className="flex flex-col w-full h-screen border border-brand-grey-3 bg-brand-white p-px text-brand-blue-3">
          {children}
        </div>
        <Scripts />
      </body>
    </html>
  );
}
