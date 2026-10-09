import type { StudioDocument, ToolScope } from "@studio/schema-core";
import { activePageOf, replacePage, withAutoLayout } from "@studio/schema-core";
import type { ChatMessage } from "./provider.js";
import type { GuardedOp, ScopeChecker } from "./patchGuard.js";
import { parseGenerate, scopeViolations, type ChatRequestBody, type SendEvent } from "./routes.js";
import type { AgentLoopResult } from "./agentLoop.js";
import { noteOf, patchPlanText, planText, planTextWithIssues, streamLoopDeltas } from "./loop-frames.js";

/**
 * Terminal-state assembly for the agent-loop SSE pipeline (T54 split).
 * Converts the loop's final result into the legacy done/error/violation frames
 * the workbench parsers expect; frame text construction lives in loop-frames.
 */

/** Pipeline dependencies (re-exported from loopPipeline for the public API). */
export interface LoopPipelineDeps {
  scopeChecker?: ScopeChecker;
}

/** Generate-mode completion requires a successful document mutation. */
export const GENERATE_WRITE_TOOLS = new Set([
  "insert_node",
  "update_props",
  "remove_node",
  "move_node",
  "set_frame",
  "set_token",
]);

/** Generate-mode loop epilogue: verified doc → legacy done frame + 5 deltas.
 *  `issues` non-null (repair budget exhausted) drops `validated` — the
 *  workbench renders the plan without the auto-applied marker, and the plan
 *  text names every unresolved problem so the user can reject on the card.
 *  T60 (W3-B): `alternatives` (variant-round whole docs, design §2.4) rides
 *  the done frame additively when the request asked for variants; the key is
 *  absent (not []) when undefined, so unvariant requests stay byte-compatible. */
export async function doneFromGenerateLoop(
  send: SendEvent,
  result: AgentLoopResult,
  issues: string[] | null,
  targetPageId?: string,
  alternatives?: StudioDocument[],
): Promise<void> {
  const proposed = result.steps.find((s) => s.name === "propose_document" && s.ok);
  // Real models often build the page with granular write tools instead of one
  // propose_document call. Read-only successes leave the starting document
  // untouched and must not satisfy the generate completion gate.
  const applied = result.steps.some((s) => s.ok && GENERATE_WRITE_TOOLS.has(s.name));
  if (proposed || applied) {
    const parsed = parseGenerate(JSON.stringify({ document: result.doc }));
    if (parsed.ok) {
      // withAutoLayout is page-scoped: frame the TARGET page, splice back (T21).
      const page = activePageOf(parsed.document, targetPageId ?? null);
      const laidOut = replacePage(parsed.document, page.id, withAutoLayout(page));
      const text = issues ? planTextWithIssues(laidOut, issues) : planText(result);
      const alternativesField = alternatives === undefined ? {} : { alternatives };
      await streamLoopDeltas(send, text);
      if (issues) {
        await send({ done: true, document: laidOut, text, ...alternativesField });
      } else {
        await send({ done: true, validated: "document", document: laidOut, text, ...alternativesField });
      }
      return;
    }
  }
  await send({ error: "invalid_json", raw: planText(result) });
}

/**
 * Patch-mode loop epilogue: successful update/set_frame steps convert back into
 * the { plan, ops } JSON the workbench parsePatchPayload expects; any failed
 * step follows the legacy violation/error semantics of the marker contract.
 */
export async function doneFromLoopOps(
  deps: LoopPipelineDeps,
  body: ChatRequestBody,
  send: SendEvent,
  result: AgentLoopResult,
  messages: ChatMessage[],
): Promise<void> {
  const ops = opsFromLoopSteps(result);
  if (ops.length === 0) {
    if (result.explanation) {
      const text = JSON.stringify({ plan: result.explanation, ops: [] });
      await streamLoopDeltas(send, text);
      await send({ done: true, text });
      return;
    }
    // No convertible op AND no failed step = the model decided nothing needed
    // changing (e.g. {"plan":..., "ops":[]} or a no-op tool batch). That is a
    // successful completion with an empty change set, not a malformed payload.
    const anyFailure = result.steps.some((s) => !s.ok);
    if (!anyFailure) {
      const text = patchPlanText([], noteOf(messages));
      await streamLoopDeltas(send, text);
      await send({ done: true, text });
      return;
    }
    await sendFailedLoopOutcome(deps, body, send, result, messages);
    return;
  }
  // Audit against the SAME scope the loop ran under (mode-gated: a generate
  // request has no auditable scope); re-checking a bare body.scope here rejected
  // writes the loop had just authorized (live false-positive).
  const finalDoc = result.doc;
  const auditScope = scopeFor(body, finalDoc);
  const firstViolations = scopeViolations(deps.scopeChecker, ops, auditScope);
  if (firstViolations.length > 0) {
    // Marker contract: violation frame + retry:true once, then scope_violation
    // error (the retry already happened inside the loop's single scripted step).
    await send({ violation: firstViolations, retry: true });
    await send({ error: "scope_violation", violations: firstViolations });
    return;
  }
  const doneText = patchPlanText(ops, noteOf(messages));
  await streamLoopDeltas(send, doneText);
  await send({ done: true, text: doneText });
}

/** Successful steps → GuardedOps for the done payload / scope checker. */
export function opsFromLoopSteps(result: AgentLoopResult): GuardedOp[] {
  const ops: GuardedOp[] = [];
  for (const step of result.steps) {
    if (!step.ok) continue;
    const args = (step.args ?? {}) as {
      nodeId?: string; props?: unknown; type?: string; parentId?: string; newParentId?: string;
      index?: number; path?: unknown; value?: unknown; __markerId?: string;
    };
    if (step.name === "set_token" && args.path !== undefined) {
      ops.push({ op: "tokens.set", path: args.path, value: args.value });
    } else if (step.name === "update_props" && args.nodeId) {
      ops.push({ op: "node.update", id: args.nodeId, props: args.props });
    } else if (step.name === "remove_node" && args.nodeId) {
      ops.push({ op: "node.remove", id: args.nodeId });
    } else if (step.name === "move_node" && args.nodeId && args.newParentId) {
      ops.push({ op: "node.move", id: args.nodeId, parentId: args.newParentId, index: args.index });
    } else if (step.name === "set_frame" && args.nodeId) {
      ops.push({ op: "setFrame", nodeId: args.nodeId, frame: (args as { frame?: unknown }).frame });
    } else if (step.name === "insert_node" && !args.__markerId && args.type) {
      // Real inserts (no marker pin) convert to node.add over the loop's final
      // doc so the frontend applies the SAME node the loop materialized.
      const page = activePageOf(result.doc, null);
      const parentId = args.parentId ?? page.rootId;
      const childIds = page.nodes.find((n) => n.id === parentId)?.children ?? [];
      // The parent may already contain another node of the same type. Prefer
      // the id returned by the tool result so consecutive inserts cannot both
      // be converted into the first matching child.
      const insertedId = /(?:id:\s*)([A-Za-z0-9_-]+)/.exec(step.message)?.[1];
      const inserted = insertedId
        ? page.nodes.find((n) => n.id === insertedId && childIds.includes(n.id))
        : page.nodes.find((n) => childIds.includes(n.id) && n.type === args.type);
      if (inserted) {
        ops.push({
          op: "node.add",
          // GuardedOp keeps node loosely typed ({id?}); the workbench's
          // patchOpSchema validates the full node.add shape downstream.
          node: { id: inserted.id, type: inserted.type, props: inserted.props, children: inserted.children } as { id: string },
          parentId,
        });
      }
    }
  }
  return ops;
}

/** No convertible op: mirror the legacy violation/badjson end states exactly. */
export async function sendFailedLoopOutcome(
  deps: LoopPipelineDeps,
  body: ChatRequestBody,
  send: SendEvent,
  result: AgentLoopResult,
  messages: ChatMessage[],
): Promise<void> {
  const failure = result.steps.find((s) => !s.ok);
  if (failure && failure.message.includes("超出修改范围")) {
    // The tool's own scope gate already caught it. Mirror the legacy SSE
    // order exactly: violation frame (checker call 1), a retry pass, then
    // either done (retry compliant — scripted tests stub call 2 empty) or
    // scope_violation error carrying the retry's violations.
    const auditable = scopeOpsOf(result);
    // Same mode-gated derivation as the ops epilogue (kept as two checker calls:
    // SSE contract — violation frame, then the retry pass).
    const auditScope = scopeFor(body, result.doc);
    const first = scopeViolations(deps.scopeChecker, auditable, auditScope);
    await send({ violation: first.length ? first : [failure.message], retry: true });
    const retried = scopeViolations(deps.scopeChecker, auditable, auditScope);
    if (retried.length === 0 && first.length > 0) {
      // Retry compliant: same op set passes the second pass.
      const retryText = patchPlanText(auditable, noteOf(messages));
      await streamLoopDeltas(send, retryText);
      await send({ done: true, text: retryText });
    } else {
      const finalViolations = retried.length ? retried : [failure.message];
      await send({ error: "scope_violation", violations: finalViolations });
    }
    return;
  }
  // badjson marker: args.raw carries the legacy non-JSON text verbatim.
  const raw = (failure?.args as { raw?: string } | undefined)?.raw;
  await send({ error: "invalid_json", raw: raw ?? failure?.message ?? "工具调用未产生有效变更" });
}

/** Failed-but-auditable steps expressed as ops for the scope checker (violation path). */
export function scopeOpsOf(result: AgentLoopResult): GuardedOp[] {
  return result.steps
    .filter((s) => !s.ok && (s.name === "update_props" || s.name === "set_frame" || s.name === "remove_node" || s.name === "move_node"))
    .flatMap((s) => {
      const args = (s.args ?? {}) as {
        nodeId?: string; newParentId?: string; index?: number;
      };
      if (s.name === "set_frame" && args.nodeId) {
        return [{ op: "setFrame", nodeId: args.nodeId, frame: (args as { frame?: unknown }).frame } as GuardedOp];
      }
      if (s.name === "remove_node" && args.nodeId) {
        return [{ op: "node.remove", id: args.nodeId } as GuardedOp];
      }
      if (s.name === "move_node" && args.nodeId && args.newParentId) {
        return [{ op: "node.move", id: args.nodeId, parentId: args.newParentId, index: args.index } as GuardedOp];
      }
      return args.nodeId ? [{ op: "node.update", id: args.nodeId } as GuardedOp] : [];
    });
}

/**
 * The ONE derivation of a request's scope for the loop AND both epilogues (ops
 * + failed-op). Only a patch request has an auditable scope; generate is
 * whole-page, so a leftover client selection must never veto the writes the loop
 * just authorized. rootId joins the set for the mock marker seam's ensure-inserts
 * (their marker ids are not in the project doc); a marker's own op stays audited.
 */
export function scopeFor(body: ChatRequestBody, doc: StudioDocument): ToolScope | undefined {
  if (body.mode !== "patch" || !body.scope) return undefined;
  const nodeIds = body.scope.nodeIds?.length ? [...body.scope.nodeIds] : [];
  const activeRootId = activePageOf(doc, null).rootId;
  if (!nodeIds.includes(activeRootId)) nodeIds.push(activeRootId);
  return { nodeIds, allowAllTokens: body.scope.allowAllTokens };
}
