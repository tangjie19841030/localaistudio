import { useState } from "react";
import type { ImageGenApi } from "./useImageGen";

/**
 * U7 floating canvas entry (design §3.4): top-right, mirroring AlignBar's
 * top-center chrome. Opens only when useImageGen says an Image node is
 * selected AND the server has an image model configured. One successful
 * generation swaps the selected node's src as a single undo step.
 */

const PROMPT_MAX = 500;

/** R3 known limit: generated assets are local-only and do not ship in exported vite projects. */
const EXPORT_NOTICE = "图片保存在本地项目，导出代码工程时需替换为静态资源";

const BTN = "h-7 rounded px-2 text-xs text-ink-muted hover:bg-surface disabled:opacity-40";

/** 501 sticky banner: shown in place of the entry when config disappeared. */
function BlockedNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      data-testid="image-gen-blocked"
      className="absolute right-4 top-4 w-64 rounded-md border border-warn/30 bg-overlay p-2 text-xs text-warn shadow-pop"
    >
      {message}
      <button type="button" className={`${BTN} mt-1`} onClick={onDismiss}>
        知道了
      </button>
    </div>
  );
}

/** Expanded panel: prompt input + generate action + inline result/error. */
function PopoverPanel({ api }: { api: ImageGenApi }) {
  const [prompt, setPrompt] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (): Promise<void> => {
    const text = prompt.trim();
    if (!text || api.busy) return;
    const ok = await api.onGenerate(text);
    if (ok) {
      setDone(true);
      setPrompt("");
    }
  };

  return (
    <div className="space-y-2 border-t border-hairline p-2">
      <textarea
        aria-label="图片描述"
        value={prompt}
        maxLength={PROMPT_MAX}
        onChange={(e) => {
          setPrompt(e.target.value);
          setDone(false);
        }}
        placeholder="描述要生成的图片，例如：扁平风格登录页头图，蓝色调"
        className="h-20 w-full resize-none rounded border border-hairline bg-canvas p-1.5 text-xs text-ink focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-ink-muted">{prompt.length}/{PROMPT_MAX}</span>
        <button
          type="button"
          disabled={api.busy || prompt.trim() === ""}
          onClick={() => void submit()}
          className={`${BTN} rounded-md bg-accent-soft text-accent`}
        >
          {api.busy ? "生成中…" : "生成并替换"}
        </button>
      </div>
      {api.error && (
        <p role="alert" data-testid="image-gen-error" className="text-xs text-danger">
          {api.error}
        </p>
      )}
      {done && !api.error && (
        <p data-testid="image-gen-done" className="text-[10px] leading-4 text-ink-muted">
          已替换选中图片。{EXPORT_NOTICE}
        </p>
      )}
    </div>
  );
}

export interface ImageGenPopoverProps {
  api: ImageGenApi;
}

export function ImageGenPopover({ api }: ImageGenPopoverProps) {
  const [open, setOpen] = useState(false);

  if (!api.visible) {
    return api.blocked ? <BlockedNotice message={api.blocked} onDismiss={api.dismissBlocked} /> : null;
  }

  return (
    <div
      data-testid="image-gen-popover"
      className="absolute right-4 top-4 w-72 rounded-md border border-hairline bg-overlay shadow-pop"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center justify-between rounded-md px-3 text-xs font-medium text-ink hover:bg-surface"
      >
        AI 生成图片
        <span aria-hidden>{open ? "收起" : "展开"}</span>
      </button>
      {open && <PopoverPanel api={api} />}
    </div>
  );
}
