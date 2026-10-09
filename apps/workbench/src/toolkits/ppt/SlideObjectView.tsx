import { SLIDE_HEIGHT, SLIDE_WIDTH, type PptSlideObject } from "@studio/ppt-toolkit";
import { useEffect, useState, type CSSProperties } from "react";

/**
 * Simplified visual representations for each slide object kind. Pure CSS/div
 * renderings inside the scaled canvas — full fidelity rendering is out of
 * P9.1 scope, but every kind must be visibly distinguishable.
 */

export interface SlideObjectViewProps {
  object: PptSlideObject;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}

export function SlideObjectView({ object, selected, onPointerDown }: SlideObjectViewProps) {
  const style: CSSProperties = {
    position: "absolute",
    left: object.rect.x,
    top: object.rect.y,
    width: object.rect.w,
    height: object.rect.h,
  };
  return (
    <div
      data-object-id={object.id}
      aria-label={objectLabel(object)}
      style={style}
      className={`studio-transition ${selected ? "outline outline-2 outline-accent" : ""} ${
        object.locked === true ? "cursor-default" : "cursor-move"
      }`}
      onPointerDown={onPointerDown}
    >
      <ObjectBody object={object} />
    </div>
  );
}

/** Kind-specific inner content (the wrapper owns position/size/selection). */
function ObjectBody({ object }: { object: PptSlideObject }) {
  switch (object.kind) {
    case "text":
      return <TextBody object={object} />;
    case "shape":
      return <ShapeBody object={object} />;
    case "image":
      return <ImageBody object={object} />;
    case "video":
      return <VideoBody object={object} />;
    case "table":
      return <TableBody object={object} />;
    case "chart":
      return <ChartBody object={object} />;
    case "group":
      return (
        <div className="h-full w-full rounded-sm border border-dashed border-hairline-strong" aria-hidden>
          <span className="absolute left-1 top-1 bg-canvas/80 px-1 text-[10px] text-ink-muted">
            分组 {object.children.length}
          </span>
        </div>
      );
    case "placeholder":
      return (
        <div className="flex h-full w-full items-center justify-center rounded-sm border border-dashed border-hairline-strong bg-canvas/40">
          <span className="truncate px-2 text-center text-sm text-ink-muted">{object.text ?? placeholderText(object.subtype)}</span>
        </div>
      );
  }
}

/**
 * Image with an explicit broken-load fallback. A fabricated/unreachable URL
 * used to render as nothing at all ("AI ran but nothing happened"); now the
 * failure is visible and actionable (replace via the object property panel).
 */
function ImageBody({ object }: { object: Extract<PptSlideObject, { kind: "image" }> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [object.src]);
  if (failed) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-danger/60 bg-danger/10 px-2 text-center"
        data-image-load-failed={object.id}
      >
        <span className="text-xs font-medium text-danger">图片无法加载</span>
        <span className="w-full truncate text-[10px] text-ink-muted">{describeImageSrc(object.src)}</span>
        <span className="text-[10px] text-ink-muted">可在右侧属性面板上传图片替换</span>
      </div>
    );
  }
  return (
    <img
      src={object.src}
      alt={object.title ?? "图片对象"}
      className="h-full w-full"
      style={{
        objectFit: object.fit,
        ...(object.opacity !== undefined ? { opacity: object.opacity } : {}),
        ...(object.radius !== undefined ? { borderRadius: object.radius } : {}),
        ...(object.border ? { border: `2px solid ${object.border}` } : {}),
      }}
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** Human-readable locator for a broken image src (host for URLs, scheme for data). */
function describeImageSrc(src: string): string {
  if (src.startsWith("data:")) return "data 内嵌图片数据异常";
  try {
    const url = new URL(src, window.location.origin);
    return url.origin === window.location.origin ? url.pathname : url.hostname;
  } catch {
    return src.slice(0, 60);
  }
}

/**
 * Canvas video: native <video> controls inside the scaled canvas (requirement:
 * the browser plays local project assets; no autoplay). preload=metadata
 * fetches the first frame / poster without downloading the whole file. Broken
 * srcs fall back to a visible failed state like ImageBody.
 */
function VideoBody({ object }: { object: Extract<PptSlideObject, { kind: "video" }> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [object.src]);
  if (failed) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-danger/60 bg-danger/10 px-2 text-center"
        data-video-load-failed={object.id}
      >
        <span className="text-xs font-medium text-danger">视频无法播放</span>
        <span className="w-full truncate text-[10px] text-ink-muted">{describeImageSrc(object.src)}</span>
        <span className="text-[10px] text-ink-muted">可在右侧属性面板上传视频替换</span>
      </div>
    );
  }
  return (
    <video
      src={object.src}
      controls
      preload="metadata"
      poster={object.poster}
      title={object.title}
      className="h-full w-full bg-black"
      onError={() => setFailed(true)}
    />
  );
}

function TextBody({ object }: { object: Extract<PptSlideObject, { kind: "text" }> }) {
  const align = object.align ?? "left";
  return (
    <div
      className="flex h-full w-full flex-col justify-center overflow-hidden"
      // Explicit dark default: imported runs without a color must NOT inherit
      // the dark app shell's near-white foreground (white text on white slide
      // read as "all text missing").
      style={{
        textAlign: align,
        color: "#1f2937",
        ...(object.fontFamily ? { fontFamily: object.fontFamily } : {}),
      }}
    >
      {object.paragraphs.map((paragraph, pi) => (
        <p
          key={pi}
          // Wrap instead of truncate: imported body copy is often multi-line;
          // truncate cut it to a single ellipsized line ("text incomplete").
          className="m-0 whitespace-pre-wrap break-words leading-snug"
          style={{ fontSize: object.fontSize ?? 24 }}
        >
          {paragraph.runs.map((run, ri) => (
            <span
              key={ri}
              style={{
                ...(run.bold ? { fontWeight: 700 } : {}),
                ...(run.italic ? { fontStyle: "italic" } : {}),
                ...(run.color ? { color: run.color } : {}),
              }}
            >
              {run.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function ShapeBody({ object }: { object: Extract<PptSlideObject, { kind: "shape" }> }) {
  const fill = gradientCss(object.gradient) ?? object.fill ?? "#94A3B8";
  return (
    <div className="h-full w-full" style={shapeStyle(object.shape, fill, object.stroke, object.opacity)} aria-hidden />
  );
}

/** Convert the imported gradient model to a CSS linear-gradient string. */
function gradientCss(gradient: Extract<PptSlideObject, { kind: "shape" }>["gradient"]): string | null {
  if (!gradient || gradient.stops.length === 0) return null;
  const stops = gradient.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(",");
  // OOXML angle 0 = left→right; CSS 0deg = bottom→top. Convert: css = ooxml − 90.
  return `linear-gradient(${gradient.angle - 90}deg, ${stops})`;
}

/** CSS-only approximations of the five shape kinds. */
function shapeStyle(
  shape: Extract<PptSlideObject, { kind: "shape" }>["shape"],
  fill: string,
  stroke?: string,
  opacity?: number,
): CSSProperties {
  const o = opacity !== undefined ? { opacity } : {};
  switch (shape) {
    case "round":
      return { background: fill, borderRadius: "24px", ...o, ...(stroke ? { border: `2px solid ${stroke}` } : {}) };
    case "ellipse":
      return { background: fill, borderRadius: "50%", ...o, ...(stroke ? { border: `2px solid ${stroke}` } : {}) };
    case "triangle":
      return {
        width: 0,
        height: 0,
        marginLeft: "auto",
        marginRight: "auto",
        ...o,
        borderLeft: "calc(100% / 2) solid transparent",
        borderRight: "calc(100% / 2) solid transparent",
        borderBottom: "100% solid",
        borderBottomColor: fill,
      };
    case "arrow":
      return {
        background: fill,
        ...o,
        clipPath: "polygon(0% 35%, 70% 35%, 70% 10%, 100% 50%, 70% 90%, 70% 65%, 0% 65%)",
      };
    case "rect":
    default:
      return { background: fill, ...o, ...(stroke ? { border: `2px solid ${stroke}` } : {}) };
  }
}

function TableBody({ object }: { object: Extract<PptSlideObject, { kind: "table" }> }) {
  return (
    <table className="h-full w-full table-fixed border-collapse text-[11px] text-ink" aria-hidden>
      <tbody>
        {object.cells.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} className="truncate border border-hairline px-1 text-center">
                {cell.text}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChartBody({ object }: { object: Extract<PptSlideObject, { kind: "chart" }> }) {
  // Single-series quick read; multi-series charts fall back to a badge.
  const series = object.series[0];
  const total = series ? series.points.length : 0;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm border border-hairline bg-canvas/40" aria-hidden>
      <span className="text-xs text-ink-soft">
        {chartLabel[object.chartType]}（{object.series.length} 系列 / {total} 项）
      </span>
      {series && (
        <div className="flex h-1/2 w-4/5 items-end justify-center gap-1">
          {series.points.map((point, pi) => (
            <div key={pi} className="w-2 rounded-t bg-accent" style={{ height: barHeight(point.value, series) }} />
          ))}
        </div>
      )}
    </div>
  );
}

const chartLabel: Record<string, string> = { bar: "柱状图", line: "折线图", pie: "饼图" };

function barHeight(value: number, series: { points: { value: number }[] }): string {
  const max = Math.max(...series.points.map((p) => p.value), 0) || 1;
  return `${Math.max((value / max) * 100, 4)}%`;
}

function placeholderText(subtype: string): string {
  const map: Record<string, string> = { title: "标题占位", content: "内容占位", subtitle: "副标题占位", notes: "备注占位" };
  return map[subtype] ?? "占位";
}

function objectLabel(object: PptSlideObject): string {
  const title = "title" in object && object.title ? object.title : kindLabel[object.kind] ?? object.kind;
  return `${title}（${Math.round(object.rect.x)}, ${Math.round(object.rect.y)}）`;
}

const kindLabel: Record<string, string> = {
  text: "文本",
  shape: "形状",
  image: "图片",
  video: "视频",
  table: "表格",
  chart: "图表",
  group: "分组",
  placeholder: "占位符",
};

export const SLIDE_SIZE_STYLE: CSSProperties = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
