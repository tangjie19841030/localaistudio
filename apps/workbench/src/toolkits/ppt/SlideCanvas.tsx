import type { PptDocument, PptSlide, PptSlideObject } from "@studio/ppt-toolkit";
import type { CommandInvocation } from "@studio/studio-core";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  dataToScreen,
  fitScale,
  movedRect,
  RESIZE_HANDLES,
  resizedRect,
  screenToData,
  type CanvasView,
  type ResizeHandle,
} from "./geometry";
import { manualInvocation, runPptCommands, usePptEditorStore } from "./state";
import { SLIDE_SIZE_STYLE, SlideObjectView } from "./SlideObjectView";

export interface SlideCanvasProps {
  deck: PptDocument;
  slide: PptSlide | null;
  selectedObjectIds: string[];
  /** Click the canvas OUTSIDE the slide: clear to whole-file reach. */
  onSelectSlide: () => void;
  /** Click the slide surface itself: keep the slide, just clear object selection. */
  onClearObjects?: () => void;
  /** Import/upload in progress: block canvas edits (late-arriving replace swaps the doc). */
  interactionLocked?: boolean;
  /** Click (or drag-start on) an object; additive = Shift/Ctrl/Cmd held (multi-select). */
  onSelectObject: (id: string, additive?: boolean) => void;
}

/** Active pointer drag: move or resize, origin coords in client space. */
type DragMode =
  | { kind: "move"; id: string; startX: number; startY: number }
  | { kind: "resize"; id: string; handle: ResizeHandle; startX: number; startY: number }
  | null;

/**
 * Center canvas: the fixed 1280x720 data space, rendered at a fitted scale
 * (data coords never change; only the scale/offset of the view).
 */
export function SlideCanvas({ deck, slide, selectedObjectIds, onSelectSlide, onClearObjects, onSelectObject, interactionLocked }: SlideCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [drag, setDrag] = useState<DragMode>(null);

  useContainerScale(containerRef, setScale);

  // Keyboard editing: Delete removes selection, Esc clears it (then widens to
  // whole-file reach), arrows nudge (Shift = 10px). Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      // Read selection/deck LIVE at key time: a closure over the render-time
      // props misses store changes that happened without a rerender.
      const store = usePptEditorStore.getState();
      const ids = store.selectedObjectIds;
      const currentSlideId = store.selectedSlideId ?? store.deck?.slides[0]?.id ?? null;
      const current = store.deck?.slides.find((s) => s.id === currentSlideId);
      if (!current) return;
      if (ids.length === 0) {
        if (e.key === "Escape") store.selectSlide(null);
        return;
      }
      if (e.key === "Escape") {
        store.selectObjects([]);
        return;
      }
      if (current.locked) return;
      const targets = ids
        .map((id) => current.objects.find((o) => o.id === id))
        .filter((o): o is PptSlideObject => Boolean(o) && o!.locked !== true);
      if ((e.key === "Delete" || e.key === "Backspace") && targets.length > 0) {
        runPptCommands(targets.map((o) => manualInvocation("object.remove", { objectId: o.id })));
        usePptEditorStore.getState().selectObjects([]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D") && targets.length > 0) {
        e.preventDefault();
        runPptCommands(targets.map((o) => manualInvocation("object.duplicate", { objectId: o.id })));
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const deltas: Record<string, { dx: number; dy: number }> = {
        ArrowLeft: { dx: -step, dy: 0 },
        ArrowRight: { dx: step, dy: 0 },
        ArrowUp: { dx: 0, dy: -step },
        ArrowDown: { dx: 0, dy: step },
      };
      const d = deltas[e.key];
      if (!d || targets.length === 0) return;
      e.preventDefault();
      runPptCommands(
        targets.map((o) =>
          manualInvocation("object.move", {
            objectId: o.id,
            x: Math.max(0, Math.min(o.rect.x + d.dx, 1280 - o.rect.w)),
            y: Math.max(0, Math.min(o.rect.y + d.dy, 720 - o.rect.h)),
          }),
        ),
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!slide) {
    return (
      <div aria-label="幻灯片画布" className="m-auto text-sm text-ink-muted">无幻灯片</div>
    );
  }

  const beginObjectDrag = (object: PptSlideObject) => (e: ReactPointerEvent) => {
    // jsdom's synthetic pointerdown lacks `button` (0 only in real browsers).
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation(); // do not bubble to slide-surface selection reset
    // Shift / Ctrl / Cmd + click toggles membership of the multi-selection and
    // is select-only: multi-object move is not a toolkit command today.
    const additive = Boolean(e.shiftKey || e.metaKey || e.ctrlKey);
    onSelectObject(object.id, additive);
    if (additive) return;
    if (object.locked === true || slide.locked === true) return; // select-only for locked
    setDrag({ kind: "move", id: object.id, startX: e.clientX, startY: e.clientY });
  };

  const beginHandleDrag = (id: string, handle: ResizeHandle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    setDrag({ kind: "resize", id, handle, startX: e.clientX, startY: e.clientY });
  };

  return (
    <div
      ref={containerRef}
      aria-label="幻灯片画布"
      aria-busy={interactionLocked === true}
      className={`relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden bg-canvas p-6 ${interactionLocked ? "pointer-events-none opacity-60" : ""}`}
      onPointerDown={onSelectSlide}
    >
      <div
        ref={surfaceRef}
        data-slide-surface
        // touch-none: touch drags must move objects, not scroll/zoom the page.
        // Clicking the slide surface clears object selection but stays on the
        // slide; only the outer margin click widens reach to the whole file.
        className="relative shrink-0 touch-none shadow-card"
        style={{ width: 1280 * scale, height: 720 * scale }}
        onPointerDown={(e) => {
          e.stopPropagation();
          onClearObjects?.();
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          // Dark default ink inside the slide: imported text without an
          // explicit color must not inherit the dark app shell foreground.
          style={{ transform: `scale(${scale})`, color: "#1f2937", ...SLIDE_SIZE_STYLE }}
        >
          <div className="h-full w-full" style={{ background: slide.background ?? deck.theme.background }} />
          {slide.objects.map((object) => (
            <SlideObjectView
              key={object.id}
              object={object}
              selected={selectedObjectIds.includes(object.id)}
              onPointerDown={beginObjectDrag(object)}
            />
          ))}
          {selectedObjectIds.map((id) => {
            const object = slide.objects.find((candidate) => candidate.id === id);
            if (!object) return null;
            return (
              <SelectionFrame
                key={`sel-${id}`}
                object={object}
                scale={scale}
                // Resize handles act on one object; hide them in multi-selection
                // (object.resize takes a single id) and keep only the frames.
                showHandles={selectedObjectIds.length === 1}
                locked={object.locked === true || slide.locked === true}
                onHandleDown={(handle) => beginHandleDrag(id, handle)}
              />
            );
          })}
        </div>
      </div>
      <DragTracker
        drag={drag}
        slide={slide}
        selection={selectedObjectIds}
        view={() => surfaceView(surfaceRef, scale)}
        clear={() => setDrag(null)}
      />
    </div>
  );
}

/**
 * Document-level drag tracker. Rendered as a sibling so pointermove listeners
 * attach once per drag and detach on pointerup (jsdom never runs them, but
 * real browsers need window-level capture while the cursor leaves the canvas).
 */
function DragTracker({ drag, slide, selection, view, clear }: {
  drag: DragMode;
  slide: PptSlide;
  selection: string[];
  view: () => CanvasView;
  clear: () => void;
}) {
  const attached = useRef(false);
  useEffectOnce(drag, () => {
    if (!drag || attached.current) return;
    attached.current = true;
    const store = usePptEditorStore.getState();
    store.beginGesture();
    // Freeze the dragged set + their start rects from the gesture-start slide.
    // A move drags the WHOLE multi-selection (locked members are skipped);
    // resize always acts on the single grabbed object.
    const baseRects = new Map<string, PptSlideObject["rect"]>();
    if (drag.kind === "move") {
      const ids = selection.includes(drag.id) ? selection : [drag.id];
      for (const id of ids) {
        const obj = slide.objects.find((candidate) => candidate.id === id);
        if (obj && obj.locked !== true) baseRects.set(id, obj.rect);
      }
    } else {
      const obj = slide.objects.find((candidate) => candidate.id === drag.id);
      if (obj) baseRects.set(drag.id, obj.rect);
    }
    const startX = drag.startX;
    const startY = drag.startY;
    const onMove = (e: PointerEvent) => {
      if (baseRects.size === 0) return;
      const v = view();
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const invocations: CommandInvocation[] = [];
      baseRects.forEach((rect, id) => {
        if (drag.kind === "move") {
          const next = movedRect(v, rect, dx, dy);
          if (!sameRect(next, rect)) {
            invocations.push(manualInvocation("object.move", { objectId: id, x: next.x, y: next.y }));
          }
        } else if (id === drag.id) {
          const next = resizedRect(v, rect, drag.handle, dx, dy);
          if (!sameRect(next, rect)) {
            invocations.push(manualInvocation("object.resize", { objectId: id, rect: next }));
          }
        }
      });
      if (invocations.length > 0) usePptEditorStore.getState().runGesturePreview(invocations);
    };
    const finish = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointercancel", finish);
      if (!attached.current) return;
      attached.current = false;
      // One undo point for the whole gesture (no-op for a click without movement).
      usePptEditorStore.getState().commitGesture();
      clear();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish, { once: true });
    document.addEventListener("pointercancel", finish, { once: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (attached.current) {
        attached.current = false;
        usePptEditorStore.getState().cancelGesture();
      }
      clear();
    };
  });
  return null;
}

function useEffectOnce(drag: DragMode, effect: () => void | (() => void)) {
  useEffect(() => {
    if (!drag) return;
    const cleanup = effect();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);
}

/** 8-direction resize handles around one selected object. */
function SelectionFrame({ object, scale, locked, showHandles, onHandleDown }: {
  object: PptSlideObject;
  scale: number;
  locked: boolean;
  showHandles: boolean;
  onHandleDown: (handle: ResizeHandle) => (e: ReactPointerEvent) => void;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute"
      style={{ left: object.rect.x, top: object.rect.y, width: object.rect.w, height: object.rect.h }}
    >
      {showHandles && !locked &&
        RESIZE_HANDLES.map((handle) => (
          <span
            key={handle}
            className={`pointer-events-auto absolute rounded-sm border border-accent bg-surface ${handleCursor[handle]}`}
            style={handlePosition(handle, object, scale)}
            onPointerDown={onHandleDown(handle)}
          />
        ))}
    </div>
  );
}

const handleCursor: Record<ResizeHandle, string> = {
  nw: "cursor-nwse-resize", n: "cursor-ns-resize", ne: "cursor-nesw-resize", e: "cursor-ew-resize",
  se: "cursor-nwse-resize", s: "cursor-ns-resize", sw: "cursor-nesw-resize", w: "cursor-ew-resize",
};

function handlePosition(handle: ResizeHandle, object: PptSlideObject, scale: number) {
  // The frame lives INSIDE the scaled layer: positions are data coords, and
  // the handle's own 8px screen size must counter-scale (8/scale data px),
  // otherwise handles land at w*scale² instead of on the object edge.
  const size = 8 / scale;
  const half = 4 / scale;
  const px = (v: number) => v - half;
  const map: Record<ResizeHandle, { left: number; top: number }> = {
    nw: { left: px(0), top: px(0) },
    n: { left: px(object.rect.w / 2), top: px(0) },
    ne: { left: px(object.rect.w), top: px(0) },
    e: { left: px(object.rect.w), top: px(object.rect.h / 2) },
    se: { left: px(object.rect.w), top: px(object.rect.h) },
    s: { left: px(object.rect.w / 2), top: px(object.rect.h) },
    sw: { left: px(0), top: px(object.rect.h) },
    w: { left: px(0), top: px(object.rect.h / 2) },
  };
  return { ...map[handle], width: size, height: size };
}

function sameRect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
}

/** Data-space view mapping from the live surface element box (0 offset: surface-relative coords). */
function surfaceView(surfaceRef: React.RefObject<HTMLDivElement | null>, scale: number): CanvasView {
  const el = surfaceRef.current;
  if (!el) return { scale, offsetX: 0, offsetY: 0 };
  const box = el.getBoundingClientRect();
  return { scale, offsetX: box.left, offsetY: box.top };
}

/** Keep the fitted scale in sync with the container box (panel resizer / window resize). */
function useContainerScale(ref: React.RefObject<HTMLDivElement | null>, setScale: (fn: (prev: number) => number) => void) {
  const recompute = () => {
    const el = ref.current;
    if (!el) return;
    const next = fitScale(el.clientWidth, el.clientHeight);
    setScale((prev) => (Math.abs(prev - next) > 0.001 ? next : prev));
  };
  useEffect(() => {
    recompute();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
}

