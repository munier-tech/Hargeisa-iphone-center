/* HARGEISA IPHONE CENTER — staff application shell */
const V = {};            // view renderers: V.name(root, param)
const TITLES = { dashboard: 'Dashboard', customers: 'Customers', repairs: 'Hardware Repairs', software: 'Software Repair', unlock: 'Apple Unlock Requests', newid: 'New Apple ID Service', appleid: 'Apple ID Requests', inventory: 'Inventory', stores: 'Stores / Suppliers', regional: 'External / Regional Repairs', sales: 'Sales centre', receipts: 'Sales receipts', invoices: 'Invoices', quotes: 'Quotations', accounts: 'Accounts & Wallets', expenses: 'Expenses', notifications: 'Notifications', users: 'Users', portal: 'Customer Portal Management', reports: 'Reports', finance: 'Finance', profile: 'My Profile', settings: 'Themes / Settings', analytics: 'Management Analytics', employees: 'Employee Activity Center', audit: 'Advanced Audit Log', security: 'Security & Permission Center', backup: 'Backup & Restore Center', recovery: 'Data Recovery Center', health: 'System Health Monitor', chat: 'Chat', chatperms: 'Chat Permissions', owner: 'Owner Control' };
const NAV = [
  ['dashboard', 'Dashboard', 'grid', () => true], ['customers', 'Customers', 'users', () => can('customers', 'view')], ['repairs', 'Hardware Repairs', 'tool', () => can('repairs', 'view')],
  ['software', 'Software Repair', 'zap', () => can('software', 'view')], ['unlock', 'Apple Unlock', 'lock', () => can('software', 'view')], ['newid', 'New Apple ID', 'user-check', () => can('software', 'view')], ['appleid', 'Apple ID Requests', 'key', () => can('appleid', 'view')],
  ['regional', 'External / Regional Repairs', 'globe', () => can('regional', 'view')],
  ['sales', 'Sales centre', 'cart', () => can('sales', 'view')], ['invoices', 'Invoices', 'sheet', () => can('sales', 'view')], ['quotes', 'Quotations', 'file', () => can('sales', 'view')],
  ['inventory', 'Inventory', 'package', () => can('inventory', 'view')], ['stores', 'Stores / Suppliers', 'store', () => can('stores', 'view')], ['expenses', 'Expenses', 'dollar', () => can('expenses', 'view')], ['accounts', 'Accounts & Wallets', 'send', () => can('accounts', 'view')],
  ['notifications', 'Notifications', 'bell', () => true], ['chat', 'Chat', 'chat', () => !!S.chatOn && !!(S.user && S.user.chat && S.user.chat.chat)], ['users', 'Users', 'user-check', isAdmin], ['owner', 'Owner Control', 'crown', isOwner], ['portal', 'Customer Portal Management', 'shield', () => can('portal', 'view')],
  ['reports', 'Reports', 'list', () => can('reports', 'view')], ['finance', 'Finance — Super Admin Only', 'trend', () => isAdmin() && !modOff('finance')],
  ['analytics', 'Management Analytics', 'trend', isAdmin], ['employees', 'Employee Activity', 'users', isAdmin], ['audit', 'Advanced Audit Log', 'list', isAdmin], ['security', 'Security & Permissions', 'shield', isAdmin],
  ['backup', 'Backup & Restore', 'download', isAdmin], ['recovery', 'Data Recovery', 'refresh', isAdmin], ['health', 'System Health', 'activity', isAdmin], ['chatperms', 'Chat Permissions', 'chat', isAdmin],
  ['profile', 'My Profile', 'user', () => true], ['settings', 'Themes / Settings', 'sliders', () => true],
];
/* sidebar dropdown groups: the members are listed inside one collapsible entry */
const GROUPS = [
  { id: 'soft', label: 'Software Department', icon: 'zap', members: ['software', 'unlock', 'newid', 'appleid'] },
  { id: 'acc', label: 'Sales & Accounting', icon: 'dollar', members: ['sales', 'invoices', 'quotes', 'inventory', 'stores', 'expenses', 'accounts', 'reports', 'finance'] },
  { id: 'sys', label: 'System Center', icon: 'sliders', members: ['analytics', 'employees', 'audit', 'security', 'backup', 'recovery', 'health', 'chatperms'] },
];
const NOTIF = { new_user: ['user', '#3b82f6'], user_approved: ['check-circle', '#22c55e'], user_activated: ['user-check', '#10b981'], user_deactivated: ['pause', '#f97316'], appleid_deadline: ['key', '#f59e0b'], appleid_reminder: ['key', '#f59e0b'], stock: ['package', '#ef4444'], followup: ['phone', '#8b5cf6'], settlement: ['file', '#06b6d4'], system: ['info', '#64748b'], portal: ['shield', '#8b5cf6'], overdue: ['clock', '#ef4444'], ready_wait: ['package', '#f59e0b'], unpaid: ['dollar', '#f97316'], backup: ['download', '#3b82f6'], security: ['lock', '#ef4444'], health: ['activity', '#ef4444'] };
let curRoute = '';

/* ---- sidebar layout set by the System Owner (order, names, hidden items, who sees what) */
const ALWAYS_NAV = ['dashboard', 'profile'];      // landing page + own profile can be renamed but never hidden
const navItem = k => (S.nav && S.nav.items && S.nav.items[k]) || {};
const navLabel = n => navItem(n[0]).label || n[1];
const groupLabel = g => (S.nav && S.nav.groups && S.nav.groups[g.id]) || g.label;
const userRole = () => S.user.is_admin ? 'Super Admin' : S.user.position;
function navAllowed(k) {
  if (isOwner() || ALWAYS_NAV.includes(k)) return true;   // the owner always sees everything, so the menu can never lock them out
  const c = navItem(k); if (c.hidden) return false;
  if ((c.pos || []).length || (c.users || []).length) return (c.pos || []).includes(userRole()) || (c.users || []).includes(S.user.id);
  return true;
}
/* saved order from the owner; menu items added later sit right after their neighbour in the default order */
const navOrdered = () => { const o = (S.nav && S.nav.order) || [], pos = {}; let last = -1;
  NAV.forEach((n, i) => { const k = o.indexOf(n[0]); if (k >= 0) last = k; pos[n[0]] = k >= 0 ? k : last + 0.001 * (i + 1); });
  return [...NAV].sort((a, b) => pos[a[0]] - pos[b[0]]); };
const navVisible = () => navOrdered().filter(n => n[3]() && navAllowed(n[0]));
function navHtml(vis) {
  const isOpen = g => { try { return localStorage.getItem('hic_nav_' + g.id) === '1'; } catch (e) { return false; } };
  const link = (n, cls = '') => { const hid = isOwner() && (navItem(n[0]).hidden || (navItem(n[0]).pos || []).length || (navItem(n[0]).users || []).length);
    return `<a class="${cls}${navItem(n[0]).hidden && isOwner() ? ' nhid' : ''}" data-r="${n[0]}" href="#/${n[0]}" title="${esc(navLabel(n))}${hid ? ' (restricted by you)' : ''}">${ic(n[2])}<span>${esc(navLabel(n))}</span>${n[0] === 'notifications' ? '<span class="nb hidden" data-nb></span>' : n[0] === 'portal' ? '<span class="nb hidden" data-pb></span>' : n[0] === 'chat' ? '<span class="nb hidden" data-cb></span>' : ''}</a>`; };
  return vis.map(n => {
    const g = GROUPS.find(x => x.members.includes(n[0])); if (!g) return link(n);
    const mem = vis.filter(x => g.members.includes(x[0])); if (n[0] !== mem[0][0]) return '';
    return `<div class="ng ${isOpen(g) ? 'open' : ''}" id="ng_${g.id}"><a class="ngh" data-ng="${g.id}" title="${esc(groupLabel(g))}">${ic(g.icon)}<span>${esc(groupLabel(g))}</span><i class="chev">${ic('chev-down')}</i></a><div class="ngb"><div>${mem.map(x => link(x, 'sub')).join('')}</div></div></div>`;
  }).join('') + `<div class="sep"></div><a class="logout" data-logout title="Logout">${ic('logout')}<span>Logout</span></a>`;
}
function wireNav() {
  $$('[data-ng]').forEach(h => h.onclick = () => { const g = $('#ng_' + h.dataset.ng); g.classList.toggle('open'); try { localStorage.setItem('hic_nav_' + h.dataset.ng, g.classList.contains('open') ? '1' : '0'); } catch (e) { } });
  $$('[data-logout]').forEach(a => a.onclick = doLogout);
}
/* re-draw the menu in place (after the owner changes the layout) without reloading the page */
async function refreshNav() {
  try { const me = await api('me'); S.user = me.user; S.nav = me.nav; } catch (e) { return; }
  $('#side .nav').innerHTML = navHtml(navVisible()); wireNav(); paintBadge();
  $$('.nav a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === curRoute));
  const item = NAV.find(n => n[0] === curRoute); if (item && !(item[3]() && navAllowed(item[0]))) route();
}

function applyBranding() {
  document.title = (S.br.company_name || 'HARGEISA IPHONE CENTER');
  $$('[data-logo]').forEach(i => i.src = logoSrc());
  $$('[data-cname]').forEach(i => i.textContent = S.br.company_name || '');
  $$('[data-slogan]').forEach(i => i.textContent = S.br.slogan || '');
  $$('[data-footer]').forEach(i => i.textContent = S.br.footer || '');
  let l = $('link[rel=icon]'); if (!l) { l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); } l.href = logoSrc();
}
function goRestricted(msg) {
  S.user = null; S.timers.forEach(clearInterval); S.timers = [];
  const ov = document.createElement('div'); ov.className = 'ov'; ov.style.alignItems = 'center';
  ov.innerHTML = `<div class="modal sm"><div class="modal-b confirm" style="--c:#ef4444"><div class="big">${ic('lock')}</div><h3>Access restricted</h3><p class="muted">${esc(msg || 'Your access has been restricted; this user account has been deactivated. Please contact your owner, as you are not authorized.')}</p><p class="muted"><small>Redirecting…</small></p></div></div>`;
  document.body.appendChild(ov); setTimeout(() => { location.href = 'restricted.html?reason=deactivated'; }, 3200);
}

/* ------------------------------------------------ login */
function showLogin(mode = 'in', notice = '') {
  S.timers.forEach(clearInterval); S.timers = [];
  const phone = `<svg class="float" viewBox="0 0 300 300" aria-hidden="true"><defs><linearGradient id="fg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#bfe3ff" stop-opacity=".85"/></linearGradient></defs>
    <g transform="rotate(-12 150 150)"><rect x="80" y="30" width="140" height="250" rx="26" fill="#0b1633" stroke="#fff" stroke-opacity=".55" stroke-width="3"/><rect x="92" y="52" width="116" height="206" rx="14" fill="url(#fg)"/><rect x="128" y="38" width="44" height="8" rx="4" fill="#fff" fill-opacity=".4"/>
    <path d="M156 92 124 158h26l-8 52 38-70h-26z" fill="#2563eb"/></g><g transform="translate(232 214)"><circle r="38" fill="#0b1633" stroke="#fff" stroke-opacity=".5" stroke-width="3"/><path d="M-14 12 8-10a10 10 0 0 1 14-14l-8 8 6 6 8-8a10 10 0 0 1-14 14L-6 20z" fill="#22d3ee"/></g></svg>`;
  const feat = [['tool', 'Hardware & software repairs with live progress'], ['key', 'Apple ID, Apple Unlock & new Apple ID services'], ['package', 'Inventory, stores, sales and finance in one place'], ['shield', 'Secure, role-based access for every team member']];
  $('#app').innerHTML = `<div class="auth2"><section class="hero"><div class="grid-bg"></div><div class="hero-in"><img class="logo" data-logo alt=""><h1 data-cname></h1><p class="sl" data-slogan></p>
      <ul class="feat">${feat.map(f => `<li><i>${ic(f[0])}</i><span>${f[1]}</span></li>`).join('')}</ul></div>${phone}</section>
    <section class="lpanel"><div class="lcard"><div class="mbrand"><img data-logo alt=""><b data-cname></b><small data-slogan></small></div>
      <div class="lsw"><a data-m="in" class="${mode === 'in' ? 'on' : ''}">Sign in</a><a data-m="up" class="${mode === 'up' ? 'on' : ''}">Request access</a></div>
      ${notice ? `<div class="notice ok" style="margin-bottom:14px">${ic('check-circle')}<span>${esc(notice)}</span></div>` : ''}
      <h2>${mode === 'in' ? 'Welcome back' : 'Request an account'}</h2><p class="sub">${mode === 'in' ? 'Sign in to manage repairs, customers and stock.' : 'The Super Admin must approve your account before you can sign in.'}</p>
      <div id="aerr" class="lerr hidden" role="alert">${ic('alert')}<span></span></div>
      <form id="af" autocomplete="on">${mode === 'up' ? `<label class="lbl">Full name</label><div class="ifield">${ic('user')}<input name="name" required placeholder="Your full name"></div>` : ''}
        <label class="lbl">Email</label><div class="ifield">${ic('mail')}<input name="email" type="email" required placeholder="name@example.com" autocomplete="username" inputmode="email"></div>
        ${mode === 'up' ? `<label class="lbl">Position</label><div class="ifield">${ic('tool')}<select name="position" style="padding-left:42px;min-height:50px;border-radius:12px"><option>Technician</option><option>Software</option></select></div>` : ''}
        <label class="lbl">Password</label><div class="ifield">${ic('lock')}<input name="password" type="password" required placeholder="${mode === 'up' ? 'At least 6 characters' : 'Your password'}" autocomplete="${mode === 'up' ? 'new-password' : 'current-password'}"><button type="button" class="eye" data-eye title="Show / hide password" aria-label="Show or hide password">${ic('eye')}</button></div>
        ${mode === 'in' ? `<div class="lrow"><label><input type="checkbox" name="remember"> Remember me</label><a id="fp" style="cursor:pointer">Forgot password?</a></div>` : '<div style="height:6px"></div>'}
        <button class="btn primary lbtn" id="lb">${ic(mode === 'in' ? 'lock' : 'user-check')} <span>${mode === 'in' ? 'Sign in' : 'Submit request'}</span></button></form>
      <p class="muted" style="margin-top:22px;text-align:center">Are you a customer? <a href="/portal">Open the Customer Portal ${ic('ext')}</a></p><p class="muted" style="font-size:12px;text-align:center" data-footer></p></div></section></div>`;
  applyBranding();
  $$('.lsw a').forEach(a => a.onclick = () => showLogin(a.dataset.m));
  $('#fp')?.addEventListener('click', () => {
    const m = modal({ title: `${ic('lock')} Forgot your password?`, size: 'sm', body: `<p class="muted" style="margin-top:0">Enter your account email. The Super Admin is notified and will set a new password for you.</p><form id="fpf">${fi('email', 'Email', $('[name=email]')?.value || '', { req: 1, type: 'email' })}</form>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="fps">${ic('check')} Send request</button>` });
    $('#fps').onclick = () => safe(async () => { await api('password_request', formData($('#fpf'))); m.close(); toast('If that email belongs to an active account, the Super Admin has been notified.', 'ok'); });
  });
  $('#af').onsubmit = async e => {
    e.preventDefault(); const b = $('#lb'), err = $('#aerr'), label = $('span', b).textContent; err.classList.add('hidden'); b.disabled = true; b.innerHTML = `<span class="spin"></span> <span>${mode === 'in' ? 'Signing in…' : 'Sending…'}</span>`;
    try {
      const d = formData(e.target);
      if (mode === 'in') { const r = await api('login', d); await startApp(r); }
      else { await api('staff_register', d); showLogin('in', 'Request sent. The Super Admin must approve your account before you can sign in.'); }
    } catch (x) { if (!x.handled) { $('span', err).textContent = x.message; err.classList.remove('hidden'); } b.disabled = false; b.innerHTML = `${ic(mode === 'in' ? 'lock' : 'user-check')} <span>${label}</span>`; }
  };
}

/* ------------------------------------------------ shell */
let idleWired = false;
async function startApp(me) {
  S.user = me.user; S.br = me.branding; S.unread = me.unread; S.portalPending = me.portal_pending || 0; S.idleMin = me.idle_min || 30; S.chatOn = !!me.chat_on; S.chatUnread = me.chat_unread || 0; S.weak = !!me.default_password;
  try { const t = localStorage.getItem('hic_theme_' + S.user.id); if (t) applyTheme(t); } catch (e) { }
  S.nav = me.nav || {}; S.staff = await api('staff_lookup').catch(() => []);
  const vis = navVisible();
  $('#app').innerHTML = `<div id="shell"><aside class="side" id="side"><div class="brand"><img data-logo alt=""><div><b data-cname></b><small data-slogan></small></div></div>
      <nav class="nav">${navHtml(vis)}</nav><div class="side-foot" data-footer></div></aside><div class="scrim" id="scrim"></div>
    <div class="main"><header class="top"><button class="icon-btn burger" id="burger" aria-label="Menu">${ic('menu')}</button><button class="icon-btn" id="collapse" title="Collapse / expand menu" aria-label="Collapse menu">${ic('menu')}</button><h1 id="ptitle"></h1>
      <div class="gsearch" id="gs">${ic('search')}<input id="gsi" type="search" placeholder="Search customers, devices, IMEI, Apple ID…" autocomplete="off" aria-label="Global search"><kbd>/</kbd><div class="gres hidden" id="gsr"></div></div><div class="grow"></div>
      <button class="icon-btn" id="gsbtn" aria-label="Search">${ic('search')}</button>
      <div class="rel"><button class="icon-btn" id="thbtn" title="Theme" aria-label="Theme">${ic('palette')}</button><div class="pop small hidden" id="thpop">${THEMES.map(t => `<div class="tm" data-t="${t[0]}"><i>${t[2].map(c => `<b style="background:${c}"></b>`).join('')}</i>${t[1]}</div>`).join('')}</div></div>
      <div class="rel"><button class="icon-btn" id="bell" aria-label="Notifications">${ic('bell')}<span class="badge hidden" data-nb></span></button><div class="pop hidden" id="notifpop"></div></div>
      <div class="rel"><div class="me" id="me" tabindex="0"><div class="who"><b data-me-name></b><small data-me-pos></small><small class="st">● Online</small></div><span data-me-av></span></div>
        <div class="pop small hidden" id="mepop"><a class="mi" href="#/profile">${ic('user')} My Profile</a><a class="mi" href="#/settings">${ic('palette')} Themes / Settings</a><a class="mi" data-logout style="color:var(--danger)">${ic('logout')} Logout</a></div></div></header>
      <main class="view" id="view"></main><div class="foot" data-footer></div></div>
    <nav class="mnav" aria-label="Quick navigation">${[['dashboard', 'grid', 'Home'], ['customers', 'users', 'Customers'], ['repairs', 'tool', 'Repairs'], ['software', 'zap', 'Software']].filter(x => vis.some(n => n[0] === x[0])).map(x => `<a href="#/${x[0]}" data-r="${x[0]}">${ic(x[1])}<span>${x[2]}</span></a>`).join('')}<a id="mnsearch">${ic('search')}<span>Search</span></a><a id="mnmenu">${ic('menu')}<span>Menu</span></a></nav></div>`;
  applyBranding(); paintMe(); paintBadge(); wireNav();
  try { $('#shell').classList.toggle('collapsed', localStorage.getItem('hic_collapsed') === '1'); } catch (e) { }
  $('#mnmenu').onclick = () => { $('#side').classList.toggle('open'); $('#scrim').classList.toggle('open'); };
  $('#mnsearch').onclick = e => { e.stopPropagation(); $('#gs').classList.add('open'); $('#gsi').focus(); };
  $('#burger').onclick = () => { $('#side').classList.toggle('open'); $('#scrim').classList.toggle('open'); };
  $('#collapse').onclick = () => { const c = $('#shell').classList.toggle('collapsed'); try { localStorage.setItem('hic_collapsed', c ? '1' : '0'); } catch (e) { } };
  $('#scrim').onclick = () => { $('#side').classList.remove('open'); $('#scrim').classList.remove('open'); };
  const closePops = except => ['notifpop', 'mepop', 'thpop'].forEach(id => { if (id !== except) $('#' + id)?.classList.add('hidden'); });
  $('#bell').onclick = e => { e.stopPropagation(); closePops('notifpop'); const p = $('#notifpop'); p.classList.toggle('hidden'); if (!p.classList.contains('hidden')) renderNotifPop(); };
  $('#me').onclick = e => { e.stopPropagation(); closePops('mepop'); $('#mepop').classList.toggle('hidden'); };
  $('#thbtn').onclick = e => { e.stopPropagation(); closePops('thpop'); $('#thpop').classList.toggle('hidden'); };
  $$('.tm').forEach(t => t.onclick = () => { applyTheme(t.dataset.t); closePops(); route(); toast('Theme applied', 'ok'); });
  document.addEventListener('click', e => { if (!e.target.closest('#notifpop,#mepop,#thpop')) closePops(); if (!e.target.closest('#gs,#gsbtn')) $('#gsr')?.classList.add('hidden'); });
  wireGlobalSearch();
  S.timers.push(setInterval(pingLoop, 15000));
  // inactivity sign-out (30 min)
  let lastAct = Date.now();
  if (!idleWired) { idleWired = true; ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true })); }
  S.timers.push(setInterval(async () => { if (S.user && Date.now() - lastAct > (S.idleMin || 30) * 60000) { await api('logout').catch(() => { }); S.user = null; S.timers.forEach(clearInterval); S.timers = []; location.hash = ''; showLogin('in', 'You were signed out after 30 minutes of inactivity.'); } }, 30000));
  window.onhashchange = route; if (!location.hash) location.hash = '#/dashboard'; else route();
}
function wireGlobalSearch() {
  const gs = $('#gs'), inp = $('#gsi'), box = $('#gsr'); let t;
  $('#gsbtn').onclick = e => { e.stopPropagation(); gs.classList.toggle('open'); if (gs.classList.contains('open')) inp.focus(); };
  document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); gs.classList.add('open'); inp.focus(); } if (e.key === 'Escape') { box.classList.add('hidden'); gs.classList.remove('open'); } });
  const show = async () => {
    const q = inp.value.trim(); if (q.length < 2) { box.classList.add('hidden'); return; }
    const r = await api('search', { q }).catch(() => null); if (!r) return;
    const groups = {}; r.forEach(x => (groups[x.g] ||= []).push(x));
    box.innerHTML = r.length ? Object.entries(groups).map(([g, xs]) => `<h6>${esc(g)}</h6>${xs.map(x => `<a data-l="${esc(x.l)}">${ic(x.ic)}<span class="grow"><b>${esc(x.t)}</b></span>${x.st ? chip(x.st) : `<small class="muted">${esc(x.s || '')}</small>`}</a>`).join('')}`).join('') : `<div class="empty" style="padding:20px">${ic('search')}<div>No results for “${esc(q)}”</div></div>`;
    box.classList.remove('hidden');
    $$('a[data-l]', box).forEach(a => a.onclick = () => { location.hash = a.dataset.l; box.classList.add('hidden'); inp.value = ''; gs.classList.remove('open'); });
  };
  inp.addEventListener('input', () => { clearTimeout(t); t = setTimeout(show, 220); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const a = $('a[data-l]', box); if (a) a.click(); } });
}
function paintMe() {
  const u = S.user; $('[data-me-name]').textContent = u.name; $('[data-me-pos]').textContent = u.position;
  $('[data-me-av]').innerHTML = avatar({ ...u, online: true });
}
function paintChatBadge() { $$('[data-cb]').forEach(b => { b.textContent = S.chatUnread > 99 ? '99+' : S.chatUnread; b.classList.toggle('hidden', !S.chatUnread); }); }
function paintBadge() { paintChatBadge(); $$('[data-pb]').forEach(b => { b.textContent = S.portalPending; b.classList.toggle('hidden', !S.portalPending); }); $$('[data-nb]').forEach(b => { b.textContent = S.unread > 99 ? '99+' : S.unread; b.classList.toggle('hidden', !S.unread); }); }
async function pingLoop() {
  try {
    const r = await api('ping'); const before = S.unread; S.unread = r.unread;
    if (r.nav_v !== undefined && S.nav && r.nav_v !== S.nav.v) { S.nav.v = r.nav_v; await refreshNav(); if (!isOwner()) toast('The menu was updated by the System Owner'); } if (r.chat_on !== undefined) { if (!!r.chat_on !== !!S.chatOn) { location.reload(); return; } const cu = S.chatUnread || 0; S.chatUnread = r.chat_unread || 0; if (curRoute !== 'chat' && S.chatUnread > cu) chatNotify('💬 ' + (S.chatUnread - cu) + ' new chat message' + (S.chatUnread - cu > 1 ? 's' : '')); }
    const pb = S.portalPending || 0; S.portalPending = r.portal_pending || 0; paintBadge(); if (S.portalPending > pb) toast(`Customer portal: ${S.portalPending - pb} new access request(s) waiting for approval`); if (curRoute === 'portal' && S.portalPending !== pb && !$('.ov')) V.portal($('#view'));
    if (r.unread > before) { toast(`${r.unread - before} new notification${r.unread - before > 1 ? 's' : ''}`); if (!$('#notifpop').classList.contains('hidden')) renderNotifPop(); if (curRoute === 'notifications') V.notifications($('#view')); }
  } catch (e) { }
}
async function doLogout() {
  if (!await confirmBox({ title: 'Are you sure you want to logout?', message: 'You will need to sign in again to continue.', confirmText: 'Logout', color: 'danger', icon: 'logout' })) return;
  await api('logout').catch(() => { }); S.user = null; S.timers.forEach(clearInterval); S.timers = []; location.hash = ''; showLogin();
}
async function route() {
  const [, r = 'dashboard', param] = location.hash.split('/'); const name = V[r] ? r : 'dashboard';
  const item = NAV.find(n => n[0] === name);
  if (item && !(item[3]() && navAllowed(item[0]))) { toast('You are not authorized to open that page.', 'err'); location.hash = '#/dashboard'; return; }
  curRoute = name; S.pageTimers?.forEach(clearInterval); S.pageTimers = [];
  $('#side').classList.remove('open'); $('#scrim').classList.remove('open');
  $$('.nav a[data-r], .mnav a[data-r]').forEach(a => a.classList.toggle('on', a.dataset.r === name)); GROUPS.filter(g => g.members.includes(name)).forEach(g => $('#ng_' + g.id)?.classList.add('open'));
  $('#ptitle').textContent = navItem(name).label || TITLES[name];
  const root = $('#view'); root.innerHTML = '<div class="empty">Loading…</div>';
  try { await V[name](root, param); } catch (e) { if (!e.handled) root.innerHTML = `<div class="card empty">${ic('alert')}<div>${esc(e.message)}</div></div>`; }
  window.scrollTo(0, 0);
}
const every = (fn, ms) => { (S.pageTimers ||= []).push(setInterval(fn, ms)); };

/* ------------------------------------------------ notifications */
function notifRow(n) {
  const [icn, col] = NOTIF[n.type] || NOTIF.system;
  return `<div class="nt ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${esc(n.link || '')}" data-s="${esc((n.message + ' ' + n.type).toLowerCase())}" data-st="${n.type},${n.is_read ? 'read' : 'unread'}"><div class="ni" style="--c:${col}">${ic(icn)}</div><div class="grow"><div class="msg">${esc(n.message)}</div><small>${ago(n.ts)}${n.is_read ? '' : ' • unread'}</small></div>${n.is_read ? '' : '<span class="ud"></span>'}</div>`;
}
async function renderNotifPop() {
  const p = $('#notifpop'); const d = await api('notifs_list'); S.unread = d.unread; paintBadge();
  p.innerHTML = `<div class="pop-h"><b>Notifications ${d.unread ? `<span class="chip" style="--c:#ef4444">${d.unread} new</span>` : ''}</b><a data-all style="cursor:pointer">Mark all read</a></div><div style="max-height:60vh;overflow:auto">${d.items.slice(0, 12).map(notifRow).join('') || '<div class="empty">No notifications</div>'}</div><a class="mi" href="#/notifications" style="justify-content:center;border-top:1px solid var(--border)">View all notifications</a>`;
  $('[data-all]', p).onclick = async () => { await api('notif_read', { id: 'all' }); renderNotifPop(); };
  wireNotifClicks(p);
}
function wireNotifClicks(root) {
  $$('.nt', root).forEach(el => el.onclick = async () => {
    if (el.classList.contains('unread')) { const r = await api('notif_read', { id: +el.dataset.id }); S.unread = r.unread; paintBadge(); el.classList.remove('unread'); $('.ud', el)?.remove(); el.dataset.st = 'read'; }
    if (el.dataset.link) { $('#notifpop').classList.add('hidden'); location.hash = el.dataset.link.replace(/^#?\/?/, '#/'); }
  });
}
V.notifications = async root => {
  const d = await api('notifs_list'); S.unread = d.unread; paintBadge();
  root.innerHTML = pageHead('Notifications', 'Alerts about users, Apple ID deadlines, stock, follow-ups and settlements', `<button class="btn" id="mr">${ic('check-circle')} Mark all as read</button>`) +
    `<div class="tools">${searchBox('Search notifications…')}<div class="chips" data-chips><span class="chip on" data-v="" style="--c:#64748b">All</span><span class="chip" data-v="unread" style="--c:#ef4444">Unread</span><span class="chip" data-v="overdue,ready_wait,unpaid,backup,security,health,stock" style="--c:#f97316">Alerts</span><span class="chip" data-v="portal,followup" style="--c:#8b5cf6">Customers</span><span class="chip" data-v="appleid_deadline,appleid_reminder,settlement" style="--c:#f59e0b">Deadlines</span><span class="chip" data-v="new_user,user_approved,user_activated,user_deactivated" style="--c:#3b82f6">Users</span><span class="chip" data-v="read" style="--c:#22c55e">Read</span></div><span class="muted" data-count></span></div>
    <div class="card" style="padding:0"><table class="tbl" style="display:table"><tbody>${d.items.map(n => `<tr data-s="${esc((n.message + ' ' + n.type).toLowerCase())}" data-st="${n.type},${n.is_read ? 'read' : 'unread'}"><td style="padding:0">${notifRow(n)}</td></tr>`).join('')}</tbody></table><div class="empty hidden" data-none>No matching notifications.</div>${d.items.length ? '' : '<div class="empty">No notifications yet.</div>'}</div>`;
  $('#mr').onclick = async () => { await api('notif_read', { id: 'all' }); V.notifications(root); };
  wireLive(root); wireNotifClicks(root);
};

/* ------------------------------------------------ dashboard */
const statCard = (label, v, icn, color) => `<div class="card stat" style="--c:${color}"><div class="si">${ic(icn)}</div><div><b>${v}</b><span>${label}</span></div></div>`;
V.dashboard = async root => {
  const d = await api('dashboard'), st = d.stats, adm = isAdmin() && !!d.finance;
  const cards = [['Total Users', st.total_users, 'users', '#4f8cff'], ['Total Technicians', st.technicians, 'tool', '#8b5cf6'], ['Total Software Users', st.software, 'sliders', '#06b6d4'],
    ['Online Users', st.online, 'user-check', '#22c55e'], ['Offline Users', st.offline, 'user', '#ef4444'], ['Active Users', st.active, 'check-circle', '#10b981'], ['Inactive Users', st.inactive, 'pause', '#f97316'],
    ['Total Customers', st.customers, 'users', '#f59e0b'], ['Total Inventory (units)', num(st.inventory), 'package', '#ec4899'], ['Open Repairs', st.open_repairs, 'tool', '#3b82f6'],
    ['Apple ID In Progress', st.appleid_open, 'key', '#a855f7'], ['Follow-ups Pending', st.followups, 'phone', '#14b8a6']];
  if (adm) cards.push(['Total Sales', money(st.sales), 'cart', '#0ea5e9'], ['Total Expenses', money(st.expenses), 'dollar', '#ef4444'], ['Total Profit', money(st.profit), 'trend', st.profit >= 0 ? '#22c55e' : '#ef4444']);
  const anyOn = d.wave.online > 0;
  root.innerHTML = (S.weak ? `<div class="notice" style="margin-bottom:16px">${ic('alert')}<span><b>Change the default Super Admin password.</b> You are still using the password the system shipped with. <a href="#/profile">Open My Profile</a> and set a new one.</span></div>` : '') +
    `<div class="grid g-auto" style="margin-bottom:16px">${cards.map(c => statCard(...c)).join('')}</div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>${ic('activity')} User activity wave <span class="muted" style="font-weight:400;margin-left:auto">last 24 hours</span></h3>
      <div class="row" style="margin-bottom:6px">${anyOn ? `<span class="dot on"></span><b style="color:#22c55e">${d.wave.online} user${d.wave.online > 1 ? 's' : ''} online</b>` : `<span class="wave-banner">${ic('alert')} All users are offline</span>`}</div><div id="ch-wave"></div></div>
      <div class="card"><h3>${ic('users')} Customers by gender</h3><div id="ch-gender"></div></div></div>
    ${adm ? `<div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>${ic('trend')} Daily profit <span class="muted" style="font-weight:400;margin-left:auto">last 30 days</span></h3><div id="ch-daily"></div></div><div class="card"><h3>${ic('cart')} Monthly profit</h3><div id="ch-monthly"></div></div></div>` : ''}
    <div class="grid g3" style="margin-bottom:16px">${adm ? `<div class="card"><h3>${ic('dollar')} Expenses by category</h3><div id="ch-exp"></div></div>` : `<div class="card"><h3>${ic('tool')} Repairs by status</h3><div id="ch-rep"></div></div>`}
      <div class="card"><h3>${ic('activity')} Most active users <span class="muted" style="font-weight:400;margin-left:auto">30 days</span></h3><div id="ch-active"></div></div>
      <div class="card"><h3>${ic('check-circle')} Most productive users <span class="muted" style="font-weight:400;margin-left:auto">jobs progressed</span></h3><div id="ch-prod"></div></div></div>
    ${adm ? `<div class="card"><h3>${ic('tool')} Repairs by status</h3><div id="ch-rep"></div></div>` : ''}`;
  CH.line($('#ch-wave'), { labels: d.wave.labels, series: [{ name: 'Tasks', values: d.wave.values, color: anyOn ? '#22c55e' : '#ef4444' }] }, { force: true, dots: false, h: 200, banner: anyOn ? '' : 'All users offline' });
  const gcol = { Male: '#4f8cff', Female: '#f472b6', Other: '#a78bfa', Unknown: '#94a3b8' };
  CH.pie3d($('#ch-gender'), d.gender.map(g => ({ label: g.label, v: g.v, color: gcol[g.label] })));
  if (adm) {
    const f = d.finance;
    CH.line($('#ch-daily'), { labels: f.daily.map(x => x.label), series: [{ name: 'Profit', values: f.daily.map(x => x.v), color: cv('--c1') }] }, { fmt: money, force: true });
    CH.bar3d($('#ch-monthly'), { labels: f.monthly.map(x => x.label), series: [{ name: 'Profit', values: f.monthly.map(x => x.v), color: cv('--c2') }] }, { fmt: money });
    CH.donut($('#ch-exp'), f.expense_cats.map(x => ({ label: x.label, v: x.v })), { fmt: money, center: 'Expenses' });
  }
  CH.hbar($('#ch-active'), d.most_active.map(x => ({ label: x.name, v: x.v })));
  CH.hbar($('#ch-prod'), d.most_productive.map(x => ({ label: x.name, v: x.v })), { empty: 'No completed jobs yet' });
  CH.donut($('#ch-rep'), d.repairs_by.map(x => ({ label: stLabel(x.label), v: x.v, color: (ST[x.label] || [0, '#94a3b8'])[1] })), { center: 'Repairs' });
  root.insertAdjacentHTML('beforeend', recentPanels(d.recent));
  every(() => { if (curRoute === 'dashboard' && !document.querySelector('.ov')) V.dashboard(root); }, 30000);
};


function recentPanels(r) {
  const rl = (icn, col, t, sub, right = '') => `<div class="rl" style="--c:${col}"><div class="ri">${ic(icn)}</div><div class="grow"><b>${t}</b><small class="muted">${sub}</small></div>${right}</div>`;
  const card = (title, icn, body, link) => `<div class="card"><h3>${ic(icn)} ${title}${link ? `<a href="${link}" style="margin-left:auto;font-size:12px;font-weight:500">View all</a>` : ''}</h3>${body || '<div class="muted" style="padding:14px 0">Nothing yet.</div>'}</div>`;
  const kl = { repair: 'Software repair', unlock: 'Apple Unlock', newid: 'New Apple ID' };
  const jobs = [...r.repairs.map(x => ({ t: x.received_at, h: rl('tool', (ST[x.status] || [0, '#3b82f6'])[1], esc(x.device), `${esc(x.customer)} • Hardware • ${ago(x.received_at)}`, chip(x.status)) })),
    ...r.software.map(x => ({ t: x.received_at, h: rl(x.kind === 'unlock' ? 'lock' : x.kind === 'newid' ? 'key' : 'zap', (ST[x.status] || [0, '#3b82f6'])[1], esc(x.device), `${esc(x.customer)} • ${kl[x.kind]} • ${ago(x.received_at)}`, chip(x.status)) }))].sort((a, b) => b.t - a.t).slice(0, 6);
  const parts = [];
  if (can('repairs', 'view') || can('software', 'view')) parts.push(card('Recent repairs & services', 'tool', jobs.map(j => j.h).join(''), can('repairs', 'view') ? '#/repairs' : '#/software'));
  if (can('customers', 'view')) parts.push(card('Recent customers', 'users', r.customers.map(c => rl('user', '#4f8cff', `<a href="#/customers/${c.id}">${esc(c.name)}</a>`, `${esc(c.phone)} • ${ago(c.created_at)}`)).join(''), '#/customers'));
  if (can('sales', 'view')) parts.push(card('Recent invoices', 'cart', r.sales.map(s => rl('cart', s.status === 'paid' ? '#22c55e' : '#f59e0b', `<a href="#/invoices/${s.id}">${esc(s.customer_name)}</a>`, `${esc(s.number)} • ${fdate(s.date)} • ${s.paid + .005 >= s.total ? 'paid' : 'owes ' + money(s.total - s.paid)}`, `<b>${money(s.total)}</b>`)).join(''), '#/invoices'));
  const row1 = parts.length ? `<div class="grid g3" style="margin-top:16px">${parts.join('')}</div>` : '';
  const due = r.due.map(x => { const n = x.days; const c = n === null ? '#94a3b8' : n < 0 ? '#ef4444' : n <= 1 ? '#f97316' : '#22c55e'; return rl(x.k === 'Apple ID' ? 'key' : 'lock', c, esc(x.c), `${x.k} • ${esc(x.d)}`, `<span class="chip" style="--c:${c}">${n === null ? 'No date' : n < 0 ? -n + ' overdue' : n === 0 ? 'Today' : n + ' day(s)'}</span>`); }).join('');
  const low = r.low_stock.map(p => rl('package', p.rem <= 0 ? '#ef4444' : '#f59e0b', esc(p.name), `Alert level ${p.min_stock}`, `<span class="chip" style="--c:${p.rem <= 0 ? '#ef4444' : '#f59e0b'}">${p.rem <= 0 ? 'Out' : p.rem + ' left'}</span>`)).join('');
  const act = r.activity.map(a => `<div style="--c:var(--primary)"><b>${esc(a.user || 'System')}</b> <span class="chip" style="--c:#06b6d4">${esc(a.action)}</span> ${esc(a.entity)}${a.entity_id ? ' #' + a.entity_id : ''} <small class="muted">${esc(a.detail || '')} • ${ago(a.ts)}</small></div>`).join('');
  const row2 = [];
  if (can('appleid', 'view') || can('software', 'view')) row2.push(card('Apple ID & Unlock deadlines', 'key', due));
  if (can('inventory', 'view')) row2.push(card('Low-stock alerts', 'package', low, '#/inventory'));
  row2.push(card(isAdmin() ? 'Team activity timeline' : 'My recent activity', 'activity', act ? `<div class="tl">${act}</div>` : ''));
  return row1 + `<div class="grid g3" style="margin-top:16px">${row2.join('')}</div>`;
}
/* ------------------------------------------------ profile */
V.profile = async root => {
  const me = await api('me'); S.user = me.user; const u = S.user; paintMe();
  root.innerHTML = pageHead('My Profile', 'Update your personal details') + `<div class="grid g2"><div class="card" style="text-align:center">${avatar({ ...u, online: true }, 'lg')}<h2 style="margin-top:12px">${esc(u.name)}</h2>
      <div style="margin:6px 0"><span class="chip" style="--c:var(--primary)">${esc(u.position)}</span> ${chip(u.status)}</div><p>${presence({ ...u, online: true })}</p><p class="muted">${esc(u.email)}</p>
      <div class="row" style="justify-content:center"><button class="btn" id="up">${ic('camera')} Change picture</button>${u.avatar ? `<button class="btn ghost" id="rm">${ic('trash')} Remove</button>` : ''}</div></div>
    <form class="card form" id="pf"><h3 class="full">${ic('edit')} Edit details</h3>${fi('name', 'Full name', u.name, { req: 1 })}${fi('email', 'Email', u.email, { req: 1, type: 'email' })}
      <label class="fld"><span>Position</span><input value="${esc(u.position)}" disabled></label><label class="fld"><span>Account status</span><input value="${esc(stLabel(u.status))}" disabled></label>
      <h3 class="full" style="margin-top:8px">${ic('lock')} Change password</h3>${fp('current_password', 'Current password')}${fp('new_password', 'New password (min 6)')}
      <div class="full row"><button class="btn primary">${ic('check')} Save changes</button></div></form></div>`;
  api('my_activity').then(a => root.insertAdjacentHTML('beforeend', `<div class="card" style="margin-top:16px"><h3>${ic('activity')} My recent activity</h3>${tbl([{ h: 'When', f: x => ago(x.ts) }, { h: 'Action', f: x => `<span class="chip" style="--c:#06b6d4">${esc(x.action)}</span>` }, { h: 'Item', f: x => esc(x.entity) + (x.entity_id ? ' #' + x.entity_id : '') }, { h: 'Detail', f: x => esc(x.detail || '') }], a, { empty: 'No activity yet.' })}</div>`)).catch(() => { });
  $('#up').onclick = () => pickImage(256, async img => { await safe(async () => { await api('profile_update', { avatar: img }); toast('Picture updated', 'ok'); V.profile(root); }); });
  $('#rm')?.addEventListener('click', async () => { await safe(async () => { await api('profile_update', { avatar: '' }); V.profile(root); }); });
  $('#pf').onsubmit = async e => { e.preventDefault(); await safe(async () => { const d = formData(e.target); const body = { name: d.name, email: d.email }; if (d.new_password) { body.new_password = d.new_password; body.current_password = d.current_password; }
    const r = await api('profile_update', body); S.user = r.user; if (body.new_password) S.weak = false; paintMe(); toast('Profile saved', 'ok'); V.profile(root); }); };
};

/* ------------------------------------------------ themes / settings */
V.settings = async root => {
  const adm = isAdmin(), b = S.br;
  root.innerHTML = pageHead('Themes / Settings', 'Choose how the system looks — every chart, table, form and printed document follows your theme') +
    `<div class="card" style="margin-bottom:16px"><h3>${ic('palette')} Themes</h3>${themePicker()}<label class="row" style="margin-top:14px;gap:10px;cursor:pointer"><input type="checkbox" id="glassT" ${document.documentElement.dataset.glass !== 'off' ? 'checked' : ''}> <b>Liquid Glass design</b> <span style="color:var(--muted)">translucent blurred surfaces (turn off on slow devices)</span></label></div>` +
    (adm ? `<form class="card" id="bf"><h3>${ic('shield')} Company branding & contact details</h3><div class="form">
      <div class="full row"><img data-logo style="width:84px;height:84px;object-fit:contain;border-radius:16px;background:var(--panel2);padding:6px" alt=""><button type="button" class="btn" id="lg">${ic('upload')} Change company logo</button><button type="button" class="btn ghost" id="lgr">Reset logo</button></div>
      ${fi('company_name', 'Company name', b.company_name, { req: 1 })}${fi('slogan', 'Slogan', b.slogan)}${fi('phone', 'Phone number', b.phone)}${fi('email', 'Email', b.email)}${fi('address', 'Address', b.address)}${fi('website', 'Website', b.website)}
      ${fi('social', 'Social media / contact information', b.social, { cls: 'full' })}${fi('footer', 'Footer information', b.footer, { cls: 'full' })}${fi('currency', 'Currency symbol', b.currency, { attrs: 'maxlength=4' })}
      <div class="full"><button class="btn primary">${ic('check')} Save branding</button></div></div></form>` : '');
  const setT = el => { applyTheme(el.dataset.themeId); V.settings(root); toast('Theme applied', 'ok'); };
  $('#glassT', root).onchange = e => { const on = e.target.checked; document.documentElement.dataset.glass = on ? 'on' : 'off'; try { localStorage.setItem('hic_glass', on ? 'on' : 'off'); } catch (x) { } toast(on ? 'Liquid Glass on' : 'Liquid Glass off', 'ok'); };
  $$('.theme', root).forEach(el => { el.onclick = () => setT(el); el.onkeydown = e => { if (e.key === 'Enter') setT(el); }; });
  if (adm) {
    let logo = b.logo || ''; const prev = () => { $('[data-logo]', root).src = logo || defaultLogo(); };
    $('#lg').onclick = () => pickImage(320, img => { logo = img; prev(); }); $('#lgr').onclick = () => { logo = ''; prev(); };
    $('#bf').onsubmit = async e => { e.preventDefault(); await safe(async () => { S.br = await api('settings_save', { ...formData(e.target), logo }); applyBranding(); toast('Branding saved', 'ok'); }); };
  }
};

/* ------------------------------------------------ boot */
(async function boot() {
  try { S.br = await api('branding'); } catch (e) { S.br = {}; }
  try { const me = await api('me'); await startApp(me); } catch (e) { if (!e.handled) showLogin(); }
})();
