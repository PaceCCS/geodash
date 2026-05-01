import type { NodeProps } from "@xyflow/react";
import { useLiveQuery } from "@tanstack/react-db";
import type { BranchNodeData } from "@/lib/api-client";
import { useFlowSelection } from "@/components/flow/selection-context";
import { geoCollection } from "@/lib/collections/geo";
import { getSelectedBlockPath } from "@/lib/flow-selection";
import { FluidBranchBody, SchematicBranchBody } from "./branch-bodies";
import { BranchNodeProvider } from "./branch-context";
import { Branch } from "./branch-parts";

const branchBodies = {
  fluid: FluidBranchBody,
  schematic: SchematicBranchBody,
};

export function BranchNode({ data, selected }: NodeProps) {
  const nodeData = data as BranchNodeData;
  const { label, blocks } = nodeData;
  const { viewMode, selectedQuery, setSelectedQuery, onAddBlockToBranch } =
    useFlowSelection();
  const selectedBlock = getSelectedBlockPath(selectedQuery);
  const { data: geoBlocks = [] } = useLiveQuery(geoCollection);
  const Body = branchBodies[viewMode ?? "schematic"];

  return (
    <BranchNodeProvider
      value={{
        node: nodeData,
        blocks,
        geoBlocks,
        selectedBlock,
        selectBlock: (blockIndex) => {
          setSelectedQuery?.(`${nodeData.id}/blocks/${blockIndex}`);
        },
        addBlock: () => {
          onAddBlockToBranch?.(nodeData.id);
        },
      }}
    >
      <Branch.Root nodeId={nodeData.id} selected={selected}>
        <Branch.Handle type="target" />
        <Branch.Header
          title={label || nodeData.id}
          blockCount={blocks.length}
        />
        <Body />
        <Branch.Handle type="source" />
      </Branch.Root>
    </BranchNodeProvider>
  );
}
