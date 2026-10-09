import { useEffect, useState } from "react";
import type { PptSlide } from "@studio/ppt-toolkit";
import { usePptEditorStore } from "./state";
import { SlideObjectView } from "./SlideObjectView";

/**
 * Presenter view: fullscreen player rendering the REAL slide (images/shapes/
 * tables included), not a text-only bullet list. ←/→ paging, Esc exits.
 * Purely presentational — it never mutates the document.
 */
export function PresenterView() {
  const deck = usePptEditorStore((s) => s.deck);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const slideCount = deck?.slides.length ?? 0;
  const slide = open && deck ? deck.slides[Math.min(index, slideCount - 1)] ?? null : null;

  // Keyboard control only while the player is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowRight") setIndex((at) => Math.min(at + 1, slideCount - 1));
      if (event.key === "ArrowLeft") setIndex((at) => Math.max(at - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, slideCount]);

  const start = () => {
    setIndex(0);
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        aria-label="开始放映"
        disabled={slideCount === 0}
        className="rounded-lg border border-hairline-strong bg-surface px-2.5 py-1 text-xs text-ink transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-faint"
        onClick={start}
      >
        放映
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="幻灯片放映"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black px-16 text-white"
        >
          {slide && deck ? (
            <div
              className="origin-center overflow-hidden shadow-2xl"
              style={{
                width: 1280 * 0.9,
                height: 720 * 0.9,
                background: slide.background ?? deck.theme.background,
              }}
            >
              <div
                className="origin-top-left"
                style={{ width: 1280, height: 720, transform: "scale(0.9)" }}
              >
                {slide.objects.map((object) => (
                  <SlideObjectView
                    key={object.id}
                    object={object}
                    selected={false}
                    onPointerDown={() => {}}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xl text-white/60">空演示文稿</p>
          )}
          <footer className="absolute bottom-6 flex w-full items-center justify-between px-8 text-sm text-white/50">
            <span>← → 翻页 · Esc 退出</span>
            <span>
              {slideCount === 0 ? 0 : Math.min(index, slideCount - 1) + 1} / {slideCount}
            </span>
          </footer>
        </div>
      )}
    </>
  );
}
