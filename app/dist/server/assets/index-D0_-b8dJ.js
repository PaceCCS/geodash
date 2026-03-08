import { jsxs, jsx } from "react/jsx-runtime";
import { Link } from "@tanstack/react-router";
function Home() {
  return /* @__PURE__ */ jsxs("div", { className: "flex-1 min-h-0 w-full flex flex-col bg-brand-white overflow-y-auto", children: [
    /* @__PURE__ */ jsxs("section", { className: "flex flex-col items-center justify-center p-8", children: [
      /* @__PURE__ */ jsx("h1", { className: "text-3xl font-bold", children: "geodash" }),
      /* @__PURE__ */ jsx("p", { className: "text-lg text-muted-foreground mt-2", children: "Geospatial pipeline data tools" })
    ] }),
    /* @__PURE__ */ jsxs("section", { className: "flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full", children: [
      /* @__PURE__ */ jsxs(Link, { to: "/network/watch", className: "border border-brand-grey-3 rounded-lg p-4 hover:border-brand-blue-1 transition-colors block", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-bold", children: "Network Editor" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-muted-foreground mt-1", children: "Watch a directory of TOML network files. Visualise and edit the flow graph — changes are automatically written back to the files." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "border border-brand-grey-3 rounded-lg p-4", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-bold", children: "Network Engine" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-muted-foreground mt-1", children: "Directed acyclic graph engine for flow network modelling. Scope resolution, query system, and TOML-based configuration." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "border border-brand-grey-3 rounded-lg p-4", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-bold", children: "Shapefile Tools" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-muted-foreground mt-1", children: "Read and write ESRI shapefiles (SHP, SHX, DBF). PointZ and PolyLineZ geometry types with KP computation." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "border border-brand-grey-3 rounded-lg p-4", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-bold", children: "CRS Reprojection" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-muted-foreground mt-1", children: "Coordinate reference system transformation via PROJ. Convert between projected and geographic coordinate systems." })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "border border-brand-grey-3 rounded-lg p-4", children: [
        /* @__PURE__ */ jsx("h2", { className: "text-xl font-bold", children: "Unit-Aware Quantities" }),
        /* @__PURE__ */ jsx("p", { className: "text-sm text-muted-foreground mt-1", children: "Dimensional analysis powered by dim WASM. SI, Imperial, and CGS units with automatic conversion." })
      ] })
    ] })
  ] });
}
export {
  Home as component
};
