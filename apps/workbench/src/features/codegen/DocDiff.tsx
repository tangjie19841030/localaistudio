import { useCodegenStore } from "../../state/codegenStore";
import { useEditorStore } from "../../state/editorStore";
import { useMonacoTheme } from "../../utils/monacoTheme";
import { SafeDiffEditor } from "./SafeDiffEditor";

/**
 * Document JSON diff: "original" is the snapshot frozen at the last successful
 * generate, "modified" is the live editor document. Before the first generate
 * there is no baseline to diff against (spec §8: regen diff needs two runs).
 */
export function DocDiff() {
  const lastGeneratedDocJson = useCodegenStore((s) => s.lastGeneratedDocJson);
  const document = useEditorStore((s) => s.document);
  const monacoTheme = useMonacoTheme();

  if (!lastGeneratedDocJson || !document) {
    return (
      <p className="p-3 text-xs text-ink-muted">
        生成代码后可查看文档 diff（上次生成的文档 vs 当前文档）。
      </p>
    );
  }
  return (
    <SafeDiffEditor
      original={lastGeneratedDocJson}
      modified={JSON.stringify(document)}
      language="json"
      theme={monacoTheme}
      options={{ readOnly: true, renderSideBySide: true, fontSize: 12 }}
      height="100%"
    />
  );
}
