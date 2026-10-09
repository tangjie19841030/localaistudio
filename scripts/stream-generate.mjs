/** Stream the SSE frames live; stop at done/error or timeout. */
const BASE = "http://127.0.0.1:8787";
const projRes = await fetch(`${BASE}/api/projects`);
const projects = (await projRes.json()).projects;
const id = projects[0].id;
const requestId = `stream-${Date.now()}`;

const res = await fetch(`${BASE}/api/chat/completions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    projectId: id,
    requestId,
    mode: "generate",
    messages: [{ role: "user", content: "生成简约运营看板：页头，四个指标卡，一张表格" }],
  }),
});
console.log("status:", res.status);

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffered = "";
const counts = { insert: 0, propose: 0, done: 0, error: 0, token: 0, other: 0 };
const deadline = Date.now() + 240_000;

const flushLine = (line) => {
  const s = line.trim();
  if (!s.startsWith("data:")) return;
  const payload = s.slice(5).trim();
  if (!payload) return;
  try {
    const ev = JSON.parse(payload);
    if (ev.type === "tool-call") {
      if (ev.name === "insert_node") counts.insert++;
      else if (ev.name === "propose_document") counts.propose++;
      else if (ev.name === "set_token") counts.token++;
      else counts.other++;
      console.log(`  [tool-call] ${ev.name}`);
    } else if (ev.type === "tool-result") {
      console.log(`  [tool-result] ${ev.name} ok=${ev.ok} :: ${String(ev.message).slice(0, 240)}`);
    } else if (ev.done) {
      counts.done++;
      console.log(`  [done] validated=${ev.validated ?? "none"} docLen=${JSON.stringify(ev.document ?? {}).length}`);
    } else if (ev.error) {
      counts.error++;
      console.log(`  [error] ${ev.error.slice(0, 160)}`);
    }
  } catch { /* partial frame */ }
};

while (Date.now() < deadline) {
  const { done, value } = await reader.read();
  if (done) break;
  buffered += decoder.decode(value, { stream: true });
  let nl;
  while ((nl = buffered.indexOf("\n")) !== -1) {
    flushLine(buffered.slice(0, nl));
    buffered = buffered.slice(nl + 1);
  }
  if (counts.done > 0 || counts.error > 0) break;
}

console.log("\nsummary:", JSON.stringify(counts));
process.exit(0);