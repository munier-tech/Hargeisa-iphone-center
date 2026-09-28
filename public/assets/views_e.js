/* System Center (Super Admin): analytics, employee activity, audit log, security, backup & recovery, health, documents settings */
const fmtBytes = b => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B';
const fmtDur = s => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
const sPill = st => `<span class="chip" style="--c:${{ ok: '#22c55e', warn: '#f59e0b', crit: '#ef4444' }[st] || '#64748b'}">${{ ok: 'OK', warn: 'Attention', crit: 'Critical' }[st] || st}</span>`;
const scoreBar = (v, mx) => `<div class="hb" style="--c:var(--primary);grid-template-columns:1fr 46px"><div class="t"><i style="width:${mx ? Math.max(3, v / mx * 100) : 0}%"></i></div><b>${v}</b></div>`;

/* ------------------------------------------------ Management Analytics */
V.analytics = async root => {
  const months = +(root.dataset.am || 12), a = await api('analytics', { months }), k = a.kpi;
  const g = k.growth;
  root.innerHTML = pageHead('Management Analytics', 'Trends and business statistics — Super Admin only', `<select name="months" aria-label="Period" style="width:auto">${[[6, 'Last 6 months'], [12, 'Last 12 months'], [24, 'Last 24 months']].map(o => `<option value="${o[0]}" ${o[0] === months ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`) +
    `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Revenue this month', money(k.revenue_month) + (g === null ? '' : ` <small style="color:${g >= 0 ? '#22c55e' : '#ef4444'}">${g >= 0 ? '▲' : '▼'} ${Math.abs(g)}%</small>`), 'dollar', '#22c55e')}${statCard('Profit this month', money(k.profit_month), 'trend', '#4f8cff')}${statCard('Repairs this month', k.repairs_month, 'tool', '#8b5cf6')}${statCard('Open repairs now', k.open_repairs, 'clock', '#f59e0b')}${statCard('Avg. repair time', k.avg_turnaround_h === null ? '—' : k.avg_turnaround_h + ' h', 'zap', '#06b6d4')}${statCard('Customers', k.total_customers, 'users', '#ec4899')}</div>
    <div class="grid g2"><div class="card"><h3>${ic('trend')} Income, expenses & profit</h3><div id="c1"></div></div><div class="card"><h3>${ic('tool')} Repairs & software jobs per month</h3><div id="c2"></div></div>
    <div class="card"><h3>${ic('users')} New customers per month</h3><div id="c3"></div></div><div class="card"><h3>${ic('dollar')} Revenue mix</h3><div id="c4"></div></div>
    <div class="card"><h3>${ic('mobile')} Most repaired devices</h3><div id="c5"></div></div><div class="card"><h3>${ic('activity')} Repair status distribution</h3><div id="c6"></div></div>
    <div class="card"><h3>${ic('calendar')} Busiest weekdays (repairs received)</h3><div id="c7"></div></div><div class="card"><h3>${ic('star' in IC ? 'star' : 'user-check')} Top customers by revenue</h3><div id="c8"></div></div></div>`;
  $('[name=months]', root).onchange = e => { root.dataset.am = e.target.value; V.analytics(root); };
  const P = pal(), lab = a.labels;
  CH.bar3d($('#c1'), { labels: lab, series: [{ name: 'Income', values: a.income, color: P[4] }, { name: 'Expenses', values: a.expense, color: P[3] }, { name: 'Profit', values: a.profit, color: P[0] }] });
  CH.line($('#c2'), { labels: lab, series: [{ name: 'Hardware repairs', values: a.repairs, color: P[0] }, { name: 'Software jobs', values: a.soft, color: P[2] }] });
  CH.bar3d($('#c3'), { labels: lab, series: [{ name: 'New customers', values: a.new_customers, color: P[5] }] });
  CH.donut($('#c4'), [{ label: 'Products', v: a.revenue_mix.products, color: P[0] }, { label: 'Services & repairs', v: a.revenue_mix.services, color: P[2] }], { fmt: money, center: 'Revenue' });
  CH.hbar($('#c5'), a.top_devices.map(x => ({ label: x.label, v: x.v })));
  CH.donut($('#c6'), a.repair_status.map(x => ({ label: stLabel(x.label), v: x.v, color: (ST[x.label] || [0, '#64748b'])[1] })), { center: 'Repairs' });
  CH.bar3d($('#c7'), { labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], series: [{ name: 'Repairs', values: a.weekday, color: P[1] }] });
  CH.hbar($('#c8'), a.top_customers.map(x => ({ label: x.label, v: Math.round(x.v) })), { empty: 'No revenue yet' });
};

/* ------------------------------------------------ Employee Activity Center */
V.employees = async root => {
  const from = root.dataset.ef || todayStr().slice(0, 8) + '01', to = root.dataset.et || todayStr();
  const r = await api('employees', { from, to }), list = r.items, mx = Math.max(1, ...list.map(x => x.score));
  const sum = k => list.reduce((a, x) => a + (+x[k] || 0), 0);
  root.innerHTML = pageHead('Employee Activity Center', 'Activity and performance of every active employee — Super Admin only', `<button class="btn" id="ep">${ic('print')} Print</button><button class="btn" id="ex">${ic('sheet')} Export Excel</button>`) +
    `<div class="card" style="margin-bottom:16px"><div class="form" style="grid-template-columns:1fr 1fr auto;align-items:end">${fi('from', 'From', r.from, { type: 'date' })}${fi('to', 'To', r.to, { type: 'date' })}<button class="btn primary" id="er">${ic('refresh')} Show</button></div></div>
    <div class="grid g-auto" style="margin-bottom:16px">${statCard('Repairs handled', sum('repairs'), 'tool', '#4f8cff')}${statCard('Repairs finished', sum('repairs_done'), 'check-circle', '#22c55e')}${statCard('Software jobs', sum('soft'), 'zap', '#8b5cf6')}${statCard('Sales made', sum('sales'), 'cart', '#f59e0b')}${statCard('Actions logged', sum('actions'), 'activity', '#06b6d4')}</div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>${ic('trend')} Performance score</h3><p class="muted" style="margin-top:0"><small>Finished repairs & software jobs ×3, sales ×2, customers registered, plus activity.</small></p><div id="sc"></div></div><div class="card"><h3>${ic('activity')} Actions per employee</h3><div id="ac"></div></div></div>
    <div class="tools">${searchBox('Search employee…')}<span class="muted" data-count></span></div>` +
    tbl([{ h: 'Employee', f: u => `<div class="row" style="flex-wrap:nowrap"><b>${esc(u.name)}</b> ${u.online ? '<span class="chip" style="--c:#22c55e">Online</span>' : ''}</div><small>${esc(u.is_admin ? 'Super Admin' : u.position)} • last seen ${u.last_seen ? ago(u.last_seen) : 'never'}</small>` },
      { h: 'Hardware repairs', f: u => `<b>${u.repairs_done}</b> / ${u.repairs}<small>finished / assigned</small>` }, { h: 'Avg. repair time', f: u => u.avg_hours === null ? '—' : u.avg_hours + ' h' },
      { h: 'Software jobs', f: u => `<b>${u.soft_done}</b> / ${u.soft}<small>finished / assigned</small>` }, { h: 'Sales', f: u => `<b>${u.sales}</b><small>${money(u.sales_value)}</small>` }, { h: 'Customers added', f: u => u.customers },
      { h: 'Actions', f: u => `<b>${u.actions}</b><small>${u.active_days} active day(s) • ${u.logins} sign-in(s)</small>` }, { h: 'Score', f: u => scoreBar(u.score, mx) },
      { h: '', act: 1, f: u => `<button class="btn sm" data-vu="${u.id}">${ic('eye')} Details</button>` }], list, { empty: 'No employees.' });
  wireLive(root);
  const cols = [{ k: 'name', l: 'Employee' }, { k: 'position', l: 'Position' }, { k: 'repairs', l: 'Repairs assigned' }, { k: 'repairs_done', l: 'Repairs finished' }, { k: 'avg_hours', l: 'Avg hours' }, { k: 'soft', l: 'Software assigned' }, { k: 'soft_done', l: 'Software finished' }, { k: 'sales', l: 'Sales' }, { k: 'sales_value', l: 'Sales value' }, { k: 'customers', l: 'Customers added' }, { k: 'actions', l: 'Actions' }, { k: 'score', l: 'Score' }];
  CH.hbar($('#sc'), [...list].sort((a, b) => b.score - a.score).map(u => ({ label: u.name, v: u.score })), { empty: 'No activity in this period' });
  CH.hbar($('#ac'), [...list].sort((a, b) => b.actions - a.actions).map(u => ({ label: u.name, v: u.actions })), { empty: 'No activity in this period' });
  $('#er').onclick = () => { root.dataset.ef = $('[name=from]', root).value; root.dataset.et = $('[name=to]', root).value; V.employees(root); };
  $('#ep').onclick = () => printTable('Employee activity report', cols, list, `${r.from} → ${r.to}`);
  $('#ex').onclick = () => exportXls('employee_activity', cols, list);
  $$('[data-vu]', root).forEach(b => b.onclick = () => userDetail(+b.dataset.vu, () => V.employees(root)));
};

/* ------------------------------------------------ Advanced Audit Log */
V.audit = async root => {
  const f = JSON.parse(root.dataset.af || '{}'), page = +(root.dataset.ap || 0), size = 50;
  const r = await api('audit_search', { ...f, limit: size, offset: page * size });
  const pages = Math.max(1, Math.ceil(r.total / size));
  root.innerHTML = pageHead('Advanced Audit Log', 'Everything users and the Super Admin do — who, what, when and from where', `<button class="btn" id="ap">${ic('print')} Print</button><button class="btn" id="ax">${ic('sheet')} Export Excel</button>`) +
    `<form class="card form" id="af2" style="margin-bottom:16px;grid-template-columns:2fr 1fr 1fr 1fr 1fr 1fr auto;align-items:end">${fi('q', 'Search', f.q || '', { ph: 'detail, item, user, IP…' })}${fs('user_id', 'User', r.users.map(u => [u.id, u.name]), f.user_id || '', { blank: 'All users' })}${fs('action', 'Action', r.actions, f.action || '', { blank: 'All actions' })}${fs('entity', 'Function', r.entities.map(e => [e, ENT_LABEL[e] || e]), f.entity || '', { blank: 'All' })}${fi('from', 'From', f.from || '', { type: 'date' })}${fi('to', 'To', f.to || '', { type: 'date' })}<button class="btn primary">${ic('search')} Filter</button></form>
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><span class="muted">${r.total.toLocaleString()} record(s)</span><div class="row"><button class="btn sm" id="pp" ${page ? '' : 'disabled'}>${ic('back')} Newer</button><span class="muted">Page ${page + 1} / ${pages}</span><button class="btn sm" id="pn" ${page + 1 < pages ? '' : 'disabled'}>Older ${ic('ext')}</button></div></div>` +
    tbl([{ h: 'When', f: l => fdt(l.ts) + `<small>${ago(l.ts)}</small>` }, { h: 'User', f: l => esc(l.user || 'System / customer') }, { h: 'Action', f: l => actChip(l.action) }, { h: 'Function', f: l => esc(ENT_LABEL[l.entity] || l.entity) + (l.entity_id ? ' #' + l.entity_id : '') }, { h: 'Detail', f: l => esc(l.detail || '—') }, { h: 'IP address', f: l => `<span class="muted">${esc(l.ip || '—')}</span>` }], r.items, { empty: 'No records match these filters.' });
  $('#af2').onsubmit = e => { e.preventDefault(); const d = formData(e.target); Object.keys(d).forEach(k => { if (!d[k]) delete d[k]; }); root.dataset.af = JSON.stringify(d); root.dataset.ap = 0; V.audit(root); };
  $('#pp').onclick = () => { root.dataset.ap = page - 1; V.audit(root); }; $('#pn').onclick = () => { root.dataset.ap = page + 1; V.audit(root); };
  const cols = [{ k: 'when', l: 'When' }, { k: 'user', l: 'User' }, { k: 'action', l: 'Action' }, { k: 'fn', l: 'Function' }, { k: 'detail', l: 'Detail' }, { k: 'ip', l: 'IP' }];
  const all = async () => (await api('audit_search', { ...f, limit: 5000, offset: 0 })).items.map(l => ({ when: new Date(l.ts * 1000).toLocaleString('en-GB'), user: l.user || 'System', action: l.action, fn: (ENT_LABEL[l.entity] || l.entity) + (l.entity_id ? ' #' + l.entity_id : ''), detail: l.detail || '', ip: l.ip || '' }));
  $('#ap').onclick = () => safe(async () => printTable('Audit log', cols, await all(), Object.keys(f).length ? 'Filtered' : 'All activity (latest 5000)'));
  $('#ax').onclick = () => safe(async () => exportXls('audit_log', cols, await all()));
};

/* ------------------------------------------------ Security & Permission Center */
V.security = async root => {
  const tab = root.dataset.stab || 'ov', d = await api('sec_overview'), s = d.settings, locked = d.fails.filter(f => f.locked).length;
  const short = ua => (/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ua ? ua.slice(0, 24) : '—') + (/Android|iPhone|iPad|Mobile/.test(ua) ? ' • phone' : '');
  const staffSess = d.sessions.filter(x => x.kind === 'staff'), custSess = d.sessions.filter(x => x.kind === 'portal');
  const body = {
    ov: `${d.default_password ? `<div class="notice warn" style="margin-bottom:14px">${ic('alert')}<span><b>The Super Admin still uses the default password.</b> Change it now in My Profile.</span></div>` : ''}
      <div class="grid g2"><form class="card" id="sp"><h3>${ic('shield')} Login & password policy</h3><div class="form">${fi('sec_min_pw', 'Minimum password length', s.min_pw, { type: 'number', attrs: 'min=6 max=64' })}${fi('sec_max_attempts', 'Failed attempts before lock-out', s.max_attempts, { type: 'number', attrs: 'min=3 max=50' })}${fi('sec_lock_min', 'Lock-out time (minutes)', s.lock_min, { type: 'number', attrs: 'min=1 max=240' })}${fi('sec_idle_min', 'Sign out after inactivity (minutes)', s.idle_min, { type: 'number', attrs: 'min=5 max=720' })}<div class="full"><button class="btn primary">${ic('check')} Save policy</button></div></div></form>
      <div class="card"><h3>${ic('lock')} What is enforced</h3><ul style="margin:0;padding-left:18px;line-height:1.9"><li>Passwords are bcrypt-hashed; Apple ID passwords use AES-256-GCM.</li><li>Every request is permission-checked <b>on the server</b>, not just hidden in the screen.</li><li>Deactivating a user ends their session immediately.</li><li>Sessions are revocable — use the Sessions tab to force a sign-out.</li><li>Failed sign-ins are counted per IP + account and lock out automatically.</li><li>Finance, users, backups and this center are Super Admin only.</li></ul></div></div>`,
    se: `<h3 style="margin:0 0 8px">${ic('user-check')} Staff sessions</h3>` + tbl([{ h: 'User', f: x => `<b>${esc(x.name)}</b>${x.current ? ' <span class="chip" style="--c:#22c55e">This session</span>' : ''}<small>${esc(x.who)}</small>` }, { h: 'Device', f: x => esc(short(x.ua)) + `<small>${esc(x.ip || '—')}</small>` }, { h: 'Signed in', f: x => fdt(x.created) }, { h: 'Last activity', f: x => ago(x.last) }, { h: 'Type', f: x => x.remember ? 'Remembered' : 'Standard' },
        { h: '', act: 1, f: x => x.current ? '' : `<div class="acts"><button class="btn sm warn" data-ks="${x.id}">${ic('logout')} Sign out</button><button class="btn sm ico danger" data-ku="${x.uid}" data-kk="staff" title="Sign this user out everywhere">${ic('x')}</button></div>` }], staffSess, { empty: 'No staff sessions.' }) +
      `<h3 style="margin:18px 0 8px">${ic('globe')} Customer portal sessions</h3>` + tbl([{ h: 'Customer', f: x => `<b>${esc(x.name)}</b><small>${esc(x.who)}</small>` }, { h: 'Device', f: x => esc(short(x.ua)) + `<small>${esc(x.ip || '—')}</small>` }, { h: 'Signed in', f: x => fdt(x.created) }, { h: 'Last activity', f: x => ago(x.last) }, { h: '', act: 1, f: x => `<button class="btn sm warn" data-ks="${x.id}">${ic('logout')} Sign out</button>` }], custSess, { empty: 'No customers signed in.' }),
    fa: `<p class="muted" style="margin-top:0">Failed sign-in attempts in the last 24 hours (staff key = IP address | email, portal key = IP | p | type). Locked entries cannot sign in until the time passes or you unlock them.</p>` + tbl([{ h: 'Source', f: f => `<code>${esc(f.k.replace('|p|', ' • portal • '))}</code>` }, { h: 'Failures', f: f => `<b>${f.n}</b>` }, { h: 'Last attempt', f: f => fdt(f.last) + `<small>${ago(f.last)}</small>` }, { h: 'State', f: f => f.locked ? '<span class="chip" style="--c:#ef4444">Locked</span>' : '<span class="chip" style="--c:#64748b">Counting</span>' }, { h: '', act: 1, f: f => `<button class="btn sm" data-un="${esc(f.k)}">${ic('lock')} Reset</button>` }], d.fails, { empty: 'No failed sign-ins in the last 24 hours. 👍' }),
    lo: tbl([{ h: 'When', f: l => fdt(l.ts) + `<small>${ago(l.ts)}</small>` }, { h: 'User', f: l => `<b>${esc(l.name || '—')}</b><small>${esc(l.email || '')}</small>` }, { h: 'Event', f: l => l.action === 'login' ? '<span class="chip" style="--c:#22c55e">Signed in</span>' : '<span class="chip" style="--c:#64748b">Signed out</span>' }, { h: 'IP address', f: l => esc(l.ip || '—') }], d.logins, { empty: 'No sign-in history yet.' }),
    pm: `<p class="muted" style="margin-top:0">Who can do what. Click a user to change their permissions.</p><div class="tablewrap" style="overflow:auto"><table class="perm"><thead><tr><th>User</th>${Object.values(MOD_LABEL).map(l => `<th>${l}</th>`).join('')}</tr></thead><tbody>${d.users.map(u => `<tr><td style="text-align:left;white-space:nowrap"><b>${esc(u.name)}</b> ${u.is_owner ? '<span class="chip" style="--c:#eab308">Owner</span>' : u.is_admin ? '<span class="chip" style="--c:#f59e0b">Admin</span>' : chip(u.status)}<br><small class="muted">${esc(u.position)}</small></td>${Object.keys(MOD_LABEL).map(m => { const a = u.is_admin ? ['full'] : (u.perms[m] || []); return `<td>${!a.length ? '<span class="muted">—</span>' : a.includes('full') ? '<span class="chip" style="--c:#22c55e">Full</span>' : `<span class="chip" style="--c:#3b82f6" title="${esc(a.join(', '))}">${a.length}/${ACT_LABEL.length - 1}</span>`}</td>`; }).join('')}${u.is_admin ? '' : ''}</tr>`).join('')}</tbody></table></div>`,
  }[tab];
  root.innerHTML = pageHead('Security & Permission Center', 'Role permissions, login security and sessions — Super Admin only') +
    `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Signed-in staff', staffSess.length, 'user-check', '#22c55e')}${statCard('Customer sessions', custSess.length, 'globe', '#06b6d4')}${statCard('Failed sign-ins (24h)', d.fails24, 'alert', d.fails24 ? '#f59e0b' : '#64748b')}${statCard('Locked sources', locked, 'lock', locked ? '#ef4444' : '#64748b')}${statCard('Active users', d.users.filter(u => u.status === 'active').length, 'users', '#4f8cff')}</div>` +
    tabsBar([['ov', 'Policy', 'shield'], ['se', 'Sessions', 'user-check'], ['fa', 'Failed sign-ins', 'alert'], ['lo', 'Sign-in history', 'clock'], ['pm', 'Permission matrix', 'users']], tab) + `<div style="margin-top:14px" id="sb2">${body}</div>`;
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.stab = a.dataset.tab; V.security(root); });
  wireLive(root);
  $('#sp')?.addEventListener('submit', e => { e.preventDefault(); safe(async () => { await api('sec_settings_save', formData(e.target)); toast('Security policy saved', 'ok'); V.security(root); }); });
  $$('[data-ks]', root).forEach(b => b.onclick = () => safe(async () => { await api('sec_kill', { sid: b.dataset.ks }); toast('Session ended', 'ok'); V.security(root); }));
  $$('[data-ku]', root).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Sign this user out everywhere?', message: 'All of their active sessions end immediately.', confirmText: 'Sign out', color: 'warn', icon: 'logout' })) safe(async () => { await api('sec_kill', { uid: +b.dataset.ku, kind: b.dataset.kk }); toast('User signed out', 'ok'); V.security(root); }); });
  $$('[data-un]', root).forEach(b => b.onclick = () => safe(async () => { await api('sec_unlock', { k: b.dataset.un }); toast('Counter reset', 'ok'); V.security(root); }));
  $$('#sb2 tbody tr', root).forEach(tr => { if (tab === 'pm') tr.style.cursor = 'pointer'; });
  if (tab === 'pm') $$('#sb2 tbody tr', root).forEach((tr, i) => tr.onclick = () => { const u = d.users[i]; if (canManage(u)) userForm(u, () => V.security(root)); });
};

/* ------------------------------------------------ Backup & Restore Center */
const bkKind = { auto: ['Automatic', '#3b82f6'], manual: ['Manual', '#22c55e'], 'pre-restore': ['Before restore', '#f59e0b'] };
const bkVer = b => b.verified_ok === 1 ? `<span class="chip" style="--c:#22c55e">Verified</span><small>${ago(b.verified_ts)}</small>` : b.verified_ok === 0 ? '<span class="chip" style="--c:#ef4444">Failed check</span>' : '<span class="chip" style="--c:#64748b">Not checked</span>';
V.backup = async root => {
  const r = await api('backup_list'), last = r.items[0], age = last ? (nowTs() - last.ts) / 3600 : null;
  root.innerHTML = pageHead('Backup & Restore Center', 'Automatic and manual backups of the whole database — Super Admin only', `<button class="btn primary" id="bn">${ic('download')} Create backup now</button>`) +
    `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Last backup', last ? ago(last.ts) : 'Never', 'clock', age === null || age > 48 ? '#ef4444' : age > 26 ? '#f59e0b' : '#22c55e')}${statCard('Backups stored', r.items.length, 'package', '#4f8cff')}${statCard('Database size', fmtBytes(r.db_size), 'file', '#8b5cf6')}${statCard('Automatic backup', r.auto ? 'ON (daily)' : 'OFF', 'refresh', r.auto ? '#22c55e' : '#f59e0b')}</div>
    <div class="grid g2" style="margin-bottom:16px"><form class="card" id="bs"><h3>${ic('sliders')} Automatic backup</h3><div class="form">${fs('auto', 'Daily automatic backup', [['on', 'On'], ['off', 'Off']], r.auto ? 'on' : 'off', { blank: false })}${fi('keep', 'Keep the newest automatic backups', r.keep, { type: 'number', attrs: 'min=3 max=90' })}<div class="full"><button class="btn primary">${ic('check')} Save</button></div></div></form>
      <div class="card"><h3>${ic('shield')} Important</h3><ul style="margin:0;padding-left:18px;line-height:1.8"><li>Backups are saved in <code style="word-break:break-all">${esc(r.dir)}</code> — copy that folder to a USB drive or another PC regularly.</li><li>Also keep a copy of <code>data\\app.key</code>: without it, encrypted Apple ID passwords cannot be read after a restore on a new PC.</li><li>Restoring first saves an automatic "before restore" copy of the current data.</li></ul></div></div>` +
    tbl([{ h: 'Backup', f: b => `<b>${esc(b.file)}</b><small>${esc(b.note || '')}</small>` }, { h: 'Type', f: b => `<span class="chip" style="--c:${(bkKind[b.kind] || ['', '#64748b'])[1]}">${(bkKind[b.kind] || [b.kind])[0]}</span>` }, { h: 'Date', f: b => fdt(b.ts) + `<small>${ago(b.ts)}${b.by ? ' • ' + esc(b.by) : ''}</small>` }, { h: 'Size', f: b => fmtBytes(b.size) }, { h: 'Check', f: bkVer },
      { h: '', act: 1, f: b => `<div class="acts"><a class="btn sm" href="/backup_download/${encodeURIComponent(b.file)}" title="Download">${ic('download')}</a><button class="btn sm" data-bv="${esc(b.file)}" title="Verify">${ic('check-circle')}</button><button class="btn sm warn" data-br="${esc(b.file)}">${ic('refresh')} Restore</button><button class="btn sm ico danger" data-bd="${esc(b.file)}" title="Delete">${ic('trash')}</button></div>` }], r.items, { empty: 'No backups yet — create the first one.' });
  $('#bn').onclick = () => { const m = modal({ title: `${ic('download')} Create backup`, size: 'sm', body: fi('note', 'Note (optional)', '', { ph: 'e.g. before month-end' }), footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="bgo">${ic('check')} Create</button>` });
    $('#bgo', m.el).onclick = () => safe(async () => { const x = await api('backup_create', { note: $('[name=note]', m.el).value }); m.close(); toast('Backup created and verified (' + fmtBytes(x.size) + ')', 'ok'); V.backup(root); }); };
  $('#bs').onsubmit = e => { e.preventDefault(); const f = formData(e.target); safe(async () => { await api('backup_settings', { auto: f.auto === 'on', keep: +f.keep }); toast('Saved', 'ok'); V.backup(root); }); };
  wireBackupActions(root, () => V.backup(root));
};
function wireBackupActions(root, back) {
  $$('[data-bv]', root).forEach(b => b.onclick = () => safe(async () => showVerify(await api('backup_verify', { file: b.dataset.bv }), b.dataset.bv, back)));
  $$('[data-bt]', root).forEach(b => b.onclick = () => safe(async () => showRecovery(await api('recovery_test', { file: b.dataset.bt }), b.dataset.bt, back)));
  $$('[data-bd]', root).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this backup?', message: `<b>${esc(b.dataset.bd)}</b>`, confirmText: 'Delete' })) safe(async () => { await api('backup_delete', { file: b.dataset.bd }); toast('Backup deleted', 'ok'); back(); }); });
  $$('[data-br]', root).forEach(b => b.onclick = () => {
    const m = modal({ title: `${ic('alert')} Restore this backup?`, size: 'sm', body: `<p style="margin-top:0"><b>${esc(b.dataset.br)}</b></p><div class="notice warn" style="margin-bottom:12px">${ic('alert')}<span>All current data will be replaced by this backup. Everything entered after it was made will be lost. A safety copy of the current data is saved first.</span></div><label class="fld"><span>Type <b>RESTORE</b> to confirm</span><input id="rc" autocomplete="off"></label>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn warn" id="rgo">${ic('refresh')} Restore now</button>` });
    $('#rgo', m.el).onclick = () => safe(async () => { const x = await api('backup_restore', { file: b.dataset.br, confirm: $('#rc', m.el).value.trim() }); m.close(); toast('Restored. Safety copy: ' + x.safety, 'ok'); back(); });
  });
}
function showVerify(v, file, back) {
  modal({ title: `${ic('check-circle')} Backup verification`, size: 'lg', body: `<div class="notice ${v.ok ? 'ok' : 'warn'}" style="margin-bottom:12px">${ic(v.ok ? 'check-circle' : 'alert')}<span><b>${v.ok ? 'This backup passed the integrity check.' : 'This backup failed the integrity check.'}</b> ${esc(file)}${v.error ? '<br>' + esc(v.error) : ''}</span></div>
    ${tbl([{ h: 'Table', f: t => esc(t.table) }, { h: 'Rows in backup', f: t => t.backup ?? '<span class="chip" style="--c:#ef4444">missing</span>' }, { h: 'Rows now (live)', f: t => t.live }, { h: 'Difference', f: t => t.backup === null || t.backup === undefined ? '—' : (t.live - t.backup === 0 ? '<span class="muted">same</span>' : `<span style="color:#f59e0b">${t.live - t.backup > 0 ? '+' : ''}${t.live - t.backup} since backup</span>`) }], v.tables)}`, footer: '<button class="btn primary" data-close>Close</button>' });
  back?.();
}
function showRecovery(v, file, back) {
  modal({ title: `${ic('shield')} Restore test`, size: 'sm', body: `<p class="muted" style="margin-top:0">The backup was restored into a temporary copy and checked. <b>Your live data was not touched.</b></p><div class="notice ${v.ok ? 'ok' : 'warn'}" style="margin-bottom:12px">${ic(v.ok ? 'check-circle' : 'alert')}<span><b>${v.ok ? 'This backup can be restored safely.' : 'Restore test FAILED — do not rely on this backup.'}</b></span></div>${v.steps.map(s => `<div class="row" style="padding:6px 0;border-top:1px solid var(--border)"><span style="color:${s.ok ? '#22c55e' : '#ef4444'}">${ic(s.ok ? 'check-circle' : 'x')}</span> ${esc(s.step)}</div>`).join('')}`, footer: '<button class="btn primary" data-close>Close</button>' });
  back?.();
}

/* ------------------------------------------------ Data Recovery Center */
V.recovery = async root => {
  const r = await api('backup_list'), ok = r.items.filter(b => b.verified_ok === 1).length, bad = r.items.filter(b => b.verified_ok === 0).length;
  root.innerHTML = pageHead('Data Recovery Center', 'Prove your backups work before you need them — verification and restore testing', '') +
    `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Verified backups', ok, 'check-circle', '#22c55e')}${statCard('Failed checks', bad, 'alert', bad ? '#ef4444' : '#64748b')}${statCard('Not yet checked', r.items.length - ok - bad, 'clock', '#f59e0b')}${statCard('Newest backup', r.items[0] ? ago(r.items[0].ts) : 'None', 'package', '#4f8cff')}</div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>${ic('check-circle')} Verify</h3><p class="muted" style="margin:0">Runs SQLite's integrity check and compares every table's row count with the live database.</p></div><div class="card"><h3>${ic('shield')} Restore test</h3><p class="muted" style="margin:0">Restores the backup into a <b>temporary copy</b>, then checks the Super Admin, settings, customers, repairs, sales, payments and inventory. Live data is never touched.</p></div></div>` +
    tbl([{ h: 'Backup', f: b => `<b>${esc(b.file)}</b><small>${fmtBytes(b.size)}</small>` }, { h: 'Type', f: b => `<span class="chip" style="--c:${(bkKind[b.kind] || ['', '#64748b'])[1]}">${(bkKind[b.kind] || [b.kind])[0]}</span>` }, { h: 'Date', f: b => fdt(b.ts) + `<small>${ago(b.ts)}</small>` }, { h: 'Last check', f: bkVer },
      { h: '', act: 1, f: b => `<div class="acts"><button class="btn sm" data-bv="${esc(b.file)}">${ic('check-circle')} Verify</button><button class="btn sm primary" data-bt="${esc(b.file)}">${ic('shield')} Restore test</button></div>` }], r.items, { empty: 'No backups to check yet. Create one in Backup & Restore.' }) +
    `<div class="card" style="margin-top:16px"><h3>${ic('info')} If the computer ever fails</h3><ol style="margin:0;padding-left:18px;line-height:1.9"><li>Install Python and copy the system folder to the new PC (or run START-SYSTEM.bat).</li><li>Copy the newest backup file into <code>data\\</code>, rename it to <code>hic.sqlite</code>, and put your saved <code>app.key</code> next to it.</li><li>Start the system — or sign in and use Backup & Restore → Restore.</li></ol></div>`;
  wireBackupActions(root, () => V.recovery(root));
};

/* ------------------------------------------------ System Health Monitor */
V.health = async root => {
  const h = await api('health'), sv = h.server, banner = { ok: ['#22c55e', 'All systems healthy'], warn: ['#f59e0b', 'Some items need attention'], crit: ['#ef4444', 'Critical problem detected'] }[h.overall];
  root.innerHTML = pageHead('System Health Monitor', 'Database, server, storage and backups — refreshes automatically', `<button class="btn" id="hr">${ic('refresh')} Refresh</button>`) +
    `<div class="card" style="--c:${banner[0]};margin-bottom:16px;border-left:5px solid ${banner[0]}"><div class="row"><span style="color:${banner[0]};font-size:26px;display:grid">${ic(h.overall === 'ok' ? 'check-circle' : 'alert')}</span><div><b style="font-size:18px">${banner[1]}</b><br><small class="muted">Checked ${fdt(sv.time)}</small></div></div></div>
    <div class="grid g-auto" style="margin-bottom:16px">${statCard('Server uptime', fmtDur(sv.uptime), 'clock', '#22c55e')}${statCard('Requests served', sv.requests.toLocaleString(), 'activity', '#4f8cff')}${statCard('Server errors', sv.errors, 'alert', sv.errors ? '#f59e0b' : '#64748b')}${statCard('Free disk', h.disk ? fmtBytes(h.disk.free) : '—', 'package', '#8b5cf6')}</div>
    <div class="grid g2"><div class="card"><h3>${ic('shield')} Checks</h3>${h.checks.map(c => `<div class="row" style="justify-content:space-between;padding:9px 0;border-top:1px solid var(--border);flex-wrap:nowrap"><div><b>${esc(c.name)}</b><br><small class="muted">${esc(c.detail)}</small></div>${sPill(c.status)}</div>`).join('')}</div>
    <div><div class="card" style="margin-bottom:16px"><h3>${ic('list')} Server</h3><dl class="kv"><dt>Python</dt><dd>${esc(sv.python)}</dd><dt>System</dt><dd>${esc(sv.os)}</dd><dt>Threads</dt><dd>${sv.threads}</dd><dt>Database file</dt><dd style="word-break:break-all">${esc(sv.db_file)}</dd></dl></div>
    <div class="card"><h3>${ic('alert')} Recent server errors</h3>${h.errors.length ? h.errors.map(e => `<div style="border-top:1px solid var(--border);padding:6px 0"><small class="muted">${fdt(e.ts)} • ${esc(e.where)}</small><br><code style="word-break:break-word">${esc(e.msg)}</code></div>`).join('') : '<p class="muted" style="margin:0">No errors since the server started. 👍</p>'}</div></div></div>
    <div class="card" style="margin-top:16px"><h3>${ic('package')} Database tables</h3><div class="row">${h.tables.map(t => `<span class="chip" style="--c:${t[1] ? '#3b82f6' : '#64748b'}">${esc(t[0])} · ${t[1].toLocaleString()}</span>`).join('')}</div></div>`;
  $('#hr').onclick = () => V.health(root);
  every(() => { if (curRoute === 'health' && !$('.ov')) V.health(root); }, 15000);
};

/* ------------------------------------------------ Settings Center (tabs) */
const oldSettings = V.settings;
V.settings = async root => {
  const tab = root.dataset.stab || 'main', adm = isAdmin();
  const wireTabs = () => $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.stab = a.dataset.tab; V.settings(root); });
  const bar = adm ? tabsBar([['main', 'Appearance & company', 'palette'], ['docs', 'Invoices & documents', 'file'], ['sys', 'System & app', 'sliders']], tab) : '';
  if (tab === 'main' || !adm) { await oldSettings(root); if (bar) { root.insertAdjacentHTML('afterbegin', bar); wireTabs(); } return; }
  if (tab === 'docs') {
    const c = await api('center_settings_get'), x = c.doc;
    root.innerHTML = pageHead('Themes / Settings', 'Invoices, receipts and printed documents') + bar + `<form class="card" id="df2" style="margin-top:14px"><h3>${ic('file')} Invoice & document settings</h3><div class="form">${fi('doc_prefix', 'Invoice number prefix', x.doc_prefix || 'INV', { attrs: 'maxlength=8' })}${fs('doc_paper', 'Paper', [['A4', 'A4 sheet'], ['thermal', '80 mm receipt printer']], x.doc_paper || 'A4', { blank: false })}${ft('doc_terms', 'Terms & conditions (printed on invoices)', x.doc_terms, { cls: 'full', ph: 'e.g. Devices not collected within 30 days are not our responsibility. Warranty covers the repaired part only.' })}${ft('doc_note', 'Extra note / thank-you line', x.doc_note, { cls: 'full' })}
      <div class="full row"><button class="btn primary">${ic('check')} Save</button><button type="button" class="btn" id="dpv">${ic('print')} Preview sample invoice</button></div></div></form>
      <div class="notice info" style="margin-top:14px">${ic('info')}<span>Company name, logo, address and currency come from <b>Appearance & company</b>. Documents open the print dialog — choose <b>Save as PDF</b> to create a PDF file.</span></div>
      <form class="card" id="acf" style="margin-top:14px"><h3>${ic('sheet')} Sales & inventory defaults</h3><div class="form">${fi('tax_rate', 'Default tax % on invoices', '', { type: 'number', attrs: 'min=0 max=100 step=0.01' })}${fi('inv_due_days', 'Invoices due after (days, 0 = on receipt)', '', { type: 'number', attrs: 'min=0 max=365' })}${fi('quote_days', 'Quotations valid for (days)', '', { type: 'number', attrs: 'min=1 max=365' })}${fi('quote_prefix', 'Quotation number prefix', '', { attrs: 'maxlength=8' })}${fi('receipt_prefix', 'Sales receipt number prefix', '', { attrs: 'maxlength=8' })}
        <label class="row full" style="gap:8px;cursor:pointer"><input type="checkbox" name="allow_negative_stock"> Allow selling more than the stock on hand (not recommended)</label><div class="full"><button class="btn primary">${ic('check')} Save defaults</button></div></div></form>`;
    wireTabs();
    api('acc_settings').then(a => { const f = $('#acf'); if (!f) return; ['tax_rate', 'inv_due_days', 'quote_days', 'quote_prefix', 'receipt_prefix'].forEach(k => $(`[name=${k}]`, f).value = a[k]); $('[name=allow_negative_stock]', f).checked = !!a.allow_negative_stock; }).catch(() => { });
    $('#acf').onsubmit = e => { e.preventDefault(); safe(async () => { await api('acc_settings_save', formData(e.target)); ACC.cfg = null; toast('Defaults saved', 'ok'); }); };
    $('#df2').onsubmit = e => { e.preventDefault(); safe(async () => { S.br = await api('doc_settings_save', formData(e.target)); toast('Document settings saved', 'ok'); }); };
    $('#dpv').onclick = () => { const f = formData($('#df2')); S.br = { ...S.br, ...f }; Docs.invoice('sale', { sale: { id: 1, customer_name: 'Sample Customer', phone: '+252 63 0000000', ts: nowTs(), date: todayStr(), total: 95, paid: 50, discount: 5, method: 'Cash', by_name: S.user.name }, items: [{ name: 'iPhone 13 screen', kind: 'product', qty: 1, unit_price: 80 }, { name: 'Software service', kind: 'service', qty: 1, unit_price: 20 }] }); };
    return;
  }
  root.innerHTML = pageHead('Themes / Settings', 'System tools and this device') + bar + `<div class="grid g2" style="margin-top:14px"><div class="card"><h3>${ic('mobile')} Use on a phone / install the app</h3><p class="muted" style="margin-top:0">Install the system on your phone or PC like an app — full screen, its own icon. On a phone open the site in Chrome/Safari, then <b>Add to Home Screen</b>.</p><button class="btn primary" id="pwa">${ic('download')} Install app on this device</button><p class="muted" style="margin-bottom:0"><small id="pwas"></small></p></div>
    <div class="card"><h3>${ic('shield')} System Center</h3><div class="grid" style="gap:8px">${[['security', 'Security & Permission Center', 'shield'], ['backup', 'Backup & Restore Center', 'download'], ['recovery', 'Data Recovery Center', 'refresh'], ['health', 'System Health Monitor', 'activity'], ['audit', 'Advanced Audit Log', 'list'], ['analytics', 'Management Analytics', 'trend'], ['employees', 'Employee Activity Center', 'users']].map(x => `<a class="btn" href="#/${x[0]}">${ic(x[2])} ${x[1]}</a>`).join('')}</div></div></div>`;
  wireTabs();
  const st = $('#pwas'); st.textContent = window.matchMedia('(display-mode: standalone)').matches ? 'This device is already running the installed app.' : (window._installEv ? 'Ready to install.' : 'If the button does nothing, use the browser menu → Install / Add to Home Screen (needs https or localhost).');
  $('#pwa').onclick = async () => { if (window._installEv) { window._installEv.prompt(); await window._installEv.userChoice; window._installEv = null; } else toast('Use your browser menu → Install app / Add to Home Screen', 'ok'); };
};
