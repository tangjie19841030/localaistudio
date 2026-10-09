import { getComponentDef } from "@studio/schema-core";
import type { NodeRecord, ComponentPreset } from "@studio/schema-core";
import { useState } from "react";

export interface PropsFormProps {
  node: NodeRecord;
  /** Receives the full next props object (schema-valid assembly up to the caller). */
  onPropsChange: (props: Record<string, unknown>) => void;
  /** Plan C unpin entry: called when the user returns a pinned node to flow. */
  onUnpin?: (id: string) => void;
}

type FieldKindName = "string" | "number" | "boolean" | "enum" | "string-array" | "table" | "unknown";

interface FieldKind {
  kind: FieldKindName;
  options?: string[];
}

interface ZodNode {
  _def?: { typeName?: string; innerType?: unknown; type?: unknown; values?: unknown[]; options?: unknown[] };
}

/** Unwrap ZodDefault/ZodOptional/ZodNullable layers to reach the concrete type node. */
function unwrapSchema(schema: unknown): unknown {
  let cur: unknown = schema;
  for (let i = 0; i < 10; i++) {
    const def = (cur as ZodNode)?._def;
    if (!def) return cur;
    if (def.typeName === "ZodDefault" || def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      cur = def.innerType;
    } else {
      return cur;
    }
  }
  return cur;
}

/** Element zod node of an array field (already unwrapped). */
function arrayElement(schema: unknown): unknown {
  return (unwrapSchema(schema) as ZodNode)?._def?.type;
}

/** Classify a shape field by its (unwrapped) zod type name. */
function fieldKind(schema: unknown): FieldKind {
  const inner = unwrapSchema(schema) as ZodNode;
  const typeName = inner?._def?.typeName;
  switch (typeName) {
    case "ZodString":
      return { kind: "string" };
    case "ZodNumber":
      return { kind: "number" };
    case "ZodBoolean":
      return { kind: "boolean" };
    case "ZodEnum":
      return { kind: "enum", options: (inner._def?.values as string[]) ?? [] };
    case "ZodArray": {
      const elem = unwrapSchema(arrayElement(schema)) as ZodNode;
      // Union elements (e.g. Nav items: string | {key,label}) edit as the first
      // branch — the kit normalizes model output, the editor stays simple.
      const first = elem?._def?.typeName === "ZodUnion" ? unionFirst(elem) : elem;
      const inner = unwrapSchema(first) as ZodNode;
      return inner?._def?.typeName === "ZodString" ? { kind: "string-array" } : { kind: "table" };
    }
    default:
      return { kind: "unknown" };
  }
}

/** First option of a ZodUnion (editor renders the simplest branch). */
function unionFirst(schema: ZodNode): ZodNode | undefined {
  const options = schema?._def?.options as ZodNode[] | undefined;
  return Array.isArray(options) ? options[0] : undefined;
}

const TEXT_INPUT =
  "studio-transition w-full rounded border border-hairline bg-canvas px-2 py-1 text-xs text-ink placeholder:text-ink-muted hover:border-hairline-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

/** One line per item; empty lines dropped on change. */
function StringArrayField({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <textarea
      aria-label={ariaLabel}
      rows={3}
      className={TEXT_INPUT}
      value={value.join("\n")}
      onChange={(e) => onChange(e.target.value.split("\n"))}
    />
  );
}

/** Normalize model-emitted rows (cell arrays or keyed objects) to string[][]. */
function normalizeRows(value: unknown): string[][] {
  if (!Array.isArray(value)) return [[""]];
  const out = value
    .filter((r) => Array.isArray(r) || (r && typeof r === "object"))
    .map((r) =>
      Array.isArray(r)
        ? r.map((c) => (c == null ? "" : String(c)))
        : Object.values(r as Record<string, unknown>).map((v) => (v == null ? "" : String(v))),
    );
  return out.length > 0 ? out : [[""]];
}

/** Editable 2D string grid (Table rows). Cells are inline inputs; rows add/remove. */
function TableField({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: unknown;
  onChange: (v: string[][]) => void;
}) {
  // Tolerant: models emit either cell arrays or {colKey: value} objects; the
  // editor always edits the normalized string[][] form (same rule as the kit).
  const rows = normalizeRows(value);
  const cols = Math.max(1, ...rows.map((r) => r.length));

  const setCell = (ri: number, ci: number, val: string) => {
    const next = rows.map((r, i) =>
      i === ri ? r.map((c, j) => (j === ci ? val : c)) : r,
    );
    onChange(next);
  };
  const addRow = () => onChange([...rows, new Array(cols).fill("")]);
  const removeRow = (ri: number) => onChange(rows.filter((_, i) => i !== ri));

  return (
    <div className="space-y-1.5">
      <div role="grid" aria-label={ariaLabel} className="flex flex-col gap-1">
        {rows.map((row, ri) => (
          <div key={ri} role="row" className="flex items-center gap-1">
            {row.map((cell, ci) => (
              <input
                key={ci}
                role="gridcell"
                aria-label={`行 ${ri + 1} 列 ${ci + 1}`}
                value={cell}
                onChange={(e) => setCell(ri, ci, e.target.value)}
                className={`${TEXT_INPUT} min-w-0 flex-1`}
              />
            ))}
            <button
              type="button"
              aria-label={`删除第 ${ri + 1} 行`}
              onClick={() => removeRow(ri)}
              className="studio-transition flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs text-ink-muted hover:bg-danger-soft hover:text-danger"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="studio-transition h-7 rounded-md border border-dashed border-hairline-strong px-2 text-xs font-medium text-ink-soft hover:border-accent hover:text-accent"
      >
        + 添加行
      </button>
    </div>
  );
}

export function PropsForm({ node, onPropsChange, onUnpin }: PropsFormProps) {
  const def = getComponentDef(node.type);
  // The initial props snapshot is taken once at mount. The parent (RightPanel)
  // mounts this form with key={node.id}, so a node switch remounts the form and
  // state resets — no prop-sync logic is needed here.
  const [props, setProps] = useState<Record<string, unknown>>(() => ({ ...node.props }));

  if (!def) {
    return <p className="text-xs text-ink-muted">未知组件类型 {node.type}，无法编辑属性。</p>;
  }

  const shape = (def.propsSchema as unknown as { shape?: Record<string, unknown> }).shape;
  const fields = Object.entries(shape ?? {});

  /** Commit one field's new value: merge into props and notify. */
  const update = (key: string, value: unknown) => {
    const next = { ...props, [key]: value };
    setProps(next);
    onPropsChange(next);
  };

  // W4-B preset chips: merge the preset's props keys one by one into the local
  // state, then commit once through the existing onPropsChange chain — a
  // partial merge, so fields outside the preset (user edits) are preserved.
  const applyPreset = (preset: ComponentPreset) => {
    let next = props;
    for (const [key, value] of Object.entries(preset.props)) {
      next = { ...next, [key]: value };
    }
    setProps(next);
    onPropsChange(next);
  };

  // Plan C positioning state: node META (pinned + frame), not props — kept as
  // a read-only badge plus the pinned-only unpin action, never a form field.
  const positioned = node.pinned === true && node.frame !== undefined;

  return (
    <div className="space-y-3 text-sm">
      {/* Component title/type live in the RightPanel header; keep only the id here. */}
      <p className="text-xs text-ink-muted">
        <code>{node.id}</code>
      </p>
      <div className="flex items-center gap-2">
        <span className="text-xs text-ink-muted">定位</span>
        <span
          data-testid="props-positioning"
          data-positioning={positioned ? "pinned" : "flow"}
          className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-soft ring-1 ring-hairline"
        >
          {positioned ? "自由定位" : "流式布局"}
        </span>
        {positioned && onUnpin && (
          <button
            type="button"
            data-testid="props-unpin"
            onClick={() => onUnpin(node.id)}
            title="放弃自由定位坐标，节点回到文档流式布局（可撤销）"
            className="studio-transition rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-accent-soft"
          >
            回到流式布局
          </button>
        )}
      </div>
      {(def.presets?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="preset-row">
          <span className="text-xs text-ink-muted">预设</span>
          {def.presets!.map((preset) => (
            <button
              key={preset.id}
              type="button"
              data-testid={`preset-chip-${preset.id}`}
              onClick={() => applyPreset(preset)}
              className="studio-transition rounded-full border border-hairline bg-surface px-2 py-0.5 text-[11px] text-ink-soft hover:border-accent hover:text-accent"
            >
              {preset.name}
            </button>
          ))}
        </div>
      )}
      {fields.map(([key, schema]) => {
        const kind = fieldKind(schema);
        const value = props[key];
        const multiline = node.type === "SvgBox" && key === "source"; // multi-line SVG (T73)
        return (
          <label key={key} className="block">
            <span className="mb-1 block text-xs font-medium text-ink-soft">{key}</span>
            {kind.kind === "enum" && (
              <select
                aria-label={key}
                className={TEXT_INPUT}
                value={String(value ?? "")}
                onChange={(e) => update(key, e.target.value)}
              >
                {(kind.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
            {kind.kind === "boolean" && (
              <input
                type="checkbox"
                aria-label={key}
                checked={Boolean(value)}
                onChange={(e) => update(key, e.target.checked)}
                className="size-4"
              />
            )}
            {kind.kind === "number" && (
              <input
                type="number"
                aria-label={key}
                value={value === undefined || value === null ? "" : String(value)}
                onChange={(e) => update(key, e.target.value === "" ? 0 : Number(e.target.value))}
                className={TEXT_INPUT}
              />
            )}
            {kind.kind === "string" && (multiline ? (
              <textarea
                rows={8}
                data-testid="props-svg-source"
                aria-label={key}
                value={String(value ?? "")}
                onChange={(e) => update(key, e.target.value)}
                className={TEXT_INPUT}
              />
            ) : (
              <input
                type="text"
                aria-label={key}
                value={String(value ?? "")}
                onChange={(e) => update(key, e.target.value)}
                className={TEXT_INPUT}
              />
            ))}
            {kind.kind === "string-array" && (
              <StringArrayField
                ariaLabel={key}
                value={Array.isArray(value) ? (value as string[]) : []}
                onChange={(v) => update(key, v)}
              />
            )}
            {kind.kind === "table" && (
              <TableField
                ariaLabel={key}
                value={Array.isArray(value) ? (value as string[][]) : []}
                onChange={(v) => update(key, v)}
              />
            )}
            {kind.kind === "unknown" && null}
          </label>
        );
      })}
    </div>
  );
}
