import { join } from "node:path";
import { PathError } from "../store/projects.js";

/** Run ids are directory names — only UUIDs pass (same guard style as assertSafeVersionId). */
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Screenshot files are named after the viewport; nothing else may be served. */
const SHOT_FILE_RE = /^(desktop|tablet|mobile)\.png$/;

/** Audit result file inside a run dir. */
export const ISSUES_FILE = "issues.json";

/** `<projectDir>/design/snapshots` — parent of every run dir. */
export function snapshotsDir(projectDir: string): string {
  return join(projectDir, "design", "snapshots");
}

export function assertSafeRunId(runId: string): string {
  if (!RUN_ID_RE.test(runId)) {
    throw new PathError(`非法截图批次 ID: "${runId}"`);
  }
  return runId;
}

export function assertSafeShotFile(file: string): string {
  if (!SHOT_FILE_RE.test(file)) {
    throw new PathError(`非法截图文件名: "${file}"`);
  }
  return file;
}

/** `<projectDir>/design/snapshots/<runId>`; throws PathError on a non-UUID runId. */
export function runDir(projectDir: string, runId: string): string {
  return join(snapshotsDir(projectDir), assertSafeRunId(runId));
}

/** Absolute path of one run's issues.json. */
export function issuesFile(projectDir: string, runId: string): string {
  return join(runDir(projectDir, runId), ISSUES_FILE);
}
