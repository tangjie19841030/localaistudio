/** Reproduce: PPT run produces model output but no artifacts. Logs every SSE frame. */
const BASE = "http://127.0.0.1:8787";
const PROJECT_ID = process.argv[2] ?? "3440334a-5db4-47ed-84ff-7c3936fee589"; // "123123"
const PROMPT = process.argv[3] ?? "做一页关于季度营收的汇报封面，标题用「2026 Q3 营收汇报」，并加备注「封面页」";

const res = await fetch(`${BASE}/api/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    projectId: PROJECT_ID,
    requestId: `repro-${Date.now()}`,
    mode: "generate",
    scope: { kind: "file", targetIds: [] },
    messages: [{ role: "user", content: PROMPT }],
  }),
});
console.log("HTTP", res.status);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffered = "";
const counts = { call: 0, ok: 0, fail: 0, partial: 0, done: 0, error: 0, other: 0 };
const deadline = Date.now() + 300_000;

while (Date.now() < deadline) {
  const chunk = await Promise.race([
    reader.read(),
    new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 300_000)),
  ]);
  if (chunk.done) break;
  buffered += decoder.decode(chunk.value, { stream: true });
  let idx;
  while ((idx = buffered.indexOf("\n")) >= 0) {
    const line = buffered.slice(0, idx).trim();
    buffered = buffered.slice(idx + 1);
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    let ev;
    try { ev = JSON.parse(payload); } catch { continue; }
    if (ev.type === "tool-call") {
      counts.call++;
      console.log(`[tool-call] ${ev.name} args=${JSON.stringify(ev.args).slice(0, 300)}`);
    } else if (ev.type === "tool-result") {
      if (ev.ok) counts.ok++; else counts.fail++;
      console.log(`[tool-result] ${ev.name} ok=${ev.ok} :: ${String(ev.message).slice(0, 400)}`);
    } else if (ev.type === "stage") {
      console.log(`[stage] ${ev.id} ${ev.label ?? ""}`);
    } else if (typeof ev.delta === "string") {
      process.stdout.write(ev.delta);
    } else if (ev.done) {
      if (ev.partial) counts.partial++; else counts.done++;
      console.log(`\n[done partial=${!!ev.partial}] text=${ev.text ?? ""}`);
      console.log(`  commands=${(ev.commands ?? []).map((c) => c.commandId).join(", ") || "(none)"}`);
    } else if (ev.error) {
      counts.error++;
      console.log(`[error] ${ev.error}: ${ev.message ?? ev.raw ?? ""}`);
    } else {
      counts.other++;
      console.log(`[other] ${JSON.stringify(ev).slice(0, 200)}`);
    }
  }
}
console.log("\n=== counts:", JSON.stringify(counts));
