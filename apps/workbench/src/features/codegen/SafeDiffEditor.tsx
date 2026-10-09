import { DiffEditor, type DiffEditorProps } from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";

/**
 * @monaco-editor/react disposes DiffEditor models before the diff widget.
 * Monaco can report a disposed-model error during that teardown. Keep the
 * models alive for the library cleanup, then dispose them in a microtask after
 * the widget has been released.
 */
export function SafeDiffEditor(props: DiffEditorProps) {
  const editorRef = useRef<Parameters<NonNullable<DiffEditorProps["onMount"]>>[0] | null>(null);

  const onMount = useCallback<NonNullable<DiffEditorProps["onMount"]>>((editor, monaco) => {
    editorRef.current = editor;
    props.onMount?.(editor, monaco);
  }, [props.onMount]);

  useEffect(() => {
    return () => {
      const model = editorRef.current?.getModel();
      editorRef.current = null;
      if (!model) return;

      queueMicrotask(() => {
        model.original.dispose();
        model.modified.dispose();
      });
    };
  }, []);

  return (
    <DiffEditor
      {...props}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={onMount}
    />
  );
}
