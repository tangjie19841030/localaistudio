import { PPT_THEMES, PPT_THEME_IDS, type PptDocument } from "@studio/ppt-toolkit";
import type { ProjectMeta } from "@studio/schema-core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { NarrowDrawer } from "../../components/layout/NarrowDrawer";
import { Presence } from "../../components/motion";
import { PanelToggleButton } from "../../components/layout/PanelToggleButton";
import { useBreakpoint } from "../../utils/useBreakpoint";
import { api } from "../../api/client";
import { useEditorStore } from "../../state/editorStore";
import { manualInvocation, runPptCommands, usePptEditorStore } from "./state";
import { ExportPanel } from "./ExportPanel";
import { QualityPanel } from "./QualityPanel";
import { NotesPanel } from "./NotesPanel";
import { PresenterView } from "./PresenterView";
import { PropertyPanel } from "./PropertyPanel";
import { SlideCanvas } from "./SlideCanvas";
import { SlideList } from "./SlideList";

export interface PptEditorPanelProps {
  /** PPT document narrowed by the caller (projectType === "ppt"). */
  document: PptDocument;
  meta: ProjectMeta;
  /** Persist wiring: write the new deck into editorStore + mark dirty. */
  onDocumentChange: (deck: PptDocument) => void;
}

/**
 * P9.1 PPT editor panel: toolbar + three-pane layout (slide list / canvas /
 * property) + notes footer. Every mutation is a ppt-toolkit manual
 * transaction through the local zustand store; onDocumentChange persists.
 */
export function PptEditorPanel({ document, meta, onDocumentChange }: PptEditorPanelProps) {
  const deck = usePptEditorStore((s) => s.deck);
  const selectedSlideId = usePptEditorStore((s) => s.selectedSlideId);
  const selectedObjectIds = usePptEditorStore((s) => s.selectedObjectIds);
  const error = usePptEditorStore((s) => s.error);
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const [objectTextDrafts, setObjectTextDrafts] = useState<Record<string, string>>({});

  // Props -> store: incoming document identity + save wiring (App owns editorStore).
  useEffect(() => {
    usePptEditorStore.getState().syncDocument(document);
  }, [document]);
  useEffect(() => {
    usePptEditorStore.getState().setOnChange(onDocumentChange);
  }, [onDocumentChange]);

  const current = deck ?? document;
  const slide = current.slides.find((candidate) => candidate.id === selectedSlideId) ?? current.slides[0] ?? null;
  const selectedObject = selectedObjectIds.length === 1
    ? slide?.objects.find((object) => object.id === selectedObjectIds[0]) ?? null
    : null;
  const breakpoint = useBreakpoint();
  const [narrowRail, setNarrowRail] = useState<"slides" | "properties" | null>(null);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const lastRepairs = usePptEditorStore((s) => s.lastRepairs);
  const [repairDismissed, setRepairDismissed] = useState(false);

  // A drawer only exists in narrow mode. Clear its transient open state in a
  // layout effect so a breakpoint transition cannot race a subsequent click.
  useLayoutEffect(() => {
    if (breakpoint !== "narrow") {
      setNarrowRail(null);
    }
  }, [breakpoint]);

  const toggleNarrowRail = (rail: "slides" | "properties") => {
    setNarrowRail((current) => (current === rail ? null : rail));
  };

  const titleDraftKey = `${meta.id}:${slide?.id ?? ""}`;
  const objectTextDraftKey = `${meta.id}:${slide?.id ?? ""}:${selectedObject?.id ?? ""}`;
  const writeTitleDraft = (draft: string | undefined): void => {
    setTitleDrafts((current) => {
      if (draft === undefined) {
        if (!(titleDraftKey in current)) return current;
        const next = { ...current };
        delete next[titleDraftKey];
        return next;
      }
      return { ...current, [titleDraftKey]: draft };
    });
  };
  const writeObjectTextDraft = (draft: string | undefined): void => {
    setObjectTextDrafts((current) => {
      if (draft === undefined) {
        if (!(objectTextDraftKey in current)) return current;
        const next = { ...current };
        delete next[objectTextDraftKey];
        return next;
      }
      return { ...current, [objectTextDraftKey]: draft };
    });
  };

  const slideList = (
    <SlideList
      deck={current}
      selectedSlideId={slide?.id ?? null}
      onSelect={(id) => usePptEditorStore.getState().selectSlide(id)}
    />
  );
  const propertyPanel = (
    <PropertyPanel
      key={meta.id + (slide?.id ?? "")}
      slide={slide}
      selectedObject={selectedObject}
      selectedIds={selectedObjectIds}
      titleDraft={titleDrafts[titleDraftKey]}
      onTitleDraftChange={writeTitleDraft}
      objectTextDraft={objectTextDrafts[objectTextDraftKey]}
      onObjectTextDraftChange={writeObjectTextDraft}
    />
  );

  return (
    <section aria-label="PPT 编辑器" className="flex min-h-0 min-w-0 flex-1 flex-col" data-project-id={meta.id}>
      <Toolbar onBusyChange={setCanvasBusy} />
      {lastRepairs.length > 0 && !repairDismissed && (
        <p
          role="status"
          className="shrink-0 border-b border-hairline bg-accent-soft px-3 py-1 text-[11px] text-accent"
          title={lastRepairs.join("\n")}
        >
          已自动修复 {lastRepairs.length} 页的图层顺序（背景色块沉到内容下方，{lastRepairs.length} 页），Ctrl+S 保存后生效
          <button
            type="button"
            aria-label="关闭图层修复提示"
            className="ml-2 underline"
            onClick={() => setRepairDismissed(true)}
          >
            知道了
          </button>
        </p>
      )}
      {error && (
        <p role="alert" aria-label="编辑错误" className="shrink-0 bg-danger-soft px-3 py-1.5 text-xs text-danger">
          {error}
          <button type="button" aria-label="关闭错误" className="ml-2 underline" onClick={() => usePptEditorStore.getState().clearError()}>
            关闭
          </button>
        </p>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {breakpoint === "narrow" ? (
          <>
            <PanelToggleButton
              side="left"
              variant="strip"
              label="切换幻灯片列表"
              expanded={narrowRail === "slides"}
              onClick={() => toggleNarrowRail("slides")}
            />
            <SlideCanvas
              deck={current}
              slide={slide}
              selectedObjectIds={selectedObjectIds}
              interactionLocked={canvasBusy}
              onSelectSlide={() => usePptEditorStore.getState().selectSlide(null)}
              onClearObjects={() => usePptEditorStore.getState().selectObjects([])}
              onSelectObject={(id, additive) => {
                const store = usePptEditorStore.getState();
                if (additive) store.toggleObjectSelection(id);
                else store.selectObjects([id]);
              }}
            />
            <PanelToggleButton
              side="right"
              variant="strip"
              label="切换幻灯片属性"
              expanded={narrowRail === "properties"}
              onClick={() => toggleNarrowRail("properties")}
            />
            <Presence when={narrowRail === "slides"}>
              <NarrowDrawer
                key="ppt-slides"
                side="left"
                label="幻灯片列表"
                onClose={() => setNarrowRail(null)}
                focusFallback={() =>
                  globalThis.document.querySelector<HTMLElement>('ol[aria-label="幻灯片列表"] button')
                    ?? globalThis.document.querySelector<HTMLElement>('button[aria-label="新增幻灯片"]')
                }
              >
                <div className="min-h-0 flex-1 overflow-y-auto">{slideList}</div>
              </NarrowDrawer>
            </Presence>
            <Presence when={narrowRail === "properties"}>
              <NarrowDrawer
                key="ppt-properties"
                side="right"
                label="幻灯片属性"
                onClose={() => setNarrowRail(null)}
                focusFallback={() =>
                  globalThis.document.querySelector<HTMLElement>('[aria-label="属性面板"] input:not([disabled]), [aria-label="属性面板"] textarea:not([disabled]), [aria-label="属性面板"] button:not([disabled])')
                    ?? globalThis.document.querySelector<HTMLElement>('button[aria-label="新增幻灯片"]')
                }
              >
                <div className="min-h-0 flex-1 overflow-y-auto">{propertyPanel}</div>
              </NarrowDrawer>
            </Presence>
          </>
        ) : (
          <>
            {slideList}
            <SlideCanvas
              deck={current}
              slide={slide}
              selectedObjectIds={selectedObjectIds}
              interactionLocked={canvasBusy}
              onSelectSlide={() => usePptEditorStore.getState().selectSlide(null)}
              onClearObjects={() => usePptEditorStore.getState().selectObjects([])}
              onSelectObject={(id, additive) => {
                const store = usePptEditorStore.getState();
                if (additive) store.toggleObjectSelection(id);
                else store.selectObjects([id]);
              }}
            />
            {/* Keys include meta.id: the deck state must remount when a DIFFERENT
                project is opened (slide ids like "slide-1" repeat across decks). */}
            {propertyPanel}
          </>
        )}
      </div>
      <NotesPanel key={meta.id + (slide?.id ?? "")} slide={slide} />
      <div className="flex shrink-0 gap-2 border-t border-hairline px-3 py-2">
        <ExportPanel />
        <QualityPanel />
      </div>
      <PresenterView />
    </section>
  );
}

/** Insert menu: text box, shapes, table, chart — all land on the current slide. */
function InsertMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const addObject = (data: Record<string, unknown>, rect: { x: number; y: number; w: number; h: number }, kind: string) => {
    const store = usePptEditorStore.getState();
    const slideId = store.selectedSlideId ?? store.deck?.slides[0]?.id;
    if (!slideId) return;
    const id = `obj-${kind}-${Date.now().toString(36)}`;
    const ok = runPptCommands([manualInvocation("object.add", { slideId, object: { id, kind, rect, data } })]);
    if (ok) usePptEditorStore.getState().selectObjects([id]);
  };

  const shape = (shape: string) => addObject({ shape, fill: "#94A3B8" }, { x: 440, y: 260, w: 200, h: 120 }, shape);
  const items: { label: string; action: () => void }[] = [
    { label: "文本框", action: () => addObject({ paragraphs: [{ runs: [{ text: "新文本" }] }], fontSize: 24, align: "left" }, { x: 380, y: 260, w: 520, h: 80 }, "text") },
    { label: "矩形", action: () => shape("rect") },
    { label: "圆角矩形", action: () => shape("round") },
    { label: "椭圆", action: () => shape("ellipse") },
    { label: "三角形", action: () => shape("triangle") },
    { label: "箭头", action: () => shape("arrow") },
    {
      label: "表格",
      action: () =>
        addObject(
          {
            rows: 3,
            cols: 3,
            cells: [
              [{ text: "" }, { text: "" }, { text: "" }],
              [{ text: "" }, { text: "" }, { text: "" }],
              [{ text: "" }, { text: "" }, { text: "" }],
            ],
          },
          { x: 290, y: 200, w: 700, h: 320 },
          "table",
        ),
    },
    {
      label: "图表",
      action: () =>
        addObject(
          {
            chartType: "bar",
            series: [
              {
                name: "系列 1",
                points: [
                  { label: "一", value: 30 },
                  { label: "二", value: 60 },
                  { label: "三", value: 45 },
                ],
              },
            ],
          },
          { x: 390, y: 180, w: 500, h: 360 },
          "chart",
        ),
    },
  ];

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="插入对象"
        aria-expanded={open}
        className="rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs text-ink hover:bg-canvas"
        onClick={() => setOpen((v) => !v)}
      >
        插入 +
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 grid w-32 grid-cols-1 gap-0.5 rounded-lg border border-hairline bg-overlay p-1 shadow-pop">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              className="rounded-sm px-2 py-1 text-left text-xs text-ink hover:bg-accent-soft"
              onClick={() => {
                item.action();
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Toolbar: insert, add slide, layout choice, pptx import, theme.
 *  Undo/redo live only in TopBar (single global history group). */
function Toolbar({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const projectId = useEditorStore((s) => s.projectId);
  const importInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  /** append: keep current slides; replace: re-import fixes (e.g. alpha parse fix). */
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [insertingImage, setInsertingImage] = useState(false);
  const [insertingVideo, setInsertingVideo] = useState(false);
  useEffect(() => {
    onBusyChange?.(importing || insertingImage || insertingVideo);
  }, [importing, insertingImage, insertingVideo, onBusyChange]);
  const [imageNotice, setImageNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [importNotice, setImportNotice] = useState<{ kind: "info" | "error"; text: string; detail?: string } | null>(null);
  const addSlide = (layout: PptLayoutChoice) => {
    runPptCommands([manualInvocation("slide.add", layout === "blank" ? {} : { layout })]);
  };
  const applyTheme = (themeId: string) => {
    runPptCommands([manualInvocation("theme.apply", { themeId })]);
  };
  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    if (!file || !projectId) return;
    setImporting(true);
    setImportNotice(null);
    try {
      const result = await api.importPptx(projectId, file, importMode);
      const applied = usePptEditorStore.getState().replaceDeck(result.document);
      if (!applied) {
        setImportNotice({ kind: "error", text: "导入失败：返回的文档未通过本地校验" });
        return;
      }
      const downgrade = result.warnings.length > 0 ? `，${result.warnings.length} 项内容降级` : "";
      setImportNotice({
        kind: "info",
        text:
          importMode === "replace"
            ? `已重新导入并替换为 ${result.imported.slides} 页、${result.imported.assets} 张图片${downgrade}（记得 Ctrl+S 保存）`
            : `已从模板追加 ${result.imported.slides} 页、${result.imported.assets} 张图片${downgrade}（记得 Ctrl+S 保存）`,
        detail: result.warnings.join("\n"),
      });
    } catch (err) {
      setImportNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setImporting(false);
    }
  };
  /** Upload one image as a project asset, then add an image object on the slide. */
  const handleImageFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    const slideId =
      usePptEditorStore.getState().selectedSlideId ?? usePptEditorStore.getState().deck?.slides[0]?.id;
    if (!file || !projectId || !slideId) return;
    setInsertingImage(true);
    setImageNotice(null);
    try {
      const uploaded = await api.uploadPptAsset(projectId, file);
      // Cascade consecutive inserts so they don't stack 1:1 on top of each other.
      const imageCount =
        usePptEditorStore.getState().deck?.slides.find((s) => s.id === slideId)?.objects.filter((o) => o.kind === "image").length ?? 0;
      const offset = (imageCount % 6) * 36;
      const ok = runPptCommands([
        manualInvocation("object.add", {
          slideId,
          object: {
            kind: "image",
            rect: { x: 128 + offset, y: 72 + offset, w: 1024, h: 576 },
            data: { src: uploaded.src, fit: "contain", title: file.name.slice(0, 200) },
          },
        }),
      ]);
      setImageNotice(
        ok
          ? { kind: "info", text: "图片已插入当前页（记得 Ctrl+S 保存）；可直接让 AI「把这张图铺满当背景」" }
          : { kind: "error", text: "图片已上传，但插入画布失败" },
      );
    } catch (err) {
      setImageNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setInsertingImage(false);
    }
  };
  /** Upload one video as a project asset, then add a video object (16:9 default). */
  const handleVideoFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file
    const slideId =
      usePptEditorStore.getState().selectedSlideId ?? usePptEditorStore.getState().deck?.slides[0]?.id;
    if (!file || !projectId || !slideId) return;
    setInsertingVideo(true);
    setImageNotice(null);
    try {
      const uploaded = await api.uploadPptAsset(projectId, file, "video");
      // Cascade consecutive inserts so they don't stack 1:1 on top of each other.
      const videoCount =
        usePptEditorStore.getState().deck?.slides.find((s) => s.id === slideId)?.objects.filter((o) => o.kind === "video").length ?? 0;
      const offset = (videoCount % 6) * 36;
      const ok = runPptCommands([
        manualInvocation("object.add", {
          slideId,
          object: {
            kind: "video",
            rect: { x: 200 + offset, y: 140 + offset, w: 880, h: 495 },
            data: { src: uploaded.src, title: file.name.slice(0, 200) },
          },
        }),
      ]);
      setImageNotice(
        ok
          ? { kind: "info", text: "视频已插入当前页（记得 Ctrl+S 保存）；画布上可直接点播放预览" }
          : { kind: "error", text: "视频已上传，但插入画布失败" },
      );
    } catch (err) {
      setImageNotice({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setInsertingVideo(false);
    }
  };
  return (
    <>
    <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-hairline bg-rail px-3 py-1.5">
      <InsertMenu />
      <button
        type="button"
        aria-label="新增幻灯片"
        className="rounded-lg bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover"
        onClick={() => addSlide("blank")}
      >
        新增幻灯片
      </button>
      <select
        aria-label="新增幻灯片布局"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value !== "") addSlide(e.target.value as PptLayoutChoice);
          e.target.value = "";
        }}
      >
        <option value="" disabled>按布局新增…</option>
        <option value="title">标题页</option>
        <option value="titleContent">标题+内容</option>
        <option value="blank">空白页</option>
      </select>
      <div className="flex items-center overflow-hidden rounded-lg border border-hairline">
        <button
          type="button"
          aria-label={importMode === "replace" ? "导入 PPTX 模板（替换全部）" : "导入 PPTX 模板（追加页面）"}
          disabled={importing || !projectId}
          className="border-r border-hairline bg-surface px-2.5 py-1 text-xs text-ink hover:bg-canvas disabled:opacity-50"
          onClick={() => importInputRef.current?.click()}
        >
          {importing ? "导入中…" : importMode === "replace" ? "重新导入（替换）" : "导入 .pptx"}
        </button>
        <select
          aria-label="导入模式"
          title="追加：保留当前页；替换：用模板重新覆盖整个演示"
          className="h-full bg-surface px-1 py-1 text-[10px] text-ink-muted outline-none"
          value={importMode}
          onChange={(e) => setImportMode(e.target.value as "append" | "replace")}
          disabled={importing}
        >
          <option value="append">追加</option>
          <option value="replace">替换全部</option>
        </select>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        className="hidden"
        onChange={(e) => void handleImportFile(e)}
      />
      <button
        type="button"
        aria-label="插入图片到当前页"
        disabled={insertingImage || !projectId}
        className="studio-transition rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs text-ink hover:bg-canvas disabled:opacity-50"
        onClick={() => imageInputRef.current?.click()}
      >
        {insertingImage ? "上传中…" : "插入图片"}
      </button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
        className="hidden"
        aria-label="选择图片文件"
        onChange={(e) => void handleImageFile(e)}
      />
      <button
        type="button"
        aria-label="插入视频到当前页"
        disabled={insertingVideo || !projectId}
        className="studio-transition rounded-lg border border-hairline bg-surface px-2.5 py-1 text-xs text-ink hover:bg-canvas disabled:opacity-50"
        onClick={() => videoInputRef.current?.click()}
      >
        {insertingVideo ? "上传中…" : "插入视频"}
      </button>
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        className="hidden"
        aria-label="选择视频文件"
        onChange={(e) => void handleVideoFile(e)}
      />
      <div className="flex-1" />
      <label className="text-xs text-ink-muted" htmlFor="ppt-theme-select">主题</label>
      <select
        id="ppt-theme-select"
        aria-label="应用主题"
        className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink"
        value={currentThemeId(usePptEditorStore.getState().deck)}
        onChange={(e) => applyTheme(e.target.value)}
      >
        {/* Custom (AI/import) colors get an inert placeholder so the select
            never displays a built-in theme it would overwrite on click. */}
        <option value="custom" disabled hidden>
          自定义
        </option>
        {PPT_THEME_IDS.map((id) => (
          <option key={id} value={id}>{themeLabel[id]}</option>
        ))}
      </select>
    </header>
    {importNotice && (
      <p
        role={importNotice.kind === "error" ? "alert" : "status"}
        title={importNotice.detail}
        className={`shrink-0 border-b px-3 py-1 text-xs ${
          importNotice.kind === "error"
            ? "border-danger/30 bg-danger-soft text-danger"
            : "border-hairline bg-surface text-ink-soft"
        }`}
      >
        {importNotice.text}
      </p>
    )}
    {imageNotice && (
      <p
        role={imageNotice.kind === "error" ? "alert" : "status"}
        className={`shrink-0 border-b px-3 py-1 text-xs ${
          imageNotice.kind === "error"
            ? "border-danger/30 bg-danger-soft text-danger"
            : "border-hairline bg-surface text-ink-soft"
        }`}
      >
        {imageNotice.text}
      </p>
    )}
    </>
  );
}

type PptLayoutChoice = "title" | "titleContent" | "blank";

/** Best-effort theme id for the select's controlled value (matched by colors). */
function currentThemeId(deck: PptDocument | null): string {
  if (!deck) return "brand";
  for (const id of PPT_THEME_IDS) {
    const theme = PPT_THEMES[id];
    if (theme.primary === deck.theme.primary && theme.background === deck.theme.background) return id;
  }
  return "custom"; // AI/import colors not matching a built-in theme
}

const themeLabel: Record<string, string> = { brand: "品牌主题", professional: "专业商务", minimal: "极简黑白" };
