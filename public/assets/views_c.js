/* Users, portal management, reports, finance */
const MOD_LABEL = { customers: 'Customers', repairs: 'Hardware repairs', software: 'Software department', appleid: 'Apple ID', inventory: 'Inventory', stores: 'Stores / suppliers & bills', regional: 'Regional repairs', sales: 'Sales, quotations & invoices', expenses: 'Expenses', accounts: 'Accounts & wallets (balances, transfers)', reports: 'Reports', portal: 'Customer portal access' };
const ACT_LABEL = [['view', 'View'], ['add', 'Add'], ['edit', 'Edit'], ['status', 'Update status'], ['delete', 'Delete'], ['full', 'Full access']];
const DEF_PERMS = {
  Technician: { customers: ['view', 'add', 'edit'], repairs: ['view', 'add', 'edit', 'status'], appleid: ['view', 'add', 'edit', 'status'], inventory: ['view'], regional: ['view', 'add', 'status'], sales: ['view', 'add'] },
  Software: { customers: ['view', 'add', 'edit'], software: ['view', 'add', 'edit', 'status'], appleid: ['view', 'add', 'edit', 'status'], regional: ['view', 'add', 'edit', 'status'], sales: ['view', 'add'], inventory: ['view'] },
};
const permMatrix = p => `<table class="perm"><thead><tr><th>Module</th>${ACT_LABEL.map(a => `<th>${a[1]}</th>`).join('')}</tr></thead><tbody>${Object.entries(MOD_LABEL).map(([m, l]) => `<tr><td>${l}</td>${ACT_LABEL.map(a => `<td><input type="checkbox" data-pm="${m}" data-pa="${a[0]}" ${(p[m] || []).includes(a[0]) ? 'checked' : ''} aria-label="${l} ${a[1]}"></td>`).join('')}</tr>`).join('')}</tbody></table>`;
const readPerms = root => { const o = {}; $$('[data-pm]', root).forEach(c => { if (c.checked) (o[c.dataset.pm] ||= []).push(c.dataset.pa); }); return o; };
function wirePerms(root) {
  root.addEventListener('change', e => { const c = e.target; if (!c.dataset?.pa) return; const row = c.closest('tr');
    if (c.dataset.pa === 'full') $$('[data-pa]', row).forEach(x => { if (x !== c) x.checked = c.checked; });
    else if (!c.checked) $('[data-pa=full]', row).checked = false; });
}

/* only the System Owner manages Super Admins; nobody manages the owner (or themself) from the Users page */
const canManage = u => !u.is_owner && u.id !== S.user.id && (!u.is_admin || isOwner());
const roleName = u => u.is_owner ? 'System Owner' : u.is_admin ? 'Super Admin' : u.position;
const roleChip = u => `<span class="chip" style="--c:${u.is_owner ? '#eab308' : u.is_admin ? '#f59e0b' : u.position === 'Technician' ? '#8b5cf6' : '#06b6d4'}">${u.is_owner ? ic('crown') + ' ' : ''}${esc(roleName(u))}</span>`;

V.users = async root => {
  const tab = root.dataset.utab || 'users';
  const [users, log] = await Promise.all([api('users_list'), tab === 'log' ? api('audit_list') : []]);
  const c = { on: users.filter(u => u.online && u.status === 'active').length, off: users.filter(u => !u.online && u.status === 'active').length, act: users.filter(u => u.status === 'active').length, ina: users.filter(u => u.status === 'inactive').length, pen: users.filter(u => u.status === 'pending').length };
  root.innerHTML = pageHead('Users', 'Approve accounts, control permissions and watch live activity', `<button class="btn primary" id="nu">${ic('plus')} Add user</button>`) +
    `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Online', c.on, 'user-check', '#22c55e')}${statCard('Offline', c.off, 'user', '#ef4444')}${statCard('Active accounts', c.act, 'check-circle', '#10b981')}${statCard('Inactive accounts', c.ina, 'pause', '#f97316')}${statCard('Pending approval', c.pen, 'clock', '#f59e0b')}</div>` +
    tabsBar([['users', 'All users', 'users'], ['log', 'Activity & audit log', 'activity']], tab) + `<div class="tools">${searchBox(tab === 'users' ? 'Search name, email, position…' : 'Search activity…')}<span class="muted" data-count></span></div>` +
    (tab === 'users' ? tbl([{ h: 'User', f: u => `<div class="row" style="flex-wrap:nowrap">${avatar(u, 'sm')}<div><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div></div>` }, { h: 'Position', f: u => roleChip(u) },
      { h: 'Account', f: u => chip(u.status) + (u.status === 'inactive' && u.deactivated_at ? `<small>Deactivated ${fdt(u.deactivated_at)} • ${ago(u.deactivated_at)}${u.deactivated_by ? ' • by ' + esc(u.deactivated_by) : ''}${u.deactivate_reason ? '<br>Reason: ' + esc(u.deactivate_reason) : ''}</small>` : '') }, { h: 'Access', f: u => u.is_admin ? '<span class="chip" style="--c:#f59e0b">All functions</span>' : `<b>${Object.keys(u.perms || {}).length}</b> <small style="display:inline">of ${Object.keys(MOD_LABEL).length} modules</small>` }, { h: 'Live status', f: u => u.status === 'active' ? `<span class="nowrap">${presence(u)}</span>` : '<span class="grey">—</span>' }, { h: 'Tasks', f: u => `<b>${u.tasks}</b><small>${u.tasks30} in 30 days</small>` },
      { h: '', act: 1, f: u => !canManage(u) ? `<div class="acts"><button class="btn sm" data-vu="${u.id}">${ic('eye')} Details</button><span class="muted">${u.is_owner ? 'System Owner' : 'Super Admin'}</span></div>` : `<div class="acts"><button class="btn sm" data-vu="${u.id}">${ic('eye')} Details</button><button class="btn sm ico" data-eu="${u.id}" title="Edit & permissions">${ic('edit')}</button>${u.status === 'pending' ? `<button class="btn sm ok" data-ap="${u.id}">${ic('check')} Approve</button>` : u.status === 'active' ? `<button class="btn sm warn" data-de="${u.id}">${ic('pause')} Deactivate</button>` : `<button class="btn sm ok" data-ac="${u.id}">${ic('check')} Activate</button>`}<button class="btn sm ico danger" data-du="${u.id}" title="Delete user">${ic('trash')}</button></div>` }], users, { empty: 'No users.', attrs: u => `data-id="${u.id}"` })
      : tbl([{ h: 'When', f: l => fdt(l.ts) }, { h: 'User', f: l => esc(l.user || 'System / customer') }, { h: 'Action', f: l => `<span class="chip" style="--c:${{ delete: '#ef4444', create: '#22c55e', update: '#3b82f6', status: '#f59e0b', approve: '#10b981', deactivate: '#f97316', login: '#64748b', logout: '#64748b', reveal: '#a855f7', export: '#a855f7', hide: '#64748b' }[l.action] || '#06b6d4'}">${esc(l.action)}</span>` }, { h: 'Item', f: l => esc(l.entity) + (l.entity_id ? ' #' + l.entity_id : '') }, { h: 'Detail', f: l => esc(l.detail || '') }], log, { empty: 'No activity yet.' }));
  wireLive(root);
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.utab = a.dataset.tab; V.users(root); });
  const back = () => V.users(root), find = id => users.find(u => u.id == id);
  $('#nu').onclick = () => userForm(null, back);
  $$('[data-eu]', root).forEach(b => b.onclick = () => userForm(find(b.dataset.eu), back));
  $$('[data-ap]', root).forEach(b => b.onclick = () => safe(async () => { await api('user_status', { id: +b.dataset.ap, status: 'active' }); toast('User approved', 'ok'); back(); }));
  $$('[data-ac]', root).forEach(b => b.onclick = () => safe(async () => { await api('user_status', { id: +b.dataset.ac, status: 'active' }); toast('User activated', 'ok'); back(); }));
  $$('[data-de]', root).forEach(b => b.onclick = async () => { const u = find(b.dataset.de);
    const why = await reasonBox({ title: 'Are you sure you want to deactivate this user?', message: `<b>${esc(u.name)}</b> (${esc(u.position)})`, warning: 'Warning: the user loses access immediately — even if currently online — and will see a restricted-access page until you activate the account again. The deactivation time is recorded.' });
    if (why !== null) await safe(async () => { await api('user_status', { id: u.id, status: 'inactive', reason: why }); toast('User deactivated', 'ok'); back(); }); });
  $$('[data-vu]', root).forEach(b => b.onclick = () => userDetail(+b.dataset.vu, back));
  $$('[data-du]', root).forEach(b => b.onclick = async () => { const u = find(b.dataset.du); if (await confirmBox({ title: 'Delete user?', message: `Permanently delete <b>${esc(u.name)}</b>? Consider deactivating instead — their history is kept either way.`, confirmText: 'Delete' })) await safe(async () => { await api('user_delete', { id: u.id }); toast('User deleted', 'ok'); back(); }); });
  if (tab === 'users') every(() => { if (curRoute === 'users' && !$('.ov') && !$('[data-live]', root)?.value) V.users(root); }, 15000);
};
/* Deactivation dialog with an optional reason; resolves to the reason text, or null when cancelled */
function reasonBox({ title, message, warning }) {
  return new Promise(res => {
    let done = false; const fin = v => { if (!done) { done = true; res(v); } };
    const m = modal({ title: `${ic('alert')} ${title}`, size: 'sm', body: `<p style="margin-top:0">${message}</p><div class="notice warn" style="margin-bottom:12px">${ic('alert')}<span>${warning}</span></div><label class="fld"><span>Reason (optional)</span><input id="rsn" maxlength="200" placeholder="e.g. left the company, on leave, security"></label>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn warn" id="rok">${ic('pause')} Deactivate</button>`, onClose: () => fin(null) });
    $('#rok', m.el).onclick = () => { fin($('#rsn', m.el).value.trim()); m.close(); };
  });
}
const ENT_LABEL = { customer: 'Customers', repair: 'Hardware repairs', soft_job: 'Software jobs', appleid: 'Apple ID', product: 'Inventory', lot: 'Inventory', item: 'Inventory items', sale: 'Sales', invoice: 'Invoices', quote: 'Quotations', payment: 'Customer payments', bill: 'Store bills', store_payment: 'Store payments', expense: 'Expenses', expense_category: 'Expense categories', account: 'Money accounts', transfer: 'Account transfers', user: 'Users', portal_account: 'Customer portal', regional: 'Regional repairs', store: 'Stores', settings: 'Settings', profile: 'Profile', settlement: 'Settlements' };
const ACT_COL = { delete: '#ef4444', create: '#22c55e', update: '#3b82f6', status: '#f59e0b', approve: '#10b981', deactivate: '#f97316', activate: '#10b981', login: '#64748b', logout: '#64748b', reveal: '#a855f7', export: '#a855f7', hide: '#64748b' };
const actChip = a => `<span class="chip" style="--c:${ACT_COL[a] || '#06b6d4'}">${esc(a)}</span>`;

/* Full user file: role, functions, activity, sign-ins */
async function userDetail(id, done) {
  const d = await safe(() => api('user_detail', { id })); if (!d) return;
  const u = d.user, tab0 = 'ov';
  const perms = Object.entries(MOD_LABEL).map(([m, l]) => { const a = u.is_admin ? ['full'] : (u.perms[m] || []); const full = a.includes('full');
    return `<tr><td><b>${l}</b></td><td>${!a.length ? '<span class="chip" style="--c:#64748b">No access</span>' : full ? '<span class="chip" style="--c:#22c55e">Full access</span>' : ACT_LABEL.filter(x => x[0] !== 'full' && a.includes(x[0])).map(x => `<span class="chip" style="--c:#3b82f6">${x[1]}</span>`).join(' ')}</td></tr>`; }).join('');
  const extra = u.is_admin ? `<tr><td><b>Finance, Users, Portal, Branding</b></td><td><span class="chip" style="--c:#f59e0b">Super Admin</span></td></tr>` + (u.is_owner ? `<tr><td><b>Sidebar, modules on/off, Super Admins</b></td><td><span class="chip" style="--c:#eab308">System Owner</span></td></tr>` : '') : '';
  const pane = {
    ov: `<dl class="kv"><dt>Email</dt><dd>${esc(u.email)}</dd><dt>Role / position</dt><dd>${esc(roleName(u))}</dd><dt>Account</dt><dd>${chip(u.status)}</dd>
      <dt>Live status</dt><dd>${u.status === 'active' ? presence(u) : '<span class="muted">—</span>'}</dd><dt>Last seen</dt><dd>${u.last_seen ? fdt(u.last_seen) + ` (${ago(u.last_seen)})` : 'Never'}</dd>
      <dt>Account created</dt><dd>${u.created_at ? fdt(u.created_at) : '—'}</dd><dt>Approved by</dt><dd>${esc(u.approved_by || '—')}</dd>
      ${u.status === 'inactive' ? `<dt>Deactivated</dt><dd>${u.deactivated_at ? fdt(u.deactivated_at) + ` (${ago(u.deactivated_at)})` : '—'}${u.deactivated_by ? ' by ' + esc(u.deactivated_by) : ''}</dd><dt>Reason</dt><dd>${esc(u.deactivate_reason || '—')}</dd>` : ''}</dl>
      <h3 style="margin:16px 0 8px">${ic('list')} Work by area</h3>${d.by_entity.length ? `<div class="row">${d.by_entity.map(e => `<span class="chip" style="--c:#06b6d4">${esc(ENT_LABEL[e.entity] || e.entity)} · ${e.n}</span>`).join('')}</div>` : '<p class="muted">No recorded work yet.</p>'}`,
    fn: `<p class="muted" style="margin-top:0">${u.is_owner ? 'The System Owner can use every function and controls the whole system.' : u.is_admin ? 'The Super Admin can use every function.' :'Functions this user can open and what they may do in each.'}</p><table class="perm"><thead><tr><th>Function</th><th>Permissions</th></tr></thead><tbody>${perms}${extra}</tbody></table>`,
    act: tbl([{ h: 'When', f: l => fdt(l.ts) + `<small>${ago(l.ts)}</small>` }, { h: 'Action', f: l => actChip(l.action) }, { h: 'Function', f: l => esc(ENT_LABEL[l.entity] || l.entity) + (l.entity_id ? ' #' + l.entity_id : '') }, { h: 'Detail', f: l => esc(l.detail || '') }], d.activity, { empty: 'No activity yet.' }),
    ses: tbl([{ h: 'When', f: l => fdt(l.ts) + `<small>${ago(l.ts)}</small>` }, { h: 'Event', f: l => l.action === 'login' ? '<span class="chip" style="--c:#22c55e">Signed in</span>' : '<span class="chip" style="--c:#64748b">Signed out</span>' }], d.sessions, { empty: 'No sign-ins recorded.' }),
  };
  const m = modal({ title: `<div class="row" style="flex-wrap:nowrap">${avatar(u, 'sm')}<div><b>${esc(u.name)}</b> ${roleChip(u)} ${chip(u.status)}</div></div>`, size: 'lg',
    body: `<div class="grid g-auto" style="margin-bottom:14px">${statCard('Actions total', d.totals.all, 'activity', '#3b82f6')}${statCard('Last 30 days', d.totals.days30, 'calendar', '#8b5cf6')}${statCard('Today', d.totals.today, 'zap', '#f59e0b')}${statCard('Sign-ins', d.totals.logins, 'user-check', '#22c55e')}</div>
      <div class="tabs" id="udt">${[['ov', 'Overview', 'user'], ['fn', 'Roles & functions', 'shield'], ['act', 'Activity', 'activity'], ['ses', 'Sign-in history', 'clock']].map(t => `<a data-p="${t[0]}" class="${t[0] === tab0 ? 'on' : ''}">${ic(t[2])} ${t[1]}</a>`).join('')}</div><div id="udp" style="margin-top:14px">${pane[tab0]}</div>`,
    footer: `${!canManage(u) ? '' : `<button class="btn" id="ude">${ic('edit')} Edit & permissions</button>`}<button class="btn primary" data-close>Close</button>` });
  $$('#udt a', m.el).forEach(a => a.onclick = () => { $$('#udt a', m.el).forEach(x => x.classList.toggle('on', x === a)); $('#udp', m.el).innerHTML = pane[a.dataset.p]; wireLive($('#udp', m.el)); });
  $('#ude')?.addEventListener('click', () => { m.close(); userForm(u, done); });
}
function userForm(u, done, role0) {
  const own = isOwner(), role = u ? (u.is_admin ? 'admin' : 'staff') : (role0 || 'staff');
  const m = modal({ title: u ? `Edit ${esc(u.name)}` : role === 'admin' ? 'Add Super Admin' : 'Add user', size: 'lg', body: `<form class="form" id="uf" novalidate>${fi('name', 'Full name', u?.name, { req: 1 })}${fi('email', 'Email', u?.email, { req: 1, type: 'email' })}
    ${own ? fs('role', 'Role', [['staff', 'Staff — permissions below'], ['admin', 'Super Admin — full access']], role, { blank: false }) : ''}<span data-staff>${fs('position', 'Position', ['Technician', 'Software'], u && !u.is_admin ? u.position : 'Technician', { blank: false })}</span>${fp('password', u ? 'New password (leave blank to keep)' : 'Password (min 6)', '')}
    <div class="full" data-staff><h3 style="margin:6px 0">${ic('shield')} Permissions</h3><p class="muted" style="margin:0 0 8px">Users only see the functions you tick. Finance, Users, Stores editing and branding are Super Admin only. Tick Customer portal access to let this user approve and manage portal customers.</p><div class="tablewrap" style="overflow:auto"><div id="pm">${permMatrix(u ? u.perms : DEF_PERMS.Technician)}</div></div><button type="button" class="btn sm ghost" id="pr" style="margin-top:8px">${ic('refresh')} Reset to position defaults</button></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="us">${ic('check')} Save</button>` });
  wirePerms($('#pm'));
  const syncRole = () => { const adm = $('[name=role]', m.el)?.value === 'admin'; $$('[data-staff]', m.el).forEach(x => x.classList.toggle('hidden', adm)); };
  $('[name=role]', m.el)?.addEventListener('change', syncRole); syncRole();
  $('#pr').onclick = () => { $('#pm').innerHTML = permMatrix(DEF_PERMS[$('[name=position]', m.el).value] || {}); };
  $('#us').onclick = () => safe(async () => { const f = formData($('#uf')); await api('user_save', { ...f, id: u?.id, perms: readPerms($('#pm')) }); m.close(); toast(f.role === 'admin' ? 'Super Admin saved' : 'User saved', 'ok'); done?.(); });
}

/* ------------------------------------------------ portal management */
V.portal = async root => {
  const list = await api('portal_list'), pend = list.filter(a => a.status === 'pending').length;
  root.innerHTML = pageHead('Customer Portal Management', `A customer registers once with name + mobile number; after approval they enter with the number only${pend ? ` — <b style="color:#f59e0b">${pend} waiting</b>` : ''}`, `<a class="btn" href="/portal" target="_blank">${ic('ext')} Open portal</a>`) +
    `<div class="tools">${searchBox('Search name or phone…')}<span class="muted" data-count></span></div><div style="margin-bottom:14px">${statusChips(['pending', 'active', 'rejected', 'suspended'])}</div>` +
    tbl([{ h: 'Customer', f: a => `<b>${esc(a.name)}</b><small>${esc(a.phone)}</small>` }, { h: 'Status', f: a => chip(a.status) }, { h: 'Registered', f: a => fdate(a.created_at) }, { h: 'Last login', f: a => a.last_login ? ago(a.last_login) : '<span class="muted">Never</span>' },
      { h: 'Repairs', f: a => a.repairs || 0 }, { h: 'Current repair', f: a => esc(a.current ? a.current.replace(/ — (\w+)$/, (_, s) => ' — ' + stLabel(s)) : '—') },
      { h: '', act: 1, f: a => `<div class="acts"><button class="btn sm" data-pv="${a.id}">${ic('eye')} View</button>${a.status !== 'active' ? `<button class="btn sm ok" data-ps="${a.id}" data-to="active">${ic('check')} Approve</button>` : `<button class="btn sm warn" data-ps="${a.id}" data-to="suspended">${ic('pause')} Suspend</button>`}${a.status === 'pending' ? `<button class="btn sm danger" data-ps="${a.id}" data-to="rejected">${ic('x')} Reject</button>` : ''}</div>` }], list, { empty: 'No portal registrations yet.', attrs: a => `data-st="${a.status}"` });
  wireLive(root);
  $$('[data-ps]', root).forEach(b => b.onclick = async () => { const a = list.find(x => x.id == b.dataset.ps), to = b.dataset.to;
    if (to !== 'active' && !await confirmBox({ title: `${to === 'rejected' ? 'Reject' : 'Suspend'} ${esc(a.name)}?`, message: 'They will not be able to sign in to the customer portal.', confirmText: to === 'rejected' ? 'Reject' : 'Suspend', color: to === 'rejected' ? 'danger' : 'warn' })) return;
    await safe(async () => { await api('portal_status', { id: a.id, status: to }); toast('Account updated', 'ok'); V.portal(root); }); });
  $$('[data-pv]', root).forEach(b => b.onclick = () => safe(async () => {
    const d = await api('portal_get', { id: +b.dataset.pv }), a = d.account;
    modal({ title: `${ic('user')} ${esc(a.name)} ${chip(a.status)}`, size: 'lg', body: `<dl class="kv" style="margin-bottom:16px"><dt>Phone</dt><dd>${esc(a.phone)}</dd><dt>Email</dt><dd>${esc(a.email || '—')}</dd><dt>Registered</dt><dd>${fdt(a.created_at)}</dd><dt>Last login</dt><dd>${a.last_login ? fdt(a.last_login) + ` (${ago(a.last_login)})` : 'Never'}</dd>${a.customer_id ? `<dt>Customer file</dt><dd><a href="#/customers/${a.customer_id}" data-close>Open customer profile</a></dd>` : ''}</dl>
      <h3>${ic('tool')} Devices & repair history</h3>${tbl([{ h: 'Device', f: r => `<b>${esc(r.device)}</b>` }, { h: 'Status', f: r => chip(r.status) }, { h: 'Received', f: r => fdate(r.received_at) }, { h: 'Expected', f: r => fdate(r.expected_date) }, { h: 'Parts', f: r => esc(r.parts.map(p => `${p.product} ×${p.qty}`).join(', ') || '—') }], d.repairs, { empty: 'No repairs yet.' })}
      ${d.appleids.length ? `<h3 style="margin-top:14px">${ic('key')} Apple ID requests</h3>${tbl([{ h: 'iPhone', f: r => esc(r.model) }, { h: 'Status', f: r => chip(r.status) }, { h: 'Expected', f: r => fdate(r.expected_date) }], d.appleids)}` : ''}` });
  }));
};

/* ------------------------------------------------ finance (Super Admin) */
V.finance = async root => {
  const tab = root.dataset.ftab || 'overview', f = await api('finance'), t = f.totals;
  const pct = (a, b) => b ? Math.round((a - b) / Math.abs(b) * 100) : (a ? 100 : 0), cmp = pct(f.month.profit, f.last_month.profit);
  root.innerHTML = pageHead('Finance', 'Visible to the Super Admin only — enforced on the server', `<button class="btn" id="fp">${ic('print')} Print summary</button>`) + tabsBar([['overview', 'Overview', 'trend'], ['stores', 'Owed & owing', 'store'], ['tables', 'Daily & monthly reports', 'file']], tab) + '<div id="ft"></div>';
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.ftab = a.dataset.tab; V.finance(root); });
  const box = $('#ft');
  if (tab === 'overview') {
    box.innerHTML = `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Total income', money(t.income), 'dollar', '#4f8cff')}${statCard('Total sales', money(t.sales), 'cart', '#0ea5e9')}${statCard('Repair income', money(t.repair_income), 'tool', '#8b5cf6')}${statCard('Product / part costs', money(t.cost), 'package', '#f59e0b')}${statCard('Total expenses', money(t.expense), 'dollar', '#ef4444')}${statCard('Net profit', money(t.profit), 'trend', t.profit >= 0 ? '#22c55e' : '#ef4444')}
      ${statCard('Today profit', money(f.today.profit), 'calendar', '#14b8a6')}${statCard('This week', money(f.week.profit), 'calendar', '#06b6d4')}${statCard('This month', money(f.month.profit), 'calendar', '#10b981')}${statCard('Last month', money(f.last_month.profit), 'calendar', '#64748b')}${statCard('Owed to stores', money(f.payable), 'store', f.payable > .005 ? '#f97316' : '#22c55e')}</div>
      <div class="notice info" style="margin-bottom:16px">${ic('info')}<span>Net profit = Sales & repair income − product/part costs − expenses. This month vs last month: <b style="color:${cmp >= 0 ? '#22c55e' : '#ef4444'}">${cmp >= 0 ? '▲' : '▼'} ${Math.abs(cmp)}%</b></span></div>
      <div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>${ic('file')} Revenue & profit breakdown</h3>${(() => { const A = f.breakdown, M = f.breakdown_month, row = (l, k, sign = '', strong = false, hint = '') => `<tr${strong ? ' style="font-weight:800;border-top:2px solid var(--border)"' : ''}><td>${l}${hint ? `<small class="muted">${hint}</small>` : ''}</td><td class="right">${sign}${money(M[k])}</td><td class="right">${sign}${money(A[k])}</td></tr>`;
        return `<div class="tablewrap"><table class="tbl" style="display:table"><thead><tr><th>Item</th><th class="right">This month</th><th class="right">All time</th></tr></thead><tbody>${row('Product sales', 'product_sales', '', false, 'Physical products sold')}${row('Service sales', 'service_sales', '', false, 'Services sold on invoices')}${row('Service charges', 'service_charges', '', false, `Repair & software job payments`)}${row('Discounts', 'discounts', '−')}${row('Total revenue', 'total_revenue', '', true)}${row('Cost of goods sold', 'product_costs', '−')}${row('Parts costs', 'parts_costs', '−', false, 'Parts used in hardware & software jobs')}${row('Stock adjustments', 'adjustments', '−', false, 'Damaged, lost or counted differences')}${row('Expenses', 'expenses', '−')}${row('Net profit', 'net_profit', '', true)}</tbody></table></div>`; })()}</div>
        <div class="card"><h3>${ic('dollar')} Revenue mix (all time)</h3><div id="c5"></div></div></div>
      <div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>${ic('trend')} Daily profit — 30 days</h3><div id="c1"></div></div><div class="card"><h3>${ic('cart')} Monthly income vs expenses</h3><div id="c2"></div></div></div>
      <div class="grid g2"><div class="card"><h3>${ic('trend')} Monthly profit</h3><div id="c3"></div></div><div class="card"><h3>${ic('dollar')} Expenses by category</h3><div id="c4"></div></div></div>`;
    CH.line($('#c1'), { labels: f.daily.map(x => x.label), series: [{ name: 'Profit', values: f.daily.map(x => x.v), color: cv('--c1') }] }, { fmt: money, force: true });
    CH.bar3d($('#c2'), { labels: f.monthly.map(x => x.label), series: [{ name: 'Income', values: f.monthly.map(x => x.income), color: cv('--c5') }, { name: 'Costs + expenses', values: f.monthly.map(x => x.cost + x.expense), color: '#ef4444' }] }, { fmt: money });
    CH.bar3d($('#c3'), { labels: f.monthly.map(x => x.label), series: [{ name: 'Profit', values: f.monthly.map(x => x.v), color: cv('--c2') }] }, { fmt: money });
    CH.donut($('#c5'), [{ label: 'Product sales', v: f.breakdown.product_sales, color: cv('--c1') }, { label: 'Service sales', v: f.breakdown.service_sales, color: cv('--c3') }, { label: 'Service charges', v: f.breakdown.service_charges, color: cv('--c5') }], { fmt: money, center: 'Revenue' });
    CH.donut($('#c4'), f.expense_cats.map(x => ({ label: x.label, v: x.v })), { fmt: money, center: 'Expenses' });
  }
  if (tab === 'stores') {
    box.innerHTML = `<div class="grid g-auto" style="margin-bottom:16px">${statCard('Customers owe you', money(f.receivable), 'users', '#f59e0b')}${statCard('You owe stores', money(f.payable), 'store', f.payable > .005 ? '#ef4444' : '#22c55e')}${statCard('Stock value (cost)', money(f.stock_value), 'package', '#8b5cf6')}</div><div class="card"><h3>${ic('store')} Stores you still owe <a href="#/stores" style="margin-left:auto;font-size:13px">Open Stores ${ic('ext')}</a></h3>` + tbl([{ h: 'Store', f: s => `<b>${esc(s.name)}</b><small>${esc(s.phone || '')}</small>` }, { h: 'Purchased', f: s => money(s.billed) }, { h: 'Paid', f: s => money(s.paid) },
        { h: 'Owed', f: s => `<b style="color:#f59e0b">${money(s.owed)}</b>` }], f.stores, { empty: 'You do not owe any store. 👍' }) + '</div>';
  }
  if (tab === 'tables') {
    const mcols = [{ k: 'label', l: 'Month' }, { k: 'income', l: 'Income' }, { k: 'cost', l: 'Costs' }, { k: 'expense', l: 'Expenses' }, { k: 'v', l: 'Profit' }], dcols = [{ k: 'label', l: 'Day' }, { k: 'income', l: 'Income' }, { k: 'expense', l: 'Costs + expenses' }, { k: 'v', l: 'Profit' }];
    box.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h3>${ic('calendar')} Monthly finance</h3><button class="btn sm" id="xm">${ic('sheet')} Export Excel</button></div>` + tbl(mcols.map(c => ({ h: c.l, cls: c.k === 'label' ? '' : 'right', f: r => c.k === 'label' ? r.label : c.k === 'v' ? `<b style="color:${r.v >= 0 ? '#22c55e' : '#ef4444'}">${money(r.v)}</b>` : money(r[c.k]) })), [...f.monthly].reverse()) + `</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3>${ic('calendar')} Daily finance (30 days)</h3><button class="btn sm" id="xd">${ic('sheet')} Export Excel</button></div>` + tbl(dcols.map(c => ({ h: c.l, cls: c.k === 'label' ? '' : 'right', f: r => c.k === 'label' ? r.label : c.k === 'v' ? `<b style="color:${r.v >= 0 ? '#22c55e' : '#ef4444'}">${money(r.v)}</b>` : money(r[c.k]) })), [...f.daily].reverse()) + '</div>';
    $('#xm').onclick = () => exportXls('Monthly_finance', mcols, f.monthly); $('#xd').onclick = () => exportXls('Daily_finance', dcols, f.daily);
  }
  $('#fp').onclick = () => printTable('Finance summary', [{ k: 'l', l: 'Item' }, { k: 'v', l: 'Amount' }], [['Product sales', f.breakdown.product_sales], ['Service sales', f.breakdown.service_sales], ['Service charges', f.breakdown.service_charges], ['Discounts', -f.breakdown.discounts], ['Total revenue', f.breakdown.total_revenue], ['Product costs', f.breakdown.product_costs], ['Parts costs', f.breakdown.parts_costs], ['Total income', t.income], ['Total sales', t.sales], ['Repair income', t.repair_income], ['Product / part costs', t.cost], ['Total expenses', t.expense], ['Net profit', t.profit], ['Today profit', f.today.profit], ['This week profit', f.week.profit], ['This month profit', f.month.profit], ['Last month profit', f.last_month.profit], ['Customers owe', f.receivable], ['Owed to stores', f.payable], ['Stock value', f.stock_value]].map(([l, v]) => ({ l, v: money(v) })), 'Generated ' + fdt(nowTs()));
};
