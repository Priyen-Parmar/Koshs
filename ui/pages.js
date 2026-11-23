// Payments, insights, suppliers, policy and the demo kit (script + invoice lab).
import {
  $, esc, icon, pill, money, moneyShort, clock, shortDay, duration, plural, initials, state, api, post, refresh, toast, btn, empty,
  isOpen, heads, stateOf, payment, discountFor, metrics, byId, csv, RISK_CHECKS,
} from "./shared.js";
import { enqueue } from "./review.js";
import { payAction } from "./invoices.js";
import { runFor, processMail } from "./inbox.js";
import { logo, donut, columns, emptyState } from "./art.js";

const pagehead = (title, sub, actions = "") => `<div class="pagehead"><div><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ""}</div><div class="row">${actions}</div></div>`;
const kpi = (label, value, hint) => `<div class="card kpi"><small>${label}</small><b>${value}</b>${hint ? `<span>${hint}</span>` : ""}</div>`;

/* Payments ---------------------------------------------------------------------- */
export function payments() {
  const runs = heads().filter(r => r.status === "Approved");
  const ready = runs.filter(r => !payment(r)).sort((a, b) => (a.due || "").localeCompare(b.due || ""));
  const pays = state.data.payments || [];
  const sched = pays.filter(p => p.status === "Scheduled"), paid = pays.filter(p => p.status === "Paid");
  const sel = state.ui.paysel ||= new Set();
  for (const id of [...sel]) if (!ready.some(r => r.id === id)) sel.delete(id);
  const total = ready.filter(r => sel.has(r.id)).reduce((s, r) => s + (r.gross || 0), 0);
  const save = ready.filter(r => sel.has(r.id)).reduce((s, r) => { const d = discountFor(r); return s + (d?.open ? d.amount : 0); }, 0);
  const avail = ready.reduce((s, r) => { const d = discountFor(r); return s + (d?.open ? d.amount : 0); }, 0);
  const batches = [...new Set(sched.map(p => p.batch))];
  return `<div class="page">${pagehead("Payments", "Approved invoices become payments. Accounts payable builds the batch; the finance controller releases it. Payments here are simulated.")}
    <div class="grid4" style="margin-bottom:20px">
      ${kpi("Ready to pay", money(ready.reduce((s, r) => s + (r.gross || 0), 0)), plural(ready.length, "invoice"))}
      ${kpi("Scheduled", money(sched.reduce((s, p) => s + p.amount, 0)), plural(sched.length, "payment") + (batches.length ? ` · ${plural(batches.length, "batch", "batches")}` : ""))}
      ${kpi("Paid", money(paid.reduce((s, p) => s + p.amount, 0)), plural(paid.length, "payment"))}
      ${kpi("Early-payment discounts", money(avail), avail ? "still available to take" : pays.some(p => p.discount) ? money(pays.reduce((s, p) => s + p.discount, 0)) + " captured" : "none open")}
    </div>
    <div class="stack s24">
      ${forecast()}
      <div class="card"><div class="cardhead"><h3>Ready to pay</h3><span class="t3">Sorted by due date</span></div>
        ${ready.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th style="width:36px"><input type="checkbox" class="cb" data-act="payall" ${ready.every(r => sel.has(r.id)) ? "checked" : ""} aria-label="Select all"></th><th>Invoice</th><th>Supplier</th><th>Due</th><th>Discount</th><th class="r">Amount</th></tr></thead><tbody>
          ${ready.map(r => { const d = discountFor(r); return `<tr><td><input type="checkbox" class="cb" data-act="paysel" data-id="${r.id}" ${sel.has(r.id) ? "checked" : ""} aria-label="Select ${esc(r.number)}"></td><td><a class="link" href="#/invoices/${r.id}">${esc(r.number)}</a></td><td><span class="row" style="flex-wrap:nowrap">${logo(r.vendor, 24)}${esc(r.vendor)}</span></td><td class="num">${shortDay(r.due)}</td><td>${d ? (d.open ? `<span class="pill p-ok plain">${d.pct}% by ${shortDay(d.by)} · save ${money(d.amount)}</span>` : `<span class="t3 sm">${d.pct}% window closed</span>`) : '<span class="t3">—</span>'}</td><td class="r num">${money(r.gross)}</td></tr>`; }).join("")}
        </tbody></table></div>` : emptyState("pay", "Nothing ready to pay", "Approved invoices land here, sorted by due date.", `<a class="btn" href="#/invoices">Review invoices</a>`)}</div>
      ${sel.size ? `<div class="paybar"><b>${plural(sel.size, "invoice")} · ${money(total - save)}</b>${save ? `<span style="opacity:.75">after ${money(save)} discount</span>` : ""}<span style="flex:1"></span><button class="btn" data-act="payclear">Clear</button><button class="btn primary" data-act="payschedule">${icon("payments", 14)}Schedule batch</button></div>` : ""}
      ${batches.map(b => { const ps = sched.filter(p => p.batch === b); return `<div class="card"><div class="cardhead"><h3>${icon("payments", 15)}Batch ${esc(b)}</h3><div class="row">${btn("Bank file", "bankfile", "download", "ghost", `data-batch="${esc(b)}"`)}${btn("Release " + money(ps.reduce((s, p) => s + p.amount, 0)), "payrelease", "send", "primary", `data-batch="${esc(b)}"`)}</div></div>
        <div class="tblwrap"><table class="tbl"><tbody>${ps.map(p => { const r = byId[p.run_id]; return `<tr><td><a class="link" href="#/invoices/${p.run_id}">${esc(r?.number || p.run_id)}</a></td><td>${esc(r?.vendor || "")}</td><td class="t3 sm">scheduled by ${esc(p.scheduled_by)} · ${clock(p.scheduled)}</td><td class="r num">${money(p.amount)}${p.discount ? ` <span class="t3 xs">(−${money(p.discount)})</span>` : ""}</td><td class="r"><button class="btn ghost" data-act="pay" data-op="cancel" data-id="${p.run_id}">Remove</button></td></tr>`; }).join("")}</tbody></table></div>
        <div class="cardbody" style="padding-top:10px;padding-bottom:12px"><span class="t3 xs">Releasing needs the finance controller, which keeps the person who builds a batch separate from the person who sends the money.</span></div></div>`; }).join("")}
      ${paid.length ? `<div class="card"><div class="cardhead"><h3>Paid</h3><span class="t3">${plural(paid.length, "payment")}</span></div><div class="cardbody row" style="flex-wrap:wrap">${[...new Set(paid.map(p=>p.batch))].map(b=>btn("Export "+b,"bankfile","download","ghost",`data-batch="${esc(b)}"`)).join("")}</div><div class="tblwrap"><table class="tbl"><tbody>${paid.map(p => { const r = byId[p.run_id]; return `<tr><td><a class="link" href="#/invoices/${p.run_id}">${esc(r?.number || "")}</a></td><td>${esc(r?.vendor || "")}</td><td class="t3 sm">${esc(p.batch)} · released by ${esc(p.paid_by)} · ${clock(p.paid)}</td><td class="r num">${money(p.amount)}</td></tr>`; }).join("")}</tbody></table></div></div>` : ""}
    </div></div>`;
}
function forecast() {
  const today = new Date((state.data.today || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const weeks = Array.from({ length: 6 }, (_, i) => ({ i, value: 0, n: 0 }));
  for (const r of heads().filter(r => r.status === "Approved")) {
    const p = payment(r); if (p?.status === "Paid" || !r.due) continue;
    const w = Math.max(0, Math.min(5, Math.floor((new Date(r.due + "T00:00:00") - today) / 6048e5)));
    weeks[w].value += p ? p.amount : r.gross || 0; weeks[w].n++;
  }
  const total = weeks.reduce((s, w) => s + w.value, 0);
  if (!total) return "";
  const label = i => { const d = new Date(today); d.setDate(d.getDate() + 7 * i); return i === 0 ? "Due by week 1" : i === 5 ? "Week 6 onward" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }); };
  return `<div class="card"><div class="cardhead"><h3>Cash-out forecast</h3><span class="t3">approved, unpaid · by due week</span></div><div class="cardbody">
    ${columns(weeks.map(w => ({ label: label(w.i), value: w.value, top: w.value ? moneyShort(w.value) : "", title: plural(w.n, "invoice") })), 150)}</div></div>`;
}
function bankFile(batch) {
  const ps = (state.data.payments || []).filter(p => p.batch === batch);
  csv([["Batch", "Beneficiary", "Account (masked)", "Invoice", "Amount INR", "Discount INR", "Reference"],
    ...ps.map(p => { const r = byId[p.run_id], v = (state.data.vendors || []).find(x => x.name === r?.vendor); return [batch, r?.vendor, v?.account, r?.number, (p.amount / 100).toFixed(2), (p.discount / 100).toFixed(2), `NIMBUS ${r?.number}`]; })],
    `kosh-${batch}.csv`);
}

/* Insights ---------------------------------------------------------------------- */
export function insights() {
  const m = metrics(), d = state.data, runs = d.runs.filter(r => r.kind !== "action");
  const mix = [["Approved first time", "c-ok", runs.filter(r => r.status === "Approved").length], ["Needed review", "c-warn", runs.filter(r => r.status === "Hold").length], ["Unreadable", "c-mute", runs.filter(r => r.status === "Error").length]];
  const mt = mix.reduce((s, x) => s + x[2], 0) || 1;
  const count = xs => Object.entries(xs.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {})).sort((a, b) => b[1] - a[1]);
  const reasons = count(runs.filter(r => r.status === "Hold").map(r => r.title));
  const owners = count(heads().filter(isOpen).map(r => r.owner));
  const bars = rows => rows.length ? `<div class="hbars">${rows.map(([k, v], _, a) => `<div class="hb"><span class="lb" title="${esc(k)}">${esc(k)}</span><span class="tr"><span class="fl" style="width:${100 * v / Math.max(...a.map(x => x[1]))}%"></span></span><span class="v">${v}</span></div>`).join("")}</div>` : `<p class="t3 sm">Nothing yet.</p>`;
  const timed = runs.filter(r => r.cycle_ms > 0).slice(0, 30).reverse(), max = Math.max(1, ...timed.map(r => r.cycle_ms));
  return `<div class="page">${pagehead("Insights", "Measured from this workspace's invoices. Nothing here is estimated.", btn("Export CSV", "export", "download"))}
    <div class="grid4">
      ${kpi("Straight-through rate", m.stp == null ? "—" : m.stp + "%", `${m.straight} of ${m.reviewed} reviews approved automatically`)}
      ${kpi("Flagged invoices", heads().filter(r=>isOpen(r) && RISK_CHECKS.has(r.title)).length, "open bank, sender, duplicate or instruction alerts")}
      ${kpi("Open exceptions", m.open, m.open ? money(m.onHold) + " on hold" : "nothing waiting")}
      ${kpi("Median processing", m.cycle == null ? "—" : duration(m.cycle), m.resolve == null ? "upload to decision" : "median time to follow-up " + duration(m.resolve))}
    </div>
    <div class="grid2" style="margin-top:16px">
      <div class="card"><div class="cardhead"><h3>Outcomes</h3><span class="t3">${plural(runs.length, "invoice")} processed</span></div><div class="cardbody">
        <div class="donutwrap">${donut(mix.map(([k, c, v]) => ({ label: k, value: v, color: { "c-ok": "var(--ok)", "c-warn": "#d99a3a", "c-mute": "var(--text-3)" }[c] })), 132, 16, String(runs.length), "invoices")}
        <div class="dlegend">${mix.map(([k, c, v]) => `<div><i class="${c}"></i><span>${k}</span><b>${v}</b></div>`).join("")}</div></div></div></div>
      <div class="card"><div class="cardhead"><h3>Waiting on</h3><span class="t3">open exceptions by owner</span></div><div class="cardbody">${bars(owners)}</div></div>
      <div class="card"><div class="cardhead"><h3>Why invoices were held</h3><span class="t3">first finding, all time</span></div><div class="cardbody">${bars(reasons)}</div></div>
      <div class="card"><div class="cardhead"><h3>Processing time</h3><span class="t3">per invoice, oldest → newest</span></div><div class="cardbody">${timed.length ? `<div class="cols">${timed.map(r => `<a class="${r.cycle_ms > 2000 ? "slow" : ""}" href="#/invoices/${r.id}" title="${esc(r.number)}: ${duration(r.cycle_ms)}" style="height:${Math.max(4, 100 * r.cycle_ms / max)}%"></a>`).join("")}</div><div class="legend"><span><i style="background:var(--line-2)"></i>Up to 2 s</span><span><i style="background:var(--ai)"></i>Over 2 s</span></div>` : '<p class="t3 sm">No processed invoices yet.</p>'}</div></div>
    </div></div>`;
}
export function exportRuns() {
  csv([["Run", "Invoice", "Supplier", "Sender", "PO", "Pre-tax", "Gross", "Decision", "State", "Reason", "Owner", "Policy", "Reader", "ms", "Created"],
  ...state.data.runs.map(r => [r.id, r.number, r.vendor, r.sender, r.po, (r.amount || 0) / 100, r.gross == null ? "" : r.gross / 100, r.status, stateOf(r), r.brief?.headline || r.title, r.owner, r.policy, r.method, r.cycle_ms, r.created])],
    `kosh-invoices-${new Date().toISOString().slice(0, 10)}.csv`);
}

/* Suppliers -------------------------------------------------------------------- */
export function suppliers(arg) {
  if (arg) return vendorProfile(arg);
  const tab = state.ui.suptab || "vendors", d = state.data;
  const held = po => heads().filter(r => isOpen(r) && r.po === po).reduce((s, r) => s + (r.amount || 0), 0);
  const body = tab === "vendors" ? `<div class="grid3">${d.vendors.map(v => {
    const runs = heads().filter(r => r.vendor === v.name), open = runs.filter(isOpen).length;
    const [pct, days] = (v.discount || "").split("|");
    return `<a class="card vcard" href="#/suppliers/${encodeURIComponent(v.name)}"><div class="cardbody stack s8"><div class="row" style="flex-wrap:nowrap">${logo(v.name, 40)}<div style="min-width:0"><b>${esc(v.name)}</b><div class="t3 xs">${esc(v.state)} · net ${esc(v.terms)}${pct ? ` · ${pct}% if paid in ${days} days` : ""}</div></div></div>
      <dl class="kv" style="margin-top:8px"><dt>Email domain</dt><dd class="mono">${esc(v.domain || "—")}</dd><dt>Bank account</dt><dd class="mono">${esc(v.account)}${v.verified_change ? ` ${pill("Approved", "verified change")}` : ""}</dd><dt>Trusted contact</dt><dd>${esc(v.contact)}</dd><dt>Invoices</dt><dd>${runs.length}${open ? ` · <a class="link" href="#/invoices">${open} open</a>` : ""}</dd></dl>
      <div class="between" style="margin-top:6px"><div class="row">${v.aliases.split("|").map(a => `<span class="tag">${esc(a)}</span>`).join("")}</div><span class="link sm">Profile ${icon("arrow", 12)}</span></div></div></a>`;
  }).join("")}</div><div class="note" style="margin-top:16px">${icon("shield")}<span>Kosh matches suppliers by registered name or alias, never by guessing. Bank details and sender domains are trusted only when they match this register or a recorded callback.</span></div>`
    : `<div class="grid2">${d.orders.map(o => {
      const h = held(o.po), scale = Math.max(o.limit, o.billed + h) || 1, w = v => (100 * v / scale).toFixed(2) + "%";
      return `<div class="card"><div class="cardhead"><h3>${esc(o.po)} <span class="t3" style="font-weight:400">${esc(o.vendor)}</span></h3><span class="tag">${esc(o.location)}</span></div><div class="cardbody">
        <div class="between sm"><span class="t2">${money(o.billed)} of ${money(o.limit)} billed${o.amended ? " · amended" : ""}</span><b class="num">${money(o.limit - o.billed)} left</b></div>
        <div class="bar" style="margin-top:8px"><span class="b-posted" style="width:${w(Math.min(o.billed, o.limit))}"></span><span class="b-held" style="width:${w(h)}"></span></div>
        ${h ? `<p class="xs" style="color:var(--warn);margin-top:6px">${money(h)} held for review</p>` : ""}
        <table class="tbl" style="margin-top:12px"><thead><tr><th style="padding-left:0">Line</th><th class="r">Rate</th><th class="r">Billed</th><th class="r" style="padding-right:0">Received</th></tr></thead><tbody>${o.lines.map(l => `<tr><td style="padding-left:0">${esc(l.item)}</td><td class="r num">${money(l.rate)}</td><td class="r num">${l.billed} / ${l.units}</td><td class="r num" style="padding-right:0">${l.received ?? '<span class="t3">—</span>'}</td></tr>`).join("")}</tbody></table>
        ${o.support ? `<a class="link sm" style="display:inline-block;margin-top:10px" href="/samples/${encodeURIComponent(o.support)}" target="_blank" rel="noopener">Supporting record: ${esc(o.support)}</a>` : ""}</div></div>`;
    }).join("")}</div>${d.opening.length ? `<p class="t3 sm" style="margin-top:12px">Opening balance: ${d.opening.map(x => `${esc(x.number)} (${money(x.amount)} on ${esc(x.po)})`).join(", ")} were billed before this workspace started.</p>` : ""}`;
  return `<div class="page">${pagehead("Suppliers", "The vendor register and purchase orders every invoice is checked against.")}
    <div class="tabs" style="margin-bottom:20px">${[["vendors", "Vendors", d.vendors.length], ["orders", "Purchase orders", d.orders.length]].map(([k, l, n]) => `<button class="${tab === k ? "on" : ""}" data-act="suptab" data-v="${k}">${l}<span class="n">${n}</span></button>`).join("")}</div>${body}</div>`;
}

function vendorProfile(name) {
  const d = state.data, v = d.vendors.find(x => x.name === name);
  if (!v) return `<div class="page">${emptyState("docs", "Supplier not found", "It isn't in the vendor register.", `<a class="btn" href="#/suppliers">All suppliers</a>`)}</div>`;
  const runs = heads().filter(r => r.vendor === v.name).sort((a, b) => a.created.localeCompare(b.created));
  const posted = d.orders.filter(o => o.vendor === v.name).reduce((s, o) => s + o.billed, 0);
  const risk = (d.runs || []).filter(r => r.vendor === v.name && r.kind !== "action" && r.status === "Hold" && ["Remittance account", "Sender verification", "Duplicate invoice", "Embedded instructions"].includes(r.title));
  const [pct, days] = (v.discount || "").split("|");
  const color = s => ({ Approved: "", Hold: "warn", Rejected: "risk" })[s] ?? "";
  return `<div class="page"><a class="link sm" href="#/suppliers">${icon("back", 13)} All suppliers</a>
    <div class="vhero">${logo(v.name, 64)}<div style="min-width:0"><h2>${esc(v.name)}</h2><p class="t2">${esc(v.state)} · net ${esc(v.terms)} days${pct ? ` · ${pct}% discount if paid within ${days} days` : ""} · <span class="mono">${esc(v.domain)}</span></p>
      <div class="row" style="margin-top:8px">${v.aliases.split("|").map(a => `<span class="tag">${esc(a)}</span>`).join("")}</div></div></div>
    <div class="grid4" style="margin:20px 0">
      ${kpi("Invoices", runs.length, plural(runs.filter(isOpen).length, "open exception"))}
      ${kpi("Posted to orders", money(posted), "including opening balance")}
      ${kpi("Fraud signals", risk.length, risk.length ? "bank, sender or instruction holds" : "none recorded")}
      ${kpi("Bank account", esc(v.account), v.verified_change ? "changed after a verified callback" : "as registered")}
    </div>
    <div class="grid2" style="align-items:start">
      <div class="card"><div class="cardhead"><h3>Invoices over time</h3><span class="t3">gross per invoice</span></div><div class="cardbody">
        ${runs.length ? columns(runs.map(r => ({ label: r.number, value: r.gross || 0, top: moneyShort(r.gross), cls: color(r.status), title: r.status }))) : emptyState("docs", "No invoices yet", "Invoices from this supplier will chart here.")}</div></div>
      <div class="card"><div class="cardhead"><h3>Trust</h3></div><div class="cardbody"><dl class="kv">
        <dt>Registered email domain</dt><dd class="mono">${esc(v.domain)}</dd><dt>Trusted contact</dt><dd>${esc(v.contact)}</dd><dt>Bank account</dt><dd class="mono">${esc(v.account)}</dd></dl>
        <div class="note" style="margin-top:14px">${icon("shield")}<span>Bank changes and new sender domains are accepted only after a callback to this contact. Kosh never uses contact details from an invoice or email.</span></div></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="cardhead"><h3>History</h3><span class="t3">${plural(runs.length, "invoice")}</span></div>
      ${runs.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Invoice</th><th>PO</th><th>Finding</th><th>State</th><th class="r">Gross</th></tr></thead><tbody>${runs.slice().reverse().map(r => `<tr><td><a class="link" href="#/invoices/${r.id}">${esc(r.number)}</a></td><td>${esc(r.po || "—")}</td><td class="t2">${esc(r.status === "Approved" ? "Cleared" : r.brief?.headline || r.title)}</td><td>${pill(stateOf(r))}</td><td class="r num">${money(r.gross)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("docs", "No history", "Process an invoice from this supplier.")}</div></div>`;
}

/* Policy ---------------------------------------------------------------------- */
export function policy() {
  const p = state.data.policy, versions = state.data.versions || [];
  const rules = [
    ["file", "Readable evidence", "Every required value must be printed and found on the page. Dates are read day-first and shown back.", "AP"],
    ["suppliers", "Approved supplier", "Registered name or alias only.", "AP"],
    ["at", "Sender", "Emailed invoices must come from the supplier's registered domain.", "Vendor master"],
    ["bank", "Bank account", "Must equal the vendor record. A change needs a callback. Never waivable.", "Vendor master"],
    ["layers", "Duplicates", "Same supplier and normalised number as a posting. Never waivable.", "AP"],
    ["shield", "Embedded instructions", "Text asking to skip review is a fraud signal, never a reason to pass.", "AP"],
    ["invoices", "Purchase order", "An open order for this supplier; Procurement picks one if none is printed.", "Procurement"],
    ["receipt", "Order line and price", `On the order, within ${p.price_percent}% of the agreed rate.`, "Procurement"],
    ["gauge", "Order balance", "Quantity and amount within what earlier postings left.", "Procurement"],
    ["truck", "Goods receipt", "Billed units can't exceed received units.", "Procurement"],
    ["percent", "GST type", "Same state: equal CGST + SGST. Inter-state: IGST.", "AP"],
    ["calendar", "Date", `Within the last ${p.age_days} days and not in the future.`, "AP"],
    ["user", "Controller approval", `Gross above ${money(p.approval_limit * 100)}.`, "Controller"],
  ];
  return `<div class="page">${pagehead("Policy", `AP-01 · version ${p.version}. Every decision records the version it used.`)}
    <div class="grid2" style="align-items:start">
      <form class="card" id="policyform"><div class="cardhead"><h3>Tolerances</h3><span class="t3">apply to new reviews</span></div><div class="cardbody stack">
        <div class="grid2f">
          <label class="field">Price tolerance (%)<small>Above the agreed unit price, max 5</small><input type="number" name="price_percent" min="0" max="5" step="0.5" value="${p.price_percent}" required></label>
          <label class="field">Controller threshold (₹)<small>Gross amount needing sign-off</small><input type="number" name="approval_limit" min="1" max="10000000" step="1" value="${p.approval_limit}" required></label>
          <label class="field">Maximum invoice age (days)<input type="number" name="age_days" min="1" max="1500" value="${p.age_days}" required></label>
          <div class="field">Tax-inclusive invoices<label class="toggle" style="height:36px"><input type="checkbox" name="allow_derived" ${p.allow_derived ? "checked" : ""}>Derive the pre-tax amount</label></div>
        </div>
        <div class="row" style="justify-content:flex-end">${btn("Preview impact", "policypreview", "eye")}<button class="btn primary">Save as v${p.version + 1}</button></div>
        <div id="impact" class="stack s8"></div></div></form>
      <div class="card"><div class="cardhead"><h3>What Kosh checks</h3><span class="t3">in priority order</span></div><div class="rules">${rules.map(([i, t, d, o]) => `<div class="rule"><span class="ri">${icon(i, 14)}</span><div><b>${t}</b><p>${esc(d)}</p></div><span class="t3 xs">${o}</span></div>`).join("")}</div></div>
    </div>
    ${versions.length ? `<p class="t3 sm" style="margin-top:16px">History: ${versions.map(v => `v${v.version} saved ${clock(v.created)}`).join(" · ")}</p>` : ""}</div>`;
}
const policyBody = f => { const d = new FormData(f); return { price_percent: +d.get("price_percent"), approval_limit: +d.get("approval_limit"), age_days: +d.get("age_days"), allow_derived: d.get("allow_derived") === "on" }; };
async function preview() {
  const f = $("#policyform"); if (!f.reportValidity()) return;
  const out = $("#impact"); out.innerHTML = '<div class="skel" style="height:48px"></div>';
  try {
    const { preview } = await post("/api/policy/preview", policyBody(f));
    const clear = preview.filter(x => x.status !== "Hold");
    out.innerHTML = preview.length ? `<div class="note ${clear.length ? "ok" : "info"}">${icon(clear.length ? "check" : "eye")}<span>${clear.length ? `${plural(clear.length, "open exception")} would clear. This is a simulation: nothing is posted until you save and the invoices are rechecked.` : "No open exception would change. Nothing was posted."}</span></div>
      <div class="card"><table class="tbl"><tbody>${preview.map(x => `<tr><td><a class="link" href="#/invoices/${x.id}">${esc(x.number)}</a></td><td class="r">${pill(x.status === "Hold" ? "Hold" : x.status, x.status === "Hold" ? "Still needs review" : "Would approve")}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="note">${icon("eye")}<span>No open exceptions to simulate against.</span></div>`;
  } catch (e) { out.innerHTML = ""; toast(e.message, { error: true }); }
}
export async function savePolicy(f) {
  try { const p = await post("/api/policy/save", policyBody(f)); await refresh(); toast(`Policy v${p.version} saved`); document.dispatchEvent(new CustomEvent("kosh:render")); }
  catch (e) { toast(e.message, { error: true }); }
}

/* Demo kit ---------------------------------------------------------------------- */
const iso = () => { if (state.data?.today) return state.data.today; const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const num = () => "LAB-" + Math.floor(1000 + Math.random() * 9000);
const PRESETS = {
  "Clean": { expect: "Approved against PO-A.", spec: { vendor: "Apex Office Supply", po: "PO-A", bank: "@record", tax_mode: "Split GST", lines: [{ item: "Desk lamp", qty: 2, rate: 2000 }] } },
  "Over-bills PO": { expect: "Needs review by Procurement once fewer than 30 chairs remain on PO-D.", spec: { vendor: "Delta Furniture", po: "PO-D", bank: "@record", tax_mode: "Split GST", lines: [{ item: "Task chair", qty: 30, rate: 5000 }] } },
  "Bank change": { expect: "Fraud risk: printed account differs from the vendor record.", spec: { vendor: "Apex Office Supply", po: "PO-A", bank: "100000009931", tax_mode: "Split GST", lines: [{ item: "Desk lamp", qty: 1, rate: 2000 }] } },
  "No PO": { expect: "Procurement picks PO-E or PO-W.", spec: { vendor: "Kaveri Logistics", po: "", bank: "@record", tax_mode: "Split GST", lines: [{ item: "Freight trip", qty: 1, rate: 6000 }] } },
  "Wrong GST": { expect: "A same-state supplier billing IGST instead of CGST + SGST.", spec: { vendor: "Apex Office Supply", po: "PO-A", bank: "@record", tax_mode: "IGST", lines: [{ item: "Desk lamp", qty: 1, rate: 2000 }] } },
  "Price +4%": { expect: "Held at 0% tolerance. Set 5% in Policy and preview: it clears.", spec: { vendor: "Apex Office Supply", po: "PO-A", bank: "@record", tax_mode: "Split GST", lines: [{ item: "Desk lamp", qty: 1, rate: 2080 }] } },
  "Prompt injection": { expect: "The printed approval instruction is flagged and can't help it pass.", spec: { vendor: "Apex Office Supply", po: "PO-A", bank: "@record", tax_mode: "Split GST", instruction: true, lines: [{ item: "Desk lamp", qty: 1, rate: 2000 }] } },
  "Day-first date": { expect: "Approved: 23/11-style dates are read day-first.", spec: { vendor: "Apex Office Supply Pvt Ltd", po: "PO-A", bank: "@record", tax_mode: "GST", ddmm: true, lines: [{ item: "Desk lamp", qty: 1, rate: 2000 }] } },
  "Unknown supplier": { expect: "Not in the vendor register.", spec: { vendor: "Zenith Traders", po: "", bank: "", tax_mode: "GST", lines: [{ item: "Desk lamp", qty: 1, rate: 2000 }] } },
};
function preset(name) {
  const s = structuredClone(PRESETS[name].spec);
  state.ui.lab = { preset: name, number: num(), tax_rate: 18, instruction: false, ...s, date: s.ddmm ? iso().split("-").reverse().join("/") : iso() };
}
export function demo() {
  const tab = state.ui.demotab || "script";
  return `<div class="page">${pagehead("Demo kit", "A scripted path through the mailbox, an invoice builder for any edge case, and a reset for rehearsals.", btn("Reset workspace", "reset", "refresh"))}
    <div class="tabs" style="margin-bottom:20px">${[["script", "Script"], ["lab", "Invoice lab"]].map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-act="demotab" data-v="${k}">${l}</button>`).join("")}</div>
    ${tab === "lab" ? lab() : script()}</div>`;
}
function script() {
  const mail = state.data.mail || [], samples = state.data.samples || [];
  const steps = mail.map(m => ({ m, s: samples.find(s => s.slug === m.slug) || {}, r: runFor(m) }));
  const next = steps.find(x => !x.r);
  return `<div class="card"><div class="steps">${steps.map((x, i) => `<div class="step ${x.r ? "done" : x === next ? "next" : ""}"><span class="no">${x.r ? icon("check", 12, 3) : i + 1}</span>
    <div style="min-width:0"><b>${esc(x.s.number || x.m.subject)} · ${esc(x.s.group || "")}</b><p>${esc(x.s.description || x.m.subject)}</p><p class="look">${esc(x.s.look || "")}</p></div>
    <div class="row" style="flex-wrap:nowrap">${x.r ? `${pill(stateOf(x.r))}<a class="btn" href="#/invoices/${x.r.id}">Open</a>` : `<a class="btn ghost" href="#/inbox/${x.m.id}">Email</a><button class="btn ${x === next ? "primary" : ""}" data-act="demorun" data-id="${x.m.id}">Process</button>`}</div></div>`).join("")}</div></div>
    <p class="t3 sm" style="margin-top:12px">Order matters: D-103-R1 corrects D-103, and earlier postings change order balances. Reset before a rehearsal.</p>`;
}
function lab() {
  if (!state.ui.lab) preset("Clean");
  const s = state.ui.lab, d = state.data;
  const vkey = d.vendors.find(v => v.name === s.vendor || v.aliases.split("|").includes(s.vendor))?.name;
  const pos = d.orders.filter(o => o.vendor === vkey);
  return `<div class="presets" style="margin-bottom:16px">${Object.keys(PRESETS).map(k => `<button class="${s.preset === k ? "on" : ""}" data-act="preset" data-v="${esc(k)}">${esc(k)}</button>`).join("")}</div>
  <div class="grid2" style="grid-template-columns:minmax(0,1.5fr) minmax(260px,1fr);align-items:start">
    <form class="card" id="labform"><div class="cardbody stack">
      <div class="grid2f">
        <label class="field">Supplier<input name="vendor" list="vlist" value="${esc(s.vendor)}" required maxlength="56"><datalist id="vlist">${d.vendors.flatMap(v => [v.name, ...v.aliases.split("|")]).map(n => `<option value="${esc(n)}">`).join("")}</datalist></label>
        <label class="field">Invoice number<input name="number" value="${esc(s.number)}" required maxlength="36"></label>
        <label class="field">Date<small>2026-11-23, 23/11/2026 or 23 Nov 2026</small><input name="date" value="${esc(s.date)}" maxlength="20"></label>
        <label class="field">Purchase order<small>&nbsp;</small>${pos.length ? `<select name="po"><option value="">None printed</option>${pos.map(o => `<option value="${o.po}" ${o.po === s.po ? "selected" : ""}>${o.po} · ${esc(o.location)}</option>`).join("")}</select>` : `<input name="po" value="${esc(s.po)}" maxlength="32">`}</label>
        <label class="field">Bank account<select name="bankmode"><option value="@record" ${s.bank === "@record" ? "selected" : ""}>Account on file</option><option value="custom" ${s.bank && s.bank !== "@record" ? "selected" : ""}>Different account</option><option value="" ${!s.bank ? "selected" : ""}>Not printed</option></select></label>
        <label class="field">Different account<input name="bank" value="${esc(s.bank === "@record" ? "" : s.bank)}" maxlength="32" inputmode="numeric" placeholder="Only if chosen"></label>
        <label class="field">Tax<select name="tax_mode">${["Split GST", "GST", "IGST", "Inclusive"].map(m => `<option ${m === s.tax_mode ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        <label class="field">Tax rate (%)<input type="number" name="tax_rate" min="0" max="100" step="0.01" value="${esc(s.tax_rate)}"></label>
      </div>
      <div><div class="between" style="margin-bottom:8px"><b class="sm">Lines</b>${btn("Add line", "addline", "plus", "ghost")}</div>
        <div class="lablines">${s.lines.map((l, i) => `<div class="labline"><input class="input" name="item${i}" value="${esc(l.item)}" placeholder="Item" required maxlength="65"><input class="input num" type="number" name="qty${i}" value="${esc(l.qty)}" min="1" required aria-label="Quantity"><input class="input num" type="number" name="rate${i}" value="${esc(l.rate)}" min="0.01" step="0.01" required aria-label="Unit price"><button type="button" class="iconbtn" data-act="delline" data-i="${i}" ${s.lines.length === 1 ? "disabled" : ""} aria-label="Remove line">${icon("x", 15)}</button></div>`).join("")}</div></div>
      <label class="toggle"><input type="checkbox" name="instruction" ${s.instruction ? "checked" : ""}>Print an instruction asking reviewers to approve without review</label>
    </div><div class="cardhead" style="border-bottom:0;border-top:1px solid var(--line)"><span class="t3 xs">Prints a real PDF and runs the full pipeline.</span><div class="row">${btn("Download", "labdl", "download", "ghost")}<button class="btn primary">${icon("play", 13)}Generate and process</button></div></div></form>
    <div class="stack"><div class="card"><div class="cardbody" id="labtotals">${labTotals()}</div></div>
      <div class="note ${PRESETS[s.preset] ? "info" : ""}">${icon("eye")}<span><b>${esc(s.preset || "Custom")}.</b> ${esc(PRESETS[s.preset]?.expect || "Kosh decides from what gets printed.")}</span></div></div>
  </div>`;
}
export function labTotals() {
  const s = state.ui.lab, sub = s.lines.reduce((t, l) => t + (+l.qty || 0) * (+l.rate || 0), 0), tax = Math.round(sub * (+s.tax_rate || 0)) / 100;
  return `<div class="receipt">${s.lines.map(l => `<div class="between"><span>${esc(l.qty)} × ${esc(l.item || "item")}</span><span>${money(Math.round((+l.qty || 0) * (+l.rate || 0) * 100))}</span></div>`).join("")}<hr>
    <div class="between"><span>Subtotal</span><span>${money(Math.round(sub * 100))}</span></div><div class="between"><span>${esc(s.tax_mode)} ${esc(s.tax_rate)}%</span><span>${money(Math.round(tax * 100))}</span></div>
    <div class="between"><b>Total</b><b>${money(Math.round((sub + tax) * 100))}</b></div></div>`;
}
export function readLab(f) {
  const d = new FormData(f), s = state.ui.lab;
  for (const k of ["vendor", "number", "date", "po", "tax_mode", "tax_rate"]) if (d.has(k)) s[k] = String(d.get(k));
  const mode = d.get("bankmode"); s.bank = mode === "@record" ? "@record" : mode === "custom" ? String(d.get("bank") || "") : "";
  s.instruction = d.get("instruction") === "on";
  s.lines = s.lines.map((l, i) => ({ item: String(d.get("item" + i) ?? l.item), qty: d.get("qty" + i) ?? l.qty, rate: d.get("rate" + i) ?? l.rate }));
  return s;
}
export async function labGenerate(f, download) {
  if (!f.reportValidity()) return;
  const s = readLab(f);
  if (s.bank && s.bank !== "@record" && !/^\d{6,24}$/.test(s.bank.replace(/[\s-]/g, ""))) { toast("Use 6–24 digits for a different bank account.", { error: true }); return; }
  const spec = { vendor: s.vendor.trim(), number: s.number.trim(), date: s.date.trim(), currency: "INR", po: s.po.trim(), bank: s.bank, tax_mode: s.tax_mode, tax_rate: +s.tax_rate, instruction: s.instruction, replaces: "", place: "", lines: s.lines.map(l => ({ item: l.item.trim(), qty: +l.qty, rate: +l.rate })) };
  try {
    const blob = await (await api("/api/lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) })).blob();
    const name = `lab-${s.number.replace(/[^\w.-]+/g, "_")}.pdf`;
    if (download) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); return; }
    enqueue([new File([blob], name, { type: "application/pdf" })]); s.number = num();
  } catch (e) { toast(e.message, { error: true }); }
}

export function onPageAct(act, el) {
  const ui = state.ui;
  switch (act) {
    case "paysel": { const s = ui.paysel; el.checked ? s.add(el.dataset.id) : s.delete(el.dataset.id); return "render"; }
    case "payall": { const ready = heads().filter(r => r.status === "Approved" && !payment(r)); ui.paysel = el.checked ? new Set(ready.map(r => r.id)) : new Set(); return "render"; }
    case "payclear": ui.paysel = new Set(); return "render";
    case "payschedule": payAction("schedule", [...ui.paysel]).then(ok => { if (ok) { ui.paysel = new Set(); document.dispatchEvent(new CustomEvent("kosh:render")); } }); return true;
    case "payrelease": payAction("release", (state.data.payments || []).filter(p => p.batch === el.dataset.batch && p.status === "Scheduled").map(p => p.run_id)).then(ok => ok && document.dispatchEvent(new CustomEvent("kosh:render"))); return true;
    case "bankfile": bankFile(el.dataset.batch); return true;
    case "export": exportRuns(); return true;
    case "suptab": ui.suptab = el.dataset.v; return "render";
    case "policypreview": preview(); return true;
    case "demotab": ui.demotab = el.dataset.v; return "render";
    case "demorun": processMail(el.dataset.id); return true;
    case "preset": preset(el.dataset.v); return "render";
    case "addline": readLab($("#labform")); if (ui.lab.lines.length >= 8) { toast("Up to eight lines.", { error: true }); return true; } ui.lab.lines.push({ item: "", qty: 1, rate: "" }); ui.lab.preset = null; return "render";
    case "delline": readLab($("#labform")); ui.lab.lines.splice(+el.dataset.i, 1); ui.lab.preset = null; return "render";
    case "labdl": labGenerate($("#labform"), true); return true;
  }
  return false;
}
