// Processing queue, streamed stage events, and the pipeline view (live and replay).
import { $, esc, icon, pill, state, api, refresh, toast, duration, plural, modal } from "./shared.js";

export const STAGES = [
  ["Receive PDF", "Fingerprint the file. An exact re-upload returns its original decision."],
  ["Read document", "Text layer first, OCR for scans. Every value keeps its page and position."],
  ["AI reader", "Runs only if printed labels miss something. Each proposed value must be on the page."],
  ["Policy checks", "Supplier, sender, bank record, PO ledger, receipts, GST, duplicates."],
  ["Decision", "Post to the PO ledger, or hold with one owner and one question."],
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let seq = 0;
const emit = key => document.dispatchEvent(new CustomEvent("kosh:live", { detail: key }));

function freshLive(stages = STAGES) {
  return { stages: stages.map(([name, what]) => ({ name, what, state: "pending", detail: "", ms: null })), checks: [], result: null, error: null };
}

/* Queue ------------------------------------------------------------------------ */
export function enqueue(files, opts = {}) {
  const pdfs = [...files].filter(f => f && (f.type === "application/pdf" || /\.pdf$/i.test(f.name)));
  if (!pdfs.length) { toast("Choose a PDF invoice.", { error: true }); return []; }
  const added = [];
  for (const f of pdfs) {
    if (f.size > 6 * 1024 * 1024) { toast(`${f.name} is larger than 6 MB.`, { error: true }); continue; }
    const item = { key: "q" + (++seq), file: f, name: f.name, size: f.size, status: "queued", mail: opts.mail || null, live: freshLive() };
    state.queue.push(item); added.push(item);
  }
  if (!added.length) return [];
  if (!opts.stay) location.hash = "#/invoices/" + added[0].key;
  emit(null);
  if (!state.queue.some(q => q.status === "running")) process(opts);
  return added;
}
export async function enqueueSample(slug, mail, opts = {}) {
  const blob = await (await api(`/samples/${slug}.pdf`)).blob();
  return enqueue([new File([blob], slug + ".pdf", { type: "application/pdf" })], { mail, ...opts });
}
async function process(opts) {
  let item;
  const batch = [];
  while ((item = state.queue.find(q => q.status === "queued"))) { batch.push(item); await runOne(item); }
  if (batch.length > 1) {
    const ok = batch.filter(q => q.result);
    toast(`${plural(ok.length, "invoice")} processed · ${ok.filter(q => q.result.status === "Approved").length} approved · ${ok.filter(q => q.result.status === "Hold").length} need review`);
  }
  state.queue = state.queue.filter(q => q.status === "running" || q.status === "queued");
  emit(null);
}
async function runOne(item) {
  item.status = "running"; emit(item.key);
  const live = item.live;
  const receive = line => { apply(live,JSON.parse(line)); emit(item.key); };
  try {
    const q = new URLSearchParams({ name: item.name });
    if (item.mail) { q.set("sender", item.mail.from); q.set("mail", item.mail.id); }
    const r = await api("/api/review?" + q, { method: "POST", body: item.file });
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = "";
    for (; ;) {
      const { done: end, value } = await reader.read();
      text += dec.decode(value || new Uint8Array(), { stream: !end });
      const lines = text.split("\n"); text = lines.pop();
      for (const line of lines) if (line.trim()) receive(line);
      if (end) break;
    }
    if (text.trim()) receive(text);
  } catch (err) { apply(live,{ error: err.message }); }

  if (!live.result && !live.error) live.error = "Processing stopped before a decision was saved. Try the PDF again.";
  item.status = live.result ? "done" : "failed"; item.result = live.result;
  try { await refresh(); } catch { }
  emit(item.key);
  document.dispatchEvent(new CustomEvent("kosh:processed", { detail: item }));
}
function apply(live, e) {
  if (e.result) { live.result = e.result; finish(live, e.result); return; }
  if (e.error) { live.error = e.error; const s = live.stages.find(s => s.state === "running"); if (s) s.state = "failed"; return; }
  let s = live.stages.find(x => x.name === e.stage);
  if (!s) { s = { name: e.stage, what: "", state: "pending" }; live.stages.splice(live.stages.length - 1, 0, s); }
  if (e.state === "check") { const [name, status] = e.detail.split(" · "); live.checks.push({ name, status }); return; }
  if (e.state === "progress") { s.detail = e.detail; return; }
  s.state = e.state; if (e.detail) s.detail = e.detail; if (e.ms != null) s.ms = e.ms;
}
function finish(live, r) {
  for (const s of live.stages) if (s.state === "pending" || s.state === "running") s.state = "skipped";
  const d = live.stages.find(s => s.name === "Decision");
  if (d) { d.state = r.status === "Approved" ? "done" : r.status === "Error" ? "failed" : "hold"; d.detail = r.existing ? "Already processed. Showing the original decision." : r.brief?.headline || r.status; }
}

/* Pipeline view ------------------------------------------------------------------ */
function stageIcon(s) {
  if (s.state === "running") return '<span class="spin"></span>';
  if (s.state === "done") return icon("check", 14, 2.4);
  if (s.state === "failed") return icon("x", 14, 2.4);
  if (s.state === "hold") return icon("clock", 14, 2.2);
  if (s.state === "skipped") return icon("dash", 14, 2.2);
  return "";
}
export function pipeline(live) {
  return `<div class="pipe" aria-live="polite">${live.stages.map(s => `
    <div class="stage ${s.state}"><div class="si">${stageIcon(s)}</div>
      <div><b>${esc(s.name)}</b><p>${esc(s.detail || s.what)}</p>
        ${s.name === "Policy checks" && live.checks.length ? `<div class="streamed">${live.checks.map(c => pill(c.status === "Hold" ? "Hold" : c.status, c.name)).join("")}</div>` : ""}</div>
      <span class="ms">${s.ms != null && s.state !== "pending" ? duration(s.ms) : s.state === "skipped" ? "skipped" : ""}</span></div>`).join("")}</div>`;
}
export function processingPane(item) {
  const live = item.live, r = live.result;
  return `<div class="detailin">
    <div class="ihead"><div><div class="from">${item.mail ? icon("mail", 14) + esc(item.mail.from) : icon("upload", 14) + "Uploaded"} · ${esc(item.name)}</div>
      <h2>${r ? esc(r.number) : item.status === "queued" ? "Queued" : "Processing…"}</h2>
      <div class="meta">${r ? esc(r.vendor) : "Each stage reports as it actually runs."}</div></div>
      ${r ? `<a class="btn primary" href="#/invoices/${r.id}">Open invoice ${icon("arrow", 14)}</a>` : ""}</div>
    ${live.error ? `<div class="note risk" style="margin-top:20px">${icon("alert")}<span>${esc(live.error)}</span></div>` : ""}
    <div class="card" style="margin-top:20px"><div class="cardbody">${pipeline(live)}</div></div>
  </div>`;
}

/* Replay of a stored run ----------------------------------------------------------- */
export async function replay(r) {
  const tl = (r.timeline || []).filter(e => e.state !== "progress");
  const names = [...new Set(tl.map(e => e.stage))];
  const stages = names.map(n => STAGES.find(s => s[0] === n) || [n, n === "Human review" ? "A reviewer recorded a decision; every check ran again." : ""]);
  const live = freshLive(stages.length ? stages : STAGES);
  const paint = () => { const el = $("#replaybody"); if (el) el.innerHTML = pipeline(live); return !!el; };
  modal(`Replay · ${r.number}`, `<p class="t2 sm" style="margin-bottom:16px">Stored timeline. Durations are the ones measured when it ran.</p><div id="replaybody"></div>`);
  paint();
  for (const e of tl) {
    if (e.state === "running") { apply(live, e); if (!paint()) return; await sleep(260); continue; }
    if (e.stage === "Policy checks") for (const c of r.checks || []) { live.checks.push({ name: c.name, status: c.status }); if (!paint()) return; await sleep(70); }
    apply(live, e); if (!paint()) return; await sleep(160);
  }
  live.result = r; finish(live, r); paint();
}
