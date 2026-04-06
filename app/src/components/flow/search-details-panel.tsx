import { Search } from "lucide-react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated } from "@/hooks/use-hydrated";
import {
  FLOW_EDITOR_QUERY_PARAM,
  normalizeFlowSelectionQuery,
} from "@/lib/flow-selection";
import { nodesCollection } from "@/lib/collections/flow";

export function SearchDetailsPanel() {
  const watchSearch = useSearch({
    from: "/network/watch",
    shouldThrow: false,
  });
  const hydrated = useHydrated();

  if (!watchSearch) {
    return (
      <div className="px-4 py-3 border-b border-border space-y-1">
        <p className="text-xs font-medium">Search</p>
        <p className="text-xs text-muted-foreground">
          Open the network editor to run a query path.
        </p>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="px-4 py-3 border-b border-border space-y-1">
        <p className="text-xs font-medium">Search</p>
        <p className="text-xs text-muted-foreground">
          Loading search...
        </p>
      </div>
    );
  }

  return (
    <HydratedSearchDetailsPanelContent selectedQuery={watchSearch.selected} />
  );
}

function HydratedSearchDetailsPanelContent({
  selectedQuery,
}: {
  selectedQuery?: string;
}) {
  const { data: nodes = [] } = useLiveQuery(nodesCollection);
  const navigate = useNavigate({ from: "/network/watch" });
  const [draftQuery, setDraftQuery] = useState(selectedQuery ?? "");
  const prevSelectedRef = useRef(selectedQuery);

  if (prevSelectedRef.current !== selectedQuery) {
    prevSelectedRef.current = selectedQuery;
    setDraftQuery(selectedQuery ?? "");
  }

  if (nodes.length === 0) {
    return (
      <div className="px-4 py-3 border-b border-border space-y-1">
        <p className="text-xs font-medium">Search</p>
        <p className="text-xs text-muted-foreground">
          Watch a network directory to run a query path.
        </p>
      </div>
    );
  }

  const submitQuery = () => {
    const nextSelected = normalizeFlowSelectionQuery(draftQuery);

    navigate({
      replace: true,
      search: (prev) => ({
        ...prev,
        selected: nextSelected,
      }),
    });
  };

  return (
    <div className="px-4 py-3 border-b border-border space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-medium">Search</p>
        <p className="text-xs text-muted-foreground">
          Enter a network query path like `branch-1` or `branch-1/blocks/0`.
        </p>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submitQuery();
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draftQuery}
            onChange={(event) => setDraftQuery(event.target.value)}
            placeholder="branch-1/blocks/0/type"
            className="pl-8 font-mono text-xs"
          />
        </div>
        <Button type="submit" size="sm">
          Go
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setDraftQuery("");
            navigate({
              replace: true,
              search: (prev) => ({
                ...prev,
                selected: undefined,
                [FLOW_EDITOR_QUERY_PARAM]: undefined,
              }),
            });
          }}
        >
          Clear
        </Button>
      </form>
    </div>
  );
}
