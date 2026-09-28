/* HARGEISA IPHONE CENTER — core utilities */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { user: null, br: {}, unread: 0, staff: [], timers: [], skew: 0 };
const nowTs = () => Math.floor(Date.now() / 1000) + S.skew;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- icons ---------- */
const IC = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  store: '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
  dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  sheet: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 12.5l4 5M12 12.5l-4 5"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  sliders: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
  reply: '<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  'chev-down':'<polyline points="6 9 12 15 18 9"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m5 0V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  'check-circle': '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  down: '<polyline points="6 9 12 15 18 9"/>',
  menu: '<line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mobile: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  palette: '<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  ext: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  crown: '<path d="M2 18h20l-2-11-5 4-3-6-3 6-5-4z"/><line x1="4" y1="21" x2="20" y2="21"/>',
  up: '<polyline points="18 15 12 9 6 15"/>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[n] || ''}</svg>`;

/* ---------- formatting ---------- */
const cur = () => S.br.currency || '$';
const money = v => (Number(v) < 0 ? '-' : '') + cur() + Math.abs(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => Number(v || 0).toLocaleString('en-US');
const fdate = d => { if (!d) return '—'; const x = typeof d === 'number' ? new Date(d * 1000) : new Date(d + 'T00:00:00'); return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); };
const fdt = ts => ts ? new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function dur(sec) { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60); if (h) return `${h} hr ${m} min`; if (m) return `${m} min`; return 'less than a minute'; }
function ago(ts) {
  if (!ts) return 'never'; const s = Math.max(0, nowTs() - ts);
  if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago'; const d = Math.floor(s / 86400); return d + (d === 1 ? ' day ago' : ' days ago');
}
function presence(u, short = false) {
  if (u.online) return `<span class="dot on"></span><b style="color:#22c55e">Online</b> — Active for ${dur(u.active_for)}`;
  return `<span class="dot"></span><b style="color:#ef4444">Offline</b> — <span class="grey">${u.last_seen ? 'Last active ' + ago(u.last_seen) : 'Never signed in'}</span>`;
}
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
function avatar(u, cls = '', dot = null) {
  const on = dot === null ? u.online : dot;
  return `<div class="avatar ${cls}">${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : esc(initials(u.name))}${dot === false ? '' : `<span class="dot ${on ? 'on' : ''}"></span>`}</div>`;
}

/* ---------- status catalogue (one unique colour per status, system-wide) ---------- */
const ST = {
  received: ['Received', '#3b82f6'], diagnosis: ['Diagnosis', '#8b5cf6'], progress: ['Progress', '#f59e0b'], waiting_part: ['Waiting for Part', '#f97316'],
  parts_installed: ['Parts Installed', '#06b6d4'], testing: ['Testing', '#d946ef'], working: ['Working', '#84cc16'], not_working: ['Not Working', '#ef4444'],
  finishing: ['Finishing', '#14b8a6'], completed: ['Completed', '#059669'], ready: ['Ready', '#6366f1'], took_completed: ['Customer Took Phone — Completed', '#22c55e'],
  took_incomplete: ['Customer Took Phone — Not Completed', '#ec4899'], in_store: ['In Store', '#78716c'], failed: ['Failed', '#be123c'],
  request: ['Request', '#94a3b8'], finished: ['Finished', '#10b981'], took: ['Customer Took Phone', '#22c55e'], instore: ['In Store', '#78716c'],
  sent: ['Sent Outside Hargeisa', '#a855f7'], in_repair: ['In Repair', '#f59e0b'], returning: ['Returning', '#0891b2'], returned: ['Returned to Hargeisa', '#65a30d'], collected: ['Customer Collected', '#22c55e'],
  active: ['Active', '#22c55e'], inactive: ['Inactive', '#f97316'], pending: ['Pending', '#f59e0b'], rejected: ['Rejected', '#ef4444'], suspended: ['Suspended', '#f97316'],
  in_progress: ['In Progress', '#f59e0b'], waiting: ['Waiting', '#eab308'], requested: ['Requested', '#94a3b8'], creating: ['Creating', '#0ea5e9'], created: ['Created', '#10b981'], verified: ['Verified', '#06b6d4'], customer_received: ['Customer Received', '#22c55e'],
  store_completed: ['In Store — Completed', '#78716c'], store_incomplete: ['In Store — Not Completed', '#a8a29e'],
  unpaid: ['Unpaid', '#ef4444'], partial: ['Partly Paid', '#f59e0b'], paid: ['Paid', '#22c55e'], overdue: ['Overdue', '#dc2626'], void: ['Void', '#64748b'],
  accepted: ['Accepted', '#10b981'], declined: ['Declined', '#e11d48'], converted: ['Converted to Invoice', '#8b5cf6'], expired: ['Expired', '#94a3b8'],
};
const REPAIR_LIST = ['received', 'diagnosis', 'progress', 'waiting_part', 'parts_installed', 'testing', 'working', 'not_working', 'finishing', 'completed', 'ready', 'took_completed', 'took_incomplete', 'in_store', 'failed'];
const APPLE_LIST = ['request', 'received', 'progress', 'finished', 'failed', 'took', 'instore'];
const REGIONAL_LIST = ['received', 'sent', 'in_repair', 'returning', 'returned', 'ready', 'collected', 'failed'];
const chip = k => { const s = ST[k] || [k, '#94a3b8']; return `<span class="chip" style="--c:${s[1]}">${esc(s[0])}</span>`; };
const stLabel = k => (ST[k] || [k])[0];
/* groups: [[label, colour, [status keys]]] add multi-status quick filters (e.g. "Processing") */
const statusChips = (list, cur = '', groups = []) => `<div class="chips" data-chips><span class="chip ${cur === '' ? 'on' : ''}" style="--c:#64748b" data-v="">All</span>${groups.map(g => `<span class="chip" style="--c:${g[1]}" data-v="${g[2].join(',')}">${esc(g[0])}</span>`).join('')}${list.map(k => `<span class="chip ${cur === k ? 'on' : ''}" style="--c:${ST[k][1]}" data-v="${k}">${esc(ST[k][0])}</span>`).join('')}</div>`;

/* ---------- API ---------- */
let _busy = 0; const busy = d => { _busy = Math.max(0, _busy + d); document.documentElement.classList.toggle('busy', _busy > 0); };
async function api(a, body) {
  let res, j; busy(1);
  try { res = await fetch((window.API_BASE || 'api.php') + '?a=' + a, { method: 'POST', headers: { 'X-Requested-With': 'HIC', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); j = await res.json(); }
  catch (e) { busy(-1); throw new Error('Cannot reach the server. Check the connection and try again.'); }
  busy(-1);
  if (j.now) S.skew = j.now - Math.floor(Date.now() / 1000);
  if (!j.ok) {
    if (j.restricted && typeof goRestricted === 'function') goRestricted(j.error);
    if (j.auth && S.user && typeof showLogin === 'function') { S.user = null; showLogin(); toast(j.error || 'Please sign in again.', 'err'); }
    const e = new Error(j.error || 'Something went wrong'); e.handled = !!j.restricted; e.unknown = !!j.unknown; throw e;
  }
  return j.data;
}
async function safe(fn) { try { return await fn(); } catch (e) { if (!e.handled) toast(e.message, 'err'); return undefined; } }
const isOwner = () => !!(S.user && S.user.is_owner);
const modOff = m => !isOwner() && !!(S.nav && (S.nav.off || []).includes(m));      // module turned off by the System Owner
const can = (m, a) => !!S.user && !modOff(m) && (S.user.is_admin || (S.user.perms[m] || []).some(x => x === a || x === 'full'));
const isAdmin = () => !!(S.user && S.user.is_admin);

/* ---------- toast / modal ---------- */
function toast(msg, type = '') {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3500);
}
function modal({ title, body, footer = '', size = '', onOpen, onClose, closable = true }) {
  const ov = document.createElement('div'); ov.className = 'ov';
  ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true"><div class="modal-h"><h3>${title}</h3>${closable ? `<button class="btn ico ghost" data-close aria-label="Close">${ic('x')}</button>` : ''}</div><div class="modal-b">${body}</div>${footer ? `<div class="modal-f">${footer}</div>` : ''}</div>`;
  document.body.appendChild(ov);
  const m = { el: ov, box: $('.modal', ov), close() { ov.remove(); document.removeEventListener('keydown', esc_); onClose?.(); } };
  const esc_ = e => { if (e.key === 'Escape' && closable && ov === [...$$('.ov')].pop()) m.close(); };
  document.addEventListener('keydown', esc_);
  ov.addEventListener('mousedown', e => { if (e.target === ov && closable) m.close(); });
  $$('[data-close]', ov).forEach(b => b.onclick = m.close);
  if (onOpen) onOpen(m);
  const f = $('input:not([type=hidden]):not([type=checkbox]),select,textarea', ov); if (f && window.innerWidth > 700) f.focus();
  return m;
}
function confirmBox({ title, message, warning = '', confirmText = 'Confirm', color = 'danger', icon = 'alert', hex }) {
  return new Promise(res => {
    const c = hex || { danger: '#ef4444', warn: '#f97316', ok: '#22c55e', primary: 'var(--primary)' }[color];
    const m = modal({
      title: '', size: 'sm', closable: false,
      body: `<div class="confirm" style="--c:${c}"><div class="big">${ic(icon)}</div><h3>${title}</h3><p class="muted">${message}</p>${warning ? `<div class="notice" style="text-align:left;margin-top:10px">${ic('alert')}<span>${warning}</span></div>` : ''}</div>`,
      footer: `<button class="btn" data-no>Cancel</button><button class="btn ${color}" data-yes>${confirmText}</button>`,
    });
    $('.modal-h', m.el).remove();
    $('[data-no]', m.el).onclick = () => { m.close(); res(false); };
    $('[data-yes]', m.el).onclick = () => { m.close(); res(true); };
  });
}

/* ---------- form builders ---------- */
const fi = (name, label, val = '', o = {}) => `<label class="fld ${o.cls || ''}"><span>${label}${o.req ? ' *' : ''}</span><input name="${name}" type="${o.type || 'text'}" value="${esc(val)}" placeholder="${esc(o.ph || '')}" ${o.req ? 'required' : ''} ${o.attrs || ''}></label>`;
const fp = (name, label, val = '', o = {}) => `<label class="fld ${o.cls || ''}"><span>${label}${o.req ? ' *' : ''}</span><div class="pw"><input name="${name}" type="password" autocomplete="new-password" value="${esc(val)}" placeholder="${esc(o.ph || '')}" ${o.req ? 'required' : ''}><button type="button" data-eye title="Show / hide">${ic('eye')}</button></div></label>`;
const fs = (name, label, opts, val = '', o = {}) => `<label class="fld ${o.cls || ''}"><span>${label}${o.req ? ' *' : ''}</span><select name="${name}" ${o.req ? 'required' : ''} ${o.attrs || ''}>${o.blank === false ? '' : `<option value="">${esc(o.blank || '— Select —')}</option>`}${opts.map(x => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`;
const ft = (name, label, val = '', o = {}) => `<label class="fld ${o.cls || ''}"><span>${label}</span><textarea name="${name}" placeholder="${esc(o.ph || '')}" ${o.attrs || ''}>${esc(val)}</textarea></label>`;
function formData(root) {
  const o = {};
  $$('[name]', root).forEach(el => { if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type !== 'radio' || el.checked) o[el.name] = el.value; });
  return o;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-eye]'); if (!b) return;
  const inp = b.parentElement.querySelector('input'); inp.type = inp.type === 'password' ? 'text' : 'password'; b.innerHTML = ic(inp.type === 'password' ? 'eye' : 'eye-off');
});
const staffOpts = () => S.staff.map(s => [s.id, `${s.name} (${s.position})`]);

/* ---------- table with live search ---------- */
function tbl(cols, rows, { empty = 'Nothing here yet.', attrs = () => '' } = {}) {
  if (!rows.length) return `<div class="tablewrap"><div class="empty">${ic('info')}<div>${empty}</div></div></div>`;
  const head = cols.map(c => `<th class="${c.cls || ''}" ${c.h && !c.act ? 'data-sort' : ''}>${c.h}</th>`).join('');
  const body = rows.map(r => {
    const cells = cols.map(c => { const v = c.f(r); return { v, cls: c.cls || '', h: c.h, act: c.act }; });
    const text = cells.filter(c => !c.act).map(c => String(c.v).replace(/<[^>]*>/g, ' ')).join(' ').replace(/&[a-z#0-9]+;/g, ' ').toLowerCase();
    return `<tr data-s="${esc(text)}" ${attrs(r)}>${cells.map(c => `<td class="${c.cls} ${c.act ? 'actcell' : ''}" data-l="${esc(String(c.h).replace(/<[^>]*>/g, ''))}">${c.v}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="tablewrap"><table class="tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table><div class="empty hidden" data-none>No matching results.</div></div>`;
}
const searchBox = (ph = 'Search…') => `<div class="search">${ic('search')}<input type="search" data-live placeholder="${esc(ph)}" aria-label="Search"></div>`;
/** Live filtering (search box + status chips) with column sorting and pagination for every table under root. */
const PAGE_SIZE_KEY = 'hic_page_size';
function sortKey(td) {
  const t = (td?.dataset.sv ?? td?.innerText ?? '').trim();
  const num = t.replace(/[$,\s]/g, '').match(/^-?\d+(\.\d+)?/);
  if (num && /^[-$\d.,\s]+/.test(t) && !/[a-z]{3,}/i.test(t.split('\n')[0])) return parseFloat(num[0]);
  const d = t.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/);
  if (d) { const v = Date.parse(`${d[1]} ${d[2]} ${d[3]}`); if (!isNaN(v)) return v; }
  return t.toLowerCase();
}
/* Top summary strip for repair pages: each card shows a live count and filters the table when clicked.
   cards: [[label, statuses[], icon, colour]] */
const repairStrip = (list, cards) => `<div class="grid g-auto strip" style="margin-bottom:14px">${cards.map(c => { const n = c[1] ? list.filter(r => c[1].includes(r.status)).length : list.length; return `<div class="card stat click" data-strip="${c[1] ? c[1].join(',') : ''}" style="--c:${c[3]}" role="button" tabindex="0"><div class="si">${ic(c[2])}</div><div><b>${n}</b><span>${c[0]}</span></div></div>`; }).join('')}</div>`;
function wireStrip(root) {
  $$('[data-strip]', root).forEach(el => { const go = () => { const ch = $$('[data-chips] .chip', root).find(x => x.dataset.v === el.dataset.strip); if (ch) ch.click(); $$('[data-strip]', root).forEach(x => x.classList.toggle('sel', x === el)); }; el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter') go(); }; });
}
function wireLive(root) {
  const inp = $('[data-live]', root), chips = $('[data-chips]', root);
  const tables = $$('table.tbl', root).filter(t => t.tBodies[0] && $$('tr[data-s]', t.tBodies[0]).length);
  if (!tables.length) return;
  let size = 25; try { size = +localStorage.getItem(PAGE_SIZE_KEY) || 25; } catch (e) { }
  const st = new Map(tables.map(t => [t, { col: -1, dir: 1, page: 1 }]));
  const run = (reset = true) => {
    const q = (inp?.value || '').trim().toLowerCase().split(/\s+/).filter(Boolean), chip = chips ? ($('.chip.on', chips)?.dataset.v || '') : '';
    let firstCount = null;
    tables.forEach((t, ti) => {
      const s = st.get(t), body = t.tBodies[0], all = [...body.rows].filter(r => r.dataset.s !== undefined);
      if (reset) s.page = 1;
      let matched = all.filter(tr => q.every(w => tr.dataset.s.includes(w)) && (!chip || chip.split(',').some(c => (tr.dataset.st || '').split(',').includes(c))));
      if (s.col >= 0) { matched = matched.map(r => [sortKey(r.cells[s.col]), r]).sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0) * s.dir).map(x => x[1]); matched.forEach(r => body.appendChild(r)); }
      const pages = Math.max(1, Math.ceil(matched.length / size)); if (s.page > pages) s.page = pages;
      const from = (s.page - 1) * size, slice = new Set(matched.slice(from, from + size));
      all.forEach(tr => { const ok = matched.includes(tr); tr.classList.toggle('hidden', !ok); tr.classList.toggle('pg-hidden', ok && !slice.has(tr)); });
      const none = $('[data-none]', t.parentElement); if (none) none.classList.toggle('hidden', matched.length > 0 || !all.length);
      if (ti === 0) firstCount = matched.length;
      // pager
      let pg = t.parentElement.nextElementSibling; if (!pg || !pg.classList.contains('pager')) { pg = document.createElement('div'); pg.className = 'pager'; t.parentElement.after(pg); }
      if (matched.length <= 10) { pg.innerHTML = ''; return; }
      pg.innerHTML = `<span>Showing ${from + 1}–${Math.min(from + size, matched.length)} of ${matched.length}</span><span class="row"><label class="row" style="gap:6px">Rows <select data-ps>${[10, 25, 50, 100].map(n => `<option ${n === size ? 'selected' : ''}>${n}</option>`).join('')}</select></label><button class="btn sm" data-pp ${s.page <= 1 ? 'disabled' : ''}>‹ Prev</button><b>${s.page} / ${pages}</b><button class="btn sm" data-pn ${s.page >= pages ? 'disabled' : ''}>Next ›</button></span>`;
      $('[data-pp]', pg).onclick = () => { s.page--; run(false); };
      $('[data-pn]', pg).onclick = () => { s.page++; run(false); };
      $('[data-ps]', pg).onchange = e => { size = +e.target.value; try { localStorage.setItem(PAGE_SIZE_KEY, size); } catch (x) { } run(); };
    });
    const cnt = $('[data-count]', root); if (cnt && firstCount !== null) cnt.textContent = firstCount + ' shown';
  };
  tables.forEach(t => $$('th[data-sort]', t).forEach((th, _) => th.onclick = () => {
    const s = st.get(t), idx = [...th.parentElement.children].indexOf(th);
    s.dir = s.col === idx ? -s.dir : 1; s.col = idx;
    $$('th', t).forEach(x => x.classList.remove('asc', 'desc')); th.classList.add(s.dir > 0 ? 'asc' : 'desc'); run(false);
  }));
  inp?.addEventListener('input', () => run());
  chips?.addEventListener('click', e => { const c = e.target.closest('.chip'); if (!c) return; $$('.chip', chips).forEach(x => x.classList.toggle('on', x === c)); run(); });
  run();
}
const sec = (title, icn = '') => `<h4 class="sec">${icn ? ic(icn) : ''}${title}</h4>`;
const pageHead = (title, sub = '', actions = '') => `<div class="page-h"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div class="row">${actions}</div></div>`;
const tabsBar = (tabs, cur) => `<div class="tabs">${tabs.map(t => `<a data-tab="${t[0]}" class="${t[0] === cur ? 'on' : ''}">${t[2] ? ic(t[2]) : ''}${t[1]}</a>`).join('')}</div>`;

/* ---------- customer picker (reuses existing customers instead of duplicating) ---------- */
function custPicker(c = {}) {
  return `<div class="full custpick" style="grid-column:1/-1"><input type="hidden" name="customer_id" value="${esc(c.id || '')}">
    <label class="fld"><span>Search existing customer (name or phone)</span><div class="search" style="max-width:none">${ic('search')}<input type="search" data-cq placeholder="Type to find a returning customer…" autocomplete="off"></div></label>
    <div data-cres class="card hidden" style="padding:6px;margin-top:6px"></div>
    <div class="notice ok hidden" data-cnote style="margin-top:8px">${ic('check-circle')}<span></span></div>
    <div class="form" style="margin-top:10px">${fi('customer_name', 'Customer name', c.name, { req: 1 })}${fi('customer_phone', 'Phone number', c.phone, { req: 1, type: 'tel' })}${fs('gender', 'Gender', ['Male', 'Female', 'Other'], c.gender || '', { blank: '— Optional —' })}</div></div>`;
}
function wireCust(root) {
  const box = $('.custpick', root); if (!box) return;
  const q = $('[data-cq]', box), res = $('[data-cres]', box), note = $('[data-cnote]', box), id = $('[name=customer_id]', box), nm = $('[name=customer_name]', box), ph = $('[name=customer_phone]', box);
  const pick = c => { id.value = c.id; nm.value = c.name; ph.value = c.phone; res.classList.add('hidden'); note.classList.remove('hidden'); note.querySelector('span').textContent = `Existing customer: ${c.name}. No new record will be created — this visit is added to their history.`; };
  const unlink = () => { if (id.value) { id.value = ''; note.classList.add('hidden'); } };
  let t; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => {
    if (q.value.trim().length < 2) return res.classList.add('hidden');
    const r = await safe(() => api('customer_find', { q: q.value })) || [];
    res.innerHTML = r.length ? r.map(c => `<div class="nt" data-id="${c.id}"><div class="ni" style="--c:var(--primary)">${ic('user')}</div><div><b>${esc(c.name)}</b><br><small>${esc(c.phone)}</small></div></div>`).join('') : '<div class="empty" style="padding:12px">No match — enter the new customer below.</div>';
    res.classList.remove('hidden'); $$('.nt', res).forEach((el, i) => el.onclick = () => pick(r[i]));
  }, 200); });
  [nm].forEach(el => el.addEventListener('input', unlink));
  ph.addEventListener('input', unlink);
  ph.addEventListener('change', async () => { if (id.value || ph.value.replace(/\D/g, '').length < 7) return; const r = await safe(() => api('customer_find', { q: ph.value })) || []; const m = r.find(c => c.phone.replace(/\D/g, '') === ph.value.replace(/\D/g, '')); if (m) pick(m); });
}

/* ---------- export / print ---------- */
function exportXls(filename, cols, rows) {
  const th = cols.map(c => `<th style="background:#1e3a8a;color:#fff">${esc(c.l)}</th>`).join('');
  const tr = rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c.k] ?? '')}</td>`).join('')}</tr>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"></head><body><h3>${esc(S.br.company_name || '')}</h3><table border="1"><tr>${th}</tr>${tr}</table></body></html>`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + html], { type: 'application/vnd.ms-excel' }));
  a.download = filename.replace(/[^\w\-]+/g, '_') + '_' + todayStr() + '.xls'; document.body.appendChild(a); a.click(); a.remove();
}
function logoSrc() { return S.br.logo || defaultLogo(); }
function defaultLogo() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8cff"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><rect x="6" y="6" width="108" height="108" rx="28" fill="url(#g)"/><rect x="38" y="20" width="44" height="80" rx="10" fill="#0b1220"/><rect x="42" y="27" width="36" height="58" rx="4" fill="#dbeafe"/><path d="M64 33 50 61h9l-3 22 15-30h-9z" fill="#2563eb"/><circle cx="60" cy="92" r="3" fill="#94a3b8"/></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(svg);
}
/** Print HTML inside a hidden iframe (no popup blockers) */
function printHtml(html) {
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f); const d = f.contentWindow.document; d.open(); d.write(html); d.close();
  const go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 60000); };
  const imgs = [...d.images]; Promise.all(imgs.map(i => i.complete ? 1 : new Promise(r => { i.onload = i.onerror = r; }))).then(() => setTimeout(go, 150));
}
function docCss() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  return `:root{--p:${v('--primary')};--a:${v('--accent')};--t:#0f1b33}*{box-sizing:border-box}body{font-family:"Segoe UI",Arial,sans-serif;color:var(--t);margin:0}
  .sheet{padding:34px 40px;page-break-after:always;min-height:96vh;position:relative}.sheet:last-child{page-break-after:auto}
  .lh{display:flex;align-items:center;gap:16px;border-bottom:4px solid var(--p);padding-bottom:14px}.lh img{width:78px;height:78px;object-fit:contain}
  .lh h1{margin:0;font-size:24px;letter-spacing:1px;color:var(--p)}.lh p{margin:2px 0 0;font-style:italic;color:#475569;font-size:14px}.lh small{display:block;color:#64748b;margin-top:4px;font-size:11.5px}
  .band{height:6px;background:linear-gradient(90deg,var(--p),var(--a));margin-top:3px;border-radius:3px}
  h2.dt{text-align:center;margin:26px 0 16px;font-size:19px;letter-spacing:2px;color:var(--p);text-transform:uppercase}
  table.kv{width:100%;border-collapse:collapse}table.kv td{padding:11px 14px;border:1px solid #d6deea;font-size:14px}table.kv td:first-child{width:32%;background:#f1f5fb;font-weight:700;color:#334155}
  .pwv{font-family:Consolas,monospace;font-size:16px;letter-spacing:1px;font-weight:700}
  .sig{display:flex;justify-content:space-between;margin-top:64px;gap:40px}.sig div{flex:1;border-top:1px solid #64748b;padding-top:6px;text-align:center;font-size:12px;color:#475569}
  .ft{position:absolute;left:40px;right:40px;bottom:24px;text-align:center;font-size:11px;color:#64748b;border-top:1px solid #d6deea;padding-top:8px}
  .warn{margin-top:18px;padding:10px 14px;background:#fff7ed;border:1px solid #fdba74;border-radius:6px;font-size:12px;color:#9a3412}
  table.dt2{width:100%;border-collapse:collapse;font-size:12px}table.dt2 th{background:var(--p);color:#fff;padding:7px 8px;text-align:left}table.dt2 td{padding:6px 8px;border-bottom:1px solid #d6deea}
  @page{margin:10mm}`;
}
function letterhead() {
  const b = S.br;
  return `<div class="lh"><img src="${esc(logoSrc())}" alt=""><div><h1>${esc(b.company_name)}</h1><p>${esc(b.slogan)}</p><small>${esc([b.phone, b.email, b.address, b.website].filter(Boolean).join('  •  '))}</small></div></div><div class="band"></div>`;
}
function printAppleDocs(list) {
  const b = S.br;
  const sheets = list.map(r => `<div class="sheet">${letterhead()}<h2 class="dt">Apple ID Information</h2>
    <table class="kv"><tr><td>Customer</td><td>${esc(r.customer_name)}</td></tr><tr><td>Phone</td><td>${esc(r.phone || '—')}</td></tr><tr><td>iPhone model</td><td>${esc(r.model)}</td></tr>
    <tr><td>Apple ID</td><td>${esc(r.apple_id)}</td></tr><tr><td>Apple ID password</td><td class="pwv">${esc(r.password)}</td></tr>
    <tr><td>Description</td><td>${esc(r.description || '—')}</td></tr><tr><td>Date</td><td>${esc(fdate(r.date))}</td></tr><tr><td>Status</td><td>${esc(stLabel(r.status))}</td></tr>
    <tr><td>Entered by</td><td>${esc(r.created_name || '—')}</td></tr></table>
    <div class="warn"><b>Confidential:</b> this document contains sensitive account credentials. Store it securely and hand it only to the account owner.</div>
    <div class="sig"><div>Customer signature</div><div>Authorised staff (${esc(r.created_name || '')})</div></div>
    <div class="ft">${esc(b.footer || '')}</div></div>`).join('');
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Apple ID</title><style>${docCss()}</style></head><body>${sheets}</body></html>`);
}
function printTable(title, cols, rows, sub = '') {
  const t = `<div class="sheet" style="min-height:auto">${letterhead()}<h2 class="dt">${esc(title)}</h2>${sub ? `<p style="text-align:center;color:#64748b;margin-top:-8px">${esc(sub)}</p>` : ''}<table class="dt2"><tr>${cols.map(c => `<th>${esc(c.l)}</th>`).join('')}</tr>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(r[c.k] ?? '')}</td>`).join('')}</tr>`).join('')}</table><p style="margin-top:20px;color:#64748b;font-size:11px">Printed ${esc(new Date().toLocaleString())} • ${esc(S.br.footer || '')}</p></div>`;
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${docCss()}</style></head><body>${t}</body></html>`);
}

/* ---------- image helper ---------- */
function pickImage(maxPx, cb) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp';
  i.onchange = () => { const f = i.files[0]; if (!f) return; const img = new Image(); img.onload = () => {
    const k = Math.min(1, maxPx / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); cb(c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', .88));
  }; img.onerror = () => toast('That image could not be read.', 'err'); img.src = URL.createObjectURL(f); };
  i.click();
}

/* ---------- themes ---------- */
const THEMES = [['midnight', 'Midnight Blue', ['#0b1220', '#4f8cff', '#22d3ee']], ['light', 'Clean Light', ['#f1f5fb', '#2563eb', '#0ea5e9']], ['emerald', 'Emerald Night', ['#07130f', '#10b981', '#a3e635']],
  ['royal', 'Royal Purple', ['#0f0a1f', '#8b5cf6', '#f0abfc']], ['sunset', 'Sunset Amber', ['#150c08', '#f97316', '#facc15']], ['rose', 'Rose Quartz', ['#fdf2f5', '#e11d48', '#f97316']],
  ['ocean', 'Ocean Breeze', ['#eaf7f9', '#0891b2', '#14b8a6']], ['graphite', 'Graphite Gold', ['#111214', '#eab308', '#fb923c']],
  ['dark', 'System Dark', ['#0a0a0b', '#3b82f6', '#38bdf8']], ['white', 'System White', ['#ffffff', '#2563eb', '#0ea5e9']]];
function applyTheme(t) { if (!THEMES.find(x => x[0] === t)) t = 'midnight'; document.documentElement.dataset.theme = t; try { localStorage.setItem('hic_theme', t); if (S.user) localStorage.setItem('hic_theme_' + S.user.id, t); } catch (e) { } }
function loadTheme() { let t = 'midnight'; try { t = localStorage.getItem('hic_theme') || t; } catch (e) { } applyTheme(t); }
const themePicker = () => `<div class="themes" role="listbox" aria-label="Themes">${THEMES.map(t => `<div class="theme ${document.documentElement.dataset.theme === t[0] ? 'on' : ''}" data-theme-id="${t[0]}" role="option" tabindex="0"><div class="sw">${t[2].map(c => `<i style="background:${c}"></i>`).join('')}</div><b>${t[1]} ${document.documentElement.dataset.theme === t[0] ? ic('check') : ''}</b></div>`).join('')}</div>`;
loadTheme();

/* quick "Processing" groups shown above / inside the repair lists: [label, colour, statuses, icon] */
const HW_GROUPS = [['Received', '#3b82f6', ['received'], 'inbox'], ['Processing repair', '#f59e0b', ['diagnosis', 'progress', 'parts_installed', 'testing', 'working', 'not_working', 'finishing'], 'tool'], ['Waiting for part', '#f97316', ['waiting_part'], 'clock'], ['Ready / completed', '#22c55e', ['ready', 'completed'], 'check-circle'], ['Collected', '#64748b', ['took_completed', 'took_incomplete', 'in_store'], 'package']];
const SW_GROUPS = {
  repair: [['Received', '#3b82f6', ['received'], 'inbox'], ['Processing repair', '#f59e0b', ['diagnosis', 'in_progress', 'testing', 'working', 'not_working'], 'zap'], ['Waiting', '#f97316', ['waiting'], 'clock'], ['Completed', '#22c55e', ['completed'], 'check-circle'], ['Handed over', '#64748b', ['took', 'instore'], 'package']],
  unlock: [['Requests', '#3b82f6', ['request', 'received'], 'inbox'], ['Processing unlock', '#f59e0b', ['in_progress'], 'lock'], ['Waiting', '#f97316', ['waiting'], 'clock'], ['Completed', '#22c55e', ['completed'], 'check-circle'], ['Handed over', '#64748b', ['took', 'instore'], 'package']],
  newid: [['Requested', '#3b82f6', ['requested'], 'inbox'], ['Processing (creating)', '#f59e0b', ['creating'], 'user-check'], ['Created / verified', '#22c55e', ['created', 'verified'], 'check-circle'], ['Customer received', '#64748b', ['customer_received'], 'package']],
};