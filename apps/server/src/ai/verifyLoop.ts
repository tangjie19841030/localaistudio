import { z } from "zod";
import {
  checkPage,
  issueLines,
  validateDocument,
  visualQualityIssues,
  type StudioDocument,
  type ToolScope,
} from "@studio/schema-core";
import type { ChatMessage } from "./provider.js";
import {
  runAgentLoop,
  type AgentEvent,
  type AgentLoopResult,
  type ToolDriver,
} from "./agentLoop.js";

/** Events emitted by the verification loop: inner-loop events plus the repair announcement. */
export type VerifyEvent =
  | AgentEvent
  | { type: "delta"; text: string }
  | { type: "verify-round"; round: number; issues: string[] };

/**
 * Post-generation verification loop (P6-3). A finished agent loop can still
 * end on a document that fails schema/reference validation (model gave up,
 * steps exhausted). This outer loop collects ALL issue lines, feeds them back
 * as a user message, and re-enters the agent loop — up to MAX_VERIFY_ROUNDS
 * repair rounds. Round 0 is the candidate as given: a valid doc returns
 * immediately (zero extra rounds, zero frames — the mock's generate path and
 * the E2E frame order stay untouched).
 */

/** Repair budget per the plan: at most 2 re-entries after round 0. */
export const MAX_VERIFY_ROUNDS = 2;

export interface VerifyRoundInput {
  /** Original conversation (system + user) the first round ran with. */
  messages: ChatMessage[];
  /** Candidate document from the previous (inner) agent loop. */
  doc: StudioDocument;
  /** Same driver factory the first round used. */
  driver: ToolDriver;
  scope?: ToolScope;
  signal?: AbortSignal;
  onEvent: (ev: VerifyEvent) => void;
}

export interface VerifyRoundResult {
  doc: StudioDocument;
  /** Repair rounds consumed (0 = candidate passed as given). */
  rounds: number;
  /** Remaining issues after the budget; null = document verified. */
  issues: string[] | null;
}

/**
 * Validate one candidate: zod schema first (its issue lines feed the model),
 * then checkPage — only on schema success, per its documented contract
 * (it throws on unparseable input). Non-zod failures fall back to one line.
 */
function issuesOf(doc: StudioDocument): string[] {
  const result = pageDocumentSafeParse(doc);
  if (result.ok) {
    // Per-page verification (T19 §2.2): checkPage + visualQuality with the
    // document-level tokens feeding contrast/brand rules on every page.
    const issues: string[] = [];
    for (const page of result.doc.pages) {
      issues.push(...checkPage(page), ...visualQualityIssues(page, result.doc.tokens));
    }
    return issues;
  }
  return result.issues;
}

function pageDocumentSafeParse(
  doc: StudioDocument,
): { ok: true; doc: StudioDocument } | { ok: false; issues: string[] } {
  try {
    return { ok: true, doc: validateDocument(doc) };
  } catch (err) {
    const zodIssues = zodIssueLines(err);
    return { ok: false, issues: zodIssues.length > 0 ? zodIssues : [(err as Error).message] };
  }
}

/** schema-core issueLines reuse: "path: message" per line; [] for non-zod throws. */
function zodIssueLines(err: unknown): string[] {
  if (err instanceof z.ZodError) return issueLines(err).split("\n");
  return [];
}

/** Repair prompt: the issue list the model must fix and resubmit. */
function repairPrompt(issues: string[]): string {
  const lines = issues.map((i) => `- ${i}`).join("\n");
  return `生成的文档校验未通过，必须修复以下问题后重新提交完整文档：\n${lines}`;
}

/** Candidate of a finished round: the loop's accumulated doc (a successful
 *  propose_document swaps it in; failures leave the previous candidate). */
function candidateOf(result: AgentLoopResult): StudioDocument {
  return result.doc;
}

/**
 * The outer verification loop. Fast path (no issues): { doc, rounds: 0,
 * issues: null } with zero driver calls. Each repair round emits one
 * {type:"verify-round", round, issues} frame BEFORE re-entering the inner
 * loop (the workbench ignores unknown "type" frames — additive, P6-4).
 * Abort between rounds returns the current state; still-failing docs return
 * the LAST candidate with non-null issues.
 */
export async function runVerifyLoop(input: VerifyRoundInput): Promise<VerifyRoundResult> {
  let doc = input.doc;
  let rounds = 0;
  let messages = input.messages;
  let issues = issuesOf(doc);
  while (issues.length > 0 && rounds < MAX_VERIFY_ROUNDS) {
    if (input.signal?.aborted) return { doc, rounds, issues };
    input.onEvent({ type: "verify-round", round: rounds + 1, issues });
    if (input.signal?.aborted) return { doc, rounds, issues };
    rounds += 1;
    messages = [
      ...messages,
      { role: "assistant", content: JSON.stringify({ document: doc }) },
      { role: "user", content: repairPrompt(issues) },
    ];
    const result = await runAgentLoop({
      messages,
      doc,
      driver: input.driver,
      scope: input.scope,
      signal: input.signal,
      maxSteps: 24,
      onEvent: input.onEvent,
    });
    if (input.signal?.aborted) return { doc, rounds, issues };
    doc = candidateOf(result);
    issues = issuesOf(doc);
  }
  return { doc, rounds, issues: issues.length > 0 ? issues : null };
}
