export interface HistoryMetadata {
  transactionId: string;
  coalesceKey?: string;
}

export interface HistoryEntry<TSnapshot> {
  snapshot: TSnapshot;
  metadata: HistoryMetadata;
}

export interface History<TSnapshot> {
  past: HistoryEntry<TSnapshot>[];
  future: HistoryEntry<TSnapshot>[];
  maxDepth: number;
}

export interface HistoryStep<TSnapshot> {
  history: History<TSnapshot>;
  snapshot: TSnapshot;
}

const DEFAULT_MAX_DEPTH = 50;

export function createHistory<TSnapshot>(maxDepth = DEFAULT_MAX_DEPTH): History<TSnapshot> {
  if (!Number.isInteger(maxDepth) || maxDepth < 1) {
    throw new Error("历史深度必须是正整数");
  }
  return { past: [], future: [], maxDepth };
}

export function pushHistory<TSnapshot>(
  history: History<TSnapshot>,
  snapshot: TSnapshot,
  metadata: HistoryMetadata,
): History<TSnapshot> {
  const latest = history.past.at(-1);
  const coalesces =
    metadata.coalesceKey !== undefined &&
    latest?.metadata.coalesceKey === metadata.coalesceKey;
  const past = coalesces
    ? [...history.past.slice(0, -1), { snapshot: latest!.snapshot, metadata }]
    : [...history.past, { snapshot, metadata }];
  if (past.length > history.maxDepth) {
    past.splice(0, past.length - history.maxDepth);
  }
  return { ...history, past, future: [] };
}

export function undoHistory<TSnapshot>(
  history: History<TSnapshot>,
  current: TSnapshot,
  metadata: HistoryMetadata = { transactionId: "undo-current" },
): HistoryStep<TSnapshot> | null {
  const entry = history.past.at(-1);
  if (!entry) return null;
  return {
    snapshot: entry.snapshot,
    history: {
      ...history,
      past: history.past.slice(0, -1),
      future: [{ snapshot: current, metadata }, ...history.future],
    },
  };
}

export function redoHistory<TSnapshot>(
  history: History<TSnapshot>,
  current: TSnapshot,
  metadata: HistoryMetadata = { transactionId: "redo-current" },
): HistoryStep<TSnapshot> | null {
  const [entry, ...future] = history.future;
  if (!entry) return null;
  return {
    snapshot: entry.snapshot,
    history: {
      ...history,
      past: [...history.past, { snapshot: current, metadata }],
      future,
    },
  };
}
