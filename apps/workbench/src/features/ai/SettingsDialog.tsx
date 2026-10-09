import { useEffect, useState } from "react";
import {
  getSettings,
  putSettings,
  testModel,
  type MaskedSettings,
  type ModelTestResult,
} from "../../api/client";
import { ModalSurface, OverlayBackdrop } from "../../components/motion";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDERS = ["mock", "openai-compat", "ollama"] as const;

const FIELD =
  "w-full rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink studio-transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/** External-API compliance notice (spec §9.2): shown only when openai-compat is active. */
function DataScopeNote(): React.ReactNode {
  return (
    <p
      role="note"
      className="rounded-md border border-warn/30 bg-warn-soft p-2 text-xs text-warn"
    >
      外部 API 合规提示：将发送——提示词、Schema JSON、图片（如有）到外部 API。
    </p>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<MaskedSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<ModelTestResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTestResult(null);
    setLoadError(null);
    setSaveError(null);
    getSettings()
      .then((s) => {
        setSettings(s);
        setApiKey("");
      })
      .catch((err: Error) => setLoadError(err.message));
    // Escape closes the dialog (same contract as CommandPalette); the listener
    // lives on document so it fires regardless of where focus sits inside.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const patch = (next: Partial<MaskedSettings>): void => {
    setSettings((prev) => (prev ? { ...prev, ...next } : prev));
  };

  const handleSave = (): void => {
    if (!settings) return;
    setSaveError(null);
    void putSettings({ ...settings, openai: { ...settings.openai, apiKey: apiKey as "" } })
      .then(() => onClose())
      // 失败不关对话框：用户改的内容还在表单里，可直接重试。
      .catch((err: Error) => setSaveError(`保存失败：${err.message}`));
  };

  const handleTest = (): void => {
    if (!settings) return;
    setTestResult(null);
    void testModel()
      .then(setTestResult)
      // 网络失败时没有 ModelTestResult 可回，构造 ok:false 走既有错误渲染。
      .catch((err: Error) =>
        setTestResult({ ok: false, sample: "", detail: `服务未启动或网络错误（${err.message}）` }),
      );
  };

  return (
    <OverlayBackdrop
      open={open}
      z="z-50"
      role="dialog"
      aria-label="设置"
      className="flex items-center justify-center bg-black/40"
    >
      <ModalSurface className="max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-hairline bg-canvas p-6 text-sm shadow-modal">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">设置</h2>
          <button
            type="button"
            aria-label="关闭设置"
            className="studio-transition rounded-md h-7 w-7 text-ink-muted hover:bg-rail hover:text-ink"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {loadError && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-danger/30 bg-danger-soft p-2 text-xs text-danger"
          >
            {loadError}
          </p>
        )}

        {settings && (
          <div className="space-y-4">
            <fieldset className="space-y-1.5">
              <legend className="mb-1 text-xs font-medium text-ink-muted uppercase tracking-wider">
                Provider
              </legend>
              {PROVIDERS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name="provider"
                    aria-label={p}
                    checked={settings.provider === p}
                    onChange={() => patch({ provider: p })}
                  />
                  {p}
                </label>
              ))}
            </fieldset>

            {settings.provider === "openai-compat" && <DataScopeNote />}

            <div className="space-y-3">
              <div>
                <div className="mb-1 text-xs font-medium text-ink-muted uppercase tracking-wider">
                  Base URL
                </div>
                <input
                  className={FIELD}
                  value={settings.openai.baseUrl}
                  onChange={(e) =>
                    patch({ openai: { ...settings.openai, baseUrl: e.target.value } })
                  }
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-ink-muted uppercase tracking-wider">
                  模型
                </div>
                <input
                  className={FIELD}
                  value={settings.openai.model}
                  onChange={(e) =>
                    patch({ openai: { ...settings.openai, model: e.target.value } })
                  }
                />
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-ink-muted uppercase tracking-wider">
                  API Key
                </div>
                <input
                  type="password"
                  aria-label="API Key"
                  className={FIELD}
                  placeholder="留空保留已保存的 key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <p className="mt-1 text-xs text-ink-muted">
                  {settings.hasKey ? `已配置（末4位 ****${settings.keyHint}）` : "未配置"}
                </p>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-ink-muted uppercase tracking-wider">
                  temperature
                </div>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  className={`${FIELD} w-24`}
                  value={settings.temperature}
                  onChange={(e) => patch({ temperature: Number(e.target.value) })}
                />
              </div>
            </div>

            {testResult && (
              <div className="space-y-1">
                {/* handleTest 调 testModel() 走服务端已保存配置；表单草稿不参与，
                    明确标注以免用户误以为正在测试未保存输入。 */}
                <p className="text-[11px] text-ink-muted">
                  以下为已保存配置的检测结果（不含上方未保存的表单修改）
                </p>
                <p
                  className={
                    testResult.ok
                      ? "text-xs text-success"
                      : "text-xs text-danger"
                  }
                >
                  {testResult.ok
                    ? `连接成功：${testResult.sample}`
                    : `连接失败：${testResult.detail}`}
                </p>
              </div>
            )}

            {saveError && (
              <p role="alert" className="mb-2 text-xs text-danger">
                {saveError}
              </p>
            )}

            <div className="flex gap-2 border-t border-hairline pt-3">
              <button
                type="button"
                className="studio-transition inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover active:bg-accent-pressed"
                onClick={handleSave}
              >
                保存
              </button>
              <button
                type="button"
                className="studio-transition inline-flex h-8 items-center rounded-md border border-hairline-strong px-3 text-sm font-medium text-ink-soft hover:bg-surface hover:text-ink"
                onClick={handleTest}
              >
                测试连接
              </button>
            </div>
          </div>
        )}
      </ModalSurface>
    </OverlayBackdrop>
  );
}
