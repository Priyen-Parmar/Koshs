// Illustrations, vendor marks and small charts. Pure SVG, coloured by CSS variables so themes just work.
import { esc, initials } from "./shared.js";

/* Hero: an invoice under review — a highlighted line, a magnifier and the findings floating beside it. */
export function heroArt() {
  return `<svg class="art hero-art" viewBox="0 0 440 300" role="img" aria-label="An invoice being checked line by line">
  <ellipse cx="220" cy="272" rx="170" ry="14" fill="var(--sunken)"/>
  <g class="float-slow">
    <rect x="118" y="44" width="196" height="232" rx="10" fill="var(--panel)" stroke="var(--line-2)" transform="rotate(-7 216 160)"/>
  </g>
  <g>
    <rect x="128" y="30" width="196" height="238" rx="10" fill="var(--panel)" stroke="var(--line-2)"/>
    <rect x="128" y="30" width="196" height="44" rx="10" fill="var(--brand)"/>
    <rect x="128" y="62" width="196" height="12" fill="var(--brand)"/>
    <rect x="144" y="44" width="64" height="8" rx="4" fill="#fff" opacity=".95"/>
    <rect x="144" y="57" width="40" height="6" rx="3" fill="#fff" opacity=".55"/>
    <rect x="262" y="44" width="46" height="18" rx="5" fill="#fff" opacity=".18"/>
    <g fill="var(--line-2)">
      <rect x="144" y="90" width="70" height="7" rx="3.5"/><rect x="260" y="90" width="48" height="7" rx="3.5"/>
      <rect x="144" y="106" width="52" height="7" rx="3.5"/><rect x="270" y="106" width="38" height="7" rx="3.5"/>
    </g>
    <rect x="138" y="124" width="176" height="24" rx="6" fill="#f6c54a" opacity=".35"/>
    <rect x="138" y="124" width="176" height="24" rx="6" fill="none" stroke="var(--brand)" stroke-width="1.6"/>
    <g fill="var(--text-2)"><rect x="146" y="133" width="78" height="7" rx="3.5"/><rect x="262" y="133" width="44" height="7" rx="3.5"/></g>
    <g fill="var(--line-2)">
      <rect x="144" y="162" width="88" height="7" rx="3.5"/><rect x="266" y="162" width="42" height="7" rx="3.5"/>
      <rect x="144" y="178" width="60" height="7" rx="3.5"/><rect x="274" y="178" width="34" height="7" rx="3.5"/>
    </g>
    <line x1="144" y1="200" x2="308" y2="200" stroke="var(--line-2)"/>
    <rect x="232" y="212" width="76" height="12" rx="6" fill="var(--text)" opacity=".85"/>
    <rect x="144" y="214" width="40" height="8" rx="4" fill="var(--line-2)"/>
    <rect x="144" y="240" width="90" height="6" rx="3" fill="var(--sunken)"/>
  </g>
  <g class="float">
    <circle cx="300" cy="142" r="30" fill="var(--panel)" fill-opacity=".35" stroke="var(--text)" stroke-width="5"/>
    <line x1="321" y1="164" x2="346" y2="190" stroke="var(--text)" stroke-width="9" stroke-linecap="round"/>
  </g>
  <g class="chip-a"><rect x="12" y="78" width="132" height="34" rx="10" fill="var(--panel)" stroke="var(--line)"/><circle cx="30" cy="95" r="6" fill="var(--risk)"/><text x="44" y="100" font-size="12.5" font-weight="600" fill="var(--text)" font-family="Geist, Inter, sans-serif">Bank changed</text></g>
  <g class="chip-b"><rect x="300" y="222" width="132" height="34" rx="10" fill="var(--panel)" stroke="var(--line)"/><circle cx="318" cy="239" r="6" fill="var(--ok)"/><text x="332" y="244" font-size="12.5" font-weight="600" fill="var(--text)" font-family="Geist, Inter, sans-serif">PO balance ok</text></g>
  <g class="chip-c"><rect x="20" y="186" width="120" height="34" rx="10" fill="var(--panel)" stroke="var(--line)"/><circle cx="38" cy="203" r="6" fill="#d99a3a"/><text x="52" y="208" font-size="12.5" font-weight="600" fill="var(--text)" font-family="Geist, Inter, sans-serif">₹50,000 over</text></g>
  <g class="pop"><circle cx="322" cy="34" r="18" fill="var(--ok)"/><path d="M313 34l6 6 11-12" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>`;
}

/* Five steps of the pipeline, as small duotone scenes. */
const STEP = {
  read: `<rect x="14" y="8" width="34" height="44" rx="5" fill="var(--panel)" stroke="var(--brand)" stroke-width="2"/><g fill="var(--brand-line)"><rect x="20" y="17" width="20" height="4" rx="2"/><rect x="20" y="26" width="16" height="4" rx="2"/><rect x="20" y="35" width="22" height="4" rx="2"/></g><rect class="scan" x="10" y="22" width="42" height="3" rx="1.5" fill="var(--brand)"/>`,
  prove: `<rect x="10" y="8" width="34" height="44" rx="5" fill="var(--panel)" stroke="var(--brand)" stroke-width="2"/><rect x="15" y="24" width="24" height="8" rx="2" fill="#f6c54a" opacity=".5" stroke="var(--brand)" stroke-width="1.5"/><circle cx="44" cy="40" r="9" fill="var(--panel)" stroke="var(--brand)" stroke-width="2.5"/><line x1="50.5" y1="46.5" x2="56" y2="52" stroke="var(--brand)" stroke-width="3" stroke-linecap="round"/>`,
  check: `<path d="M30 6l18 7v13c0 11-8 19-18 23-10-4-18-12-18-23V13z" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="2.2" stroke-linejoin="round"/><path d="M22 28l6 6 11-12" fill="none" stroke="var(--brand)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  decide: `<circle cx="30" cy="30" r="20" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="2.2" stroke-dasharray="4 3"/><rect x="18" y="22" width="24" height="16" rx="3" fill="var(--panel)" stroke="var(--brand)" stroke-width="2.2" transform="rotate(-10 30 30)"/><path d="M22 31h10" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" transform="rotate(-10 30 30)"/>`,
  pay: `<rect x="8" y="16" width="44" height="28" rx="5" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="2.2"/><rect x="8" y="23" width="44" height="6" fill="var(--brand)"/><rect x="14" y="35" width="14" height="4" rx="2" fill="var(--brand)"/><circle cx="46" cy="44" r="9" fill="var(--ok)"/><path d="M42 44l3 3 5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`,
};
export function stepArt(k) { return `<svg class="art step-art" viewBox="0 0 60 60" aria-hidden="true">${STEP[k] || ""}</svg>`; }

/* Empty states. */
const EMPTY = {
  done: `<ellipse cx="80" cy="96" rx="56" ry="7" fill="var(--sunken)"/><path d="M34 52h92l-10 38H44z" fill="var(--panel)" stroke="var(--line-2)" stroke-width="2"/><path d="M34 52l14-26h64l14 26" fill="none" stroke="var(--line-2)" stroke-width="2"/><path d="M34 52h28l6 12h24l6-12h28" fill="none" stroke="var(--line-2)" stroke-width="2"/><circle cx="114" cy="28" r="16" fill="var(--ok)"/><path d="M106 28l6 6 10-11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  mail: `<ellipse cx="80" cy="96" rx="56" ry="7" fill="var(--sunken)"/><rect x="36" y="36" width="88" height="56" rx="8" fill="var(--panel)" stroke="var(--line-2)" stroke-width="2"/><path d="M38 40l42 28 42-28" fill="none" stroke="var(--brand)" stroke-width="2.4" stroke-linejoin="round"/><rect x="58" y="12" width="44" height="30" rx="4" fill="var(--panel)" stroke="var(--brand)" stroke-width="2" class="float"/><rect x="65" y="20" width="22" height="4" rx="2" fill="var(--brand-line)" class="float"/>`,
  pay: `<ellipse cx="80" cy="96" rx="56" ry="7" fill="var(--sunken)"/><rect x="34" y="34" width="92" height="56" rx="10" fill="var(--panel)" stroke="var(--line-2)" stroke-width="2"/><rect x="34" y="46" width="92" height="10" fill="var(--brand-soft)"/><rect x="44" y="70" width="30" height="6" rx="3" fill="var(--line-2)"/><circle cx="112" cy="30" r="14" fill="var(--brand)"/><text x="112" y="35" text-anchor="middle" font-size="15" font-weight="700" fill="#fff" font-family="Geist, sans-serif">₹</text>`,
  docs: `<ellipse cx="80" cy="96" rx="56" ry="7" fill="var(--sunken)"/><rect x="50" y="18" width="56" height="72" rx="6" fill="var(--panel)" stroke="var(--line-2)" stroke-width="2" transform="rotate(-8 78 54)"/><rect x="56" y="14" width="56" height="72" rx="6" fill="var(--panel)" stroke="var(--line-2)" stroke-width="2"/><rect x="56" y="14" width="56" height="14" rx="6" fill="var(--brand)"/><g fill="var(--line-2)"><rect x="64" y="38" width="30" height="5" rx="2.5"/><rect x="64" y="50" width="38" height="5" rx="2.5"/><rect x="64" y="62" width="24" height="5" rx="2.5"/></g>`,
  upload: `<ellipse cx="80" cy="96" rx="56" ry="7" fill="var(--sunken)"/><rect x="40" y="30" width="80" height="60" rx="12" fill="var(--brand-soft)" stroke="var(--brand)" stroke-width="2" stroke-dasharray="6 5"/><path d="M80 74V44M68 56l12-12 12 12" fill="none" stroke="var(--brand)" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" class="float"/>`,
};
export function emptyArt(k) { return `<svg class="art empty-art" viewBox="0 0 160 110" aria-hidden="true">${EMPTY[k] || EMPTY.docs}</svg>`; }
export function emptyState(art, title, text, action = "") {
  return `<div class="empty">${emptyArt(art)}<h3>${esc(title)}</h3><p>${text}</p>${action ? `<div class="row" style="justify-content:center;margin-top:8px">${action}</div>` : ""}</div>`;
}

/* Vendor marks: a consistent colour per supplier so lists are scannable at a glance. */
const HUES = { "Apex Office Supply": ["#2f5db0", "#e9effb"], "Delta Furniture": ["#0f766e", "#e3f4f1"], "Kaveri Logistics": ["#7c3aed", "#f1ebfd"] };
export function logo(name, size = 32) {
  const [fg, bg] = HUES[name] || ["#6e6862", "#f1eeea"];
  return `<span class="logo" style="width:${size}px;height:${size}px;font-size:${Math.round(size * .36)}px;--mark-fg:${fg};--mark-bg:${bg}">${esc(initials(name))}</span>`;
}

/* Charts --------------------------------------------------------------------------- */
export function donut(segments, size = 120, stroke = 14, center = "", sub = "") {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, total = segments.reduce((s, x) => s + x.value, 0) || 1;
  let off = 0;
  const arcs = segments.filter(s => s.value > 0).map(s => {
    const len = c * s.value / total, gap = segments.filter(x => x.value > 0).length > 1 ? 3 : 0;
    const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}" stroke-linecap="butt"><title>${esc(s.label)}: ${s.value}</title></circle>`;
    off += len; return el;
  }).join("");
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(segments.map(s => s.label + " " + s.value).join(", "))}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--sunken)" stroke-width="${stroke}"/>
    <g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g>
    <text x="50%" y="${sub ? "47%" : "53%"}" text-anchor="middle" dominant-baseline="middle" font-size="${size * .2}" font-weight="650" fill="var(--text)" font-family="Geist, Inter, sans-serif">${esc(center)}</text>
    ${sub ? `<text x="50%" y="64%" text-anchor="middle" font-size="${size * .095}" fill="var(--text-3)" font-family="Geist, Inter, sans-serif">${esc(sub)}</text>` : ""}</svg>`;
}
export function spark(values, w = 96, h = 28, color = "var(--brand)") {
  if (values.length < 2) values = [0, ...values, ...(values.length ? [] : [0])];
  const max = Math.max(1, ...values), step = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (h - 6) * v / max).toFixed(1)}`);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${pts.at(-1).split(",")[0]}" cy="${pts.at(-1).split(",")[1]}" r="3" fill="${color}"/></svg>`;
}
export function columns(items, h = 140) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="vbars" style="height:${h}px">${items.map(i => `<div class="vb" title="${esc(i.title || "")}"><span class="vv">${esc(i.top || "")}</span><span class="vtrack"><span class="vbar ${i.value ? i.cls || "" : "zero"}" style="height:${i.value ? Math.max(4, 100 * i.value / max) : 2}%"></span></span><span class="vl">${esc(i.label)}</span></div>`).join("")}</div>`;
}
