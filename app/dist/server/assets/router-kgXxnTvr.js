import { createRootRoute, Outlet, HeadContent, Scripts, createFileRoute, lazyRouteComponent, createRouter } from "@tanstack/react-router";
import { jsx, jsxs } from "react/jsx-runtime";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useState, useMemo, useEffect, createContext, useCallback, useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
const appCss = "/assets/styles-DMhot9Ib.css";
let initPromise = null;
let runtime = null;
async function initDim() {
  if (!initPromise) {
    initPromise = (async () => {
      let bytes;
      const isNode = typeof process !== "undefined" && process.versions != null && process.versions.node != null;
      if (isNode) {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { fileURLToPath } = await import("node:url");
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = join(__filename, "..", "..", "..", "..");
        const wasmPath = join(__dirname, "public", "dim", "dim_wasm.wasm");
        const buf = await readFile(wasmPath);
        bytes = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength
        );
      } else {
        const res = await fetch("/dim/dim_wasm.wasm");
        bytes = await res.arrayBuffer();
      }
      let currentMemory = null;
      const wasiImports = {
        wasi_snapshot_preview1: {
          fd_write: (_fd, iovPtr, iovCnt, nwrittenPtr) => {
            if (!currentMemory) return 0;
            const dv = new DataView(currentMemory.buffer);
            let total = 0;
            for (let i = 0; i < iovCnt; i++) {
              const base = iovPtr + i * 8;
              const len = dv.getUint32(base + 4, true);
              total += len;
            }
            dv.setUint32(nwrittenPtr, total, true);
            return 0;
          },
          random_get: (bufPtr, bufLen) => {
            if (!currentMemory) return 0;
            const out = new Uint8Array(currentMemory.buffer, bufPtr, bufLen);
            const globalWithCrypto = globalThis;
            const cryptoObj = globalWithCrypto.crypto;
            if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
              cryptoObj.getRandomValues(out);
            } else {
              for (let i = 0; i < bufLen; i++) out[i] = 0;
            }
            return 0;
          },
          fd_close: () => 0,
          fd_seek: () => 0,
          fd_read: () => 0,
          fd_pread: () => 0,
          fd_pwrite: () => 0,
          fd_fdstat_get: () => 0,
          fd_filestat_get: () => 0,
          path_filestat_get: () => 0,
          fd_prestat_get: () => 0,
          fd_prestat_dir_name: () => 0,
          path_open: () => 0,
          environ_sizes_get: (countPtr, bufSizePtr) => {
            if (!currentMemory) return 0;
            const dv = new DataView(currentMemory.buffer);
            dv.setUint32(countPtr, 0, true);
            dv.setUint32(bufSizePtr, 0, true);
            return 0;
          },
          environ_get: () => 0,
          args_sizes_get: (argcPtr, argvBufSizePtr) => {
            if (!currentMemory) return 0;
            const dv = new DataView(currentMemory.buffer);
            dv.setUint32(argcPtr, 0, true);
            dv.setUint32(argvBufSizePtr, 0, true);
            return 0;
          },
          args_get: () => 0,
          clock_time_get: () => 0,
          proc_exit: (_code) => 0
        }
      };
      const result = await WebAssembly.instantiate(bytes, wasiImports);
      const inst = "instance" in result ? result.instance : result;
      currentMemory = inst.exports.memory;
      const types = Object.fromEntries(
        Object.entries(inst.exports).map(
          ([k, v]) => [k, typeof v]
        )
      );
      const required = [
        "memory",
        "dim_alloc",
        "dim_free",
        "dim_eval",
        "dim_define"
      ];
      for (const name of required) {
        const t = types[name];
        const expected = name === "memory" ? "object" : "function";
        if (t !== expected) {
          throw new Error(
            `dim wasm exports mismatch: expected ${name} to be ${expected}. Actual: ${JSON.stringify(types)}`
          );
        }
      }
      const {
        memory,
        dim_alloc,
        dim_free,
        dim_eval,
        dim_define,
        dim_clear,
        dim_clear_all
      } = inst.exports;
      runtime = {
        memory,
        dim_alloc,
        dim_free,
        dim_eval,
        dim_define,
        dim_clear,
        dim_clear_all,
        enc: new TextEncoder(),
        dec: new TextDecoder()
      };
    })();
  }
  return initPromise;
}
function writeUtf8(rt, str) {
  const bytes = rt.enc.encode(str);
  const ptr = rt.dim_alloc(bytes.length);
  new Uint8Array(rt.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}
function defineConstCore(rt, name, expr) {
  const n = writeUtf8(rt, name);
  const v = writeUtf8(rt, expr);
  const rc = rt.dim_define(n.ptr, n.len, v.ptr, v.len);
  rt.dim_free(n.ptr, n.len);
  rt.dim_free(v.ptr, v.len);
  if (rc !== 0) throw new Error("dim_define failed");
}
function defineConst(name, expr) {
  if (!runtime) {
    throw new Error("dim not initialized. Call initDim() first.");
  }
  defineConstCore(runtime, name, expr);
}
const DimContext = createContext({ ready: false });
function DimProvider(props) {
  const { constants, children } = props;
  const [ready, setReady] = useState(false);
  const constantsKey = useMemo(
    () => JSON.stringify(constants ?? []),
    [constants]
  );
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      await initDim();
      if (constants && constants.length > 0) {
        for (const c of constants) {
          defineConst(c.name, c.expr);
        }
      }
      if (!cancelled) setReady(true);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [constantsKey]);
  return /* @__PURE__ */ jsx(DimContext.Provider, { value: { ready }, children });
}
function cn(...inputs) {
  return twMerge(clsx(inputs));
}
const Dialog = DialogPrimitive.Root;
const DialogPortal = DialogPrimitive.Portal;
const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
  DialogPrimitive.Overlay,
  {
    ref,
    className: cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    ),
    ...props
  }
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;
const DialogContent = React.forwardRef(({ className, children, showCloseButton = true, ...props }, ref) => /* @__PURE__ */ jsxs(DialogPortal, { children: [
  /* @__PURE__ */ jsx(DialogOverlay, {}),
  /* @__PURE__ */ jsxs(
    DialogPrimitive.Content,
    {
      ref,
      className: cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      ),
      ...props,
      children: [
        children,
        showCloseButton && /* @__PURE__ */ jsxs(DialogPrimitive.Close, { className: "absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground", children: [
          /* @__PURE__ */ jsx(XIcon, { className: "h-4 w-4" }),
          /* @__PURE__ */ jsx("span", { className: "sr-only", children: "Close" })
        ] })
      ]
    }
  )
] }));
DialogContent.displayName = DialogPrimitive.Content.displayName;
const DialogHeader = ({
  className,
  ...props
}) => /* @__PURE__ */ jsx(
  "div",
  {
    className: cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    ),
    ...props
  }
);
DialogHeader.displayName = "DialogHeader";
const DialogTitle = React.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
  DialogPrimitive.Title,
  {
    ref,
    className: cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    ),
    ...props
  }
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;
const DialogDescription = React.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ jsx(
  DialogPrimitive.Description,
  {
    ref,
    className: cn("text-sm text-muted-foreground", className),
    ...props
  }
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
const DialogContext = createContext(null);
function DialogProvider({
  children
}) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState(null);
  const [options, setOptions] = useState();
  const close = useCallback(() => setOpen(false), []);
  const openDialogInternal = useCallback(
    (c, opts) => {
      setContent(() => c);
      setOptions(opts);
      setOpen(true);
    },
    []
  );
  const value = useMemo(
    () => ({ open: openDialogInternal, close, isOpen: open }),
    [openDialogInternal, close, open]
  );
  useEffect(() => {
    return () => {
    };
  }, [value]);
  return /* @__PURE__ */ jsxs(DialogContext.Provider, { value, children: [
    children,
    /* @__PURE__ */ jsx(Dialog, { open, onOpenChange: (v) => v ? setOpen(true) : close(), children: /* @__PURE__ */ jsxs(
      DialogContent,
      {
        showCloseButton: options?.showCloseButton ?? true,
        className: cn("lg:max-w-4xl", options?.className),
        children: [
          options?.title || options?.description ? /* @__PURE__ */ jsxs(DialogHeader, { className: "", children: [
            options?.title ? /* @__PURE__ */ jsx(DialogTitle, { children: options.title }) : null,
            options?.description ? /* @__PURE__ */ jsx(DialogDescription, { children: options.description }) : null
          ] }) : null,
          typeof content === "function" ? content({ close }) : content
        ]
      }
    ) })
  ] });
}
function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}
function normalizeShortcut(shortcut) {
  const tokens = shortcut.split("+").map((t) => t.trim()).filter(Boolean);
  let ctrlKey = false;
  let metaKey = false;
  let altKey = false;
  let shiftKey = false;
  let keyToken = "";
  for (const tokenRaw of tokens) {
    const token = tokenRaw.toLowerCase();
    if (token === "mod") {
      if (isMacPlatform()) metaKey = true;
      else ctrlKey = true;
    } else if (token === "cmd" || token === "meta") {
      metaKey = true;
    } else if (token === "ctrl" || token === "control") {
      ctrlKey = true;
    } else if (token === "alt" || token === "option") {
      altKey = true;
    } else if (token === "shift") {
      shiftKey = true;
    } else {
      keyToken = tokenRaw;
    }
  }
  return { key: keyToken, ctrlKey, metaKey, altKey, shiftKey };
}
function eventMatchesShortcut(e, shortcut) {
  const s = normalizeShortcut(shortcut);
  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const shortcutKey = s.key.length === 1 ? s.key.toLowerCase() : s.key;
  return !!s.ctrlKey === !!e.ctrlKey && !!s.metaKey === !!e.metaKey && !!s.altKey === !!e.altKey && !!s.shiftKey === !!e.shiftKey && (shortcutKey === "" || eventKey === shortcutKey);
}
const KeybindContext = createContext(null);
function KeybindProvider({
  children
}) {
  const [isCommandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const toggleCommandPalette = useCallback(
    () => setCommandPaletteOpen((v) => !v),
    []
  );
  const keybindsRef = useRef([]);
  const [commands, setCommands] = useState([]);
  const bind = useCallback(
    (shortcut, handler, options) => {
      const reg = {
        shortcut,
        handler,
        options: {
          preventDefault: options?.preventDefault ?? true,
          stopPropagation: options?.stopPropagation ?? false,
          priority: options?.priority ?? 0,
          enabled: options?.enabled
        }
      };
      keybindsRef.current = [...keybindsRef.current, reg].sort(
        (a, b) => b.options.priority - a.options.priority
      );
      return () => {
        keybindsRef.current = keybindsRef.current.filter((r) => r !== reg);
      };
    },
    []
  );
  const registerCommand = useCallback(
    (command) => {
      setCommands((prev) => {
        if (prev.some((c) => c.id === command.id)) return prev;
        return [...prev, command];
      });
      let unbind;
      if (command.shortcut) {
        unbind = bind(command.shortcut, () => {
          command.run({
            open: () => setCommandPaletteOpen(true),
            close: () => setCommandPaletteOpen(false),
            toggle: toggleCommandPalette
          });
        });
      }
      return () => {
        setCommands((prev) => prev.filter((c) => c.id !== command.id));
        if (unbind) unbind();
      };
    },
    [bind, toggleCommandPalette]
  );
  useEffect(() => {
    const onKeyDown = (e) => {
      for (let i = 0; i < keybindsRef.current.length; i++) {
        const reg = keybindsRef.current[i];
        const enabled = typeof reg.options.enabled === "function" ? reg.options.enabled() : reg.options.enabled ?? true;
        if (!enabled) continue;
        if (eventMatchesShortcut(e, reg.shortcut)) {
          if (reg.options.preventDefault) e.preventDefault();
          if (reg.options.stopPropagation) e.stopPropagation();
          reg.handler(e);
          break;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const unbind = bind(
      "Mod+J",
      () => {
        toggleCommandPalette();
      },
      { preventDefault: true, priority: 10 }
    );
    return () => unbind();
  }, [bind, toggleCommandPalette]);
  const value = useMemo(
    () => ({
      bind,
      registerCommand,
      commands,
      isCommandPaletteOpen,
      setCommandPaletteOpen,
      toggleCommandPalette
    }),
    [
      bind,
      registerCommand,
      commands,
      isCommandPaletteOpen,
      toggleCommandPalette
    ]
  );
  return /* @__PURE__ */ jsx(KeybindContext.Provider, { value, children });
}
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1e3 * 60 * 5,
      refetchOnWindowFocus: false
    }
  }
});
const Route$2 = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8"
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1"
      },
      {
        title: "geodash",
        description: "Geospatial pipeline data tools"
      }
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss
      }
    ]
  }),
  component: RootComponent
});
function RootComponent() {
  return /* @__PURE__ */ jsx(QueryClientProvider, { client: queryClient, children: /* @__PURE__ */ jsx(DimProvider, { children: /* @__PURE__ */ jsx(RootDocument, { children: /* @__PURE__ */ jsx(DialogProvider, { children: /* @__PURE__ */ jsx(KeybindProvider, { children: /* @__PURE__ */ jsx(Outlet, {}) }) }) }) }) });
}
function RootDocument({ children }) {
  return /* @__PURE__ */ jsxs("html", { lang: "en", className: "h-full", children: [
    /* @__PURE__ */ jsxs("head", { children: [
      /* @__PURE__ */ jsx(HeadContent, {}),
      /* @__PURE__ */ jsx(
        "script",
        {
          dangerouslySetInnerHTML: {
            __html: `
              if (typeof global === 'undefined') {
                var global = globalThis;
              }
            `
          }
        }
      )
    ] }),
    /* @__PURE__ */ jsxs("body", { className: "h-full", children: [
      /* @__PURE__ */ jsx("div", { className: "flex flex-col w-full h-screen border border-brand-grey-3 bg-brand-white p-px text-brand-blue-3", children }),
      /* @__PURE__ */ jsx(Scripts, {})
    ] })
  ] });
}
const $$splitComponentImporter$1 = () => import("./index-DqUMsXMr.js");
const Route$1 = createFileRoute("/")({
  component: lazyRouteComponent($$splitComponentImporter$1, "component")
});
const $$splitComponentImporter = () => import("./watch-CHQldIZX.js");
const Route = createFileRoute("/network/watch")({
  component: lazyRouteComponent($$splitComponentImporter, "component")
});
const IndexRoute = Route$1.update({
  id: "/",
  path: "/",
  getParentRoute: () => Route$2
});
const NetworkWatchRoute = Route.update({
  id: "/network/watch",
  path: "/network/watch",
  getParentRoute: () => Route$2
});
const rootRouteChildren = {
  IndexRoute,
  NetworkWatchRoute
};
const routeTree = Route$2._addFileChildren(rootRouteChildren)._addFileTypes();
const getRouter = () => {
  const router2 = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0
  });
  return router2;
};
const router = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  getRouter
}, Symbol.toStringTag, { value: "Module" }));
export {
  cn as c,
  router as r
};
