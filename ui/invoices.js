// Invoices: register and invoice pages, resolution sheet and payment hand-off.
import {
  $, $$, esc, icon, pill, money, clock, day, shortDay, duration, ago, plural, initials, state, api, post, refresh, toast, btn, empty, owner, av,
  isOpen, heads, stateOf, statusPill, chain, head, byId, lastAction, waiting, payment, discountFor, vendorOf, FIELD, CHECK_ICON, RISK_CHECKS,
  openSheet, closeSheet, openMenu, closeMenus, setRole, copy, ROLE_INFO,
} from "./shared.js";
import { processingPane, replay } from "./review.js";
import { logo, donut, emptyState } from "./art.js";

const TABS = [["review", "Needs review"], ["pay", "Approved"], ["closed", "Closed"], ["all", "All"]];
const inTab = (r, t) => t === "all" ? true : t === "review" ? isOpen(r) : t === "pay" ? r.status === "Approved" : ["Rejected", "Error"].includes(r.status);

/* List --------------------------------------------------------------------------- */
function listItems() {
  const ui = state.ui.inv ||= { tab: "review", q: "" };
  const q = ui.q.trim().toLowerCase();
  const rows = heads().filter(r => inTab(r, ui.tab)).filter(r => !q || [r.number, r.vendor, r.po, r.title, r.brief?.headline, r.filename, r.sender].join(" ").toLowerCase().includes(q));
  rows.sort((a, b) => ui.tab === "review" ? (Number(RISK_CHECKS.has(b.title)) - Number(RISK_CHECKS.has(a.title))) || a.created.localeCompare(b.created) : b.created.localeCompare(a.created));
  return rows;
}
function rowHTML(r, sel) {
  const s = stateOf(r);
  const line2 = r.status === "Hold" ? (r.brief?.headline || r.title) : r.status === "Approved" ? `Cleared against ${r.po}` + (r.due ? ` · due ${shortDay(r.due)}` : "") : r.status === "Rejected" ? (r.summary || "Rejected") : (r.brief?.headline || r.status);
  return `<a class="item ${sel ? "on" : ""}" href="#/invoices/${r.id}" data-id="${r.id}">
    ${logo(r.vendor, 32)}
    <div style="min-width:0"><div class="l1"><span>${esc(r.number)}</span><span class="t3" style="font-weight:400">${esc(r.vendor)}</span></div>
      <div class="l2">${esc(line2)}</div>
      <div class="l3">${r.mail ? icon("mail", 12) : icon("upload", 12)}<span>${ago(r.created)}</span>${r.status === "Hold" ? `<span>· ${esc(r.owner)}</span>` : ""}</div></div>
    <div class="rt"><b>${money(r.gross)}</b>${pill(s)}</div></a>`;
}
function queueRow(item, sel) {
  return `<a class="item processing ${sel ? "on" : ""}" href="#/invoices/${item.key}"><span class="vav">${item.status === "running" ? '<span class="spin" style="color:var(--info)"></span>' : icon("clock", 14)}</span>
    <div style="min-width:0"><div class="l1"><span>${esc(item.mail?.from_name || item.name)}</span></div><div class="l2">${esc(item.status === "running" ? (item.live.stages.find(s => s.state === "running")?.name || "Starting") + "…" : "Queued")}</div></div>
    <div class="rt">${pill("Processing")}</div></a>`;
}
export function renderInvoices(arg) {
  const ui = state.ui.inv ||= { tab: "review", q: "" };
  const all = heads();
  const rows = listItems();
  const queue = state.queue.filter(q => q.status !== "done" && q.status !== "failed");
  state.ui.listIds = rows.map(r => r.id);
  const counts = Object.fromEntries(TABS.map(([k]) => [k, all.filter(r => inTab(r, k)).length]));
  if (arg) return '<section class="focusdetail" id="detail" aria-label="Invoice review"><div class="detailin"><div class="skel" style="height:120px"></div></div></section>';
  return `<div class="invoiceindex"><div class="deskhead"><div><h2>Invoice register</h2><p>Review decisions, resolve holds and follow payment status.</p></div><button class="btn primary" data-act="upload">${icon("upload",16)} Upload PDF</button></div>
    <section class="listpane" aria-label="Invoices">
      <div class="listtools">
        <div class="seg" role="tablist">${TABS.map(([k, l]) => `<button class="${ui.tab === k ? "on" : ""}" data-act="invtab" data-v="${k}" role="tab" aria-selected="${ui.tab === k}">${l}<span class="n">${counts[k]}</span></button>`).join("")}</div>
        <label class="searchwrap">${icon("search", 14)}<input class="input" id="invq" placeholder="Search number, supplier, PO" value="${esc(ui.q)}" aria-label="Search invoices"></label>
      </div>
      <div class="list" id="invlist">
        ${queue.map(q => queueRow(q, q.key === arg)).join("")}
        ${rows.map(r => rowHTML(r, r.id === arg || head(byId[arg] || {})?.id === r.id)).join("") || (queue.length ? "" : all.length ? emptyState("done", ui.tab === "review" ? "Nothing needs review" : "Nothing here", ui.tab === "review" ? "Every processed invoice is approved or closed." : "Try another tab.") : `<div class="listdrop" data-act="upload">${emptyState("upload", "No invoices yet", "Drop PDFs anywhere, or bring them in from the mailbox.", `<button class="btn primary" data-act="upload">${icon("upload", 15)}Upload</button><a class="btn" href="#/inbox">${icon("inbox", 15)}Inbox</a>`)}</div>`)}
      </div>
      <div class="listfoot"><span>${plural(rows.length, "invoice")}${ui.tab === "review" ? " · " + money(rows.reduce((s, r) => s + (r.gross || 0), 0)) : ""}</span><span><kbd>J</kbd> <kbd>K</kbd> to move</span></div>
    </section>
  </div>`;
}
export async function loadDetail(arg) {
  const pane = $("#detail"); if (!pane || !arg) return;
  if (arg.startsWith("q")) {
    const item = state.queue.find(q => q.key === arg) || state.ui.lastItems?.[arg];
    if (!item) { pane.innerHTML = `<div class="detailin">${empty("Nothing processing", "This upload finished. Pick it from the list.", "", "check")}</div>`; return; }
    pane.innerHTML = processingPane(item); return;
  }
  const r = await (await api("/api/runs/" + arg)).json();
  // A just-uploaded copy of an already-processed file keeps its "returned the original decision" notice.
  if (Object.values(state.ui.lastItems || {}).some(q => q.result?.id === r.id && q.result?.existing)) r.existing = true;
  if (!pane.isConnected) return;
  state.ui.cur = r;
  pane.innerHTML = detailHTML(r);
  pane.scrollTop = 0;
  bindEvidence();
}

/* Detail ------------------------------------------------------------------------- */
function detailHTML(r) {
  const tab = state.ui.dtab || "summary";
  const s = stateOf(r), b = r.brief || {}, cur = head(r);
  const tone = r.closed_by ? (s === "Rejected" ? "risk" : "done") : r.status === "Hold" ? (b.tone === "risk" ? "risk" : "warn") : r.status === "Approved" ? "ok" : "error";
  const fic = { ok: "check", warn: "clock", risk: "shield", error: "alert", done: "link" }[tone];
  const ids = state.ui.listIds || [], i = ids.indexOf(r.id);
  return `<div class="detailin">
    <div class="dtop">
      <a class="btn ghost back" href="#/invoices">${icon("back", 15)}Invoices</a>
      <span style="flex:1"></span>
      <button class="iconbtn" data-act="nav" data-dir="-1" ${i <= 0 ? "disabled" : ""} aria-label="Previous invoice" title="Previous (K)">${icon("up", 16)}</button>
      <button class="iconbtn" data-act="nav" data-dir="1" ${i < 0 || i >= ids.length - 1 ? "disabled" : ""} aria-label="Next invoice" title="Next (J)">${icon("down", 16)}</button>
      <button class="iconbtn" data-act="more" aria-label="More actions">${icon("more", 18, 2.6)}</button>
    </div>
    <div class="ihead">
      <div style="min-width:0">
        <div class="from">${logo(r.vendor, 22)}<a class="vlink" href="#/suppliers/${encodeURIComponent(r.vendor)}">${esc(r.vendor)}</a>
          <span class="t3">·</span>${r.sender ? `${icon("mail", 13)}<span class="mono">${esc(r.sender)}</span>` : `${icon("upload", 13)}<span>Uploaded</span>`}</div>
        <h2>${money(r.gross)}</h2>
        <div class="meta">${esc(r.number)}${r.po ? ` · ${esc(r.po)}` : ""}${r.date ? ` · dated ${day(r.date)}` : ""}${r.due && r.status === "Approved" ? ` · due ${day(r.due)}` : ""}</div>
      </div>
      <div>${statusPill(r)}</div>
    </div>
    ${r.existing ? `<div class="note info" style="margin-top:16px">${icon("layers")}<span>This exact file was processed before, so Kosh returned the original decision instead of posting it twice.</span></div>` : ""}
    <section class="finding ${tone}">
      <div class="fbody"><span class="fi">${icon(fic, 16, 2)}</span><div>
        <h3>${esc(r.closed_by ? (s === "Superseded" ? "A later decision replaced this one" : s === "Rejected" ? "Rejected after review" : "Resolved by a follow-up decision") : b.headline || r.title)}</h3>
        <p>${esc(r.closed_by ? `Originally: ${b.headline || r.title}.` : b.explanation || r.summary || "")}</p></div></div>
      ${nextStep(r, cur)}
    </section>
    <div class="dtabs tabs" role="tablist">${[["summary", "Summary"], ["evidence", "Evidence"], ["activity", "Activity"]].map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-act="dtab" data-v="${k}" role="tab" aria-selected="${tab === k}">${l}${k === "evidence" && r.checks?.length ? `<span class="n">${r.checks.filter(c => c.status === "Passed").length}/${r.checks.length}</span>` : ""}</button>`).join("")}</div>
    <div class="tabpanel">${tab === "evidence" ? evidence(r) : tab === "activity" ? activity(r) : summary(r)}</div>
  </div>`;
}

function nextStep(r, cur) {
  if (r.closed_by) return `<div class="nextstep"><span class="lbl">Current state</span>${statusPill(cur)}<div class="acts"><a class="btn" href="#/invoices/${cur.id}">Open ${esc(cur.number)} ${icon("arrow", 14)}</a></div></div>`;
  if (r.status === "Error") return `<div class="nextstep"><span class="lbl">Next step</span><span class="t2 sm">Ask the supplier for a legible, unlocked PDF.</span><div class="acts">${btn("Try again", "retry", "refresh", "primary", `data-id="${r.id}"`)}</div></div>`;
  if (r.status === "Rejected") return `<div class="nextstep"><span class="lbl">Closed</span><span class="t2 sm">Nothing was posted. The supplier notice is in Summary.</span></div>`;
  if (r.status === "Approved") {
    const p = payment(r), d = discountFor(r);
    if (!p) return `<div class="nextstep"><span class="lbl">Next step</span>${owner("Accounts payable")}<span class="t2 sm">${d?.open ? `Pay by ${shortDay(d.by)} to take the ${d.pct}% early-payment discount (${money(d.amount)}).` : `Schedule payment before ${day(r.due)}.`}</span><div class="acts">${btn("Schedule payment", "pay", "payments", "primary", `data-op="schedule" data-id="${r.id}"`)}</div></div>`;
    if (p.status === "Scheduled") return `<div class="nextstep"><span class="lbl">Next step</span>${owner("Finance controller")}<span class="t2 sm">In batch ${esc(p.batch)} · ${money(p.amount)}${p.discount ? ` after ${money(p.discount)} discount` : ""}</span><div class="acts">${btn("Cancel", "pay", "", "ghost", `data-op="cancel" data-id="${r.id}"`)}${btn("Release payment", "pay", "send", "primary", `data-op="release" data-id="${r.id}"`)}</div></div>`;
    return `<div class="nextstep"><span class="lbl">Paid</span><span class="t2 sm">${money(p.amount)} released by ${esc(p.paid_by)} on ${clock(p.paid)} · batch ${esc(p.batch)}</span></div>`;
  }
  const acts = available(r).filter(k => !["request_info", "reject"].includes(k));
  const main = acts.slice(0, 2);
  return `<div class="nextstep"><span class="lbl">Next step</span>${owner(r.owner)}${waiting(r) ? pill("Waiting", "Info requested " + ago(lastAction(r.id).created)) : ""}
    <div class="acts">${main.map((k, i) => btn(ACTIONS[k].short, "act", ACTIONS[k].icon, i === 0 ? "primary" : "", `data-k="${k}"`)).join("")}
      <button class="btn" data-act="actmore" aria-label="More resolution options">${main.length ? "More" : "Resolve"} ${icon("chevud", 13)}</button></div></div>`;
}

function summary(r) {
  if (r.status === "Error") return `<div class="note">${icon("file")}<span>${esc(r.action || "The document couldn't be read.")}</span></div>`;
  const order = (state.data.orders || []).find(o => o.po === r.po);
  const m = r.brief?.message;
  const passed = (r.checks || []).filter(c => c.status === "Passed").length, held = (r.checks || []).filter(c => c.status === "Hold").length;
  const aside = `<aside class="sumaside">
    ${r.pages ? `<button class="thumb" data-act="dtab" data-v="evidence" aria-label="Open the evidence view"><img src="/api/runs/${r.id}/page/1" alt="First page of ${esc(r.number)}" loading="lazy"><span>${icon("eye", 13)} View evidence</span></button>` : ""}
    <div class="card cardbody checkdonut">${donut([{ label: "Passed", value: passed, color: "var(--ok)" }, { label: "Needs attention", value: held, color: r.brief?.tone === "risk" ? "var(--risk)" : "#d99a3a" }, { label: "Other", value: (r.checks || []).length - passed - held, color: "var(--line-2)" }], 88, 10, `${passed}/${(r.checks || []).length}`)}
      <div><b>${held ? plural(held, "check") + " need attention" : "All checks passed"}</b><p class="t3 xs">Policy ${esc(r.policy || "AP-01")}</p></div></div>
  </aside>`;
  return `<div class="sumgrid"><div class="stack s24">
    <dl class="facts">
      <div><dt>Invoice number</dt><dd>${esc(r.number)}</dd></div>
      <div><dt>Purchase order</dt><dd>${r.po ? esc(r.po) + (order ? ` · ${esc(order.location)}` : "") : "Not printed"}</dd></div>
      <div><dt>Invoice date</dt><dd>${day(r.date)}</dd></div>
      <div><dt>Pre-tax</dt><dd>${money(r.amount)}</dd></div>
      <div><dt>Tax</dt><dd>${money(r.tax ?? (r.gross != null ? r.gross - r.amount : null))}</dd></div>
      <div><dt>Due</dt><dd>${day(r.due)}</dd></div>
      <div><dt>Received</dt><dd>${r.sender ? "Email · " + esc(r.sender) : "Upload · " + esc(r.filename || "")}</dd></div>
      <div><dt>Read by</dt><dd>${esc((r.method || "").replace(/local vision \(([^)]+)\)/, "AI ($1)"))} · ${duration(r.cycle_ms)}</dd></div>
      <div><dt>Policy</dt><dd>${esc(r.policy || "AP-01")}</dd></div>
    </dl>
    ${r.balance ? recon(r, order) : ""}
    ${r.lines?.length ? lines(r, order) : ""}
    ${m && (isOpen(r) || r.status === "Rejected") ? message(m) : ""}
  </div>${aside}</div>`;
}
function recon(r, order) {
  const b = r.balance, req = b.requested || 0, within = Math.max(0, Math.min(req, b.available)), excess = b.excess || 0;
  const scale = Math.max(b.limit, b.spent + req) || 1, w = v => (100 * v / scale).toFixed(2) + "%";
  const ok = r.status === "Approved";
  return `<div><div class="section-t">Purchase order ${esc(r.po)}<span class="t3" style="font-weight:400">${money(b.limit)} authorised</span></div>
    <div class="bar lg"><span class="b-posted" style="width:${w(b.spent)}"></span><span class="${ok ? "b-this" : "b-held"}" style="width:${w(within)}"></span>${excess ? `<span class="b-excess" style="width:${w(excess)}"></span>` : ""}</div>
    <div class="legend"><span><i class="b-posted"></i>Billed before</span><span><i class="${ok ? "b-this" : "b-held"}"></i>This invoice${ok ? "" : " (held)"}</span>${excess ? '<span><i class="b-excess"></i>Beyond the order</span>' : ""}</div>
    <div class="nums"><div><small>Billed before</small><b>${money(b.spent)}</b></div><div><small>This invoice</small><b>${money(b.requested)}</b></div>
      <div class="${excess ? "bad" : ""}"><small>${excess ? "Over the order" : ok ? "Left after posting" : "Left (unchanged)"}</small><b>${money(excess || b.available - (ok ? req : 0))}</b></div>
      <div><small>Earlier invoices</small><b>${b.ledger.length ? b.ledger.map(l => l.id ? `<a class="link" href="#/invoices/${l.id}">${esc(l.number)}</a>` : esc(l.number)).join(", ") : "None"}</b></div></div>
    ${order?.lines?.some(l => l.received != null) ? `<p class="t3 sm" style="margin-top:10px">Current goods receipts: ${order.lines.filter(l => l.received != null).map(l => `${esc(l.item)} ${l.received} received / ${l.billed} billed`).join(" · ")}</p>` : ""}</div>`;
}
function lines(r, order) {
  const ord = new Map((order?.lines || []).map(l => [norm(l.item), l]));
  return `<div><div class="section-t">Lines</div><div class="card tblwrap"><table class="tbl"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th><th>Order</th></tr></thead><tbody>
    ${r.lines.map(l => { const o = ord.get(norm(l.item)); return `<tr><td>${esc(l.item || "Unreadable")}</td><td class="r num">${l.qty ?? esc(l.printed_qty || "?")}</td><td class="r num">${money(l.rate)}</td><td class="r num">${l.qty && l.rate != null ? money(l.qty * l.rate) : "—"}</td><td>${!r.po ? '<span class="t3">—</span>' : o ? (l.rate === o.rate ? pill("Passed", "Matches") : esc("Order rate " + money(o.rate))) : pill("Hold", "Not on order")}</td></tr>`; }).join("")}
  </tbody></table></div></div>`;
}
const norm = s => String(s || "").replace(/[\s./_-]/g, "").toLowerCase();
function message(m) {
  return `<div><div class="section-t">Drafted message<span class="row"><button class="btn ghost" data-act="copymsg">${icon("copy", 14)}Copy</button><a class="btn ghost" href="mailto:?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}">${icon("send", 14)}Open in email</a></span></div>
    <div class="card"><div class="cardbody" style="padding:14px 16px"><div class="t3 sm">To <b style="color:var(--text);font-weight:500">${esc(m.to)}</b></div><div class="t3 sm" style="margin-top:2px">Subject <b style="color:var(--text);font-weight:500">${esc(m.subject)}</b></div>
    <div style="white-space:pre-wrap;margin-top:12px;font-size:13.5px;line-height:1.6;color:var(--text-2)">${esc(m.body)}</div></div></div>
    <p class="t3 xs" style="margin-top:6px">Written from the rule results only, so the numbers always match the checks.</p></div>`;
}

function evidence(r) {
  const bad = new Set((r.checks || []).filter(c => c.status === "Hold").flatMap(c => c.fields || []));
  const doc = r.pages && r.status !== "Error" ? `<div class="doc" id="doc"><div class="dbar"><span class="t2">${plural(r.pages, "page")}</span><div class="row" style="gap:4px"><label class="toggle sm"><input type="checkbox" data-act="showall" ${state.ui.showall ? "checked" : ""}>Show fields</label><button class="iconbtn" data-act="zoom" aria-label="Zoom">${icon("zoom", 16)}</button><a class="iconbtn" href="/api/runs/${r.id}/source" download aria-label="Download PDF">${icon("download", 16)}</a></div></div>
      <div class="pages">${Array.from({ length: r.pages }, (_, i) => i + 1).map(n => `<div class="page"><img src="/api/runs/${r.id}/page/${n}" alt="Invoice page ${n}" loading="lazy">${(r.evidence || []).map((e, i) => e.page === n && e.bbox ? `<div class="hl ${bad.has(e.field) ? "bad" : ""}" data-i="${i}" data-field="${esc(e.field)}" style="${box(e.bbox)}"></div>` : "").join("")}</div>`).join("")}</div></div>`
    : `<div class="card">${empty("No preview", "The document couldn't be opened.", "", "file")}</div>`;
  const row = c => {
    const risk = c.status === "Hold" && RISK_CHECKS.has(c.name);
    const cls = c.status === "Hold" ? (risk ? "risk" : "hold") : c.status.toLowerCase();
    const ic = c.status === "Passed" ? "check" : c.status === "Hold" ? (CHECK_ICON[c.name] || "alert") : c.status === "Waived" ? "flag" : "clock";
    return `<div class="check ${c.status === "Passed" ? "passed" : ""}" data-fields="${esc((c.fields || []).join(" "))}"><span class="ci ${cls}">${icon(ic, 13, 2.2)}</span><div><b>${esc(c.name)}</b><p>${esc(c.detail)}</p>${c.status === "Hold" ? `<div class="own">${esc(c.owner)} · ${esc(c.action)}</div>` : ""}</div>${c.status === "Passed" ? "" : pill(c.status)}</div>`;
  };
  const groups = [["Hold", "Needs attention"], ["Awaiting", "Waiting on another check"], ["Waived", "Waived"], ["Passed", "Passed"]];
  const ev = r.evidence || [];
  const src = s => s === "OCR" ? '<span class="tag ocr">OCR</span>' : s === "AI + verified" ? '<span class="tag ai">AI · verified</span>' : s === "Human confirmation" ? '<span class="tag human">Person</span>' : '<span class="tag">PDF text</span>';
  return `<div class="evidence">${doc}<div class="stack">
    <p class="t3 sm">Hover a check to see where its values are printed.</p>
    <div class="checks">${groups.map(([s, l]) => { const list = (r.checks || []).filter(c => c.status === s).sort((a, b) => (a.priority || 50) - (b.priority || 50)); return list.length ? `<div class="grouplbl">${l} · ${list.length}</div>${list.map(row).join("")}` : ""; }).join("")}</div>
    ${ev.length ? `<details class="more"><summary>${icon("chev", 14)}Extracted fields · ${ev.length}</summary><div class="card tblwrap"><table class="tbl"><tbody>${ev.map((e, i) => `<tr data-evi="${i}"><td class="t2">${esc(FIELD[e.field] || e.field)}</td><td class="mono">${esc(e.value)}</td><td>${src(e.source)}</td><td class="r t3">p.${e.page}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
    ${r.ai_review?.length ? `<details class="more"><summary>${icon("chev", 14)}AI reader · ${r.ai_review.filter(a => a.verified).length} of ${r.ai_review.length} proposals found on the page</summary><div class="note ai" style="margin-bottom:8px">${icon("sparkle")}<span>The model only proposes printed values. Kosh checks whether each proposed value appears on the page. Review the highlighted source to verify its meaning.</span></div><div class="card tblwrap"><table class="tbl"><tbody>${r.ai_review.map(a => `<tr><td class="t2">${esc(FIELD[a.field] || a.field)}</td><td class="mono">${esc(a.value)}</td><td class="r">${a.verified ? pill("Passed", "On page " + a.page) : pill("Rejected", "Discarded")}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
  </div></div>`;
}
function box([x0, y0, x1, y1]) { const p = .004; return `left:${(x0 - p) * 100}%;top:${(y0 - p) * 100}%;width:${(x1 - x0 + 2 * p) * 100}%;height:${(y1 - y0 + 2 * p) * 100}%`; }
export function bindEvidence() {
  const doc = $("#doc"); if (doc) doc.classList.toggle("all", !!state.ui.showall);
  const pane = $("#detail"); if (!pane) return;
  const light = (fields, idx) => {
    $$(".hl.on").forEach(h => h.classList.remove("on"));
    if (!fields && idx == null) return null;
    const hits = $$(".hl").filter(h => idx != null ? h.dataset.i === String(idx) : fields.includes(h.dataset.field));
    hits.forEach(h => h.classList.add("on")); return hits[0];
  };
  pane.onmouseover = e => { const t = e.target.closest("[data-fields],[data-evi]"); if (!t) return; t.dataset.evi != null ? light(null, t.dataset.evi) : t.dataset.fields && light(t.dataset.fields.split(" ")); };
  pane.onmouseout = e => { const t = e.target.closest("[data-fields],[data-evi]"); if (t && !t.contains(e.relatedTarget)) light(); };
  pane.onclick = e => { const t = e.target.closest("[data-fields],[data-evi]"); if (!t || e.target.closest("a,button,input")) return; const f = t.dataset.evi != null ? light(null, t.dataset.evi) : light((t.dataset.fields || "").split(" ")); f?.scrollIntoView({ behavior: "smooth", block: "center" }); };
}

function activity(r) {
  const runs = chain(r), acts = state.data.actions || [];
  const pays = (state.data.payments || []).filter(p => runs.some(x => x.id === p.run_id));
  const items = [];
  for (const x of runs) {
    if (x.kind === "action") {
      const a = acts.find(a => a.run_id === x.id && !a.action.startsWith("payment_") && a.action !== "request_info");
      items.push([x.created, x.status === "Approved" ? "ok" : x.status === "Rejected" ? "risk" : "brand", x.status === "Rejected" ? "ban" : "user",
        `${esc(a?.role || "Reviewer")} · ${esc((a?.action || "review").replace(/_/g, " "))}`, `${x.note ? "“" + esc(x.note) + "” · " : ""}rechecked: ${esc(x.status === "Approved" ? "approved" : x.status === "Rejected" ? "rejected" : x.brief?.headline || x.title)}`, x.id]);
    } else {
      items.push([x.created, x.status === "Approved" ? "ok" : x.status === "Hold" ? "warn" : "risk", x.status === "Approved" ? "check" : x.status === "Hold" ? "clock" : "alert",
        `${x.sender ? "Received by email" : "Uploaded"} · ${esc(x.number)}`, `${x.sender ? esc(x.sender) + " · " : ""}${esc(x.status === "Approved" ? "Approved and posted to " + x.po : x.brief?.headline || x.title)} · read in ${duration(x.cycle_ms)}`, x.id]);
    }
    for (const q of acts.filter(a => a.run_id === x.id && a.action === "request_info")) items.push([q.created, "", "mail", `${esc(q.role)} requested information`, "“" + esc(q.reason) + "”", null]);
    for (const q of acts.filter(a => a.run_id === x.id && a.action === "note")) items.push([q.created, "brand", "edit", `${esc(q.role)} added a note`, esc(q.reason), null]);
  }
  for (const p of pays) {
    items.push([p.scheduled, "", "payments", `Payment scheduled · ${esc(p.batch)}`, `${money(p.amount)}${p.discount ? ` after ${money(p.discount)} early-payment discount` : ""} · ${esc(p.scheduled_by)}`, null]);
    if (p.paid) items.push([p.paid, "ok", "send", "Payment released", `${esc(p.paid_by)}`, null]);
  }
  items.sort((a, b) => a[0].localeCompare(b[0]));
  const tl = (r.timeline || []).filter(e => !["running", "progress"].includes(e.state) && e.stage !== "Human review");
  const note = `<form class="noteform" id="noteform" data-id="${r.id}">${av(state.role, false)}<textarea name="text" rows="2" maxlength="600" placeholder="Add a note for the team: what you checked, who you called, what you're waiting on…" required></textarea><button class="btn">${icon("send", 14)}Post</button></form>`;
  return `<div class="stack s24">${note}<div class="tl">${items.map(([t, c, ic, title, sub, id]) => `<div class="tlrow"><span class="d ${c}">${icon(ic, 12, 2.3)}</span><div><b>${title}</b>${id && id !== r.id ? ` <a class="link sm" href="#/invoices/${id}">open</a>` : id === r.id ? ' <span class="t3 xs">· this record</span>' : ""}<p>${sub}</p></div><time>${clock(t)}</time></div>`).join("")}</div>
    ${tl.length ? `<div><div class="section-t">Processing stages · ${duration(r.cycle_ms)}<button class="btn ghost" data-act="replay">${icon("play", 13)}Replay</button></div><div class="card"><table class="tbl"><tbody>${tl.map(e => `<tr><td>${esc(e.stage)}</td><td class="t2">${esc(e.detail === "Hold" ? "Needs review" : e.detail || e.state)}</td><td class="r t3 num">${e.state === "skipped" ? "skipped" : duration(e.ms)}</td></tr>`).join("")}</tbody></table></div></div>` : ""}
  </div>`;
}

/* Resolution actions ---------------------------------------------------------------- */
const ACTIONS = {
  verify_bank: { role: "Vendor master team", icon: "bank", short: "Verify bank change", title: "Confirm the new bank account", text: "Record a callback to the contact already on file. Updates the vendor record and reruns every check." },
  verify_sender: { role: "Vendor master team", icon: "at", short: "Verify sender", title: "Confirm who sent this", text: "Record a callback confirming the supplier really sent this invoice." },
  select_po: { role: "Procurement", icon: "invoices", short: "Choose PO", title: "Choose the purchase order", text: "Pick the order the goods or service belong to, with the supporting record." },
  amend: { role: "Procurement", icon: "edit", short: "Record amendment", title: "Record a PO amendment", text: "Enter the newly authorised quantity from an approved amendment." },
  receipt: { role: "Procurement", icon: "truck", short: "Record receipt", title: "Record goods received", text: "Update the received quantity from a new goods receipt note." },
  controller: { role: "Finance controller", icon: "user", short: "Authorise", title: "Authorise as controller", text: "Approve an invoice above the controller threshold." },
  waive: { role: "Finance controller", icon: "flag", short: "Waive check", title: "Waive a soft check", text: "Accept a date, item, GST or instruction finding after review. Money controls can't be waived." },
  correct_field: { role: "Accounts payable", icon: "edit", short: "Confirm a value", title: "Confirm a value from the PDF", text: "Type a value you can see on the page when the reader couldn't." },
  request_info: { role: null, icon: "mail", short: "Ask for info", title: "Ask for information", text: "Log that you sent the drafted message. The invoice waits on the reply." },
  reject: { role: "owner", icon: "ban", short: "Reject", title: "Reject the invoice", text: "Close the invoice and record a reason for the supplier." },
};
const WAIVABLE = ["Invoice date window", "Order line", "GST breakdown", "Embedded instructions"];
function available(r) {
  const failing = new Set((r.checks || []).filter(c => c.status === "Hold").map(c => c.name));
  const order = (state.data.orders || []).find(o => o.po === r.po), list = [];
  if (failing.has("Remittance account")) list.push("verify_bank");
  else if (failing.has("Sender verification")) list.push("verify_sender");
  if (failing.has("Purchase order") && r.candidates?.length) list.push("select_po");
  if (failing.has("Cumulative order balance") && order?.lines?.length === 1) list.push("amend");
  if (failing.has("Goods receipt")) list.push("receipt");
  if (failing.has("Controller approval")) list.push("controller");
  if (failing.has("Document evidence")) list.push("correct_field");
  if (WAIVABLE.some(w => failing.has(w))) list.push("waive");
  list.push("request_info", "reject");
  return list;
}
export function moreMenu(anchor) {
  const r = state.ui.cur; if (!r) return;
  const rest = available(r).filter(k => isOpen(r));
  const main = rest.filter(k => !["request_info", "reject"].includes(k)).slice(0, 2);
  const others = rest.filter(k => !main.includes(k));
  openMenu("#moremenu", anchor, `<div class="mh">Resolve</div>${others.map(k => `<button data-act="act" data-k="${k}">${icon(ACTIONS[k].icon, 15)}<span>${ACTIONS[k].title}<span class="ms">${esc(roleLabel(k, r))}</span></span></button>`).join("")}`);
}
function roleLabel(k, r) { const a = ACTIONS[k]; return a.role === "owner" ? (r.owner === "Accounts payable" ? "Accounts payable" : r.owner + " or AP") : a.role || "Any role"; }
export function overflowMenu(anchor) {
  const r = state.ui.cur; if (!r) return;
  openMenu("#moremenu", anchor, `<a href="/api/runs/${r.id}/source" download>${icon("download", 15)}Download source PDF</a><a href="/api/runs/${r.id}/report" download>${icon("file", 15)}Download decision record</a><button data-act="replay">${icon("play", 15)}Replay processing</button><button data-act="copylink">${icon("link", 15)}Copy link</button>`);
}
export function openAction(kind) {
  const r = state.ui.cur, a = ACTIONS[kind]; if (!r || !a) return;
  closeMenus();
  const order = (state.data.orders || []).find(o => o.po === r.po), vendor = vendorOf(r.vendor);
  const need = kind === "reject" ? "Accounts payable" : a.role;
  const allowed = kind === "reject" ? ["Accounts payable", r.owner].includes(state.role) : !need || need === state.role;
  const area = (label, ph, val = "") => `<label class="field">${label}<textarea name="reason" required minlength="5" maxlength="480" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;
  let f = "";
  if (kind === "verify_bank" || kind === "verify_sender") f = `<div class="note warn">${icon("shield")}<span>Call the number already in the vendor record, never a phone number or email from the invoice or the message. Those are exactly what a fraudster controls.</span></div>
    <label class="option"><input type="radio" name="value" value="${esc(vendor?.contact || "")}" required><span><b>${esc(vendor?.contact || "Contact on file")}</b><small>Trusted contact from the vendor master</small></span></label>
    <label class="option disabled"><input type="radio" disabled><span><b>Contact details in the email</b><small>Not accepted for verification</small></span></label>
    ${area("Call notes", "e.g. Spoke to Rekha at the supplier desk; she confirmed the change and the last four digits.")}`;
  else if (kind === "select_po") f = r.candidates.map(p => { const o = (state.data.orders || []).find(x => x.po === p); return `<label class="option"><input type="radio" name="value" value="${esc(p)}" required><span><b>${esc(p)} · ${esc(o?.location || "")}</b><small>${o ? `${money(o.limit - o.billed)} left of ${money(o.limit)}` : ""}</small>${o?.support ? `<br><a class="link sm" href="/samples/${encodeURIComponent(o.support)}" target="_blank" rel="noopener">Open supporting record</a>` : ""}</span></label>`; }).join("") + area("Evidence for this choice", "e.g. Dispatch note DN-301 shows the trip was received at the East depot.");
  else if (kind === "amend") { const l = order?.lines?.[0]; f = `<label class="field">New authorised quantity<small>Currently ${l?.units} ${esc((l?.item || "").toLowerCase())} units on ${esc(r.po)}</small><input type="number" name="value" min="${(l?.units || 0) + 1}" max="100000" required></label>${area("Amendment reference", "e.g. Amendment A1 approved by the category buyer on 22 Nov.")}`; }
  else if (kind === "receipt") { const ls = (order?.lines || []).filter(l => l.received != null); f = `<label class="field">Order line<select name="field">${ls.map(l => `<option value="${esc(l.item)}">${esc(l.item)} · ${l.received} of ${l.units} received</option>`).join("")}</select></label><label class="field">Total received now<input type="number" name="value" min="1" required></label>${area("Goods receipt reference", "e.g. GRN-R2: 3 more chairs received at the North depot.")}`; }
  else if (kind === "controller") f = area("Authorisation note", "e.g. Approved: annual furniture refresh, budget line FUR-26.");
  else if (kind === "waive") f = `<label class="field">Check to waive<select name="field">${(r.checks || []).filter(c => c.status === "Hold" && WAIVABLE.includes(c.name)).map(c => `<option>${esc(c.name)}</option>`).join("")}</select></label>${area("Why this is acceptable", "e.g. Supplier confirmed the date typo; the delivery note is dated 20 Nov.")}`;
  else if (kind === "correct_field") f = `<div class="grid2f"><label class="field">Field<select name="field">${["vendor", "number", "date", "currency", "po", "subtotal", "tax", "total"].map(x => `<option value="${x}">${FIELD[x]}</option>`).join("")}</select></label><label class="field">Page<select name="page">${Array.from({ length: r.pages || 1 }, (_, i) => `<option>${i + 1}</option>`).join("")}</select></label><label class="field span">Value exactly as printed<input name="value" required maxlength="150"></label></div>${area("Where you read it", "e.g. Total printed bottom right of page 1.")}`;
  else if (kind === "request_info") f = `<div class="note info">${icon("mail")}<span>Send the drafted message from Summary, then log it here. The invoice stays open and shows as waiting on a reply.</span></div>${area("What you asked for", "", r.brief?.message ? "Sent: " + r.brief.message.subject : "")}`;
  else if (kind === "reject") f = area("Reason (shared with the supplier)", "e.g. Bank change not confirmed by the supplier; suspected fraud.");
  openSheet(`<form id="actform" data-k="${kind}" style="display:contents">
    <div class="shead"><span class="vav">${icon(a.icon, 16)}</span><div style="flex:1"><h2>${a.title}</h2><p>${esc(r.number)} · ${esc(r.vendor)} · ${money(r.gross)}</p></div><button type="button" class="iconbtn" data-act="closesheet" aria-label="Close">${icon("x", 16)}</button></div>
    <div class="sbody"><p class="t2 sm">${a.text}</p>
      ${allowed ? "" : `<div class="note info">${av(need)}<span style="flex:1">This step belongs to <b>${esc(need)}</b>. Your demo role is ${esc(state.role)}.</span><button type="button" class="btn" data-act="switchrole" data-role="${esc(need)}">Switch</button></div>`}
      ${f}</div>
    <div class="sfoot"><span class="t3 xs" style="margin-right:auto">Recorded as ${esc(state.role)}</span><button type="button" class="btn ghost" data-act="closesheet">Cancel</button><button class="btn ${kind === "reject" ? "danger" : "primary"}" ${allowed ? "" : "disabled"}>${kind === "reject" ? "Reject invoice" : kind === "request_info" ? "Log request" : "Save and recheck"}</button></div></form>`);
  state.ui.sheetKind = kind;
}
export async function submitAction(form) {
  const r = state.ui.cur, fd = new FormData(form), kind = form.dataset.k;
  const body = { action: kind, role: state.role, reason: String(fd.get("reason") || "").trim(), value: String(fd.get("value") || ""), field: String(fd.get("field") || ""), page: Number(fd.get("page") || 1) };
  const b = form.querySelector("button:not([type])"); b.disabled = true; b.innerHTML = '<span class="spin"></span>Rechecking';
  try {
    const res = await post(`/api/runs/${r.id}/action`, body);
    closeSheet(); await refresh();
    if (res.id === r.id) { toast("Logged. The invoice is waiting on a reply."); loadDetail(r.id); }
    else { toast(res.status === "Approved" ? `${res.number} approved after recheck` : res.status === "Rejected" ? `${res.number} rejected` : `${res.number} still needs review: ${res.brief?.headline || res.title}`, { icon: res.status === "Approved" ? "check" : "clock" }); location.hash = "#/invoices/" + res.id; }
  } catch (e) { toast(e.message, { error: true }); b.disabled = false; b.textContent = "Try again"; }
}
export async function payAction(op, ids) {
  try {
    const res = await post("/api/payments", { action: op, role: state.role, ids });
    await refresh();
    toast(op === "schedule" ? `${plural(res.done.length, "payment")} scheduled in ${res.batch}` : op === "release" ? `${plural(res.done.length, "payment")} released` : "Payment cancelled", { icon: "payments" });
    return true;
  } catch (e) {
    const need = op === "release" ? "Finance controller" : "Accounts payable";
    if (/Switch role/.test(e.message)) toast(`${e.message.replace(" Switch role to continue.", "")} <a href="#" data-act="switchrole" data-role="${need}">Switch to ${need}</a>`, { error: true, html: true });
    else toast(e.message, { error: true });
    return false;
  }
}
export function onInvoiceAct(act, el) {
  const r = state.ui.cur;
  if (act === "invtab") { state.ui.inv.tab = el.dataset.v; return "rerender-list"; }
  if (act === "dtab") { state.ui.dtab = el.dataset.v; if (r) { $("#detail").innerHTML = detailHTML(r); bindEvidence(); } return true; }
  if (act === "act") { openAction(el.dataset.k); return true; }
  if (act === "actmore") { moreMenu(el); return true; }
  if (act === "more") { overflowMenu(el); return true; }
  if (act === "replay") { closeMenus(); if (r) replay(r); return true; }
  if (act === "copylink") { closeMenus(); copy(location.href); return true; }
  if (act === "copymsg") { const m = r?.brief?.message; if (m) copy(`To: ${m.to}\nSubject: ${m.subject}\n\n${m.body}`); return true; }
  if (act === "showall") { state.ui.showall = el.checked; $("#doc")?.classList.toggle("all", el.checked); return true; }
  if (act === "zoom") { $("#doc")?.classList.toggle("zoom"); return true; }
  if (act === "closesheet") { closeSheet(); return true; }
  if (act === "nav") { const ids = state.ui.listIds || [], i = ids.indexOf(r?.id) + Number(el.dataset.dir); if (ids[i]) location.hash = "#/invoices/" + ids[i]; return true; }
  if (act === "pay") { payAction(el.dataset.op, [el.dataset.id]).then(ok => {
    if (ok) document.dispatchEvent(new Event("kosh:render"));
  }); return true; }
  return false;
}
export { detailHTML, ACTIONS };
