import { useEffect, useState } from "react";
import type { Block, Run, StyleSet, TableBlock } from "@studio/word-toolkit";
import { deriveResolvedBlockStyle, deriveResolvedRunStyle } from "@studio/word-toolkit";

/** pt → px scale factor; 1:1 keeps A4 (595.3pt) readable in the center panel. */
export const PT_TO_PX = 1;

/** Inline runs rendered with the resolved run style (direct format > styles). */
function RunsText({ runs, styles, block }: { runs: readonly Run[]; styles: StyleSet; block: Block }) {
  return (
    <>
      {runs.map((run, i) => {
        const resolved = deriveResolvedRunStyle(styles, block, run);
        return (
          <span
            key={i}
            style={{
              fontFamily: resolved.font,
              fontWeight: resolved.bold ? 700 : undefined,
              fontStyle: resolved.italic ? "italic" : undefined,
              ...(run.color ? { color: run.color } : {}),
              ...(run.size ? { fontSize: `${run.size * PT_TO_PX}px` } : {}),
              textDecoration: [resolved.underline ? "underline" : null, resolved.strike ? "line-through" : null]
                .filter(Boolean)
                .join(" ") || undefined,
            }}
          >
            {run.text}
          </span>
        );
      })}
    </>
  );
}

/** Common paragraph-level spacing from the resolved block style. */
function spacingStyle(styles: StyleSet, block: Block): React.CSSProperties {
  const resolved = deriveResolvedBlockStyle(styles, block);
  return {
    margin: `${resolved.spaceBefore * PT_TO_PX}px 0 ${resolved.spaceAfter * PT_TO_PX}px`,
    paddingLeft: resolved.indent * PT_TO_PX,
    fontSize: `${resolved.size * PT_TO_PX}px`,
    fontFamily: resolved.font,
    lineHeight: 1.5,
    // Preserve explicit newlines and let long URLs wrap instead of clipping.
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    wordBreak: "break-word",
  };
}

function HeadingView({ block, styles }: { block: Extract<Block, { type: "heading" }>; styles: StyleSet }) {
  const resolved = deriveResolvedBlockStyle(styles, block);
  return (
    <h3 style={{ ...spacingStyle(styles, block), fontWeight: resolved.bold ? 700 : 400 }}>
      <RunsText runs={block.runs} styles={styles} block={block} />
    </h3>
  );
}

function ParagraphView({ block, styles }: { block: Extract<Block, { type: "paragraph" }>; styles: StyleSet }) {
  return (
    <p style={spacingStyle(styles, block)}>
      <RunsText runs={block.runs} styles={styles} block={block} />
    </p>
  );
}

function ListView({ block, styles }: { block: Extract<Block, { type: "list" }>; styles: StyleSet }) {
  const items = block.items.map((item, i) => (
    <li key={i}>
      <RunsText runs={item.runs} styles={styles} block={block} />
    </li>
  ));
  const style = spacingStyle(styles, block);
  return block.ordered ? (
    <ol style={{ ...style, paddingLeft: (style.paddingLeft as number) + 18 }}>{items}</ol>
  ) : (
    <ul style={{ ...style, listStyleType: "disc", paddingLeft: (style.paddingLeft as number) + 18 }}>{items}</ul>
  );
}

function TableView({ block, styles }: { block: TableBlock; styles: StyleSet }) {
  return (
    <table style={{ ...spacingStyle(styles, block), width: "100%", borderCollapse: "collapse" }}>
      <tbody>
        {block.rows.map((row, r) => (
          <tr key={r}>
            {row.cells.map((cell, c) => (
              <td
                key={c}
                style={{
                  border: "1px solid #999",
                  padding: "2px 6px",
                  verticalAlign: "top",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  wordBreak: "break-word",
                }}
              >
                <RunsText runs={cell.runs} styles={styles} block={block} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ImageView({ block, styles }: { block: Extract<Block, { type: "image" }>; styles: StyleSet }) {
  const resolved = deriveResolvedBlockStyle(styles, block);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [block.src]);
  return (
    <figure style={{ ...spacingStyle(styles, block), marginInline: 0 }} data-word-image={block.id}>
      {failed ? (
        <div
          aria-label={`图片无法加载 ${block.src}`}
          style={{
            width: `${block.width * PT_TO_PX}px`,
            aspectRatio: "2 / 1",
            border: "1px dashed #dc2626",
            background: "#fef2f2",
            color: "#b91c1c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
          }}
        >
          图片无法加载
        </div>
      ) : (
        <img
          src={block.src}
          alt={block.caption ?? "文档图片"}
          onError={() => setFailed(true)}
          style={{ width: `${block.width * PT_TO_PX}px`, maxWidth: "100%" }}
        />
      )}
      {block.caption && (
        <figcaption style={{ fontSize: resolved.size, color: "#666", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

function TocView({ block, styles }: { block: Extract<Block, { type: "tocPlaceholder" }>; styles: StyleSet }) {
  const entries = block.entries ?? [];
  return (
    <div style={{ ...spacingStyle(styles, block) }}>
      <p style={{ fontWeight: 700, margin: 0 }}>目录</p>
      {entries.length === 0 ? (
        <p style={{ margin: 0, color: "#666" }}>（尚未生成——右侧「生成目录」）</p>
      ) : (
        <ul style={{ listStyleType: "none", margin: 0, padding: 0 }}>
          {entries.map((entry, i) => (
            <li key={i} style={{ paddingLeft: (entry.level - 1) * 16 }}>
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Page-break marker: a thin gap line between two page groups. */
export function PageBreakView() {
  return (
    <div aria-label="分页符" style={{ borderTop: "1px dashed #bbb", margin: "8px 0", color: "#999", fontSize: 10 }}>
      分页符
    </div>
  );
}

/** Read-only rendering of one block; editing/selection chrome lives in DocumentCanvas. */
export function BlockView({ block, styles }: { block: Block; styles: StyleSet }) {
  switch (block.type) {
    case "heading":
      return <HeadingView block={block} styles={styles} />;
    case "paragraph":
      return <ParagraphView block={block} styles={styles} />;
    case "list":
      return <ListView block={block} styles={styles} />;
    case "table":
      return <TableView block={block} styles={styles} />;
    case "image":
      return <ImageView block={block} styles={styles} />;
    case "tocPlaceholder":
      return <TocView block={block} styles={styles} />;
    case "pageBreak":
      return <PageBreakView />;
  }
}

/** Whether a block's text can be edited inline (heading/paragraph only). */
export function isEditableTextBlock(block: Block): boolean {
  return block.type === "heading" || block.type === "paragraph";
}

/** Plain text of a heading/paragraph for seeding the inline editor. */
export function blockPlainText(block: Block): string {
  if (block.type !== "heading" && block.type !== "paragraph") return "";
  return block.runs.map((run) => run.text).join("");
}
