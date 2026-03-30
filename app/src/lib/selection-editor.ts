import type {
  Block,
  NetworkConfigMetadata,
  NetworkValue,
  Position,
} from "@/lib/api-client";
import type {
  FlowBranchNode,
  FlowGroupNode,
  FlowNode,
} from "@/lib/collections/flow-nodes";
import type { FlowResolvedSelection } from "@/lib/flow-selection";

export type EditableFlowSelection = Extract<
  FlowResolvedSelection,
  { kind: "branch" | "group" | "block" }
>;

export function isEditableFlowSelection(
  selection: FlowResolvedSelection | undefined,
): selection is EditableFlowSelection {
  if (!selection) {
    return false;
  }

  if (selection.kind === "block") {
    return selection.block !== null;
  }

  return selection.kind === "branch" || selection.kind === "group";
}

export function getSelectionEditorTitle(
  selection: EditableFlowSelection,
): string {
  switch (selection.kind) {
    case "block":
      return (
        selection.block?.label ||
        selection.block?.type ||
        `${selection.node.id} block ${selection.blockIndex}`
      );
    case "branch":
      return selection.node.data.label || selection.node.id;
    case "group":
      return selection.node.data.label || selection.node.id;
  }
}

export function getSelectionEditorKindLabel(
  selection: EditableFlowSelection,
): string {
  switch (selection.kind) {
    case "block":
      return "Block";
    case "branch":
      return "Branch";
    case "group":
      return "Group";
  }
}

export function getSelectionEditorAuthoredValues(
  selection: EditableFlowSelection,
): Record<string, NetworkValue> {
  switch (selection.kind) {
    case "block":
      return getBlockAuthoredValues(selection.block!);
    case "branch":
      return getBranchAuthoredValues(selection.node);
    case "group":
      return getGroupAuthoredValues(selection.node);
  }
}

export function getSelectionEditorDerivedValues(
  selection: EditableFlowSelection,
): Record<string, NetworkValue> {
  switch (selection.kind) {
    case "block": {
      const derived: Record<string, NetworkValue> = {};
      if (selection.block?.kind) {
        derived.kind = selection.block.kind;
      }
      if (selection.block?.label) {
        derived.label = selection.block.label;
      }
      return derived;
    }
    case "branch": {
      const derived: Record<string, NetworkValue> = {};
      if (selection.node.data.flow_rate !== undefined) {
        derived.flow_rate = cloneNetworkValue(selection.node.data.flow_rate);
      }
      if (selection.node.data.composition !== undefined) {
        derived.composition = cloneNetworkValue(selection.node.data.composition);
      }
      return derived;
    }
    case "group":
      return {};
  }
}

export function applySelectionEditorAuthoredValues(
  selection: EditableFlowSelection,
  authoredValues: Record<string, NetworkValue>,
): FlowNode {
  switch (selection.kind) {
    case "block":
      return applyBlockSelectionAuthoredValues(selection, authoredValues);
    case "branch":
      return applyBranchSelectionAuthoredValues(selection.node, authoredValues);
    case "group":
      return applyGroupSelectionAuthoredValues(selection.node, authoredValues);
  }
}

export function getConfigUnitFallback(
  metadata: NetworkConfigMetadata | null | undefined,
  propertyName: string,
  blockType?: string,
): {
  dimension: string;
  defaultUnit: string;
} | null {
  if (!metadata) {
    return null;
  }

  const dimension = metadata.propertyDimensions[propertyName];
  if (!dimension) {
    return null;
  }

  const defaultUnit =
    (blockType ? metadata.blockTypeUnits[blockType]?.[propertyName] : undefined) ??
    metadata.dimensionUnits[dimension];

  if (!defaultUnit) {
    return null;
  }

  return {
    dimension,
    defaultUnit,
  };
}

function applyBlockSelectionAuthoredValues(
  selection: Extract<EditableFlowSelection, { kind: "block" }>,
  authoredValues: Record<string, NetworkValue>,
): FlowNode {
  const nextType =
    typeof authoredValues.type === "string" && authoredValues.type.trim()
      ? authoredValues.type.trim()
      : selection.block?.type ?? "Block";
  const nextQuantity =
    typeof authoredValues.quantity === "number" && Number.isFinite(authoredValues.quantity)
      ? authoredValues.quantity
      : selection.block?.quantity ?? 1;

  const nextBlock: Block = {
    type: nextType,
    quantity: nextQuantity,
    kind: nextType.toLowerCase(),
    label: nextType,
  };

  for (const [key, value] of Object.entries(authoredValues)) {
    if (
      key === "type" ||
      key === "quantity" ||
      value === undefined
    ) {
      continue;
    }

    nextBlock[key] = cloneNetworkValue(value);
  }

  const nextBlocks = selection.node.data.blocks.map((block, index) =>
    index === selection.blockIndex ? nextBlock : block,
  );

  return {
    ...selection.node,
    data: {
      ...selection.node.data,
      blocks: nextBlocks,
    },
  };
}

function applyBranchSelectionAuthoredValues(
  node: FlowBranchNode,
  authoredValues: Record<string, NetworkValue>,
): FlowNode {
  const nextData: FlowBranchNode["data"] = {
    id: node.data.id,
    label:
      typeof authoredValues.label === "string" ? authoredValues.label : node.data.label,
    blocks: node.data.blocks,
  };

  for (const [key, value] of Object.entries(authoredValues)) {
    if (
      key === "label" ||
      key === "parentId" ||
      key === "position" ||
      key === "width" ||
      key === "height" ||
      value === undefined
    ) {
      continue;
    }

    nextData[key] = cloneNetworkValue(value);
  }

  if (node.data.flow_rate !== undefined) {
    nextData.flow_rate = cloneNetworkValue(node.data.flow_rate);
  }
  if (node.data.composition !== undefined) {
    nextData.composition = cloneNetworkValue(node.data.composition);
  }

  return {
    ...node,
    parentId: normalizeOptionalString(authoredValues.parentId),
    width: normalizeOptionalNumber(authoredValues.width),
    height: normalizeOptionalNumber(authoredValues.height),
    position: normalizePosition(authoredValues.position, node.position),
    data: nextData,
  };
}

function applyGroupSelectionAuthoredValues(
  node: FlowGroupNode,
  authoredValues: Record<string, NetworkValue>,
): FlowNode {
  const nextData: FlowGroupNode["data"] = {
    id: node.data.id,
  };

  if (typeof authoredValues.label === "string") {
    nextData.label = authoredValues.label;
  } else if (node.data.label !== undefined) {
    nextData.label = node.data.label;
  }

  for (const [key, value] of Object.entries(authoredValues)) {
    if (
      key === "label" ||
      key === "parentId" ||
      key === "position" ||
      key === "width" ||
      key === "height" ||
      value === undefined
    ) {
      continue;
    }

    nextData[key] = cloneNetworkValue(value);
  }

  return {
    ...node,
    parentId: normalizeOptionalString(authoredValues.parentId),
    width: normalizeOptionalNumber(authoredValues.width),
    height: normalizeOptionalNumber(authoredValues.height),
    position: normalizePosition(authoredValues.position, node.position),
    data: nextData,
  };
}

function getBlockAuthoredValues(
  block: Block,
): Record<string, NetworkValue> {
  const authoredValues: Record<string, NetworkValue> = {
    type: block.type,
    quantity: block.quantity,
  };

  for (const [key, value] of Object.entries(block)) {
    if (key === "type" || key === "quantity" || key === "kind" || key === "label") {
      continue;
    }

    authoredValues[key] = cloneNetworkValue(value);
  }

  return authoredValues;
}

function getBranchAuthoredValues(
  node: FlowBranchNode,
): Record<string, NetworkValue> {
  const authoredValues: Record<string, NetworkValue> = {
    label: node.data.label,
    position: cloneNetworkValue(node.position),
  };

  if (node.parentId) {
    authoredValues.parentId = node.parentId;
  }
  if (node.width !== undefined) {
    authoredValues.width = node.width;
  }
  if (node.height !== undefined) {
    authoredValues.height = node.height;
  }

  for (const [key, value] of Object.entries(node.data)) {
    if (
      key === "id" ||
      key === "label" ||
      key === "blocks" ||
      key === "flow_rate" ||
      key === "composition"
    ) {
      continue;
    }

    authoredValues[key] = cloneNetworkValue(value);
  }

  return authoredValues;
}

function getGroupAuthoredValues(
  node: FlowGroupNode,
): Record<string, NetworkValue> {
  const authoredValues: Record<string, NetworkValue> = {
    label: node.data.label ?? "",
    position: cloneNetworkValue(node.position),
  };

  if (node.parentId) {
    authoredValues.parentId = node.parentId;
  }
  if (node.width !== undefined) {
    authoredValues.width = node.width;
  }
  if (node.height !== undefined) {
    authoredValues.height = node.height;
  }

  for (const [key, value] of Object.entries(node.data)) {
    if (key === "id" || key === "label") {
      continue;
    }

    authoredValues[key] = cloneNetworkValue(value);
  }

  return authoredValues;
}

function normalizeOptionalString(
  value: NetworkValue,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalNumber(
  value: NetworkValue,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function normalizePosition(
  value: NetworkValue,
  fallback: Position,
): Position {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  ) {
    return { x: value.x, y: value.y };
  }

  return fallback;
}

function cloneNetworkValue<T extends NetworkValue>(
  value: T,
): T {
  if (value === undefined) {
    return value;
  }

  return structuredClone(value);
}
