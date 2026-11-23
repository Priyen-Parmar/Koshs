// Kosh shell: navigation, role menu, routing, live updates, palette and keyboard.
import {
  $, $$, esc, icon, state, refresh, toast, api, modal, closeModal, openMenu, closeMenus, closeSheet, setRole, av,
  ROLES, ROLE_INFO, heads, isOpen, payment, money, byId,
} from "./shared.js";
import { enqueue, processingPane } from "./review.js";
import { renderInvoices, loadDetail, onInvoiceAct, submitAction, openAction } from "./invoices.js";
import { renderInbox, mailDetail, onInboxAct, processAll } from "./inbox.js";
import * as pages from "./pages.js";
import { home } from "./home.js";

const NAV = [
  ["home", "Home", "home"], ["inbox", "Inbox", "inbox"], ["invoices", "Invoices", "invoices"], ["payments", "Payments", "payments"],
  ["insights", "Insights", "insights"], ["suppliers", "Suppliers", "suppliers"], ["policy", "Policy", "policy"],
];
const TITLES = {
  home: ["Home", ""], inbox: ["Inbox", "ap@nimbusretail.in"], invoices: ["Invoices", ""], payments: ["Payments", ""], insights: ["Insights", ""],
  suppliers: ["Suppliers", ""], policy: ["Policy", ""], demo: ["Demo kit", ""],
};
const PAGES = { home, payments: pages.payments, insights: pages.insights, suppliers: pages.suppliers, policy: pages.policy, demo: pages.demo };
let cur = { page: "home", arg: null };
state.ui.lastItems = {};

/* Shell ------------------------------------------------------------------------ */
function paintNav() {
  const d = state.data;
  const counts = d ? {
    inbox: (d.mail || []).filter(m => !(d.runs || []).some(r => r.mail?.id === m.id)).length,
    invoices: heads().filter(isOpen).length,
    payments: heads().filter(r => r.status === "Approved" && !payment(r)).length,
  } : {};
  const mine = d ? heads().filter(r => isOpen(r) && r.owner === state.role).length : 0;
  $("#nav").innerHTML = NAV.map(([k, l, ic]) => `<a class="navitem ${cur.page === k ? "on" : ""}" href="#/${k}" ${cur.page === k ? 'aria-current="page"' : ""}>${icon(ic, 16)}<span>${l}</span>${counts[k] ? `<span class="n ${k === "invoices" && mine ? "hot" : ""}" title="${k === "invoices" && mine ? mine + " waiting on you" : ""}">${counts[k]}</span>` : ""}</a>`).join("")
    + `<div class="navsec">Demo</div><a class="navitem ${cur.page === "demo" ? "on" : ""}" href="#/demo">${icon("demo", 16)}<span>Demo kit</span></a>`;
  const [, , desc] = ROLE_INFO[state.role];
  $("#whobtn").innerHTML = `${av(state.role, false)}<span style="min-width:0"><span class="lbl">Demo role</span><b>${esc(state.role)}</b></span>${icon("chevud", 14)}`;
  $("#whobtn").title = desc;
  $("#ainote").innerHTML = `<span class="dot ${d?.ai ? "on" : ""}"></span><span title="${esc(d?.ai || "")}">${d?.ai ? "AI reader on" : "AI reader off · rules and OCR"}</span>`;
}
function syncThemeControl() {
  const dark = document.documentElement.dataset.theme === "dark";
  const control = $("#themebtn");
  control.innerHTML = icon(dark ? "sun" : "moon", 18);
  control.setAttribute("aria-label", dark ? "Use light theme" : "Use dark theme");
  control.title = control.getAttribute("aria-label");
}
function toggleTheme() {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#15191e" : "#f7f8f6";
  try { localStorage.setItem("kosh-theme2", theme); } catch {}
  syncThemeControl();
}
function roleMenu() {
  const dark = document.documentElement.dataset.theme === "dark";
  openMenu("#rolemenu", $("#whobtn"), `<div class="mh">Switch role (simulated for the demo)</div>${ROLES.map(r => `<button data-act="role" data-role="${esc(r)}">${av(r)}<span><span style="display:block">${esc(r)}</span><span class="ms">${esc(ROLE_INFO[r][2])}</span></span>${r === state.role ? `<span class="chk">${icon("check", 15, 2.4)}</span>` : ""}</button>`).join("")}
    <hr><button data-act="theme">${icon(dark ? "sun" : "moon", 15)}${dark ? "Light mode" : "Dark mode"}</button><button data-act="help">${icon("help", 15)}Keyboard shortcuts</button><button data-act="reset">${icon("refresh", 15)}Reset demo workspace</button>`, "above");
  $("#whobtn").setAttribute("aria-expanded", "true");
}

/* Router --------------------------------------------------------------------------- */
const mobileNav = matchMedia("(max-width: 900px)");
function setNav(open) {
  const show = mobileNav.matches && open;
  document.body.classList.toggle("navopen", show);
  $("#sidebar").inert = mobileNav.matches && !show;
  $("#menu").setAttribute("aria-expanded", String(show));
  $(".main").inert = show;
  if (show) $("#sidebar .brand").focus();
}
mobileNav.addEventListener("change", () => setNav(false));
setNav(false);
function parse() { const [page = "home", arg = null] = location.hash.replace(/^#\/?/, "").split("/"); return { page: page || "home", arg: arg ? decodeURIComponent(arg) : null }; }
async function route() {
  cur = parse(); closeMenus(); closeSheet(); setNav(false);
  const c = $("#content");
  if (!state.data) {
    try { await refresh(); }
    catch (e) { c.innerHTML = `<div class="page"><div class="empty"><div class="ic">${icon("alert", 22)}</div><h3>Kosh isn't responding</h3><p>${esc(e.message)}</p><button class="btn primary" data-act="reload">Try again</button></div></div>`; return; }
  }
  const [t, sub] = TITLES[cur.page] || ["Kosh", ""];
  $("#title").textContent = t; $("#subtitle").textContent = sub;
  paintNav();
  try {
    if (cur.page === "inbox") c.innerHTML = renderInbox(cur.arg);
    else if (cur.page === "invoices") { const before = cur.arg; c.innerHTML = renderInvoices(cur.arg); cur = parse(); if (cur.arg) await loadDetail(cur.arg); if (!before && cur.arg) paintNav(); }
    else if (PAGES[cur.page]) c.innerHTML = PAGES[cur.page](cur.arg);
    else { location.hash = "#/home"; return; }
    if (cur.arg && byId[cur.arg]) $("#subtitle").textContent = byId[cur.arg].number + " · " + byId[cur.arg].vendor;
  } catch (e) {
    c.innerHTML = `<div class="page"><div class="empty"><div class="ic">${icon("alert", 22)}</div><h3>That page couldn't open</h3><p>${esc(e.message)}</p><a class="btn" href="#/inbox">Back to inbox</a></div></div>`;
  }
  document.title = `${$("#title").textContent} · Kosh`;
  bindListSearch();
  window.scrollTo(0,0);
}
function rerender() {
  const list = $(".list")?.scrollTop, y = scrollY;
  if (cur.page === "invoices") {
    if (!cur.arg) $("#content").innerHTML = renderInvoices(null);
    else if (cur.arg.startsWith("q")) {
      const item = state.queue.find(q => q.key === cur.arg) || state.ui.lastItems[cur.arg];
      if (item && $("#detail")) $("#detail").innerHTML = processingPane(item);
    }
  } else if (cur.page === "inbox") $("#content").innerHTML = renderInbox(cur.arg);
  else if (PAGES[cur.page]) $("#content").innerHTML = PAGES[cur.page](cur.arg);
  if (list != null && $(".list")) $(".list").scrollTop = list;
  scrollTo(0, y); paintNav(); bindListSearch();
}
function bindListSearch() {
  const box = $("#mailq");
  if (box) box.oninput = () => {
    state.ui.mail.query = box.value;
    const pos = box.selectionStart;
    rerender();
    const next = $("#mailq"); next.focus(); next.setSelectionRange(pos,pos);
  };
  const q = $("#invq");
  if (q) q.oninput = () => { state.ui.inv.q = q.value; const pos = q.selectionStart; rerender(); const n = $("#invq"); n.focus(); n.setSelectionRange(pos, pos); };
}
addEventListener("hashchange", route);
document.addEventListener("kosh:render", () => route());
document.addEventListener("kosh:role", () => { paintNav(); if (cur.page === "invoices" && cur.arg && !cur.arg.startsWith("q")) loadDetail(cur.arg); else rerender(); });
let liveTimer;
document.addEventListener("kosh:live", () => {
  if (liveTimer) return;
  liveTimer = setTimeout(() => {
    liveTimer = null;
    if (["invoices", "inbox", "demo", "home"].includes(cur.page)) rerender();
    else paintNav();
  }, 40);
});
document.addEventListener("kosh:processed", e => {
  const item = e.detail; state.ui.lastItems[item.key] = item;
  if (cur.page === "invoices" && cur.arg === item.key && item.result) setTimeout(() => { if (parse().arg === item.key) location.replace("#/invoices/" + item.result.id); }, 700);
});

/* Uploads & drag-and-drop ----------------------------------------------------------- */
$("#upload").onchange = e => { enqueue(e.target.files); e.target.value = ""; };
let depth = 0;
const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $("#drop").classList.add("on"); document.body.classList.add("dragging"); });
addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
addEventListener("dragleave", e => { if (hasFiles(e) && --depth <= 0) { depth = 0; $("#drop").classList.remove("on"); document.body.classList.remove("dragging"); } });
addEventListener("drop", e => { if (!hasFiles(e)) return; e.preventDefault(); depth = 0; $("#drop").classList.remove("on"); document.body.classList.remove("dragging"); enqueue(e.dataTransfer.files); });

/* Actions --------------------------------------------------------------------------- */
document.addEventListener("click", async e => {
  if (document.body.classList.contains("navopen") && e.target.closest("#sidebar a")) {
    setNav(false);
    $("#content").focus({preventScroll:true});
  }
  if (!e.target.closest(".menu") && !e.target.closest("[data-act=actmore],[data-act=more],#whobtn")) closeMenus();
  if (e.target.id === "scrim") { closeSheet(); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act;
  if (el.tagName === "A" && act) e.preventDefault();
  try {
    if (cur.page === "invoices") { const r = onInvoiceAct(act, el); if (r === "rerender-list") { location.hash = "#/invoices"; route(); return; } if (r) return; }
    if (act === "act" || act === "replay" || act === "copylink" || act === "closesheet" || act === "pay") { if (onInvoiceAct(act, el)) return; }
    if (cur.page === "inbox") { const r = onInboxAct(act, el); if (r === "rerender") { rerender(); return; } if (r) return; }
    if (act === "demorun") { pages.onPageAct(act, el); return; }
    const r = pages.onPageAct(act, el); if (r === "render") { rerender(); return; } if (r) return;
    switch (act) {
      case "upload": $("#upload").click(); break;
      case "processall": processAll(); toast("Processing the mailbox. Watch the inbox or invoices fill up.", { icon: "mail" }); break;
      case "golab": state.ui.demotab = "lab"; location.hash = "#/demo"; break;
      case "menu": { const open = !document.body.classList.contains("navopen"); setNav(open); if (!open) $("#menu").focus(); break; }
      case "palette": openPalette(); break;
      case "role": closeMenus(); setRole(el.dataset.role); toast(`Switched to ${el.dataset.role}`, { icon: "user" }); break;
      case "switchrole": closeMenus(); setRole(el.dataset.role); toast(`Switched to ${el.dataset.role}`, { icon: "user" }); if ($("#sheet").classList.contains("open") && state.ui.sheetKind) openAction(state.ui.sheetKind); break;
      case "theme": closeMenus(); toggleTheme(); break;
      case "help": closeMenus(); help(); break;
      case "close": closeModal(); break;
      case "reload": location.reload(); break;
      case "retry": { const run = byId[el.dataset.id]; const blob = await (await api(`/api/runs/${el.dataset.id}/source`)).blob(); enqueue([new File([blob], run?.filename || "invoice.pdf", { type: "application/pdf" })]); break; }
      case "reset": closeMenus(); modal("Reset the demo workspace?", `<p class="t2">You'll get an empty mailbox history with the original order balances, vendor records and policy. The current workspace stays in the database.</p><div class="row" style="justify-content:flex-end;margin-top:20px"><button class="btn ghost" data-act="close">Cancel</button><button class="btn primary" data-act="doreset">Reset</button></div>`); break;
      case "doreset": await api("/api/new-workspace", { method: "POST" }); closeModal(); state.queue = []; state.ui = { lastItems: {} }; await refresh(); location.hash = "#/home"; route(); toast("Fresh workspace ready"); break;
    }
  } catch (err) { toast(err.message, { error: true }); }
});
$("#whobtn").addEventListener("click", e => { e.stopPropagation(); $("#rolemenu").classList.contains("open") ? closeMenus() : roleMenu(); });
document.addEventListener("submit", e => {
  const f = e.target; e.preventDefault();
  if (f.id === "actform") submitAction(f);
  else if (f.id === "noteform") saveNote(f);
  else if (f.id === "policyform") pages.savePolicy(f);
  else if (f.id === "labform") pages.labGenerate(f);
});
document.addEventListener("input", e => { const f = e.target.closest("#labform"); if (f && $("#labtotals")) { pages.readLab(f); state.ui.lab.preset = null; $("#labtotals").innerHTML = pages.labTotals(); } });
$("#menu").innerHTML = icon("menu", 18);
$("#mclose").innerHTML = icon("x", 16);
$("#searchicon").outerHTML = icon("search", 15);
$("#palicon").innerHTML = icon("search", 17);
$("#modal").addEventListener("click", e => { if (e.target === $("#modal")) closeModal(); });

/* Keyboard ----------------------------------------------------------------------------- */
let g = 0;
addEventListener("keydown", e => {
  const typing = e.target.closest?.("input,textarea,select,[contenteditable]");
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
  if (e.key === "Escape") { closeMenus(); closeSheet(); if (document.body.classList.contains("navopen")) { setNav(false); $("#menu").focus(); } return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $("#modal").open || $("#palette").open || $("#sheet").classList.contains("open")) return;
  const k = e.key.toLowerCase();
  if (g && Date.now() - g < 900) { g = 0; const map = { h: "home", i: "inbox", v: "invoices", p: "payments", n: "insights", s: "suppliers", o: "policy", d: "demo" }; if (map[k]) { location.hash = "#/" + map[k]; e.preventDefault(); } return; }
  if (k === "g") { g = Date.now(); return; }
  if (k === "/") { e.preventDefault(); openPalette(); }
  else if (e.key === "?") help();
  else if (k === "u") $("#upload").click();
  else if ((k === "j" || k === "k") && (cur.page === "invoices" || cur.page === "inbox")) {
    const ids = state.ui.listIds || []; if (!ids.length) return;
    const i = ids.indexOf(cur.arg), n = i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + (k === "j" ? 1 : -1)));
    location.hash = `#/${cur.page}/${ids[n]}`; e.preventDefault();
  }
});
function help() {
  const rows = [["Search or run a command", "<kbd>Ctrl</kbd> <kbd>K</kbd>"], ["Next / previous in a list", "<kbd>J</kbd> <kbd>K</kbd>"], ["Upload PDFs", "<kbd>U</kbd>"], ["Inbox · Invoices · Payments", "<kbd>G</kbd> then <kbd>I</kbd> <kbd>V</kbd> <kbd>P</kbd>"], ["Insights · Suppliers · Policy · Demo", "<kbd>G</kbd> then <kbd>N</kbd> <kbd>S</kbd> <kbd>O</kbd> <kbd>D</kbd>"], ["Close a panel", "<kbd>Esc</kbd>"]];
  modal("Keyboard shortcuts", `<div class="shortcuts">${rows.map(([a, b]) => `<span>${a}</span><span>${b}</span>`).join("")}</div><p class="t3 sm" style="margin-top:16px">Drop PDFs anywhere to process them.</p>`);
}

/* Command palette -------------------------------------------------------------------- */
let items = [], idx = 0;
function commands() {
  const d = state.data || {};
  const go = (l, h, ic) => ({ g: "Go to", l, ic, run: () => location.hash = h });
  return [
    { g: "Actions", l: "Process all new email", ic: "play", run: () => { location.hash = "#/inbox"; processAll(); } },
    { g: "Actions", l: "Upload PDFs", ic: "upload", s: "U", run: () => $("#upload").click() },
    { g: "Actions", l: "Build a test invoice", ic: "demo", run: () => { state.ui.demotab = "lab"; location.hash = "#/demo"; } },
    ...ROLES.map(r => ({ g: "Actions", l: "Switch role to " + r, ic: "user", s: r === state.role ? "current" : "", run: () => setRole(r) })),
    { g: "Actions", l: "Toggle dark mode", ic: "moon", run: toggleTheme },
    ...NAV.map(([k, l, ic]) => go(l, "#/" + k, ic)), go("Demo kit", "#/demo", "demo"),
    ...heads().map(r => ({ g: "Invoices", l: `${r.number} · ${r.vendor}`, s: money(r.gross), ic: "invoices", key: [r.po, r.title, r.brief?.headline, r.sender].join(" "), run: () => location.hash = "#/invoices/" + r.id })),
    ...(d.mail || []).map(m => ({ g: "Email", l: m.subject, s: m.from_name, ic: "mail", key: m.from, run: () => location.hash = "#/inbox/" + m.id })),
  ];
}
function openPalette() { closeMenus(); const p = $("#palette"); if (!p.open) p.showModal(); $("#palq").value = ""; idx = 0; paint(); $("#palq").focus(); }
function paint() {
  const q = $("#palq").value.trim().toLowerCase();
  items = commands().filter(c => !q || (c.l + " " + (c.s || "") + " " + (c.key || "") + " " + c.g).toLowerCase().includes(q)).slice(0, 40);
  idx = Math.min(idx, Math.max(0, items.length - 1));
  let last = "";
  $("#pallist").innerHTML = items.length ? items.map((c, i) => { const h = c.g !== last ? `<div class="palg">${esc(c.g)}</div>` : ""; last = c.g; return h + `<div class="pali ${i === idx ? "on" : ""}" data-i="${i}" role="option" aria-selected="${i === idx}">${icon(c.ic, 15)}<span>${esc(c.l)}</span><span class="ps">${esc(c.s || "")}</span></div>`; }).join("") : `<div class="empty" style="padding:28px"><p>No matches</p></div>`;
  $(".pali.on")?.scrollIntoView({ block: "nearest" });
}
const runItem = c => { $("#palette").close(); Promise.resolve(c.run()).catch(err => toast(err.message, { error: true })); };
$("#palq").addEventListener("input", () => { idx = 0; paint(); });
$("#palq").addEventListener("keydown", e => {
  if (e.key === "ArrowDown") { idx = Math.min(items.length - 1, idx + 1); paint(); e.preventDefault(); }
  else if (e.key === "ArrowUp") { idx = Math.max(0, idx - 1); paint(); e.preventDefault(); }
  else if (e.key === "Enter" && items[idx]) runItem(items[idx]);
});
$("#pallist").addEventListener("click", e => { const it = e.target.closest(".pali"); if (it) runItem(items[+it.dataset.i]); });
$("#palette").addEventListener("click", e => { if (e.target === $("#palette")) $("#palette").close(); });

/* Boot ---------------------------------------------------------------------------------- */
if (!location.hash) history.replaceState(null, "", "#/home");
async function saveNote(f) {
  const text = new FormData(f).get("text")?.toString().trim(); if (!text) return;
  const id = f.dataset.id, b = f.querySelector("button"); b.disabled = true;
  try { await api(`/api/runs/${id}/note`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: state.role, text }) }); await refresh(); toast("Note added"); if (cur.arg === id) { state.ui.dtab = "activity"; loadDetail(id); } }
  catch (e) { toast(e.message, { error: true }); b.disabled = false; }
}
syncThemeControl();
route();
setInterval(() => { if (document.visibilityState === "visible" && !state.queue.length && !document.activeElement?.closest("form,input,textarea") && !$("#sheet").classList.contains("open")) refresh().then(paintNav).catch(() => { }); }, 30000);
export { mailDetail, $$ };
