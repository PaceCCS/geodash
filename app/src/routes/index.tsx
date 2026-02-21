import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="flex-1 min-h-0 w-full flex flex-col bg-brand-white overflow-y-auto">
      <section className="flex flex-col items-center justify-center p-8">
        <h1 className="text-3xl font-bold">geodash</h1>
        <p className="text-lg text-muted-foreground mt-2">
          Geospatial pipeline data tools
        </p>
      </section>

      <section className="flex flex-col gap-4 p-4 max-w-2xl mx-auto w-full">
        <Link
          to="/network/watch"
          className="border border-brand-grey-3 rounded-lg p-4 hover:border-brand-blue-1 transition-colors block"
        >
          <h2 className="text-xl font-bold">Network Editor</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Watch a directory of TOML network files. Visualise and edit the flow
            graph — changes are automatically written back to the files.
          </p>
        </Link>
        <div className="border border-brand-grey-3 rounded-lg p-4">
          <h2 className="text-xl font-bold">Network Engine</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Directed acyclic graph engine for flow network modelling. Scope
            resolution, query system, and TOML-based configuration.
          </p>
        </div>

        <div className="border border-brand-grey-3 rounded-lg p-4">
          <h2 className="text-xl font-bold">Shapefile Tools</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Read and write ESRI shapefiles (SHP, SHX, DBF). PointZ and
            PolyLineZ geometry types with KP computation.
          </p>
        </div>

        <div className="border border-brand-grey-3 rounded-lg p-4">
          <h2 className="text-xl font-bold">CRS Reprojection</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Coordinate reference system transformation via PROJ. Convert between
            projected and geographic coordinate systems.
          </p>
        </div>

        <div className="border border-brand-grey-3 rounded-lg p-4">
          <h2 className="text-xl font-bold">Unit-Aware Quantities</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Dimensional analysis powered by dim WASM. SI, Imperial, and CGS
            units with automatic conversion.
          </p>
        </div>
      </section>
    </div>
  );
}
