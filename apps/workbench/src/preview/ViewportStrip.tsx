import type { Page, Tokens } from "@studio/schema-core";
import { useEffect, useRef, useState } from "react";
import { DEVICE_PAGE } from "../features/canvas/devicePresets";
import type { Viewport } from "../state/editorStore";
import { SchemaRenderer } from "./SchemaRenderer";

/**
 * U6: read-only three-viewport side-by-side preview. All three columns render
 * the SAME Page through the SAME SchemaRenderer — the only per-column input is
 * the viewport prop, so W4-A breakpoint overlays resolve per column with zero
 * new render logic. Selection is hard-wired off (selectedId=null + noop), the
 * same read-only contract as VersionDiff.PreviewPane: three views must stay
 * pixel-identical, no per-viewport editing entry may ever appear here.
 */
export interface ViewportStripProps {
  page: Page;
  tokens: Tokens;
}

/** Column order is the preset order (wide to narrow); labels match the
 *  PreviewSurface 视口 segmented. Widths come from the DEVICE_PAGE single source. */
const PANES: readonly { name: Viewport; label: string }[] = [
  { name: "desktop", label: "桌面" },
  { name: "tablet", label: "平板" },
  { name: "mobile", label: "手机" },
];

const noop = (): void => {};

export function ViewportStrip({ page, tokens }: ViewportStripProps) {
  return (
    <div className="flex h-full min-h-0 gap-3" data-testid="viewport-strip">
      {PANES.map((p) => (
        <ViewportPane key={p.name} name={p.name} label={p.label} page={page} tokens={tokens} />
      ))}
    </div>
  );
}

/** One read-only column: header (label + preset width) + the scaled paper. */
function ViewportPane(props: {
  name: Viewport;
  label: string;
  page: Page;
  tokens: Tokens;
}) {
  const width = DEVICE_PAGE[props.name].w;
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Scale the fixed-width paper down to the column width (never up), same
  // approach as PreviewSurface.FitWidth; the renderer keeps its true viewport
  // width so breakpoint media semantics stay driven by the preset, not the box.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => setScale(Math.min(1, (host.clientWidth - 16) / width));
    update();
    // jsdom lacks ResizeObserver — the initial update above is enough there.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(host);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div
      data-testid={`viewport-pane-${props.name}`}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-hairline bg-surface"
    >
      <p className="shrink-0 border-b border-hairline px-2 py-1 text-[11px] text-ink-muted">
        {props.label} {width}px
      </p>
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto bg-white p-2">
        <div style={{ width: `${width * scale}px`, margin: "0 auto" }}>
          <div
            data-testid="viewport-paper"
            style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: `${width}px` }}
          >
            <SchemaRenderer
              doc={props.page}
              tokens={props.tokens}
              selectedId={null}
              onSelect={noop}
              viewport={props.name}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
