import type { SelectionScope, ToolKit } from "@studio/studio-core";

/**
 * Scope admission for the toolkit AI pipeline: which aiTool groups (and hence
 * command ids) a given SelectionScope admits. Pure functions, no internal deps.
 */

/** Per-command display metadata (title/risk) — commands are immutable per toolkit. */
export function commandMeta(toolkit: ToolKit): Map<string, { title: string; riskLevel: string }> {
  return new Map(toolkit.commands.map((c) => [c.id, { title: c.title, riskLevel: c.riskLevel as string }]));
}

/**
 * aiTool groups admitted per scope kind. Scope is a REACH promise ("how much
 * of the document this turn may touch"), not a capability downgrade: a
 * file/container turn must be able to structure AND write content. The earlier
 * single-group mapping meant whole-deck generation could create slides while
 * every content command was gated out — live repro: 10 titled, annotated
 * slides whose only objects were the default "标题/副标题" placeholder boxes.
 * Command-level `allowedScopeKinds` (studio-core) stays the per-command gate
 * (applied again in allowedCommandIds), and resolveScope enforces per-target
 * reach, so widening these groups cannot reach past the declared scope.
 *
 * ppt:  file = 叙事 + 页编辑 + 对象编辑；container = 页编辑 + 对象编辑；selection = 对象编辑
 * word: file/container = 起草 + 重组 + 改写；selection = 改写
 */
function aiToolSuffixesForScope(toolkit: ToolKit, kind: SelectionScope["kind"]): string[] {
  const word = toolkit.projectType === "word";
  if (kind === "selection") return [word ? ".ai.rewrite" : ".ai.object-edit"];
  if (kind === "container") {
    return word ? [".ai.draft", ".ai.restructure", ".ai.rewrite"] : [".ai.slide-edit", ".ai.object-edit"];
  }
  return word
    ? [".ai.draft", ".ai.restructure", ".ai.rewrite"]
    : [".ai.storyline", ".ai.slide-edit", ".ai.object-edit"];
}

/** aiTools admitted for this scope (group mapping, see module doc). */
export function aiToolsForScope(toolkit: ToolKit, scope: SelectionScope) {
  const suffixes = aiToolSuffixesForScope(toolkit, scope.kind);
  return toolkit.aiTools.filter((ai) => suffixes.some((suffix) => ai.id.endsWith(suffix)));
}

/**
 * Command ids admitted for this scope: union of the scoped aiTools, intersected
 * with each command's own allowedScopeKinds so a group never leaks a command
 * the command layer would reject (e.g. word.doc.rename is file-only even though
 * the container draft group is admitted).
 */
export function allowedCommandIds(toolkit: ToolKit, scope: SelectionScope): Set<string> {
  const ids = new Set<string>();
  for (const ai of aiToolsForScope(toolkit, scope)) {
    for (const commandId of ai.commandIds) {
      const command = toolkit.commands.find((candidate) => candidate.id === commandId);
      if (command?.allowedScopeKinds && !command.allowedScopeKinds.includes(scope.kind)) continue;
      ids.add(commandId);
    }
  }
  return ids;
}

/** Whether scope healing changed kind/targets (partial frames announce it only then). */
export function scopeChanged(a: SelectionScope, b: SelectionScope): boolean {
  return a.kind !== b.kind || a.targetIds.join("|") !== b.targetIds.join("|");
}
