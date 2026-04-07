import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeHero } from "@/components/home/home-hero";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-3 py-3 md:gap-10 md:px-4 md:py-4">
        <HomeHero />

        <section className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:items-start">
          <div className="max-w-2xl space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
              Overview
            </p>
            <h2 className="text-3xl font-semibold tracking-tight">
              Geospatial tooling for editable networks, coordinate transforms,
              and file-based data workflows.
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              geodash brings together flow modelling, shapefile utilities, CRS
              reprojection, and dimensional analysis so you can move from raw
              spatial inputs to a navigable pipeline without bouncing between
              separate tools.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-1">
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Homepage Hero
              </div>
              <p className="mt-2 text-sm text-foreground">
                Static flow preview defined entirely in code.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Network Editing
              </div>
              <p className="mt-2 text-sm text-foreground">
                Directory-backed graph editing when you want the full canvas.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-4">
              <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                Spatial Data
              </div>
              <p className="mt-2 text-sm text-foreground">
                Shapefile inspection, reprojection, and unit-aware processing.
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Link
            to="/network/watch"
            search={{}}
            className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary"
          >
            <h2 className="text-xl font-bold">Network Editor</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Watch a directory of TOML network files. Visualise and edit the
              flow graph — changes are automatically written back to the files.
            </p>
          </Link>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-xl font-bold">Network Engine</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Directed acyclic graph engine for flow network modelling. Scope
              resolution, query system, and TOML-based configuration.
            </p>
          </div>

          <Link
            to="/shapefiles/watch"
            className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary"
          >
            <h2 className="text-xl font-bold">Shapefile Tools</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Read and write ESRI shapefiles (SHP, SHX, DBF). PointZ and
              PolyLineZ geometry types with a live directory-backed editor.
            </p>
          </Link>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-xl font-bold">CRS Reprojection</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Coordinate reference system transformation via PROJ. Convert
              between projected and geographic coordinate systems.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-xl font-bold">Unit-Aware Quantities</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Dimensional analysis powered by dim WASM. SI, Imperial, and CGS
              units with automatic conversion.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
