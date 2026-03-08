import { jsxs, jsx, Fragment } from "react/jsx-runtime";
import { createCollection, localStorageCollectionOptions, useLiveQuery } from "@tanstack/react-db";
import * as React from "react";
import { forwardRef, createContext, useContext, useRef, useCallback, useState, useEffect, useMemo } from "react";
import { Save, EyeOff, FolderOpen } from "lucide-react";
import { Handle, Position, Panel, applyNodeChanges, applyEdgeChanges, addEdge, ReactFlow, Background, Controls, MiniMap } from "@xyflow/react";
import * as TOML from "@iarna/toml";
import { c as cn } from "./router-BWEU4qR2.js";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import "@tanstack/react-router";
import "@tanstack/react-query";
import "@radix-ui/react-dialog";
import "clsx";
import "tailwind-merge";
function getNodeZIndex(nodeType) {
  switch (nodeType) {
    case "geographicWindow":
    case "geographicAnchor":
      return -2;
    case "image":
      return -1;
    default:
      return 0;
  }
}
function sortNodesWithParentsFirst(nodes) {
  const nodeMap = /* @__PURE__ */ new Map();
  const sorted = [];
  const visited = /* @__PURE__ */ new Set();
  nodes.forEach((node) => nodeMap.set(node.id, node));
  const addNode = (node) => {
    if (visited.has(node.id)) return;
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent) addNode(parent);
    }
    sorted.push({
      ...node,
      zIndex: node.zIndex ?? getNodeZIndex(node.type)
    });
    visited.add(node.id);
  };
  nodes.forEach((node) => addNode(node));
  return sorted;
}
const nodesCollection = createCollection(
  localStorageCollectionOptions({
    id: "flow:nodes",
    storageKey: "flow:nodes",
    getKey: (node) => node.id
  })
);
const edgesCollection = createCollection(
  localStorageCollectionOptions({
    id: "flow:edges",
    storageKey: "flow:edges",
    getKey: (edge) => edge.id
  })
);
function writeNodesToCollection(updated) {
  const prevKeys = new Set(Array.from(nodesCollection.keys()));
  const updatedKeys = new Set(updated.map((n) => n.id));
  const toDelete = [];
  prevKeys.forEach((k) => {
    if (!updatedKeys.has(k)) toDelete.push(k);
  });
  if (toDelete.length) nodesCollection.delete(toDelete);
  updated.forEach((node) => {
    if (nodesCollection.has(node.id)) {
      nodesCollection.update(node.id, (draft) => {
        Object.assign(draft, node);
      });
    } else {
      nodesCollection.insert(node);
    }
  });
}
function writeEdgesToCollection(updated) {
  const prevKeys = new Set(Array.from(edgesCollection.keys()));
  const updatedKeys = new Set(updated.map((e) => e.id));
  const toDelete = [];
  prevKeys.forEach((k) => {
    if (!updatedKeys.has(k)) toDelete.push(k);
  });
  if (toDelete.length) edgesCollection.delete(toDelete);
  updated.forEach((edge) => {
    if (edgesCollection.has(edge.id)) {
      edgesCollection.update(edge.id, (draft) => {
        Object.assign(draft, edge);
      });
    } else {
      edgesCollection.insert(edge);
    }
  });
}
async function resetFlowToNetwork(network) {
  await Promise.all([nodesCollection.preload(), edgesCollection.preload()]);
  const edgeKeys = Array.from(edgesCollection.keys());
  if (edgeKeys.length) {
    const tx = edgesCollection.delete(edgeKeys);
    await tx.isPersisted.promise;
  }
  const nodeKeys = Array.from(nodesCollection.keys());
  if (nodeKeys.length) {
    const tx = nodesCollection.delete(nodeKeys);
    await tx.isPersisted.promise;
  }
  const flowNodes = network.nodes.map((node) => ({
    ...node,
    width: node.width ?? void 0,
    height: node.height ?? void 0,
    parentId: node.parentId ?? void 0,
    extent: node.extent === "parent" ? "parent" : void 0,
    draggable: node.type !== "image",
    selectable: true,
    zIndex: getNodeZIndex(node.type)
  }));
  const validEdges = network.edges.filter((edge) => {
    const src = flowNodes.find((n) => n.id === edge.source);
    const tgt = flowNodes.find((n) => n.id === edge.target);
    return src?.type === "branch" && tgt?.type === "branch" && edge.source !== edge.target;
  });
  const sortedNodes = sortNodesWithParentsFirst(flowNodes);
  const nodesTx = nodesCollection.insert(sortedNodes);
  const edgesTx = edgesCollection.insert(validEdges);
  await Promise.all([nodesTx.isPersisted.promise, edgesTx.isPersisted.promise]);
}
const REACTFLOW_UI_PROPERTIES = [
  "draggable",
  "selectable",
  "selected",
  "zIndex",
  "focusable",
  "resizing",
  "style",
  "className"
];
function filterReactFlowProperties(node) {
  const filtered = { ...node };
  REACTFLOW_UI_PROPERTIES.forEach((prop) => {
    delete filtered[prop];
  });
  return filtered;
}
function toNetworkNode(node) {
  const filtered = filterReactFlowProperties(node);
  return {
    ...filtered,
    parentId: filtered.parentId ?? null,
    width: filtered.width ?? null,
    height: filtered.height ?? null
  };
}
function getDesktopApi() {
  if (typeof window !== "undefined" && window.desktop) {
    return window.desktop;
  }
  throw new Error("Desktop APIs are only available inside the Electron app.");
}
function isDesktop() {
  return typeof window !== "undefined" && window.desktop !== void 0;
}
async function pickNetworkDirectory() {
  return getDesktopApi().pickNetworkDirectory();
}
async function writeNetworkFile(path, content) {
  return getDesktopApi().writeNetworkFile(path, content);
}
async function startWatchingDirectory(path) {
  return getDesktopApi().startWatchingDirectory(path);
}
async function stopWatchingDirectory() {
  return getDesktopApi().stopWatchingDirectory();
}
function onFileChanged(listener) {
  if (!isDesktop()) {
    return () => {
    };
  }
  return getDesktopApi().onFileChanged(listener);
}
function serializeNodeToToml(node, outgoing) {
  const obj = { type: node.type };
  if (node.data.label) obj.label = node.data.label;
  if (node.parentId) obj.parentId = node.parentId;
  if (node.width != null) obj.width = node.width;
  if (node.height != null) obj.height = node.height;
  obj.position = { x: node.position.x, y: node.position.y };
  if (node.type === "branch") {
    if (outgoing && outgoing.length > 0) {
      obj.outgoing = outgoing;
    }
    if (node.data.blocks && node.data.blocks.length > 0) {
      obj.block = node.data.blocks.map((block) => {
        const blockObj = {};
        if (block.quantity !== void 0 && block.quantity !== 1) {
          blockObj.quantity = block.quantity;
        }
        blockObj.type = block.type;
        Object.keys(block).forEach((key) => {
          if (!["type", "quantity", "kind", "label"].includes(key)) {
            blockObj[key] = block[key];
          }
        });
        return blockObj;
      });
    }
  }
  if (node.type === "labeledGroup" || node.type === "geographicAnchor" || node.type === "geographicWindow") {
    Object.keys(node.data).forEach((key) => {
      if (key !== "id" && key !== "label" && node.data[key] != null) {
        obj[key] = node.data[key];
      }
    });
  }
  if (node.type === "image" && "path" in node.data) {
    obj.path = node.data.path;
  }
  return TOML.stringify(obj);
}
function buildTomlFiles(nodes, edges, directoryPath) {
  const edgesBySource = /* @__PURE__ */ new Map();
  edges.forEach((edge) => {
    if (!edgesBySource.has(edge.source)) edgesBySource.set(edge.source, []);
    edgesBySource.get(edge.source).push(edge);
  });
  const base = directoryPath.endsWith("/") ? directoryPath : `${directoryPath}/`;
  return nodes.map((node) => {
    const networkNode = toNetworkNode(node);
    const outgoing = networkNode.type === "branch" ? (edgesBySource.get(node.id) ?? []).map((edge) => ({
      target: edge.target,
      weight: edge.data.weight
    })) : void 0;
    return {
      path: `${base}${node.id}.toml`,
      content: serializeNodeToToml(networkNode, outgoing)
    };
  });
}
async function exportNetworkToToml(nodes, edges, directoryPath) {
  const files = buildTomlFiles(nodes, edges, directoryPath);
  await Promise.all(
    files.map(({ path, content }) => writeNetworkFile(path, content))
  );
}
function BranchNode({ data }) {
  const nodeData = data;
  const { label, blocks } = nodeData;
  return /* @__PURE__ */ jsxs("div", { className: "bg-white border border-brand-grey-3 rounded-lg shadow-sm p-3 min-w-[200px]", children: [
    /* @__PURE__ */ jsx(Handle, { type: "target", position: Position.Left }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-2", children: [
      /* @__PURE__ */ jsx("div", { className: "w-3 h-3 bg-brand-blue-1 rounded-full" }),
      /* @__PURE__ */ jsx("div", { className: "text-sm font-medium", children: label || nodeData.id })
    ] }),
    blocks && blocks.length > 0 && /* @__PURE__ */ jsxs("div", { className: "mt-2 pt-2 border-t border-brand-grey-3", children: [
      /* @__PURE__ */ jsxs("div", { className: "text-xs text-brand-grey-2 mb-1", children: [
        "Blocks (",
        blocks.length,
        ")"
      ] }),
      /* @__PURE__ */ jsx("div", { className: "space-y-1", children: blocks.map((block, index) => /* @__PURE__ */ jsxs("div", { className: "text-xs flex items-center gap-2", children: [
        /* @__PURE__ */ jsxs("span", { className: "text-brand-grey-2", children: [
          "×",
          block.quantity
        ] }),
        /* @__PURE__ */ jsx("span", { children: block.label })
      ] }, index)) })
    ] }),
    /* @__PURE__ */ jsx(Handle, { type: "source", position: Position.Right })
  ] });
}
const LabeledGroupNode = forwardRef(
  ({ data, selected, width, height }, ref) => {
    const { label } = data;
    return /* @__PURE__ */ jsx(
      "div",
      {
        ref,
        className: cn(
          "overflow-hidden bg-white/30 border border-brand-blue-1 p-0",
          selected && "ring-2 ring-brand-blue-1"
        ),
        style: { width: width ?? "100%", height: height ?? "100%" },
        children: /* @__PURE__ */ jsx(Panel, { className: "m-0 p-0", position: "top-left", children: label && /* @__PURE__ */ jsx("div", { className: "w-fit bg-brand-blue-1 px-1 text-xs text-brand-white", children: label }) })
      }
    );
  }
);
LabeledGroupNode.displayName = "LabeledGroupNode";
const GeographicAnchorNode = forwardRef(
  ({ selected, width, height }, ref) => /* @__PURE__ */ jsx(
    "div",
    {
      ref,
      className: cn(
        "overflow-hidden bg-white/30 border border-brand-blue-1 p-0",
        selected && "ring-2 ring-brand-blue-1"
      ),
      style: { width: width ?? "100%", height: height ?? "100%" },
      children: /* @__PURE__ */ jsx(Panel, { className: "m-0 p-0", position: "top-left", children: /* @__PURE__ */ jsx("div", { className: "w-fit bg-brand-blue-1 px-1 text-xs text-brand-white", children: "Geographic Anchor" }) })
    }
  )
);
GeographicAnchorNode.displayName = "GeographicAnchorNode";
const GeographicWindowNode = forwardRef(
  ({ selected, width, height }, ref) => /* @__PURE__ */ jsx(
    "div",
    {
      ref,
      className: cn(
        "overflow-hidden bg-white/30 border border-brand-blue-1 p-0",
        selected && "ring-2 ring-brand-blue-1"
      ),
      style: { width: width ?? "100%", height: height ?? "100%" },
      children: /* @__PURE__ */ jsx(Panel, { className: "m-0 p-0", position: "top-left", children: /* @__PURE__ */ jsx("div", { className: "w-fit bg-brand-blue-1 px-1 text-xs text-brand-white", children: "Geographic Window" }) })
    }
  )
);
GeographicWindowNode.displayName = "GeographicWindowNode";
const __vite_import_meta_env__ = {};
const DEFAULT_BACKEND_URL = "http://localhost:3001";
function getApiBaseUrl() {
  if (typeof import.meta !== "undefined" && __vite_import_meta_env__?.VITE_API_URL) {
    return void 0;
  }
  if (typeof process !== "undefined" && process.env.VITE_API_URL) {
    return process.env.VITE_API_URL;
  }
  if (typeof process !== "undefined" && process.env.BACKEND_URL) {
    return process.env.BACKEND_URL;
  }
  return DEFAULT_BACKEND_URL;
}
const NetworkContext = createContext(null);
function NetworkProvider({
  networkId,
  children
}) {
  const getAssetUrl = (relativePath) => {
    const encodedNetwork = encodeURIComponent(networkId);
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/api/network/assets/${relativePath}?network=${encodedNetwork}`;
  };
  return /* @__PURE__ */ jsx(NetworkContext.Provider, { value: { networkId, getAssetUrl }, children });
}
function useNetworkOptional() {
  return useContext(NetworkContext);
}
const ImageNode = forwardRef(
  ({ data, selected, width, height }, ref) => {
    const { label, path } = data;
    const network = useNetworkOptional();
    const imageUrl = network?.getAssetUrl(path);
    return /* @__PURE__ */ jsxs(
      "div",
      {
        ref,
        className: cn(
          "overflow-hidden bg-white border border-brand-blue-1",
          selected && "ring-2 ring-brand-blue-1"
        ),
        style: { width: width ?? "auto", height: height ?? "auto" },
        children: [
          label && /* @__PURE__ */ jsx(Panel, { className: "m-0 p-0", position: "top-left", children: /* @__PURE__ */ jsx("div", { className: "w-fit bg-brand-blue-1 px-1 text-xs text-brand-white", children: label }) }),
          imageUrl ? /* @__PURE__ */ jsx(
            "img",
            {
              src: imageUrl,
              alt: label || "Network image",
              className: "w-full h-full object-contain",
              style: { minWidth: width ?? 100, minHeight: height ?? 100 },
              onError: (e) => {
                const target = e.target;
                target.style.display = "none";
                const placeholder = document.createElement("div");
                placeholder.className = "flex items-center justify-center w-full h-full bg-brand-grey-4 text-brand-grey-2 text-sm p-4";
                placeholder.textContent = `Failed to load: ${path}`;
                target.parentElement?.appendChild(placeholder);
              }
            }
          ) : /* @__PURE__ */ jsx(
            "div",
            {
              className: "flex items-center justify-center w-full h-full bg-brand-grey-4 text-brand-grey-2 text-sm p-4",
              style: { minWidth: width ?? 100, minHeight: height ?? 100 },
              children: /* @__PURE__ */ jsx("div", { className: "text-center", children: /* @__PURE__ */ jsx("div", { className: "font-medium text-xs", children: path }) })
            }
          )
        ]
      }
    );
  }
);
ImageNode.displayName = "ImageNode";
const nodeTypes = {
  branch: BranchNode,
  labeledGroup: LabeledGroupNode,
  geographicAnchor: GeographicAnchorNode,
  geographicWindow: GeographicWindowNode,
  image: ImageNode
};
const SYNC_DEBOUNCE_MS = 300;
function FlowNetwork({ nodes, edges, syncDirectory }) {
  const syncTimer = useRef(void 0);
  const scheduleSyncToFiles = useCallback(
    (updatedNodes, updatedEdges) => {
      if (!syncDirectory) return;
      clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        exportNetworkToToml(updatedNodes, updatedEdges, syncDirectory).catch(
          (err) => console.error("[sync] Failed to write TOML:", err)
        );
      }, SYNC_DEBOUNCE_MS);
    },
    [syncDirectory]
  );
  const onNodesChange = useCallback(
    (changes) => {
      const updated = applyNodeChanges(changes, nodes);
      writeNodesToCollection(updated);
      scheduleSyncToFiles(updated, edges);
    },
    [nodes, edges, scheduleSyncToFiles]
  );
  const onEdgesChange = useCallback(
    (changes) => {
      const updated = applyEdgeChanges(changes, edges);
      writeEdgesToCollection(updated);
      scheduleSyncToFiles(nodes, updated);
    },
    [nodes, edges, scheduleSyncToFiles]
  );
  const onConnect = useCallback(
    (connection) => {
      const src = nodes.find((n) => n.id === connection.source);
      const tgt = nodes.find((n) => n.id === connection.target);
      if (!src || !tgt || src.type !== "branch" || tgt.type !== "branch" || connection.source === connection.target) {
        return;
      }
      const updated = addEdge(
        { ...connection, data: { weight: 1 } },
        edges
      );
      writeEdgesToCollection(updated);
      scheduleSyncToFiles(nodes, updated);
    },
    [nodes, edges, scheduleSyncToFiles]
  );
  return /* @__PURE__ */ jsx("div", { className: "h-full w-full", children: /* @__PURE__ */ jsxs(
    ReactFlow,
    {
      nodes,
      edges,
      onNodesChange,
      onEdgesChange,
      onConnect,
      nodeTypes,
      fitView: true,
      children: [
        /* @__PURE__ */ jsx(Background, {}),
        /* @__PURE__ */ jsx(Controls, {}),
        /* @__PURE__ */ jsx(MiniMap, {})
      ]
    }
  ) });
}
async function apiGet(path, query) {
  const baseUrl = getApiBaseUrl();
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== void 0) {
        url.searchParams.set(key, value);
      }
    }
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      body.message ?? body.error ?? `Failed to load data (${response.status})`
    );
  }
  return response.json();
}
async function getNetworkFromPath(networkIdentifier) {
  return apiGet("/api/network", {
    network: networkIdentifier
  });
}
function useFileWatcher() {
  const [watchMode, setWatchMode] = useState({
    enabled: false,
    directoryPath: null,
    isWatching: false
  });
  useEffect(() => {
    if (!watchMode.enabled || !watchMode.directoryPath) return;
    const unlisten = onFileChanged(async (changedPaths) => {
      console.log("[watch] External file change:", changedPaths);
      try {
        const network = await getNetworkFromPath(watchMode.directoryPath);
        await resetFlowToNetwork(network);
        console.log("[watch] Network reloaded from external file change");
      } catch (error) {
        console.error("[watch] Error reloading network:", error);
      }
    });
    return unlisten;
  }, [watchMode.enabled, watchMode.directoryPath]);
  const enableWatchMode = useCallback(async (directoryPath) => {
    await startWatchingDirectory(directoryPath);
    const network = await getNetworkFromPath(directoryPath);
    await resetFlowToNetwork(network);
    setWatchMode({ enabled: true, directoryPath, isWatching: true });
  }, []);
  const disableWatchMode = useCallback(async () => {
    await stopWatchingDirectory();
    setWatchMode({ enabled: false, directoryPath: null, isWatching: false });
  }, []);
  return { watchMode, enableWatchMode, disableWatchMode };
}
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return /* @__PURE__ */ jsx(
      Comp,
      {
        className: cn(buttonVariants({ variant, size, className })),
        ref,
        ...props
      }
    );
  }
);
Button.displayName = "Button";
function WatchPage() {
  const {
    watchMode,
    enableWatchMode,
    disableWatchMode
  } = useFileWatcher();
  const [isBusy, setIsBusy] = useState(false);
  const {
    data: nodesRaw = []
  } = useLiveQuery(nodesCollection);
  const {
    data: edges = []
  } = useLiveQuery(edgesCollection);
  const nodes = useMemo(() => sortNodesWithParentsFirst(nodesRaw), [nodesRaw]);
  const handleSelectDirectory = async () => {
    const path = await pickNetworkDirectory();
    if (!path) return;
    setIsBusy(true);
    try {
      await enableWatchMode(path);
    } catch (err) {
      console.error("[watch] Failed to enable watch mode:", err);
    } finally {
      setIsBusy(false);
    }
  };
  const handleStopWatching = async () => {
    setIsBusy(true);
    try {
      await disableWatchMode();
    } catch (err) {
      console.error("[watch] Failed to disable watch mode:", err);
    } finally {
      setIsBusy(false);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col h-full w-full min-h-0", children: [
    /* @__PURE__ */ jsx("div", { className: "flex items-center justify-between px-2 py-1 border-b border-brand-grey-3 shrink-0", children: watchMode.enabled ? /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("span", { className: "text-sm truncate max-w-[60%] text-brand-grey-2", children: watchMode.directoryPath }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
        /* @__PURE__ */ jsxs("span", { className: "text-xs text-brand-grey-2 mr-2", children: [
          /* @__PURE__ */ jsx(Save, { className: "inline w-3 h-3 mr-1" }),
          "Auto-saving"
        ] }),
        /* @__PURE__ */ jsxs(Button, { variant: "outline", size: "sm", onClick: handleStopWatching, disabled: isBusy, children: [
          /* @__PURE__ */ jsx(EyeOff, { className: "mr-1 h-3 w-3" }),
          "Stop Watching"
        ] })
      ] })
    ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
      /* @__PURE__ */ jsx("span", { className: "text-sm font-medium", children: "Watch Network Directory" }),
      /* @__PURE__ */ jsxs(Button, { size: "sm", onClick: handleSelectDirectory, disabled: isBusy, children: [
        /* @__PURE__ */ jsx(FolderOpen, { className: "mr-1 h-3 w-3" }),
        "Select Directory"
      ] })
    ] }) }),
    watchMode.enabled && watchMode.directoryPath ? /* @__PURE__ */ jsx("div", { className: "flex-1 min-h-0", children: /* @__PURE__ */ jsx(NetworkProvider, { networkId: watchMode.directoryPath, children: /* @__PURE__ */ jsx(FlowNetwork, { nodes, edges, syncDirectory: watchMode.directoryPath }) }) }) : /* @__PURE__ */ jsx("div", { className: "flex-1 flex items-center justify-center", children: /* @__PURE__ */ jsxs("div", { className: "text-center space-y-4", children: [
      /* @__PURE__ */ jsx(FolderOpen, { className: "h-16 w-16 mx-auto text-brand-grey-2" }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-semibold", children: "No Directory Selected" }),
        /* @__PURE__ */ jsxs("p", { className: "text-sm text-brand-grey-2 mt-2", children: [
          "Choose a directory containing TOML network files.",
          /* @__PURE__ */ jsx("br", {}),
          "Canvas edits are automatically written back to the files."
        ] })
      ] }),
      /* @__PURE__ */ jsxs(Button, { onClick: handleSelectDirectory, size: "lg", disabled: isBusy, children: [
        /* @__PURE__ */ jsx(FolderOpen, { className: "mr-2 h-4 w-4" }),
        "Select Directory"
      ] })
    ] }) })
  ] });
}
export {
  WatchPage as component
};
