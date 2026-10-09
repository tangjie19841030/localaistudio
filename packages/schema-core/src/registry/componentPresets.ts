import type { ComponentDef } from "./componentDefs.js";

/** A named props snippet attached to a component def (W4-B style presets). */
export interface ComponentPreset {
  /** Preset id, unique per component. */
  id: string;
  /** Chinese display name shown as the chip label. */
  name: string;
  /** Props PATCH applied over current props (updateProps partial-merge semantics). */
  props: Record<string, unknown>;
}

/**
 * First-batch preset data (pure data rows; adding a preset for a new component
 * is a data-only change). Values must satisfy the target component's
 * propsSchema field schemas — enforced by validatePresets() at module load.
 */
const PRESETS: Readonly<Record<string, readonly ComponentPreset[]>> = {
  Button: [
    { id: "cta", name: "主行动", props: { variant: "primary", size: "lg" } },
    { id: "quiet", name: "弱化", props: { variant: "ghost", size: "sm" } },
    { id: "destructive", name: "危险操作", props: { variant: "danger" } },
    { id: "secondary-standard", name: "次级标准", props: { variant: "secondary", size: "md" } },
  ],
  Badge: [
    { id: "positive", name: "成功", props: { tone: "success" } },
    { id: "warning-badge", name: "警告", props: { tone: "warning" } },
    { id: "error", name: "危险", props: { tone: "danger" } },
  ],
  Card: [
    { id: "comfortable", name: "留白", props: { padded: true } },
    { id: "bare", name: "无内边距", props: { padded: false } },
  ],
};

const EMPTY: readonly ComponentPreset[] = [];

/** Presets declared for a component type; empty for unpreset/unregistered types. */
export function presetsFor(type: string): readonly ComponentPreset[] {
  return PRESETS[type] ?? EMPTY;
}

/** Structural minimal zod-field surface used for preset value validation. */
interface PresetFieldSchema {
  safeParse(value: unknown): { success: boolean };
}

/** Declared top-level field schemas of a component def (throws if shapeless). */
function declaredFields(def: ComponentDef): Record<string, PresetFieldSchema> {
  const shape = (def.propsSchema as unknown as { shape?: Record<string, PresetFieldSchema> }).shape;
  if (!shape) throw new Error(`组件 "${def.type}" 的 propsSchema 缺少 shape，无法校验预设`);
  return shape;
}

/** Validate one preset: every key declared, every value passes the field schema. */
function validateOne(type: string, preset: ComponentPreset, shape: Record<string, PresetFieldSchema>): void {
  const label = `${type}.${preset.id}`;
  for (const [key, value] of Object.entries(preset.props)) {
    const field = shape[key];
    if (!field) throw new Error(`预设 ${label} 的 props 键 "${key}" 不是组件声明的属性`);
    if (!field.safeParse(value).success) {
      throw new Error(`预设 ${label} 的 props.${key} 值未通过组件 schema 校验`);
    }
  }
}

/**
 * One-shot startup validation: preset props keys must be a subset of the
 * component's declared props and each value must pass that field's safeParse.
 * Bad presets throw — a developer error, never a runtime path. Not
 * self-executed here: componentDefs.ts calls it right after componentRegistry
 * assembly (still module-load time, avoids the init-order import cycle).
 * Tests pass a custom table to assert throwing without polluting PRESETS.
 */
export function validatePresets(
  registry: Record<string, ComponentDef>,
  table: Readonly<Record<string, readonly ComponentPreset[]>> = PRESETS,
): void {
  for (const [type, presets] of Object.entries(table)) {
    const def = registry[type];
    if (!def) throw new Error(`组件 "${type}" 未注册，预设无法挂载`);
    const shape = declaredFields(def);
    for (const preset of presets) {
      validateOne(type, preset, shape);
    }
  }
}
