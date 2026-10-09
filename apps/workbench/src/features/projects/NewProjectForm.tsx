import type { ProjectMeta, StudioDocument } from "@studio/schema-core";
import { useEffect, useId, useState } from "react";
import { api } from "../../api/client";
import { buildInput, handleImported, retrySaveImported, submit as runSubmit } from "./createFlow";
import type { CreateFormFields, ImportedRetryContext } from "./createFlow";
import { FormSection } from "./FormSection";
import { TemplatePickerSection } from "./TemplatePickerSection";
import { useTemplateGallery } from "./useTemplateGallery";
import { PptxTemplateSection } from "./PptxTemplateSection";
import { ImportFailoverCard } from "./ImportFailoverCard";
import { ScreenshotImportSection } from "./ScreenshotImportSection";

interface NewProjectFormProps {
  onCreated: (id: string) => void;
}

/** P7.3：一级项目类型。三个 builtin 工具包均已注册，全部可选。 */
const PROJECT_TYPE_OPTIONS: { value: ProjectMeta["projectType"]; label: string; disabled: boolean }[] = [
  { value: "ui", label: "UI 网页", disabled: false },
  { value: "ppt", label: "PPT 演示", disabled: false },
  { value: "word", label: "Word 文档", disabled: false },
];

/**
 * Create the project, then land the chosen template document through the
 * existing save path. Templates now come from the server registry (route A:
 * external shadcn blocks converted to Schema); pending sources carry an
 * explicit 导入 button instead of blocking the form.
 *
 * The create/land/retry orchestration lives in ./createFlow; this component
 * only gathers field values and wires the flow back into form state.
 */

/** 统一控件样式：单蓝紫聚焦环、hairline 边框、9px 圆角。 */
const FIELD =
  "mt-1 w-full rounded-md border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-faint studio-transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function NewProjectForm({ onCreated }: NewProjectFormProps) {
  const formId = useId();
  const [name, setName] = useState("");
  const [productType, setProductType] = useState("");
  const [targetUsers, setTargetUsers] = useState("");
  const [goal, setGoal] = useState("");
  const [brandRules, setBrandRules] = useState("");
  const [referenceLinks, setReferenceLinks] = useState("");
  const [projectType, setProjectType] = useState<ProjectMeta["projectType"]>("ui");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pptxFile, setPptxFile] = useState<File | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [blankProjectId, setBlankProjectId] = useState<string | null>(null);
  const [blankMeta, setBlankMeta] = useState<ProjectMeta | null>(null);
  // Converted doc kept on save failure so retry never re-runs vision (design §3.2).
  const [importRetry, setImportRetry] = useState<ImportedRetryContext | null>(null);

  // Picking a .pptx template also suggests a project name from its filename.
  const handlePptxChange = (file: File | null) => {
    setPptxFile(file);
    setImportWarnings([]);
    setBlankProjectId(null);
    setBlankMeta(null);
    setImportRetry(null);
    if (file && name.trim() === "") {
      setName(file.name.replace(/\.pptx$/i, "").slice(0, 60));
    }
  };

  // Template gallery state machine lives in the hook (fetch / select / import).
  const { loading, templates, category, setCategory, selected, setSelected, importingId, handleImport } =
    useTemplateGallery({ enabled: projectType === "ui", onError: setError });

  // Leaving the ppt flow clears the pending .pptx and blank-project state;
  // leaving ui drops the screenshot retry context (its section unmounts).
  useEffect(() => {
    if (projectType !== "ppt") {
      setPptxFile(null);
      setImportWarnings([]);
      setBlankProjectId(null);
      setBlankMeta(null);
    }
    if (projectType !== "ui") setImportRetry(null);
  }, [projectType]);

  /** Current field values, read lazily at submit time. */
  function fields(): CreateFormFields {
    return { name, productType, targetUsers, goal, referenceLinks, brandRules, projectType };
  }

  /** Form-state writers handed to the create flow so it can report back. */
  function flowContext() {
    return {
      api,
      onCreated,
      setError,
      setSubmitting,
      setImportWarnings,
      setBlankProjectId,
      setBlankMeta,
      setImportRetry,
    };
  }

  /** Submit/retry: delegates to createFlow.submit (create → land → failover anchors). */
  async function submit() {
    await runSubmit(fields(), {
      ...flowContext(),
      selected,
      pptxFile,
      blankProjectId,
      blankMeta,
    });
  }

  /** Screenshot import (T49): land the section's converted document via the existing create → saveProject → onCreated flow; failures reuse the ImportFailoverCard anchor states. */
  async function onImported(document: StudioDocument, warnings: string[]) {
    await handleImported(document, warnings, fields(), flowContext());
  }

  /** Failure flow: re-save the already-converted screenshot document into the same blank project — no re-conversion. */
  async function retryImported() {
    if (importRetry)
      await retrySaveImported(api, { ...flowContext(), selected, pptxFile, blankProjectId, blankMeta }, importRetry);
  }

  /** Failure flow: open the already-created blank project. */
  function openBlankProject() {
    if (blankProjectId) onCreated(blankProjectId);
  }

  /** Failure flow: delete the orphan blank project and reset for a fresh start. */
  async function discardBlankProject() {
    if (!blankProjectId) return;
    setSubmitting(true);
    try {
      await api.deleteProject(blankProjectId);
      setBlankProjectId(null);
      setBlankMeta(null);
      setImportRetry(null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 max-w-2xl rounded-lg border border-hairline bg-canvas p-5 shadow-pop">
      <form
        id={formId}
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-sm font-semibold text-ink">新建项目</h2>

        <FormSection title="项目身份">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs font-medium text-ink-soft">
              项目名称
              <input
                required
                maxLength={60}
                className={FIELD}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <div>
              <p className="text-xs font-medium text-ink-soft">项目类型</p>
              <div role="radiogroup" aria-label="项目类型" className="mt-1 flex flex-wrap gap-2">
                {PROJECT_TYPE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`studio-transition flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                      option.disabled
                        ? "cursor-not-allowed border-hairline text-ink-faint"
                        : projectType === option.value
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-hairline text-ink-soft hover:bg-surface"
                    }`}
                  >
                    <input
                      type="radio"
                      name="project-type"
                      value={option.value}
                      disabled={option.disabled}
                      checked={projectType === option.value}
                      onChange={() => setProjectType(option.value)}
                      className="accent-accent"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </FormSection>

        <FormSection title="创作需求">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs font-medium text-ink-soft">
              产品类型
              <input
                maxLength={60}
                className={FIELD}
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-ink-soft">
              目标用户
              <input
                maxLength={200}
                className={FIELD}
                value={targetUsers}
                onChange={(e) => setTargetUsers(e.target.value)}
              />
            </label>
          </div>

          <label className="block text-xs font-medium text-ink-soft">
            页面目标
            <textarea
              maxLength={500}
              rows={2}
              className={FIELD}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </label>

          <label className="block text-xs font-medium text-ink-soft">
            参考链接
            <textarea
              rows={2}
              aria-label="参考链接"
              placeholder="每行一条 http(s) 链接，最多 10 条（可选）"
              className={FIELD}
              value={referenceLinks}
              onChange={(e) => setReferenceLinks(e.target.value)}
            />
          </label>
        </FormSection>

        <FormSection title="品牌约束">
          <label className="block text-xs font-medium text-ink-soft">
            品牌规则
            <textarea
              maxLength={500}
              rows={2}
              className={FIELD}
              value={brandRules}
              onChange={(e) => setBrandRules(e.target.value)}
            />
          </label>
        </FormSection>
      </form>

      {/* Template + screenshot-import areas render for UI projects only; both sit outside the create <form> so nested native forms never occur. */}
      {projectType === "ui" && (
        <div className="mt-3 space-y-3">
          <TemplatePickerSection
            loading={loading}
            templates={templates}
            category={category}
            onCategory={setCategory}
            selected={selected}
            onSelect={setSelected}
            importingId={importingId}
            onImport={(id) => void handleImport(id)}
            onClear={() => setSelected(null)}
          />
          <ScreenshotImportSection onImported={onImported} />
          {/* Screenshot-import degradation warnings (T64): the ui branch owns its
              own list — same shape as PptxTemplateSection's, kept inline. */}
          {importWarnings.length > 0 && (
            <ul
              aria-label="导入降级提示"
              className="list-disc space-y-0.5 pl-5 text-xs text-warn"
              title={importWarnings.join("\n")}
            >
              {importWarnings.slice(0, 3).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
              {importWarnings.length > 3 && <li>…共 {importWarnings.length} 条降级提示</li>}
            </ul>
          )}
        </div>
      )}

      {/* PPT: optional .pptx template upload (replaces the blank deck). */}
      {projectType === "ppt" && (
        <PptxTemplateSection file={pptxFile} onFileChange={handlePptxChange} warnings={importWarnings} />
      )}

      <ImportFailoverCard
        error={error}
        blankProjectId={blankProjectId}
        hasPptxFile={pptxFile !== null}
        retryKind={importRetry?.kind ?? (pptxFile !== null ? "pptx" : null)}
        submitting={submitting}
        onOpenBlankProject={openBlankProject}
        onDiscardBlankProject={() => void discardBlankProject()}
        onRetryImport={() => void submit()}
        onRetryImported={() => void retryImported()}
      />

      <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
        <button
          type="submit"
          form={formId}
          disabled={submitting || name.trim().length === 0}
          className="studio-transition inline-flex h-8 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-hover active:bg-accent-pressed disabled:opacity-40 disabled:hover:bg-accent"
        >
          {submitting ? "创建中…" : "创建项目"}
        </button>
      </div>
    </div>
  );
}
