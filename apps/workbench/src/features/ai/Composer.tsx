import { useEffect, useRef } from "react";
import type { NodeRecord } from "@studio/schema-core";
import { useAiStore } from "../../state/aiStore";
import { useEditorStore } from "../../state/editorStore";
import { withSelectionPrefix } from "./selectionChips";

/** Read one File as a base64 data URL (multimodal input, spec §9.2). */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Streaming controls: send (disabled while streaming) + cancel (streaming only). */
export function Composer(props: {
  projectId: string;
  disabled: boolean;
  streaming: boolean;
  onSend: (text: string, images: string[]) => void;
  onCancel: () => void;
  /** W1-A: nodes behind the current selection; adds the outbound summary prefix. */
  selectedNodes?: NodeRecord[];
}) {
  const draft = useAiStore((s) => s.composerDrafts[props.projectId]);
  const text = draft?.text ?? "";
  const images = draft?.images ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  // Toolkit (PPT/Word) chat silently dropped attached images server-side;
  // PPT images must go through the project-asset upload (「插入图片」).
  const projectType = useEditorStore((s) => s.meta?.projectType);
  const referenceImagesSupported = projectType !== "ppt" && projectType !== "word";

  const updateDraft = (next: Partial<{ text: string; images: string[]; variants: 0 | 2 | 3 }>): void => {
    const current = useAiStore.getState().composerDrafts[props.projectId];
    const variants = next.variants ?? current?.variants;
    useAiStore.getState().setComposerDraft(props.projectId, {
      text: next.text ?? current?.text ?? "",
      images: next.images ?? current?.images ?? [],
      ...(variants ? { variants } : {}),
    });
  };

  useEffect(() => {
    // EmptyState suggestion chips deliver their text through this event.
    const onPrefill = (e: Event): void => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail) updateDraft({ text: detail });
    };
    window.addEventListener("studio-ai-prefill", onPrefill);
    return () => window.removeEventListener("studio-ai-prefill", onPrefill);
  }, [props.projectId]);

  const submit = (): void => {
    const value = text.trim();
    if (!value || props.disabled) return;
    // W1-A: outbound text carries a one-line selection summary (type + key
    // props) so the model sees what "改成警告色" refers to. No target markers
    // here — modeFor() still owns the patch-mode marker syntax.
    const outbound = props.selectedNodes?.length
      ? withSelectionPrefix(props.selectedNodes, value)
      : value;
    props.onSend(outbound, images);
    useAiStore.getState().clearComposerDraft(props.projectId);
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: string[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      next.push(await readFileAsDataUrl(f));
    }
    if (next.length > 0) {
      const current = useAiStore.getState().composerDrafts[props.projectId]?.images ?? [];
      updateDraft({ images: [...current, ...next].slice(0, 4) });
    }
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="ai-input" className="sr-only">
        AI 指令
      </label>
      <textarea
        id="ai-input"
        rows={2}
        aria-label="AI 指令"
        className="studio-transition w-full rounded-lg border border-hairline bg-canvas px-2.5 py-2 text-xs text-ink placeholder:text-ink-muted hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        placeholder={props.streaming ? "生成中…" : "描述需求或选中节点后的修改"}
        value={text}
        disabled={props.streaming}
        onChange={(e) => updateDraft({ text: e.target.value })}
        onKeyDown={(e) => {
          // Enter 发送、Shift+Enter 换行（对话输入惯例）
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />

      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map((src, i) => (
            <span
              key={`${i}-${src.slice(0, 16)}`}
              className="group relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-md border border-hairline bg-surface"
            >
              <img src={src} alt={`参考图 ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                aria-label={`移除参考图 ${i + 1}`}
                onClick={() => updateDraft({ images: images.filter((_, idx) => idx !== i) })}
                className="studio-transition absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-white opacity-0 hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          aria-label="添加参考图"
          className="hidden"
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={props.streaming}
          title={referenceImagesSupported ? undefined : "PPT/Word 对话不支持参考图；请用工具栏「插入图片」上传，AI 就能在资产清单里看到"}
          className={`studio-transition inline-flex h-7 items-center gap-1 rounded-md border border-hairline-strong px-2 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink disabled:opacity-40 ${
            referenceImagesSupported ? "" : "hidden"
          }`}
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
            <circle cx="6" cy="6.5" r="1.25" />
            <path d="M2.5 10.5l3-2.5 3 2.5 2-1.5 3 2" />
          </svg>
          参考图{images.length > 0 ? ` ${images.length}` : ""}
        </button>
        {/* T61 OP-3: multi-candidate generate toggle (server T60 contract). Rides
            on the composer draft so it resets per send (2-3x token cost is opt-in
            per turn); toolkit/patch turns never send it. */}
        <label htmlFor="ai-variants" className="sr-only">
          方案数量
        </label>
        <select
          id="ai-variants"
          value={draft?.variants ?? 0}
          disabled={props.streaming}
          onChange={(e) => updateDraft({ variants: Number(e.target.value) as 0 | 2 | 3 })}
          className={`studio-transition h-7 rounded-md border border-hairline-strong bg-surface px-1.5 text-xs text-ink-soft hover:text-ink disabled:opacity-40 ${
            referenceImagesSupported ? "" : "hidden"
          }`}
        >
          <option value={0}>单方案</option>
          <option value={2}>多方案 ×2</option>
          <option value={3}>多方案 ×3</option>
        </select>
        <button
          type="button"
          className="studio-transition ml-auto inline-flex h-7 items-center rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
          disabled={props.disabled || !text.trim()}
          onClick={submit}
        >
          发送
        </button>
        {props.streaming && (
          <button
            type="button"
            className="studio-transition inline-flex h-7 items-center rounded-md border border-hairline-strong px-2 text-xs font-medium text-ink-soft hover:bg-surface hover:text-ink"
            onClick={props.onCancel}
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
}
