// Home: the front door. Upload in the middle, what needs you, and how money is moving.
import { esc, icon, pill, money, moneyShort, ago, plural, state, heads, isOpen, stateOf, payment, metrics, byId, RISK_CHECKS, duration, av } from "./shared.js";
import { logo, donut, spark, columns, emptyState } from "./art.js";
import { runFor } from "./inbox.js";

export function home() {
  const d = state.data, m = metrics();
  const open = heads().filter(isOpen);
  const mine = open.filter(r => r.owner === state.role);
  const list = (mine.length ? mine : open).slice().sort((a, b) => Number(RISK_CHECKS.has(b.title)) - Number(RISK_CHECKS.has(a.title)) || (b.gross || 0) - (a.gross || 0)).slice(0, 5);
  const unread = (d.mail || []).filter(x => !runFor(x));
  const all = heads();
  const seg = [
    { label: "Approved", value: all.filter(r => r.status === "Approved").length, color: "var(--ok)" },
    { label: "Needs review", value: open.filter(r => !RISK_CHECKS.has(r.title)).length, color: "#d99a3a" },
    { label: "Fraud risk", value: open.filter(r => RISK_CHECKS.has(r.title)).length, color: "var(--risk)" },
    { label: "Read errors", value: all.filter(r=>r.status==="Error").length, color:"var(--mute)" },
    { label: "Rejected", value: all.filter(r => r.status === "Rejected").length, color: "var(--text-3)" },
  ];
  return `<div class="page home">
    <section class="hero" id="herozone" aria-label="Upload invoices">
      <div class="hero-in">
        <div class="hero-copy">
          <div class="eyebrow">Nimbus Retail / Accounts payable</div>
          <h1>Invoice overview</h1>
          <p>${unread.length ? plural(unread.length,"supplier message")+" awaiting processing." : "The mailbox is up to date."} ${m.open ? plural(m.open,"invoice")+" on hold." : "No open holds."}</p>
          <a class="btn primary" href="#/inbox">${icon("inbox",16)} Open inbox</a>
        </div>
        <div class="heroart"><img src="/assets/intake.svg" alt=""></div>
      </div>
      <div class="dropzone" id="dropzone" >
        <span class="dz-ic">${icon("upload", 22, 2)}</span>
        <label class="dz-t" for="upload"><b>Drop invoice PDFs here</b><span>Choose a PDF up to 6 MB and 8 pages</span></label>
        <div class="dz-acts">
          <button class="btn primary lg" data-act="upload">${icon("upload", 16)}Upload invoices</button>
          ${unread.length ? `<button class="btn lg" data-act="processall">${icon("mail", 16)}Process ${plural(unread.length, "email")}</button>` : `<button class="btn lg" data-act="golab">${icon("demo", 16)}Build a test invoice</button>`}
        </div>
      </div>
    </section>

    <div class="homegrid">
      <section class="card">
        <div class="cardhead"><h3>${mine.length ? `${av(state.role)} Waiting on you` : "Needs attention"}</h3><a class="link sm" href="#/invoices">All invoices ${icon("arrow", 13)}</a></div>
        ${list.length ? `<div>${list.map(r => `<a class="trow" href="#/invoices/${r.id}">${logo(r.vendor, 36)}<div style="min-width:0"><div class="tr1"><b>${esc(r.number)}</b><span class="t3">${esc(r.vendor)}</span></div><div class="tr2">${esc(r.brief?.headline || r.title)}</div></div><div class="tr3"><b>${money(r.gross)}</b>${pill(stateOf(r))}</div></a>`).join("")}</div>`
      : emptyState("done", "Nothing waiting", all.length ? "Every processed invoice is approved or closed." : "Upload an invoice or process the mailbox to begin.")}
        ${!mine.length && open.length ? `<div class="cardfoot t3 sm">Nothing is assigned to ${esc(state.role)} right now. Showing everything that's open.</div>` : ""}
      </section>
      <section class="card">
        <div class="cardhead"><h3>Outcomes</h3><span class="t3">${plural(all.length, "invoice")}</span></div>
        <div class="cardbody donutwrap">${donut(seg, 132, 16, all.length ? String(all.length) : "0", "invoices")}
          <div class="dlegend">${seg.map(s => `<div><i style="background:${s.color}"></i><span>${s.label}</span><b>${s.value}</b></div>`).join("")}</div></div>
      </section>
    </div>

    <div class="kpirow">
      ${tile("Straight-through", m.stp == null ? "—" : m.stp + "%", "of document reviews", [], "var(--ok)")}
      ${tile("Reviewed", String(m.reviewed), "document reviews", trend(() => 1), "var(--risk)")}
      ${tile("On hold", money(m.onHold), plural(m.open, "open exception"), [], "#d99a3a")}
      ${tile("Median processing", m.cycle == null ? "—" : duration(m.cycle), "from PDF to decision", [], "var(--brand)")}
    </div>

    <div class="homegrid">
      <section class="card"><div class="cardhead"><h3>Cash going out</h3><a class="link sm" href="#/payments">Payments ${icon("arrow", 13)}</a></div><div class="cardbody">${cashOut()}</div></section>
      <section class="card"><div class="cardhead"><h3>${icon("mail", 15)} Mailbox</h3><a class="link sm" href="#/inbox">Open inbox ${icon("arrow", 13)}</a></div>
        ${unread.length ? `<div>${unread.slice(0, 3).map(x => `<a class="trow" href="#/inbox/${x.id}">${logo(x.from_name, 32)}<div style="min-width:0"><div class="tr1"><b>${esc(x.from_name)}</b><span class="t3 xs">${esc(x.received)}</span></div><div class="tr2">${esc(x.subject)}</div></div></a>`).join("")}</div>
          <div class="cardfoot"><button class="btn primary" data-act="processall">${icon("play", 13)}Process all ${unread.length}</button></div>`
      : emptyState("mail", "Mailbox is clear", "Every attachment has been processed.")}
      </section>
    </div>

    <section class="card" style="margin-top:16px"><div class="cardhead"><h3>Recent activity</h3><a class="link sm" href="#/invoices">History ${icon("arrow", 13)}</a></div><div class="cardbody">${activity()}</div></section>
  </div>`;
}
function tile(label, value, hint, series, color) {
  return `<div class="card ktile"><div><small>${label}</small><b>${value}</b><span>${hint}</span></div>${series.length ? spark(series, 92, 34, color) : ""}</div>`;
}
function trend(fn) {
  const runs = (state.data.runs || []).filter(r => r.kind !== "action").slice().reverse();
  if (!runs.length) return [0, 0];
  let acc = 0; return runs.map(r => (acc += fn(r) || 0));
}
function cashOut() {
  const today = new Date((state.data.today || new Date().toISOString().slice(0, 10)) + "T00:00:00");
  const buckets = [["Due by week 1", 0, 7], ["Next week", 7, 14], ["In 2–4 weeks", 14, 31], ["Later", 31, 9999]].map(([label, a, b]) => ({ label, a, b, value: 0, n: 0 }));
  for (const r of heads().filter(r => r.status === "Approved")) {
    const p = payment(r); if (p?.status === "Paid" || !r.due) continue;
    const days = Math.round((new Date(r.due + "T00:00:00") - today) / 864e5);
    const k = buckets.find(x => days < x.b) || buckets.at(-1); k.value += p ? p.amount : r.gross || 0; k.n++;
  }
  const total = buckets.reduce((s, x) => s + x.value, 0);
  if (!total) return emptyState("pay", "Nothing scheduled to leave", "Approved invoices appear here by due date.");
  return `<div class="between" style="margin-bottom:12px"><div><div class="t3 xs">Approved, not yet paid</div><b style="font-size:22px;font-weight:650" class="num">${money(total)}</b></div></div>
    ${columns(buckets.map(x => ({ label: x.label, value: x.value, top: x.value ? moneyShort(x.value) : "", title: `${x.n} invoice(s)` })), 130)}`;
}
function activity() {
  const d = state.data, items = [];
  for (const r of d.runs) {
    if (r.kind === "action") continue;
    const t = r.status === "Approved" ? ["ok", "check", "approved"] : r.status === "Hold" ? [RISK_CHECKS.has(r.title) ? "risk" : "warn", "clock", "needs review"] : ["risk", "alert", r.status.toLowerCase()];
    items.push([r.created, `<div class="act">${logo(r.vendor, 28)}<div><b>${esc(r.number)}</b> <span class="t2">${t[2]}${r.status === "Hold" ? " · " + esc(r.brief?.headline || r.title) : r.status === "Approved" ? " · " + money(r.amount) + " to " + esc(r.po) : ""}</span></div><time>${ago(r.created)}</time></div>`, r.id]);
  }
  for (const a of d.actions || []) {
    const r = byId[a.run_id]; if (!r || (r.kind === "action" && a.action !== "request_info" && a.action !== "note" && !a.action.startsWith("payment_"))) continue;
    const verb = a.action === "note" ? "noted" : a.action.replace("payment_", "payment ").replace(/_/g, " ");
    items.push([a.created, `<div class="act">${av(a.role)}<div><b>${esc(a.role)}</b> <span class="t2">${esc(verb)} on ${esc(r.number)} · “${esc(a.reason.slice(0, 80))}”</span></div><time>${ago(a.created)}</time></div>`, r.id]);
  }
  items.sort((a, b) => b[0].localeCompare(a[0]));
  return items.length ? `<div class="acts">${items.slice(0, 7).map(x => `<a href="#/invoices/${head(x[2])}">${x[1]}</a>`).join("")}</div>` : `<p class="t3 sm">Processing and reviewer decisions will appear here.</p>`;
}
function head(id) { let r = byId[id], g = 0; while (r?.closed_by && byId[r.closed_by] && g++ < 20) r = byId[r.closed_by]; return r?.id || id; }
