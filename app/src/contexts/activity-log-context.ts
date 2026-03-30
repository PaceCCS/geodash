import { create } from "zustand";

export type ActivityLogSource = "canvas" | "details" | "filesystem" | "system";
export type ActivityLogKind = "change" | "reload";

export type ActivityLogEntry = {
  id: string;
  timestamp: number;
  source: ActivityLogSource;
  kind: ActivityLogKind;
  message: string;
  changedPaths?: string[];
};

export type ActivityLogEntryInput = Omit<ActivityLogEntry, "id" | "timestamp"> & {
  id?: string;
  timestamp?: number;
};

type ActivityLogState = {
  entries: ActivityLogEntry[];
  appendEntries: (entries: ActivityLogEntryInput[]) => void;
  clear: () => void;
};

const MAX_ACTIVITY_LOG_ENTRIES = 200;
let activityLogSequence = 0;

function createActivityLogEntry(
  entry: ActivityLogEntryInput,
): ActivityLogEntry {
  const timestamp = entry.timestamp ?? Date.now();

  return {
    id: entry.id ?? `activity-${timestamp}-${activityLogSequence++}`,
    timestamp,
    source: entry.source,
    kind: entry.kind,
    message: entry.message,
    changedPaths: entry.changedPaths,
  };
}

export const useActivityLog = create<ActivityLogState>((set) => ({
  entries: [],
  appendEntries: (entries) => {
    if (entries.length === 0) {
      return;
    }

    set((state) => {
      const nextEntries = entries.map(createActivityLogEntry);
      return {
        entries: [...nextEntries, ...state.entries].slice(
          0,
          MAX_ACTIVITY_LOG_ENTRIES,
        ),
      };
    });
  },
  clear: () => set({ entries: [] }),
}));

export function appendActivityLogEntries(
  entries: ActivityLogEntryInput[],
): void {
  useActivityLog.getState().appendEntries(entries);
}

export function appendActivityLogEntry(
  entry: ActivityLogEntryInput,
): void {
  appendActivityLogEntries([entry]);
}

export function clearActivityLog(): void {
  useActivityLog.getState().clear();
}
