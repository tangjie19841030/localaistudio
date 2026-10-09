import type { StudioDocument } from "@studio/schema-core";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { VersionListItem } from "../../state/versionStore";

/** Sentinel option value standing for the live editor document. */
export const CURRENT_DOC = "__current__";

export interface VersionDocsState {
  docs: Record<string, StudioDocument>;
  loading: boolean;
  error: string | null;
}

/**
 * Lazily pull the documents of the selected versions from the server. Only ids
 * whose Dexie mirror is gone (document === null) need a round trip; an attempt
 * ledger keeps a failed id from being retried on every re-render.
 */
export function useVersionDocs(
  projectId: string,
  versions: VersionListItem[],
  wanted: string[],
): VersionDocsState {
  const [state, setState] = useState<VersionDocsState>({ docs: {}, loading: false, error: null });
  const attempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    const missing = wanted.filter(
      (id) =>
        id !== CURRENT_DOC &&
        !attempted.current.has(id) &&
        !versions.find((v) => v.versionId === id)?.document,
    );
    if (missing.length === 0) return;
    for (const id of missing) attempted.current.add(id);
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    Promise.all(
      missing.map(async (id) => [id, (await api.getVersion(projectId, id)).document] as const),
    )
      .then((pairs) => {
        if (!alive) return;
        setState((s) => ({
          docs: { ...s.docs, ...Object.fromEntries(pairs) },
          loading: false,
          error: null,
        }));
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, loading: false, error: message }));
      });
    return () => {
      alive = false;
    };
    // wanted is a fresh array each render; join it so the effect keys on content.
  }, [projectId, versions, wanted.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
