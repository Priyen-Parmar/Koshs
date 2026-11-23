// AP mailbox: vendor emails with invoice attachments, processed through the same pipeline as uploads.
import { $, esc, icon, pill, money, plural, state, empty, stateOf, byId, toast } from "./shared.js";
import { enqueueSample, pipeline } from "./review.js";
import { logo, emptyState } from "./art.js";

export function runFor(m) {
  const runs = (state.data.runs || []).filter(r => r.mail?.id === m.id && r.kind !== "action");
  return runs[0] || null;
}
const queued = m => state.queue.find(q => q.mail?.id === m.id && (q.status === "running" || q.status === "queued"));
const fresh = m => !runFor(m) && !queued(m);
function mailState(m) {
  if (queued(m)) return "Processing";
  const run = runFor(m);
  return run ? stateOf(run) : "Unprocessed";
}
function messageRow(m) {
  const sample = state.data.samples.find(s => s.slug === m.slug);
  const status = mailState(m);
  return `<a class="mailrow" href="#/inbox/${esc(m.id)}">
    <span class="mailvendor">${logo(m.from_name, 38)}<span><b>${esc(m.from_name)}</b><small>${esc(m.from)}</small></span></span>
    <span class="mailtopic"><b>${esc(m.subject)}</b><small>${icon("file",13)} ${esc(sample?.number || m.slug)} · PDF attachment</small></span>
    <span class="mailstate">${status === "Unprocessed" ? '<span class="unprocessed">New</span>' : pill(status)}</span>
    <time class="mailtime">${esc(m.received)}</time></a>`;
}
export function renderInbox(arg) {
  const ui = state.ui.mail ||= {f:"all", query:""};
  const mail = state.data.mail || [];
  const isDone = m => Boolean(runFor(m));
  const n = mail.filter(fresh).length;
  const q = (ui.query || "").trim().toLowerCase();
  const list = mail.filter(m => (ui.f==="all" || (ui.f==="new" ? fresh(m) : isDone(m))) &&
    [m.subject,m.from_name,m.from,m.slug].join(" ").toLowerCase().includes(q)).sort((a,b)=>b.received.localeCompare(a.received));
  state.ui.listIds=list.map(m=>m.id);
  if (arg) return `<div class="messagepage">${mailDetail(mail.find(m=>m.id===arg))}</div>`;
  const filters=[["all","All mail",mail.length],["new","New",n],["done","Processed",mail.filter(isDone).length]];
  return `<div class="maildesk">
    <section class="deskhead"><div><span class="deskaddress">${icon("mail",15)} ap@nimbusretail.in</span><h2>Invoice inbox</h2>
    <p>${n ? plural(n,"supplier message")+" awaiting processing." : "Your supplier messages and their latest decisions."}</p></div>
    <div class="deskbuttons"><button class="btn" data-act="upload">${icon("upload",16)} Upload PDF</button>
    <button class="btn primary" data-act="processall" ${n ? "" : "disabled"}>${icon("play",15)} Process new mail</button></div></section>
    <section class="mailregister" aria-label="Supplier messages">
    <div class="mailtools"><div class="mailfilters" aria-label="Filter messages">${filters.map(([v,l,c])=>`<button data-act="mailf" data-v="${v}" aria-pressed="${v===ui.f}">${l} <span>${c}</span></button>`).join("")}</div>
    <label class="mailsearch">${icon("search",16)}<input id="mailq" type="search" value="${esc(ui.query||"")}" placeholder="Search messages" aria-label="Search messages"></label></div>
    <div class="mailcolumns" aria-hidden="true"><span>Supplier</span><span>Message &amp; attachment</span><span>Status</span><span>Received</span></div>
    <div class="mailrows">${list.map(messageRow).join("") || emptyState("mail","No matching messages","Try another search or filter.")}</div>
    <div class="registerfoot"><span>${plural(list.length,"message")}</span><span>Demo mailbox${state.data.reference_date ? " · "+esc(state.data.today) : ""}${state.data.temporary_storage ? " · History resets when the host restarts" : ""}</span></div></section></div>`;
}
export function mailDetail(m) {
  if (!m) return `<div class="detailin">${empty("Email not found", "It may belong to another workspace.", "", "mail")}</div>`;
  const r = runFor(m), q = queued(m);
  const vendor = (state.data.vendors || []).find(v => v.name === m.from_name);
  const sender = r?.checks?.find(c => c.name === "Sender verification");
  return `<div class="detailin">
    <div class="dtop"><a class="btn ghost back" href="#/inbox">${icon("back", 15)}Inbox</a></div>
    <div class="mailhead"><h2>${esc(m.subject)}</h2>
      <div class="sender">${logo(m.from_name, 40)}<div><b>${esc(m.from_name)}</b> <span class="mono t2">&lt;${esc(m.from)}&gt;</span><div class="t3 xs">to ap@nimbusretail.in · received ${esc(m.received)}</div></div>
        ${sender ? (sender.status === "Passed" ? `<span class="pill p-ok" style="margin-left:auto">Registered sender</span>` : `<span class="pill p-risk" style="margin-left:auto">Unregistered domain</span>`) : ""}</div>
      ${sender && sender.status !== "Passed" ? `<div class="note risk">${icon("shield")}<span>${esc(sender.detail)}</span></div>` : ""}
    </div>
    <div class="mailbody">${esc(m.body)}</div>
    <div class="attach"><a class="athumb" href="/samples/${m.slug}.pdf" target="_blank" rel="noopener" aria-label="Preview attachment"><img src="/api/sample-thumb/${m.slug}" alt="" loading="lazy"></a><div style="flex:1;min-width:160px"><b style="font-weight:500">${esc(m.slug)}.pdf</b><div class="t3 xs">Invoice attachment${vendor ? "" : " · sender not in vendor register"}</div></div>
      <a class="btn ghost" href="/samples/${m.slug}.pdf" target="_blank" rel="noopener">${icon("eye", 14)}Preview</a>
      ${r ? `<a class="btn primary" href="#/invoices/${r.id}">Open ${esc(r.number)} ${icon("arrow", 13)}</a>` : q ? pill("Processing") : `<button class="btn primary" data-act="processmail" data-id="${m.id}">${icon("play", 13)}Process invoice</button>`}</div>
    ${q ? `<div class="card" style="margin-top:20px"><div class="cardbody">${pipeline(q.live)}</div></div>` : ""}
    ${r ? `<div class="card" style="margin-top:20px"><div class="cardbody between"><div><div class="row">${pill(stateOf(r))}<b>${esc(r.brief?.headline || r.title)}</b></div><p class="t2 sm" style="margin-top:4px">${esc(r.number)} · ${money(r.gross)}${r.status === "Hold" ? " · " + esc(r.owner) : ""}</p></div><a class="btn" href="#/invoices/${r.id}">View decision</a></div></div>` : ""}
  </div>`;
}
const loading = new Set();
export async function processMail(id) {
  const m = (state.data.mail || []).find(x => x.id === id); if (!m || !fresh(m) || loading.has(id)) return;
  loading.add(id);
  try { await enqueueSample(m.slug, { id: m.id, from: m.from, from_name: m.from_name }, { stay: true }); }
  catch (e) { toast(e.message, { error: true }); }
  finally { loading.delete(id); }
}
export async function processAll() {
  const list = (state.data.mail || []).filter(fresh);
  for (const m of list) await processMail(m.id);
}
export function onInboxAct(act, el) {
  if (act === "mailf") { state.ui.mail.f = el.dataset.v; return "rerender"; }
  if (act === "processmail") { processMail(el.dataset.id); return true; }
  if (act === "processall") { processAll(); return true; }
  return false;
}
export { byId, $ };
