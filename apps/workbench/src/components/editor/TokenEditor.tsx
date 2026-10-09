import type { StudioDocument, Tokens } from "@studio/schema-core";
import type { TokenPath } from "@studio/schema-core";
import { useState } from "react";
import { useEditorStore } from "../../state/editorStore";
import { TokenPresetPicker, applyPresetTokens } from "./TokenPresetPicker";
import { TokenImportButton } from "./TokenImportButton";

export interface TokenEditorProps {
  doc: StudioDocument;
  onSetToken: (path: TokenPath, value: string | number) => void;
  /**
   * Applies a whole preset. Defaults to one editorStore.applyOp folding setToken
   * over every path, which is a single undo entry. Injectable for tests; the
   * default is used in-app because the only mount point (layout/RightPanel) is
   * outside this feature's edit scope.
   */
  onApplyTokens?: (tokens: Tokens) => void;
}

type ColorKey = keyof Tokens["color"];

const COLOR_LABEL: Record<ColorKey, string> = {
  brand: "品牌色",
  surface: "表面色",
  text: "正文色",
  muted: "弱化色",
  border: "边框色",
  accent: "强调色",
  success: "成功色",
  warning: "警告色",
  danger: "危险色",
};

const COLOR_KEYS = Object.keys(COLOR_LABEL) as ColorKey[];

interface Draft {
  /** Local text being typed; null = untouched (show the document value). */
  text: string | null;
  error: string | null;
}

const NO_DRAFT: Draft = { text: null, error: null };

/** Row-level inline error text. */
function FieldError({ draft }: { draft: Draft }) {
  if (!draft.error) return null;
  return (
    <p role="alert" className="mt-1 text-xs text-danger">
      {draft.error}
    </p>
  );
}

/** Shared numeric commit: blur validates, invalid shows an inline error and never commits. */
function commitNumber(
  raw: string,
  min: number,
  max: number,
  rangeMsg: string,
  fail: (error: string) => void,
  commit: (v: number) => void,
): void {
  if (raw.trim() === "") {
    fail("不能为空");
    return;
  }
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min || v > max) {
    fail(rangeMsg);
    return;
  }
  commit(v);
}

const INPUT =
  "studio-transition rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function TokenEditor({ doc, onSetToken, onApplyTokens }: TokenEditorProps) {
  const tokens = doc.tokens;
  const [colorDraft, setColorDraft] = useState<Partial<Record<ColorKey, Draft>>>({});
  const [radiusCard, setRadiusCard] = useState<Draft>(NO_DRAFT);
  const [radiusControl, setRadiusControl] = useState<Draft>(NO_DRAFT);
  const [spacingUnit, setSpacingUnit] = useState<Draft>(NO_DRAFT);
  const [fontSans, setFontSans] = useState<Draft>(NO_DRAFT);

  // One applyOp per preset → one undo entry, and drafts are dropped so the
  // inputs re-read the freshly applied document values.
  const applyPreset = (next: Tokens) => {
    setColorDraft({});
    setRadiusCard(NO_DRAFT);
    setRadiusControl(NO_DRAFT);
    setSpacingUnit(NO_DRAFT);
    setFontSans(NO_DRAFT);
    if (onApplyTokens) onApplyTokens(next);
    else useEditorStore.getState().applyOp((d) => applyPresetTokens(d, next));
  };

  const commitColor = (key: ColorKey, raw: string) => {
    if (raw === tokens.color[key]) {
      setColorDraft((s) => ({ ...s, [key]: undefined }));
      return;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
      onSetToken(["color", key], raw);
      setColorDraft((s) => ({ ...s, [key]: undefined }));
    } else {
      setColorDraft((s) => ({ ...s, [key]: { text: raw, error: "颜色必须是 #RRGGBB" } }));
    }
  };

  const shown = (draft: Draft, fallback: string): string => (draft.text !== null ? draft.text : fallback);

  return (
    <div className="space-y-6 text-sm">
      {/* Scope note: these tokens style the artwork document, not the workbench chrome. */}
      <p className="text-xs leading-relaxed text-ink-muted">
        以下均修改作品自身主题，不影响工作台界面。
      </p>
      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
          预设
        </h3>
        <div className="space-y-2">
          <TokenPresetPicker onApply={applyPreset} />
          <TokenImportButton onApply={applyPreset} />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
          颜色
        </h3>
        <div className="space-y-2">
          {COLOR_KEYS.map((key) => {
            const draft = colorDraft[key] ?? NO_DRAFT;
            return (
              <div key={key}>
                <label className="flex items-center gap-2">
                  <span className="w-20 text-xs text-ink-soft">{COLOR_LABEL[key]}</span>
                  <input
                    type="color"
                    aria-label={COLOR_LABEL[key]}
                    value={shown(draft, tokens.color[key])}
                    onChange={(e) => commitColor(key, e.target.value)}
                    className="studio-transition h-8 w-16 cursor-pointer rounded-md border border-hairline bg-canvas hover:border-hairline-strong"
                  />
                  <code className="text-xs text-ink-muted">{shown(draft, tokens.color[key])}</code>
                </label>
                <FieldError draft={draft} />
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
          字体
        </h3>
        <label className="flex items-center gap-2">
          <span className="w-20 text-xs text-ink-soft">sans</span>
          <input
            type="text"
            aria-label="字体-sans"
            value={shown(fontSans, tokens.font.sans)}
            onChange={(e) => setFontSans({ text: e.target.value, error: null })}
            onBlur={() => {
              const raw = fontSans.text ?? "";
              if (raw.trim() === "") {
                setFontSans({ text: raw, error: "字体栈必须非空" });
                return;
              }
              onSetToken(["font", "sans"], raw);
              setFontSans(NO_DRAFT);
            }}
            className={`${INPUT} flex-1`}
          />
        </label>
        <FieldError draft={fontSans} />
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
          间距 / 圆角
        </h3>
        <label className="flex items-center gap-2">
          <span className="w-20 text-xs text-ink-soft">卡片</span>
          <input
            type="number"
            aria-label="圆角-卡片"
            value={shown(radiusCard, String(tokens.radius.card))}
            onChange={(e) => setRadiusCard({ text: e.target.value, error: null })}
            onBlur={() =>
              commitNumber(
                radiusCard.text ?? "",
                0,
                64,
                "radius 必须是 0-64 的数值",
                (error) => setRadiusCard({ text: radiusCard.text, error }),
                (v) => {
                  onSetToken(["radius", "card"], v);
                  setRadiusCard(NO_DRAFT);
                },
              )
            }
            className={`${INPUT} w-20`}
          />
        </label>
        <FieldError draft={radiusCard} />
        <label className="mt-2 flex items-center gap-2">
          <span className="w-20 text-xs text-ink-soft">控件</span>
          <input
            type="number"
            aria-label="圆角-控件"
            value={shown(radiusControl, String(tokens.radius.control))}
            onChange={(e) => setRadiusControl({ text: e.target.value, error: null })}
            onBlur={() =>
              commitNumber(
                radiusControl.text ?? "",
                0,
                64,
                "radius 必须是 0-64 的数值",
                (error) => setRadiusControl({ text: radiusControl.text, error }),
                (v) => {
                  onSetToken(["radius", "control"], v);
                  setRadiusControl(NO_DRAFT);
                },
              )
            }
            className={`${INPUT} w-20`}
          />
        </label>
        <FieldError draft={radiusControl} />
        <label className="mt-2 flex items-center gap-2">
          <span className="w-20 text-xs text-ink-soft">单位</span>
          <input
            type="number"
            aria-label="间距单位"
            value={shown(spacingUnit, String(tokens.spacing.unit))}
            onChange={(e) => setSpacingUnit({ text: e.target.value, error: null })}
            onBlur={() =>
              commitNumber(
                spacingUnit.text ?? "",
                1,
                24,
                "spacing.unit 必须是 1-24 的数值",
                (error) => setSpacingUnit({ text: spacingUnit.text, error }),
                (v) => {
                  onSetToken(["spacing", "unit"], v);
                  setSpacingUnit(NO_DRAFT);
                },
              )
            }
            className={`${INPUT} w-20`}
          />
        </label>
        <FieldError draft={spacingUnit} />
      </section>
    </div>
  );
}
