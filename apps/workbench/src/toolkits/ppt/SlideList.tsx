import type { PptDocument, PptSlide } from "@studio/ppt-toolkit";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { manualInvocation, runPptCommands } from "./state";

export interface SlideListProps {
  deck: PptDocument;
  selectedSlideId: string | null;
  onSelect: (id: string) => void;
}

/** Left rail: slide thumbnails with duplicate/delete/lock actions and drag reorder. */
export function SlideList({ deck, selectedSlideId, onSelect }: SlideListProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const duplicate = (slide: PptSlide) => {
    runPptCommands([manualInvocation("slide.duplicate", { slideId: slide.id })]);
  };
  const remove = (slide: PptSlide) => {
    runPptCommands([manualInvocation("slide.remove", { slideId: slide.id })]);
  };
  const toggleLock = (slide: PptSlide) => {
    runPptCommands([manualInvocation("slide.lock", { slideId: slide.id, locked: slide.locked !== true })]);
  };

  const dragOver = (index: number) => {
    if (dragId === null) return;
    setDropIndex(index);
  };
  const drop = () => {
    if (dragId !== null && dropIndex !== null) {
      const fromIndex = deck.slides.findIndex((s) => s.id === dragId);
      // Dropping on its own slot: no transaction / undo point / dirty flag.
      if (fromIndex !== dropIndex) {
        runPptCommands([manualInvocation("slide.reorder", { slideId: dragId, index: dropIndex })]);
      }
    }
    setDragId(null);
    setDropIndex(null);
  };

  return (
    <ol aria-label="幻灯片列表" className="flex w-48 shrink-0 flex-col gap-2 overflow-y-auto border-r border-hairline bg-rail p-2">
      {deck.slides.map((slide, index) => (
        <SlideCard
          key={slide.id}
          slide={slide}
          index={index}
          selected={slide.id === selectedSlideId}
          dropTarget={dropIndex === index && dragId !== null && dragId !== slide.id}
          onSelect={onSelect}
          onDuplicate={duplicate}
          onRemove={remove}
          onToggleLock={toggleLock}
          onDragStart={(e) => {
            // Firefox refuses to start a DnD without data in the dataTransfer.
            e.dataTransfer.setData("text/plain", slide.id);
            e.dataTransfer.effectAllowed = "move";
            setDragId(slide.id);
          }}
          onDragOver={() => dragOver(index)}
          onDrop={drop}
          onDragEnd={() => {
            setDragId(null);
            setDropIndex(null);
          }}
        />
      ))}
    </ol>
  );
}

interface SlideCardProps {
  slide: PptSlide;
  index: number;
  selected: boolean;
  dropTarget: boolean;
  onSelect: (id: string) => void;
  onDuplicate: (slide: PptSlide) => void;
  onRemove: (slide: PptSlide) => void;
  onToggleLock: (slide: PptSlide) => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

/** One thumbnail card: number + title + lock badge + per-slide action row. */
function SlideCard(props: SlideCardProps) {
  const { slide, index, selected, dropTarget } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLLIElement>(null);

  // Click-outside closes the action menu without stealing slide selection.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <li
      ref={rootRef}
      data-slide-id={slide.id}
      draggable
      onDragStart={props.onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        props.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDrop();
      }}
      onDragEnd={props.onDragEnd}
      className={`relative rounded-lg border px-2 py-1.5 text-left studio-transition ${
        selected ? "border-accent bg-accent-soft" : "border-hairline bg-surface hover:border-hairline-strong"
      } ${dropTarget ? "border-accent" : ""}`}
    >
      <button
        type="button"
        aria-label={`幻灯片 ${index + 1}：${slide.title}${slide.locked === true ? "（已锁定）" : ""}`}
        aria-current={selected}
        onClick={() => props.onSelect(slide.id)}
        onDoubleClick={() => setMenuOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{slide.title}</span>
        {slide.locked === true && (
          <span aria-hidden className="text-xs text-warn" title="已锁定">
            🔒
          </span>
        )}
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 flex flex-col rounded-lg border border-hairline bg-overlay p-1 shadow-pop">
          <MenuButton label={`复制幻灯片 ${index + 1}`} onClick={() => { setMenuOpen(false); props.onDuplicate(slide); }} />
          <MenuButton label={`删除幻灯片 ${index + 1}`} onClick={() => { setMenuOpen(false); props.onRemove(slide); }} />
          <MenuButton
            label={`${slide.locked === true ? "解锁" : "锁定"}幻灯片 ${index + 1}`}
            onClick={() => { setMenuOpen(false); props.onToggleLock(slide); }}
          />
        </div>
      )}
    </li>
  );
}

function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded-md px-2 py-1 text-left text-xs text-ink-soft hover:bg-accent-soft hover:text-ink"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
