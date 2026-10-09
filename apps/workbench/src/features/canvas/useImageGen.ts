import { getNode, replacePage, updateProps } from "@studio/schema-core";
import type { Page } from "@studio/schema-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  describeImageGenError,
  generateImage,
  getImageGenAvailability,
} from "../../api/imageGen";
import type { ApplyOp } from "./canvasCommit";

/**
 * U7 canvas image generation (design §3.4). Selection + settings gate the
 * entry: it exists only when the active selection is an Image node AND the
 * server reports an openai key + image model. The probe runs ONCE per mount;
 * a later 501 flips the gate back off (never silently degrades).
 *
 * The node src swap runs through the passed ApplyOp (one undo entry), using
 * schema-core updateProps so the Image props schema validates the new src.
 */

export interface ImageGenApi {
  /** Entry renders only when the selection is an Image node AND generation is configured. */
  visible: boolean;
  busy: boolean;
  /** In-popover user-readable error (502/504/network); null when idle/ok. */
  error: string | null;
  /** 501 sticky banner: config disappeared server-side; entry hides but the notice stays. */
  blocked: string | null;
  /** Returns true when the node src was replaced (single undo entry). */
  onGenerate: (prompt: string) => Promise<boolean>;
  dismissBlocked: () => void;
}

export interface UseImageGenArgs {
  projectId: string | null;
  doc: Page | null;
  selectedId: string | null;
  /** One call = one undo entry (CanvasSurface's editorStore applyOp). */
  applyOp: ApplyOp;
}

/** One-shot settings probe: hasKey + imageGen.model. Hidden until resolved. */
function useConfigured(): { configured: boolean; probed: boolean; disable: () => void } {
  const [configured, setConfigured] = useState(false);
  const [probed, setProbed] = useState(false);

  useEffect(() => {
    let alive = true;
    getImageGenAvailability()
      .then((ok) => {
        if (alive) {
          setConfigured(ok);
          setProbed(true);
        }
      })
      // Server down / unexpected body: keep the entry hidden, no noise.
      .catch(() => alive && setProbed(true));
    return () => {
      alive = false;
    };
  }, []);

  const disable = useCallback(() => setConfigured(false), []);
  return { configured, probed, disable };
}

/** Map a generation failure onto either the sticky 501 banner or an inline error. */
function classifyFailure(err: unknown, disable: () => void): { blocked: string | null; error: string | null } {
  const f = describeImageGenError(err);
  if (f.unavailable) {
    disable();
    return { blocked: f.message, error: null };
  }
  return { blocked: null, error: f.message };
}

/** Replace the Image node src inside the page matching doc.id (one whole-doc op). */
function useApplySrc(applyOp: ApplyOp, pageId: string | undefined) {
  return useCallback(
    (nodeId: string, src: string): boolean =>
      applyOp((d) => {
        const page = d.pages.find((p) => p.id === pageId);
        if (!page) return d;
        return replacePage(d, page.id, updateProps(page, nodeId, { src }));
      }),
    [applyOp, pageId],
  );
}

export function useImageGen({ projectId, doc, selectedId, applyOp }: UseImageGenArgs): ImageGenApi {
  const { configured, probed, disable } = useConfigured();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const applySrc = useApplySrc(applyOp, doc?.id);

  const selectedImage = useMemo(
    () => Boolean(doc && selectedId && getNode(doc, selectedId)?.type === "Image"),
    [doc, selectedId],
  );

  // A different selection starts a fresh attempt: drop the previous error.
  useEffect(() => {
    setError(null);
  }, [selectedId]);

  const onGenerate = useCallback(
    async (prompt: string): Promise<boolean> => {
      if (!projectId || !selectedId || busy) return false;
      setBusy(true);
      setError(null);
      try {
        const result = await generateImage(projectId, prompt);
        return applySrc(selectedId, result.src);
      } catch (err) {
        // 501 despite the probe flips the gate off (classifyFailure) + banner;
        // other failures stay inline and keep the entry available.
        const settled = classifyFailure(err, disable);
        setBlocked(settled.blocked);
        setError(settled.error);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [projectId, selectedId, busy, applySrc, disable],
  );

  const dismissBlocked = useCallback(() => setBlocked(null), []);

  return {
    visible: probed && configured && selectedImage,
    busy,
    error,
    blocked,
    onGenerate,
    dismissBlocked,
  };
}
