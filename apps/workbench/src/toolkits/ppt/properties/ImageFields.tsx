import { useRef, useState } from "react";
import type { PptSlideObject } from "@studio/ppt-toolkit";
import { api } from "../../../api/client";
import { useEditorStore } from "../../../state/editorStore";
import { manualInvocation, runPptCommands } from "../state";

/**
 * Selected image: swap in an uploaded project asset + fit mode. Uploaded
 * assets are the ONLY images the AI can reference too, so after uploading,
 * the user can ask the AI ("把我刚上传的图设为封面背景") and it will resolve.
 */
export function ImageFields({ object }: { object: Extract<PptSlideObject, { kind: "image" }> }) {
  const projectId = useEditorStore((s) => s.projectId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replaceSrc = (src: string) => {
    runPptCommands([manualInvocation("object.editImage", { objectId: object.id, src })]);
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await api.uploadPptAsset(projectId, file);
      replaceSrc(uploaded.src);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const changeFit = (fit: "fill" | "contain" | "cover") => {
    runPptCommands([manualInvocation("object.editImage", { objectId: object.id, src: object.src, fit })]);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-ink-muted">图片地址</span>
      <span className="break-all rounded-lg bg-surface px-2 py-1 text-[10px] text-ink-muted" title={object.src}>
        {object.src}
      </span>
      <label className="text-xs text-ink-muted" htmlFor="ppt-object-fit">填充方式</label>
      <select
        id="ppt-object-fit"
        aria-label="填充方式"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={object.fit}
        onChange={(e) => changeFit(e.target.value as "fill" | "contain" | "cover")}
      >
        <option value="contain">完整显示（contain）</option>
        <option value="cover">填满裁剪（cover）</option>
        <option value="fill">拉伸填满（fill）</option>
      </select>
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-muted" htmlFor="ppt-img-opacity">透明度</label>
        <input
          id="ppt-img-opacity"
          aria-label="图片透明度"
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={object.opacity ?? 1}
          onChange={(e) =>
            runPptCommands([
              manualInvocation("object.editImage", { objectId: object.id, src: object.src, opacity: Number(e.target.value) }),
            ])
          }
          className="flex-1"
        />
        <span className="w-8 text-right text-[10px] text-ink-muted">{Math.round((object.opacity ?? 1) * 100)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-ink-muted" htmlFor="ppt-img-radius">圆角</label>
        <input
          id="ppt-img-radius"
          aria-label="图片圆角"
          type="number"
          min={0}
          max={640}
          value={object.radius ?? 0}
          onChange={(e) =>
            runPptCommands([
              manualInvocation("object.editImage", { objectId: object.id, src: object.src, radius: Number(e.target.value) }),
            ])
          }
          className="w-20 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        />
        <input
          type="color"
          aria-label="图片边框颜色"
          value={object.border ?? "#000000"}
          onChange={(e) =>
            runPptCommands([
              manualInvocation("object.editImage", { objectId: object.id, src: object.src, border: e.target.value }),
            ])
          }
          className="h-7 w-12 cursor-pointer rounded border border-hairline bg-surface"
        />
        {object.border && (
          <button
            type="button"
            className="text-xs text-ink-muted underline"
            onClick={() => runPptCommands([manualInvocation("object.editImage", { objectId: object.id, src: object.src, border: null })])}
          >
            去边框
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        className="hidden"
        aria-label="选择要上传的图片"
        onChange={handleFile}
      />
      <button
        type="button"
        aria-label="上传图片替换"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong disabled:opacity-50"
        disabled={busy || !projectId}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "上传中…" : "上传图片替换"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
