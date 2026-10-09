import type { PptSlide, PptSlideObject } from "@studio/ppt-toolkit";
import { useEffect, useState } from "react";
import { clampedRectField } from "./geometry";
import { manualInvocation, runPptCommands } from "./state";
import { ChartDetailFields } from "./properties/ChartFields";
import { ImageFields } from "./properties/ImageFields";
import { LayerOrderRow } from "./properties/LayerOrderRow";
import { MultiSelectSection } from "./properties/MultiSelectSection";
import { RectFields } from "./properties/RectFields";
import { ShapeDetailFields } from "./properties/ShapeFields";
import { SlideSection } from "./properties/SlideSection";
import { TableDetailFields } from "./properties/TableFields";
import { TextDetailFields } from "./properties/TextFields";
import { VideoFields } from "./properties/VideoFields";
import { kindLabel, objectText } from "./properties/properties-shared";

export interface PropertyPanelProps {
  slide: PptSlide | null;
  selectedObject: PptSlideObject | null;
  titleDraft?: string;
  onTitleDraftChange?: (draft: string | undefined) => void;
  objectTextDraft?: string;
  onObjectTextDraftChange?: (draft: string | undefined) => void;
}

/** Right rail: multi-select actions, object properties, or slide properties. */
export function PropertyPanel({
  slide,
  selectedObject,
  selectedIds,
  titleDraft,
  onTitleDraftChange,
  objectTextDraft,
  onObjectTextDraftChange,
}: PropertyPanelProps & { selectedIds?: string[] }) {
  if (!slide) {
    return (
      <aside aria-label="属性面板" className="p-3 text-xs text-ink-muted">无幻灯片</aside>
    );
  }
  const multi = (selectedIds ?? []).length > 1 && !selectedObject;
  return (
    <aside aria-label="属性面板" className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-hairline bg-rail p-3">
      {multi && selectedIds ? (
        <MultiSelectSection key="multi" slide={slide} objectIds={selectedIds} />
      ) : selectedObject ? (
        <ObjectSection
          key={selectedObject.id}
          object={selectedObject}
          textDraft={objectTextDraft}
          onTextDraftChange={onObjectTextDraftChange}
        />
      ) : (
        <SlideSection
          key={slide.id}
          slide={slide}
          titleDraft={titleDraft}
          onTitleDraftChange={onTitleDraftChange}
        />
      )}
    </aside>
  );
}

/** Selected object: rect numbers + kind-specific detail editors + lock/delete. */
function ObjectSection({ object, textDraft, onTextDraftChange }: {
  object: PptSlideObject;
  textDraft?: string;
  onTextDraftChange?: (draft: string | undefined) => void;
}) {
  const [localText, setLocalText] = useState(objectText(object));
  const text = textDraft ?? localText;

  useEffect(() => {
    if (textDraft === undefined) setLocalText(objectText(object));
  }, [object, textDraft]);

  const commitRect = (field: "x" | "y" | "w" | "h", value: number) => {
    const next = clampedRectField(object.rect, field, value);
    runPptCommands([manualInvocation("object.resize", { objectId: object.id, rect: next })]);
  };
  const editableText = object.kind === "text" || object.kind === "placeholder";
  const commitText = () => {
    if (!editableText) return;
    // Newline-separated lines become multiple paragraphs; bold/color runs of
    // AI-authored text are intentionally preserved only when single-line.
    const lines = text.split("\n");
    const paragraphs = lines.map((line) => ({ runs: [{ text: line }] }));
    if (runPptCommands([manualInvocation("object.editText", { objectId: object.id, paragraphs })])) {
      onTextDraftChange?.(undefined);
      setLocalText(text);
    }
  };
  const toggleLock = () => {
    runPptCommands([manualInvocation("object.lock", { objectId: object.id, locked: object.locked !== true })]);
  };
  const remove = () => {
    runPptCommands([manualInvocation("object.remove", { objectId: object.id })]);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">对象属性</h3>
        <span className="text-xs text-ink-muted">{kindLabel[object.kind]}</span>
      </header>
      <RectFields rect={object.rect} onCommit={commitRect} />
      {editableText && (
        <TextDetailFields
          object={object}
          text={text}
          onTextChange={(value) => {
            if (onTextDraftChange) onTextDraftChange(value);
            else setLocalText(value);
          }}
          onTextCommit={commitText}
        />
      )}
      {object.kind === "shape" && <ShapeDetailFields object={object} />}
      {object.kind === "image" && <ImageFields object={object} />}
      {object.kind === "video" && <VideoFields object={object} />}
      {object.kind === "table" && <TableDetailFields object={object} />}
      {object.kind === "chart" && <ChartDetailFields object={object} />}
      {object.kind === "group" && (
        <button
          type="button"
          className="rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong"
          onClick={() => runPptCommands([manualInvocation("object.ungroup", { objectId: object.id })])}
        >
          取消组合（保留成员）
        </button>
      )}
      <LayerOrderRow objectIds={[object.id]} withDuplicate />
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={object.locked === true ? "解锁对象" : "锁定对象"}
          className="flex-1 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-ink-soft hover:border-hairline-strong"
          onClick={toggleLock}
        >
          {object.locked === true ? "解锁对象" : "锁定对象"}
        </button>
        <button
          type="button"
          aria-label="删除对象"
          className="flex-1 rounded-lg border border-hairline bg-surface px-2 py-1 text-xs text-danger hover:border-hairline-strong"
          onClick={remove}
        >
          删除对象
        </button>
      </div>
    </div>
  );
}
