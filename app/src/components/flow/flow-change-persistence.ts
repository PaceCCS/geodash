import type { NodeChange } from "@xyflow/react";

export function shouldPersistNodeChanges(changes: NodeChange[]): boolean {
  return changes.some((change) => {
    if (change.type === "select") {
      return false;
    }

    if (change.type === "position") {
      return change.dragging !== true;
    }

    if (change.type === "dimensions") {
      if (change.resizing === true) {
        return false;
      }

      // React Flow emits measurement-only dimension changes during mount and
      // asset loads. Only persist width/height updates that explicitly opt in.
      return Boolean(change.setAttributes);
    }

    return true;
  });
}

export function shouldRefreshDerivedDataForNodeChanges(
  changes: NodeChange[],
): boolean {
  return changes.some((change) => {
    if (change.type === "select") {
      return false;
    }

    if (change.type === "position" || change.type === "dimensions") {
      return false;
    }

    return true;
  });
}
