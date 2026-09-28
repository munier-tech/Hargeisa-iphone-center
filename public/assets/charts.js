/* Dependency-free SVG charts that follow the active theme */
const CH = {};
const cv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const pal = () => [1, 2, 3, 4, 5, 6].map(i => cv('--c' + i));
function shade(hex, pct) {
  let c = hex.replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const n = parseInt(c, 16), f = v => Math.max(0, Math.min(255, Math.round(pct < 0 ? v * (1 + pct / 100) : v + (255 - v) * pct / 100)));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(f).map(x => x.toString(16).padStart(2, '0')).join('');
}
const kfmt = v => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : String(Math.round(a * 10) / 10); return (v < 0 ? '-' : '') + s; };
const emptyChart = (el, msg = 'No data yet') => { el.innerHTML = `<div class="empty" style="padding:30px 10px">${ic('activity')}<div>${msg}</div></div>`; };
const niceMax = v => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
let _uid = 0; const uid = () => 'c' + (++_uid);
const legend = (items) => `<div class="legend">${items.map(i => `<span><i style="--c:${i.color}"></i>${esc(i.label)}${i.v !== undefined ? ` <b style="color:var(--text)">${i.v}</b>` : ''}</span>`).join('')}</div>`;

/* 3D pie (extruded) */
CH.pie3d = (el, data) => {
  data = data.filter(d => d.v > 0); const total = data.reduce((a, d) => a + d.v, 0); if (!total) return emptyChart(el);
  const P = pal(), cx = 170, cy = 92, rx = 118, ry = 64, depth = 24; let a0 = -Math.PI / 2;
  const sl = data.map((d, i) => { const a1 = a0 + d.v / total * 2 * Math.PI, s = { a0, a1, d, color: d.color || P[i % 6] }; a0 = a1; return s; });
  const path = (s, dy) => {
    if (sl.length === 1) return `M${cx - rx},${cy + dy} a${rx},${ry} 0 1,0 ${2 * rx},0 a${rx},${ry} 0 1,0 ${-2 * rx},0Z`;
    const x0 = cx + rx * Math.cos(s.a0), y0 = cy + dy + ry * Math.sin(s.a0), x1 = cx + rx * Math.cos(s.a1), y1 = cy + dy + ry * Math.sin(s.a1);
    return `M${cx},${cy + dy} L${x0},${y0} A${rx},${ry} 0 ${s.a1 - s.a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}Z`;
  };
  let g = `<ellipse cx="${cx}" cy="${cy + depth + 10}" rx="${rx + 6}" ry="${ry * .45}" fill="#000" opacity=".28" filter="url(#${'bl'})"/>`;
  for (let k = depth; k >= 1; k -= 2) sl.forEach(s => g += `<path d="${path(s, k)}" fill="${shade(s.color, -42)}"/>`);
  sl.forEach(s => { const am = (s.a0 + s.a1) / 2, pc = Math.round(s.d.v / total * 100);
    g += `<path d="${path(s, 0)}" fill="${s.color}" stroke="${cv('--panel')}" stroke-width="1.5"><title>${esc(s.d.label)}: ${s.d.v} (${pc}%)</title></path>`;
    if (pc >= 7) g += `<text x="${cx + rx * .62 * Math.cos(am)}" y="${cy + ry * .62 * Math.sin(am) + 4}" text-anchor="middle" font-size="13" font-weight="700" fill="#fff" style="paint-order:stroke;stroke:rgba(0,0,0,.35);stroke-width:2px">${pc}%</text>`; });
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 340 ${cy + depth + 34}"><defs><filter id="bl"><feGaussianBlur stdDeviation="6"/></filter></defs>${g}</svg>${legend(sl.map(s => ({ label: s.d.label, color: s.color, v: s.d.v })))}</div>`;
};

/* flat donut */
CH.donut = (el, data, o = {}) => {
  data = data.filter(d => d.v > 0); const total = data.reduce((a, d) => a + d.v, 0); if (!total) return emptyChart(el);
  const P = pal(), r = 62, C = 2 * Math.PI * r; let off = 0, g = '';
  data.forEach((d, i) => { const col = d.color || P[i % 6], len = d.v / total * C;
    g += `<circle r="${r}" cx="100" cy="100" fill="none" stroke="${col}" stroke-width="26" stroke-dasharray="${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}" stroke-dashoffset="${-off}" transform="rotate(-90 100 100)" stroke-linecap="butt"><title>${esc(d.label)}: ${o.fmt ? o.fmt(d.v) : d.v}</title></circle>`; off += len; });
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 200 200" style="max-width:240px;margin:auto"><circle r="${r}" cx="100" cy="100" fill="none" stroke="${cv('--panel2')}" stroke-width="26"/>${g}<text x="100" y="97" text-anchor="middle" font-size="20" font-weight="800" fill="${cv('--text')}">${o.fmt ? o.fmt(total) : total}</text><text x="100" y="116" text-anchor="middle" font-size="10" fill="${cv('--muted')}">${esc(o.center || 'Total')}</text></svg>${legend(data.map((d, i) => ({ label: d.label, color: d.color || P[i % 6], v: o.fmt ? o.fmt(d.v) : d.v })))}</div>`;
};

/* 3D-style columns (single or grouped) */
CH.bar3d = (el, { labels, series }, o = {}) => {
  const all = series.flatMap(s => s.values); if (!labels.length || !all.some(v => v)) return emptyChart(el);
  const P = pal(), n = labels.length, ns = series.length, H = 250, pl = 46, pr = 12, pt = 18, pb = 30, gw = 46 * ns + 16, W = Math.max(360, pl + pr + n * gw);
  const mx = niceMax(Math.max(0, ...all)), mn = Math.min(0, ...all), lo = mn < 0 ? -niceMax(-mn) : 0, span = mx - lo;
  const Y = v => pt + (mx - v) / span * (H - pt - pb), y0 = Y(0), bw = Math.min(30, (gw - 16) / ns), dx = 7, dy = 5, id = uid(); let g = '';
  for (let i = 0; i <= 4; i++) { const v = lo + span * i / 4, y = Y(v); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="${cv('--border')}" stroke-dasharray="3 4"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="${cv('--muted')}">${kfmt(v)}</text>`; }
  let defs = '';
  series.forEach((s, si) => { const c = s.color || P[si % 6]; s._c = c; defs += `<linearGradient id="${id}${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 25)}"/><stop offset="1" stop-color="${shade(c, -25)}"/></linearGradient>`; });
  labels.forEach((lb, i) => {
    const gx = pl + i * gw + (gw - ns * bw - (ns - 1) * 4) / 2;
    series.forEach((s, si) => {
      const v = s.values[i] || 0, x = gx + si * (bw + 4), yv = Y(v), top = Math.min(yv, y0), h = Math.max(1.5, Math.abs(yv - y0)), c = s._c;
      g += `<g><title>${esc(lb)} — ${esc(s.name || '')}: ${o.fmt ? o.fmt(v) : v}</title><polygon points="${x + bw},${top} ${x + bw + dx},${top - dy} ${x + bw + dx},${top + h - dy} ${x + bw},${top + h}" fill="${shade(c, -45)}"/><polygon points="${x},${top} ${x + dx},${top - dy} ${x + bw + dx},${top - dy} ${x + bw},${top}" fill="${shade(c, 45)}"/><rect x="${x}" y="${top}" width="${bw}" height="${h}" fill="url(#${id}${si})"/></g>`;
    });
    g += `<text x="${pl + i * gw + gw / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${cv('--muted')}">${esc(lb)}</text>`;
  });
  g += `<line x1="${pl}" x2="${W - pr}" y1="${y0}" y2="${y0}" stroke="${cv('--muted')}" opacity=".5"/>`;
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${g}</svg>${ns > 1 || o.legend ? legend(series.map(s => ({ label: s.name, color: s._c }))) : ''}</div>`;
};

/* smooth area / line (also used for the activity wave) */
CH.line = (el, { labels, series }, o = {}) => {
  const all = series.flatMap(s => s.values); if (!labels.length || (!o.force && !all.some(v => v))) return emptyChart(el);
  const P = pal(), W = 640, H = o.h || 230, pl = 46, pr = 14, pt = 16, pb = 28, n = labels.length, id = uid();
  const mx = niceMax(Math.max(0, ...all)), mn = Math.min(0, ...all), lo = mn < 0 ? -niceMax(-mn) : 0, span = (mx - lo) || 1;
  const X = i => pl + (n === 1 ? (W - pl - pr) / 2 : i * (W - pl - pr) / (n - 1)), Y = v => pt + (mx - v) / span * (H - pt - pb);
  let g = '', defs = '';
  for (let i = 0; i <= 4; i++) { const v = lo + span * i / 4, y = Y(v); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" stroke="${cv('--border')}" stroke-dasharray="3 4"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end" font-size="10.5" fill="${cv('--muted')}">${kfmt(v)}</text>`; }
  if (lo < 0) g += `<line x1="${pl}" x2="${W - pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="${cv('--muted')}" opacity=".6"/>`;
  const step = Math.ceil(n / 8); labels.forEach((l, i) => { if (i === n - 1 || (i % step === 0 && n - 1 - i >= step * .6)) g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="10.5" fill="${cv('--muted')}">${esc(l)}</text>`; });
  series.forEach((s, si) => {
    const c = s.color || P[si % 6], pts = s.values.map((v, i) => [X(i), Y(v)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = .18;
      d += ` C${p1[0] + (p2[0] - p0[0]) * t},${p1[1] + (p2[1] - p0[1]) * t} ${p2[0] - (p3[0] - p1[0]) * t},${p2[1] - (p3[1] - p1[1]) * t} ${p2[0]},${p2[1]}`; }
    defs += `<linearGradient id="${id}${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".45"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient>`;
    if (o.fill !== false && si === 0) g += `<path d="${d} L${pts[n - 1][0]},${Y(Math.max(0, lo))} L${pts[0][0]},${Y(Math.max(0, lo))}Z" fill="url(#${id}${si})"/>`;
    g += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${o.sw || 3}" stroke-linecap="round" style="filter:drop-shadow(0 4px 6px ${c}66)"/>`;
    if (o.dots !== false && n <= 40) pts.forEach((p, i) => g += `<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="${cv('--panel')}" stroke="${c}" stroke-width="2"><title>${esc(labels[i])}: ${o.fmt ? o.fmt(s.values[i]) : s.values[i]}</title></circle>`);
  });
  if (o.banner) g += `<text x="${W / 2}" y="${H / 2 - 6}" text-anchor="middle" font-size="16" font-weight="800" fill="${series[0].color}">${esc(o.banner)}</text>`;
  el.innerHTML = `<div class="chart"><svg viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${g}</svg>${series.length > 1 ? legend(series.map((s, i) => ({ label: s.name, color: s.color || P[i % 6] }))) : ''}</div>`;
};

/* horizontal bars */
CH.hbar = (el, data, o = {}) => {
  data = data.filter(d => d.v > 0); if (!data.length) return emptyChart(el, o.empty || 'No activity yet');
  const P = pal(), mx = Math.max(...data.map(d => d.v));
  el.innerHTML = data.map((d, i) => `<div class="hb" style="--c:${d.color || P[i % 6]}"><span title="${esc(d.label)}">${esc(d.label)}</span><div class="t"><i style="width:${Math.max(4, d.v / mx * 100)}%"></i></div><b>${d.v}</b></div>`).join('');
};
