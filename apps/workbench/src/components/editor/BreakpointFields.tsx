import {
  BREAKPOINT_PROPS,
  type BreakpointName,
  type NodeRecord,
} from "@studio/schema-core";

export interface BreakpointFieldsProps {
  node: NodeRecord;
  viewport: Exclude<BreakpointName, "desktop">;
  onChange: (patch: Record<string, unknown>) => void;
  onClear: () => void;
}

const VIEWPORT_LABEL: Record<Exclude<BreakpointName, "desktop">, string> = {
  tablet: "平板",
  mobile: "手机",
};

const numberClass =
  "studio-transition w-full rounded border border-hairline bg-canvas px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

function currentOverlay(node: NodeRecord, viewport: Exclude<BreakpointName, "desktop">) {
  const value = node.breakpoints?.[viewport];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function BreakpointFields({ node, viewport, onChange, onClear }: BreakpointFieldsProps) {
  const keys = BREAKPOINT_PROPS[node.type];
  if (!keys || keys.length === 0 || node.pinned === true) return null;

  const overlay = currentOverlay(node, viewport);
  const updateNumber = (key: string, raw: string) => {
    if (raw === "") return;
    onChange({ [key]: Number(raw) });
  };

  return (
    <div className="space-y-3" data-testid="breakpoint-fields">
      {keys.map((key) => (
        <label key={key} className="block">
          <span className="mb-1 flex items-center justify-between text-xs font-medium text-ink-soft">
            <span>{key}</span>
            <span className="text-ink-muted">基础值：{String(node.props[key] ?? "")}</span>
          </span>
          <input
            type="number"
            aria-label={`${viewport}.${key}`}
            className={numberClass}
            value={overlay[key] === undefined ? "" : String(overlay[key])}
            onChange={(event) => updateNumber(key, event.target.value)}
          />
        </label>
      ))}
      <button
        type="button"
        onClick={onClear}
        disabled={Object.keys(overlay).length === 0}
        className="studio-transition h-7 w-full rounded-md border border-hairline text-xs font-medium text-ink-soft hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        清除{VIEWPORT_LABEL[viewport]}差异
      </button>
    </div>
  );
}
