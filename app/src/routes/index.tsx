import { createFileRoute, Link } from "@tanstack/react-router";
import { HomeHero } from "@/components/home/home-hero";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-3 md:gap-6 md:px-4 md:py-4">
        <div className="max-w-2xl space-y-3">
          <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
            Overview
          </p>
          <h2 className="text-3xl font-semibold tracking-tight">
            Network hierarchy
          </h2>
          <p className="text-sm leading-7 text-muted-foreground m-0">
            Networks are represented as a directed acyclic graph (DAG). The
            elements of the graph are organized in a hierarchy of scopes, with
            each scope able to override the properties of the scopes above it.
          </p>
        </div>

        <HomeHero />

        <section className="grid grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-semibold">Global</h3>
            <p>
              The global scope is the foundation of the hierarchy. It contains
              the default properties for the network.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Group</h3>
            <p>
              Groups are containers for related branches. They can override the
              properties of the global scope.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Branch</h3>
            <p>
              Branches are containers for related blocks. They can override the
              properties of the group scope.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold">Block</h3>
            <p>
              Blocks are the smallest units in the hierarchy. They contain the
              properties for the block.
            </p>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 mt-4">
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
        </section>
      </div>
    </div>
  );
}
