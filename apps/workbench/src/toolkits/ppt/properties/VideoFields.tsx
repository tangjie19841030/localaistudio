import { useRef, useState } from "react";
import type { PptSlideObject } from "@studio/ppt-toolkit";
import { api } from "../../../api/client";
import { useEditorStore } from "../../../state/editorStore";
import { manualInvocation, runPptCommands } from "../state";

/**
 * Selected video: swap the source via an uploaded asset, set the poster frame
 * from an uploaded image, or rename. Uploaded videos are the ONLY video srcs
 * the AI can reference too, so "把我刚上传的视频放到第二页" resolves the same
 * way images do (project-asset URL discipline).
 */
export function VideoFields({ object }: { object: Extract<PptSlideObject, { kind: "video" }> }) {
  const projectId = useEditorStore((s) => s.projectId);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const posterInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (args: Record<string, unknown>) => {
    runPptCommands([manualInvocation("object.editVideo", { objectId: object.id, ...args })]);
  };

  const uploadFile = async (
    file: File | undefined,
    kind: "image" | "video",
    apply: (src: string) => Record<string, unknown>,
  ) => {
    if (!file || !projectId) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded = await api.uploadPptAsset(projectId, file, kind);
      patch(apply(uploaded.src));
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setBusy(false);
    }
  };

  const handleVideoFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void uploadFile(file, "video", (src) => ({ src }));
  };

  const handlePosterFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void uploadFile(file, "image", (poster) => ({ poster }));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-ink-muted">视频地址</span>
      <span className="break-all rounded-lg bg-surface px-2 py-1 text-[10px] text-ink-muted" title={object.src}>
        {object.src}
      </span>
      <label className="text-xs text-ink-muted" htmlFor="ppt-video-title">标题</label>
      <input
        id="ppt-video-title"
        aria-label="视频标题"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={object.title ?? ""}
        onChange={(e) => patch({ title: e.target.value })}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="hidden"
        aria-label="选择要上传的视频"
        onChange={handleVideoFile}
      />
      <button
        type="button"
        aria-label="上传视频替换"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong disabled:opacity-50"
        disabled={busy || !projectId}
        onClick={() => videoInputRef.current?.click()}
      >
        {busy ? "上传中…" : "上传视频替换"}
      </button>
      <input
        ref={posterInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        className="hidden"
        aria-label="选择封面图片"
        onChange={handlePosterFile}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="上传封面图片"
          className="flex-1 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong disabled:opacity-50"
          disabled={busy || !projectId}
          onClick={() => posterInputRef.current?.click()}
        >
          {object.poster ? "更换封面帧" : "设置封面帧"}
        </button>
        {object.poster && (
          <button
            type="button"
            aria-label="清除封面帧"
            className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong"
            onClick={() => patch({ poster: null })}
          >
            清除
          </button>
        )}
      </div>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
