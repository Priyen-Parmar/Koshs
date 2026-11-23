// Shared state, formatting, data derivations and tiny view helpers.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = n => n == null ? "—" : (Math.round(n) % 100 ? inr2 : inr).format(n / 100);
export const moneyShort = n => {
  if (n == null) return "—";
  const r = Math.abs(n / 100);
  return r >= 1e7 ? "₹" + (n / 1e9).toFixed(2) + " Cr" : r >= 1e5 ? "₹" + (n / 1e7).toFixed(2) + " L" : inr.format(Math.round(n / 100));
};
export const clock = iso => iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
export const day = iso => iso ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const shortDay = iso => iso ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";
export function duration(ms) { return ms == null ? "—" : ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + " s"; }
export function ago(iso) {
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  return min < 1 ? "just now" : min < 60 ? min + "m ago" : min < 1440 ? Math.floor(min / 60) + "h ago" : Math.floor(min / 1440) + "d ago";
}
export const plural = (n, w, p) => n + " " + (n === 1 ? w : (p || w + "s"));
export const initials = name => String(name || "?").split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("") || "?";

export const ROLES = ["Accounts payable", "Procurement", "Vendor master team", "Finance controller"];
export const ROLE_INFO = {
  "Accounts payable": ["AP", "av-ap", "Reviews invoices, schedules payments, rejects"],
  "Procurement": ["PR", "av-pr", "Confirms orders, amendments and receipts"],
  "Vendor master team": ["VM", "av-vm", "Verifies bank changes and senders"],
  "Finance controller": ["FC", "av-fc", "Approves large invoices, releases payments"],
};
let stored = "Accounts payable";
try { stored = sessionStorage.getItem("kosh-role") || stored; } catch { }
export const state = { data: null, role: ROLES.includes(stored) ? stored : "Accounts payable", queue: [], live: null, ui: {} };
export function setRole(role) { state.role = role; try { sessionStorage.setItem("kosh-role", role); } catch { } document.dispatchEvent(new CustomEvent("kosh:role")); }
export function av(role, small = true) { const [k, c] = ROLE_INFO[role] || ["··", "av-ap"]; return `<span class="av ${small ? "s" : ""} ${c}">${k}</span>`; }
export const owner = role => `<span class="chip">${av(role)}${esc(role)}</span>`;

export const icons = {
  home: "M3 11 12 4l9 7 M5 10v10h14V10 M10 20v-6h4v6",
  inbox: "M4 4h16v16H4z M4 14h4.5l1.5 2.5h4l1.5-2.5H20",
  invoices: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h4",
  payments: "M3 7h18v11H3z M3 11h18 M7 15h3",
  insights: "M4 20V11 M10 20V5 M16 20v-6 M22 20H2",
  suppliers: "M3 21h18 M5 21V8l7-5 7 5v13 M9 21v-6h6v6",
  policy: "M12 3l8 3v6c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z M8.5 12l2.5 2.5 4.5-5",
  demo: "M9 3h6 M10 3v6.5L4.6 18.4A1.8 1.8 0 0 0 6.2 21h11.6a1.8 1.8 0 0 0 1.6-2.6L14 9.5V3",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 16v4h16v-4",
  plus: "M12 5v14 M5 12h14",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  back: "M19 12H5 M11 6l-6 6 6 6",
  up: "M12 19V5 M6 11l6-6 6 6",
  down: "M12 5v14 M6 13l6 6 6-6",
  check: "M5 12.5l4.5 4.5L19 7",
  x: "M6 6l12 12 M18 6 6 18",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7.5V12l3 2",
  dash: "M6 12h12",
  alert: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7.5v5.5 M12 16.3v.01",
  shield: "M12 3l8 3v6c0 4.5-3.4 7.7-8 9-4.6-1.3-8-4.5-8-9V6z M12 8v5 M12 15.8v.01",
  bank: "M3 10l9-6 9 6 M5 10v8 M9.7 10v8 M14.3 10v8 M19 10v8 M3 21h18",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  file: "M7 3h7l5 5v13H7z M14 3v5h5",
  mail: "M3 6h18v12H3z M3 7l9 6 9-6",
  copy: "M9 9h11v11H9z M5 15V4h11",
  download: "M12 3v12 M7 10l5 5 5-5 M4 20h16",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5L3 9 M3 4v5h5 M4 13a8 8 0 0 0 14.6 4.5L21 15 M21 20v-5h-5",
  play: "M7 4l13 8-13 8z",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  flag: "M5 21V4 M5 4h11l-2 4 2 4H5",
  edit: "M4 20h4L19 9l-4-4L4 16z M13.5 6.5l4 4",
  ban: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M5.6 5.6l12.8 12.8",
  layers: "M12 3 2 8l10 5 10-5z M2 13l10 5 10-5 M2 17.5l10 5 10-5",
  zoom: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4 M11 8v6 M8 11h6",
  moon: "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M2 12h2 M20 12h2 M4.9 19.1l1.4-1.4 M17.7 6.3l1.4-1.4",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  chev: "m9 6 6 6-6 6",
  chevud: "m8 9 4-4 4 4 M16 15l-4 4-4-4",
  scale: "M12 3v18 M5 21h14 M3 8h18 M6 8l-3 7a3 3 0 0 0 6 0z M18 8l-3 7a3 3 0 0 0 6 0z",
  truck: "M2 6h12v10H2z M14 10h4l3 3v3h-7z M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
  percent: "M19 5 5 19 M7 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M17 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  calendar: "M4 5h16v16H4z M4 10h16 M9 3v4 M15 3v4",
  coins: "M9 7a6 3 0 1 0 12 0A6 3 0 1 0 9 7z M9 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7 M3 12a6 3 0 0 0 6 3 M3 12v5c0 1.7 2.7 3 6 3 1.2 0 2.3-.2 3.2-.5",
  gauge: "M12 14l4-4 M3.5 18a9 9 0 1 1 17 0z",
  at: "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  send: "M22 2 11 13 M22 2l-7 20-4-9-9-4z",
  help: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2.2-2.5 4 M12 17.3v.01",
};
export function icon(k, size = 16, sw = 1.75) {
  return `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><path d="${icons[k] || icons.dash}"/></svg>`;
}

/* Status vocabulary ----------------------------------------------------------- */
const PILL = {
  Approved: ["p-ok", "Approved"], Hold: ["p-warn", "Needs review"], Resolved: ["p-ok", "Resolved"], Rejected: ["p-risk", "Rejected"],
  Error: ["p-risk", "Unreadable"], Superseded: ["", "Superseded"], Passed: ["p-ok", "Passed"], Awaiting: ["", "Waiting"],
  Waived: ["p-ai", "Waived"], Waiting: ["p-info", "Waiting on reply"], Scheduled: ["p-info", "Scheduled"], Paid: ["p-ok", "Paid"],
  Risk: ["p-risk", "Fraud risk"], Processing: ["p-info", "Processing"], New: ["p-brand", "New"], Ready: ["p-ok", "Ready to pay"],
};
export function pill(s, label) { const [c, t] = PILL[s] || ["", s]; return `<span class="pill ${c}">${esc(label || t)}</span>`; }
export function btn(text, act, ic, cls = "", attrs = "") { return `<button class="btn ${cls}" data-act="${act}" ${attrs}>${ic ? icon(ic, 15) : ""}${text ? esc(text) : ""}</button>`; }
export function empty(title, text, action = "", ic = "inbox") {
  return `<div class="empty"><div class="ic">${icon(ic, 22, 1.6)}</div><h3>${esc(title)}</h3><p>${text}</p>${action ? `<div style="margin-top:8px">${action}</div>` : ""}</div>`;
}

/* Overlays -------------------------------------------------------------------- */
export function modal(title, html) { $("#mtitle").textContent = title; $("#mbody").innerHTML = html; if (!$("#modal").open) $("#modal").showModal(); }
export function closeModal() { if ($("#modal").open) $("#modal").close(); }
export function toast(text, opts = {}) {
  const el = document.createElement("div");
  el.className = "toast" + (opts.error ? " err" : "");
  el.innerHTML = icon(opts.error ? "alert" : opts.icon || "check", 16) + `<div>${opts.html ? text : esc(text)}</div><button class="x" aria-label="Dismiss">${icon("x", 14)}</button>`;
  el.querySelector(".x").onclick = () => el.remove();
  $("#toasts").append(el);
  setTimeout(() => el.remove(), opts.error ? 8000 : 4500);
}
export function openSheet(html) { const s = $("#sheet"); s.innerHTML = html; s.classList.add("open"); s.setAttribute("aria-hidden", "false"); $("#scrim").classList.add("open"); setTimeout(() => s.querySelector("textarea,input:not([type=radio]),select")?.focus(), 220); }
export function closeSheet() { $("#sheet").classList.remove("open"); $("#sheet").setAttribute("aria-hidden", "true"); $("#scrim").classList.remove("open"); }
export function openMenu(menu, anchor, html, place = "below") {
  const m = $(menu); m.innerHTML = html; m.classList.add("open");
  const r = anchor.getBoundingClientRect(), w = Math.max(240, m.offsetWidth);
  m.style.left = Math.min(innerWidth - w - 8, Math.max(8, place === "above" ? r.left : r.right - w)) + "px";
  if (place === "above") { m.style.top = "auto"; m.style.bottom = (innerHeight - r.top + 6) + "px"; }
  else { m.style.bottom = "auto"; m.style.top = (r.bottom + 6) + "px"; }
}
export function closeMenus() { $$(".menu.open").forEach(m => m.classList.remove("open")); $("#whobtn")?.setAttribute("aria-expanded", "false"); }

/* API ---------------------------------------------------------------------------- */
export async function api(url, opt) {
  let r;
  try { r = await fetch(url, opt); } catch { throw Error("Kosh isn't reachable. Check that the local server is still running."); }
  if (!r.ok) {
    let msg;
    try { const body = await r.json(); msg = body.detail; if (Array.isArray(msg)) msg = msg.map(d => String(d.msg).replace(/^Value error, /, "")).join(" "); } catch { }
    throw Error(typeof msg === "string" ? msg : `Request failed (${r.status}).`);
  }
  return r;
}
export async function post(url, body) { return (await api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json(); }
export const byId = {};
export async function refresh() {
  const d = await (await api("/api/dashboard")).json();
  for (const k of ["runs", "orders", "opening", "vendors", "actions", "samples", "versions", "mail", "payments"]) if (!Array.isArray(d[k])) d[k] = [];
  d.policy ||= { version: 1, price_percent: 0, approval_limit: 500000, age_days: 180, allow_derived: true };
  state.data = d;
  for (const k of Object.keys(byId)) delete byId[k];
  for (const r of d.runs) byId[r.id] = r;
  document.dispatchEvent(new CustomEvent("kosh:data"));
  return d;
}

/* Derived data ------------------------------------------------------------------- */
export const isOpen = r => r.status === "Hold" && !r.closed_by;
export const heads = () => (state.data?.runs || []).filter(r => !r.closed_by);
export const payment = r => (state.data?.payments || []).find(p => p.run_id === r.id);
export function lastAction(id) { return (state.data?.actions || []).find(a => a.run_id === id && !a.action.startsWith("payment_") && a.action !== "note"); }
export const waiting = r => isOpen(r) && lastAction(r.id)?.action === "request_info";
export const RISK_CHECKS = new Set(["Remittance account", "Duplicate invoice", "Embedded instructions", "Sender verification"]);
export const risky = r => isOpen(r) && (r.brief?.tone === "risk" || RISK_CHECKS.has(r.title));
export function stateOf(r) {
  if (r.closed_by) { const n = byId[r.closed_by]; return !n ? "Resolved" : n.status === "Rejected" ? "Rejected" : n.status === "Approved" ? "Resolved" : "Superseded"; }
  if (r.status === "Approved") { const p = payment(r); return p ? p.status : "Ready"; }
  if (r.status === "Hold") return waiting(r) ? "Waiting" : risky(r) ? "Risk" : "Hold";
  return r.status;
}
export const statusPill = r => pill(stateOf(r));
export function chain(r) {
  let root = r, g = 0;
  while (root?.resolves && byId[root.resolves] && g++ < 20) root = byId[root.resolves];
  const out = []; let cur = root; g = 0;
  while (cur && g++ < 20) { out.push(cur); cur = cur.closed_by ? byId[cur.closed_by] : null; }
  return out;
}
export const head = r => { let cur = r, g = 0; while (cur?.closed_by && byId[cur.closed_by] && g++ < 20) cur = byId[cur.closed_by]; return cur; };
export function vendorOf(name) { return (state.data?.vendors || []).find(v => v.name === name); }
export function discountFor(r) {
  const v = vendorOf(r.vendor); if (!v?.discount || !r.date || !r.gross) return null;
  const [pct, days] = v.discount.split("|").map(Number); if (!pct) return null;
  const by = new Date(r.date + "T00:00:00"); by.setDate(by.getDate() + days);
  const today = new Date((state.data.today || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const iso = `${by.getFullYear()}-${String(by.getMonth() + 1).padStart(2, "0")}-${String(by.getDate()).padStart(2, "0")}`;
  return { pct, days, by: iso, amount: Math.round(r.gross * pct / 100), open: today <= by };
}
export function median(xs) { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export function metrics() {
  const runs = state.data?.runs || [];
  const reviews = runs.filter(r => r.kind !== "action");
  const straight = reviews.filter(r => r.status === "Approved");
  const open = heads().filter(isOpen);
  const cycles = reviews.map(r => r.cycle_ms).filter(x => x > 0);
  const resolved = runs.filter(r => r.closed_by && byId[r.closed_by]).map(r => Date.parse(byId[r.closed_by].created) - Date.parse(r.created)).filter(x => x >= 0);
  const pays = state.data?.payments || [];
  return {
    reviewed: reviews.length, straight: straight.length,
    stp: reviews.length ? Math.round(100 * straight.length / reviews.length) : null,
    open: open.length, onHold: open.reduce((s, r) => s + (r.gross || 0), 0),
    cycle: median(cycles), resolve: median(resolved),
    scheduled: pays.filter(p => p.status === "Scheduled").reduce((s, p) => s + p.amount, 0),
    paid: pays.filter(p => p.status === "Paid").reduce((s, p) => s + p.amount, 0),
    saved: pays.reduce((s, p) => s + (p.discount || 0), 0),
  };
}

/* Labels ---------------------------------------------------------------------------- */
export const FIELD = {
  vendor: "Supplier", number: "Invoice number", date: "Invoice date", currency: "Currency", po: "Purchase order", item: "Item",
  qty: "Quantity", rate: "Unit price", subtotal: "Subtotal", tax: "Tax", total: "Total", bank: "Bank account",
  replaces: "Replaces", cgst: "CGST", sgst: "SGST", igst: "IGST", tax_rate: "Tax rate", place: "Place of supply", terms: "Terms",
  due: "Due date", gstin: "GSTIN", inclusive: "Tax basis", line_amount: "Line amount", instructions: "Embedded instruction",
};
export const CHECK_ICON = {
  "Document evidence": "file", "Invoice date window": "calendar", "Approved supplier": "suppliers", "Currency": "coins",
  "Sender verification": "at", "Remittance account": "bank", "GST breakdown": "percent", "Invoice arithmetic": "scale",
  "Duplicate invoice": "layers", "Embedded instructions": "shield", "Correction reference": "link", "Purchase order": "invoices",
  "Order line": "receipt", "Cumulative order balance": "gauge", "Goods receipt": "truck", "Controller approval": "user",
};
export function csv(rows, name) {
  const quote = v => '"' + String(v ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
  const blob = new Blob(["﻿" + rows.map(row => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Copy isn't available here. Select the text instead.", { error: true }); }
}
