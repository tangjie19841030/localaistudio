import { useEffect, useState } from "react";
import { api, type TemplateGalleryItem } from "../../api/client";

interface UseTemplateGalleryOptions {
  /** Only UI projects can pick page templates; false clears the selection. */
  enabled: boolean;
  /** Writer for the form-level error banner: null on import start, message on failure. */
  onError: (message: string | null) => void;
}

interface UseTemplateGalleryResult {
  loading: boolean;
  templates: TemplateGalleryItem[];
  category: string;
  setCategory: (category: string) => void;
  /** Chosen template document; null = blank. */
  selected: TemplateGalleryItem | null;
  setSelected: (template: TemplateGalleryItem | null) => void;
  /** Template id currently going through the import flow (button disabled state). */
  importingId: string | null;
  /** Import a pending source template through the server, then select it. */
  handleImport: (id: string) => Promise<void>;
}

/**
 * Template gallery state machine (server-backed): fetch / categorize / select
 * / pending-import. Extracted verbatim from NewProjectForm so the form keeps
 * only field state and create/retry orchestration.
 */
export function useTemplateGallery({ enabled, onError }: UseTemplateGalleryOptions): UseTemplateGalleryResult {
  const [templates, setTemplates] = useState<TemplateGalleryItem[]>([]);
  const [category, setCategory] = useState("全部");
  const [selected, setSelected] = useState<TemplateGalleryItem | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The gallery currently provides UI PageDocument templates only.
  useEffect(() => {
    if (!enabled) setSelected(null);
  }, [enabled]);

  useEffect(() => {
    let alive = true;
    api
      .listTemplates()
      .then(({ templates: list }) => {
        if (alive) setTemplates(list);
      })
      .catch(() => {
        // Server unreachable/mock missing method → gallery stays empty; the
        // form still works (blank project). Do not surface a blocking error.
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  /** Import a pending source template through the server, then select it. */
  const handleImport = async (id: string) => {
    setImportingId(id);
    // Clear any stale form error before a new import starts.
    onError(null);
    try {
      const { template } = await api.importTemplate(id);
      setTemplates((prev) => prev.map((t) => (t.id === id ? template : t)));
      setSelected(template);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingId(null);
    }
  };

  return { loading, templates, category, setCategory, selected, setSelected, importingId, handleImport };
}
