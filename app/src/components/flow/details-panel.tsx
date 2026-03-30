import { useSearch } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";

import { useHydrated } from "@/hooks/use-hydrated";
import { edgesCollection, nodesCollection } from "@/lib/collections/flow";
import {
  buildTomlBlockObject,
  buildTomlNodeObject,
} from "@/lib/exporters/network-toml";
import {
  normalizeFlowSelectionQuery,
  resolveFlowSelection,
} from "@/lib/flow-selection";
import type { FlowResolvedSelection } from "@/lib/flow-selection";
import { BranchDetailsPanel } from "@/components/flow/branch/details-panel";
import { BlockDetailsPanel } from "@/components/flow/block/details-panel";
import { GroupDetailsPanel } from "@/components/flow/group/details-panel";

export function DetailsPanel() {
  const watchSearch = useSearch({
    from: "/network/watch",
    shouldThrow: false,
  });
  const hydrated = useHydrated();
  const selectedQuery = normalizeFlowSelectionQuery(watchSearch?.selected);

  if (!watchSearch) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Open the network editor to inspect flow details.
      </p>
    );
  }

  if (!hydrated) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Loading details...
      </p>
    );
  }

  return <HydratedDetailsPanelContent selectedQuery={selectedQuery} />;
}

function buildBranchDetailsValue(
  selection: Extract<FlowResolvedSelection, { kind: "branch" }>,
  outgoing: Array<{ target: string; weight: number }>,
): Record<string, unknown> {
  const branchValue = buildTomlNodeObject(selection.node, outgoing);
  const derivedEntries = Object.entries(selection.node.data as Record<string, unknown>)
    .filter(([key]) => key !== "id" && key !== "label" && key !== "blocks");

  if (derivedEntries.length === 0) {
    return branchValue;
  }

  return {
    ...branchValue,
    ...Object.fromEntries(derivedEntries),
  };
}

function HydratedDetailsPanelContent({
  selectedQuery,
}: {
  selectedQuery?: string;
}) {
  const { data: nodes = [] } = useLiveQuery(nodesCollection);
  const { data: edges = [] } = useLiveQuery(edgesCollection);
  const selection = useMemo(
    () => resolveFlowSelection(selectedQuery, nodes),
    [nodes, selectedQuery],
  );

  if (nodes.length === 0) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Watch a network directory to inspect properties.
      </p>
    );
  }

  if (!selectedQuery) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        Select a branch, group, or block to view its properties.
      </p>
    );
  }

  if (!selection) {
    return (
      <p className="px-4 py-3 text-xs text-muted-foreground">
        The selected query does not resolve to an item in the current network.
      </p>
    );
  }

  switch (selection.kind) {
    case "branch": {
      const outgoing = edges
        .filter((edge) => edge.source === selection.node.id)
        .map((edge) => ({
          target: edge.target,
          weight: edge.data.weight,
        }));

      return (
        <BranchDetailsPanel
          selection={selection}
          value={buildBranchDetailsValue(selection, outgoing)}
        />
      );
    }
    case "group":
      return (
        <GroupDetailsPanel
          selection={selection}
          value={buildTomlNodeObject(selection.node)}
        />
      );
    case "block":
      return (
        <BlockDetailsPanel
          selection={selection}
          value={selection.block ? buildTomlBlockObject(selection.block) : null}
        />
      );
    case "unsupported":
      return (
        <div className="px-4 py-3 text-xs text-muted-foreground space-y-1">
          <p>This selection is valid, but there is no details panel for it yet.</p>
          <p className="font-mono break-all">{selection.query}</p>
        </div>
      );
  }
}
