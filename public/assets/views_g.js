/* Owner Control (System Owner only): sidebar layout, who sees each menu item, modules on/off, Super Admins */
const OWN_MODS = { ...MOD_LABEL, stores: 'Stores / suppliers', portal: 'Customer portal', finance: 'Finance' };
const OWN_MOD_NOTE = { portal: 'Also closes the customer portal website', stores: 'Stores, bills (purchases) and payments to stores', sales: 'Sales centre, invoices, quotations and customer payments', inventory: 'Items, stock adjustments and stock history', finance: 'Finance page and profit figures on the dashboard' };
const POS_LIST = ['Technician', 'Software', 'Super Admin'];

V.owner = async root => {
  const tab = root.dataset.otab || 'nav', d = await api('owner_get');
  const wireTabs = () => $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.otab = a.dataset.tab; V.owner(root); });
  const head = pageHead(`${ic('crown')} Owner Control`, 'You own the system: arrange the sidebar, decide who sees what, switch whole parts on or off and manage the Super Admins') +
    tabsBar([['nav', 'Sidebar menu', 'menu'], ['mods', 'Modules on / off', 'sliders'], ['admins', 'Super Admins', 'shield']], tab);
  if (tab === 'mods') return ownerMods(root, d, head, wireTabs);
  if (tab === 'admins') return ownerAdmins(root, d, head, wireTabs);
  ownerNav(root, d, head, wireTabs);
};

/* ---- sidebar: order, names, hide, who can see */
function ownerNav(root, d, head, wireTabs) {
  const cfg = d.nav, items = JSON.parse(JSON.stringify(cfg.items || {})), groups = { ...(cfg.groups || {}) };
  let list = navOrdered().filter(n => n[0] !== 'owner');
  const users = d.users.filter(u => !u.is_owner && u.status === 'active');
  const groupOf = k => GROUPS.find(g => g.members.includes(k));
  const who = k => { const c = items[k] || {}; if (c.hidden) return '<span class="chip" style="--c:#ef4444">Hidden from everyone</span>';
    const p = c.pos || [], us = (c.users || []).map(id => (d.users.find(u => u.id === id) || {}).name).filter(Boolean);
    return p.length || us.length ? [...p.map(x => `<span class="chip" style="--c:#8b5cf6">${esc(x)}</span>`), ...us.map(x => `<span class="chip" style="--c:#06b6d4">${esc(x)}</span>`)].join(' ') : '<span class="muted">Everyone with permission</span>'; };
  const draw = () => {
    root.innerHTML = head + `<div class="notice info" style="margin:14px 0">${ic('info')}<span>Changes apply to everyone as soon as you press <b>Save</b> — open screens update within a few seconds. You always see every item (hidden ones look faded for you), so you can never lock yourself out. A person still needs the matching <b>permission</b> (Users → Edit) to use a page.</span></div>
      <div class="card" style="margin-bottom:16px"><h3>${ic('list')} Group names</h3><div class="form">${GROUPS.map(g => fi('g_' + g.id, `${g.label} (group)`, groups[g.id] || '', { ph: g.label, attrs: 'maxlength=40 data-grp="' + g.id + '"' })).join('')}</div></div>
      <div class="card" style="padding:0"><div class="tablewrap" style="overflow:auto"><table class="tbl own-nav" style="display:table"><thead><tr><th style="width:84px">Order</th><th>Menu item</th><th>Name shown in the sidebar</th><th>Visible</th><th>Who can see it</th><th></th></tr></thead><tbody>
      ${list.map((n, i) => { const c = items[n[0]] || {}, g = groupOf(n[0]); return `<tr data-k="${n[0]}"><td><div class="acts"><button class="btn sm ico" data-up="${i}" ${i ? '' : 'disabled'} title="Move up" aria-label="Move up">${ic('up')}</button><button class="btn sm ico" data-dn="${i}" ${i < list.length - 1 ? '' : 'disabled'} title="Move down" aria-label="Move down">${ic('down')}</button></div></td>
        <td><div class="row" style="flex-wrap:nowrap">${ic(n[2])}<div><b>${esc(n[1])}</b>${g ? `<small class="muted">in ${esc(groups[g.id] || g.label)}</small>` : ''}</div></div></td>
        <td><input data-lbl="${n[0]}" value="${esc(c.label || '')}" placeholder="${esc(n[1])}" maxlength="40" style="min-width:180px"></td>
        <td><label class="sw"><input type="checkbox" data-vis="${n[0]}" ${c.hidden ? '' : 'checked'} ${ALWAYS_NAV.includes(n[0]) ? 'disabled title="Always visible"' : ''}><i></i></label></td>
        <td>${ALWAYS_NAV.includes(n[0]) ? '<span class="muted">Everyone (always)</span>' : who(n[0])}</td><td>${ALWAYS_NAV.includes(n[0]) ? '' : `<button class="btn sm" data-who="${n[0]}" ${c.hidden ? 'disabled' : ''}>${ic('users')} Choose</button>`}</td></tr>`; }).join('')}
      </tbody></table></div></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn ghost" id="nrs">${ic('refresh')} Reset to default</button><button class="btn primary" id="nsv">${ic('check')} Save sidebar</button></div>`;
    wireTabs();
    const pull = () => { $$('[data-lbl]', root).forEach(x => { const k = x.dataset.lbl, v = x.value.trim(); (items[k] ||= {}); if (v) items[k].label = v; else delete items[k].label; });
      $$('[data-vis]', root).forEach(x => { const k = x.dataset.vis; (items[k] ||= {}); if (x.checked) delete items[k].hidden; else items[k].hidden = true; });
      $$('[data-grp]', root).forEach(x => { const v = x.value.trim(); if (v) groups[x.dataset.grp] = v; else delete groups[x.dataset.grp]; }); };
    const move = (i, j) => { pull(); [list[i], list[j]] = [list[j], list[i]]; draw(); };
    $$('[data-up]', root).forEach(b => b.onclick = () => move(+b.dataset.up, +b.dataset.up - 1));
    $$('[data-dn]', root).forEach(b => b.onclick = () => move(+b.dataset.dn, +b.dataset.dn + 1));
    $$('[data-vis]', root).forEach(x => x.onchange = () => { pull(); draw(); });
    $$('[data-who]', root).forEach(b => b.onclick = () => { pull(); whoBox(b.dataset.who, items, users, draw); });
    $('#nrs').onclick = async () => { if (await confirmBox({ title: 'Reset the sidebar?', message: 'Order, names, hidden items and who-can-see rules all go back to the original layout.', confirmText: 'Reset', color: 'warn', icon: 'refresh' }))
      safe(async () => { await api('owner_nav_save', { items: {}, order: [], groups: {} }); await refreshNav(); toast('Sidebar reset', 'ok'); V.owner(root); }); };
    $('#nsv').onclick = () => safe(async () => { pull(); await api('owner_nav_save', { items, order: list.map(n => n[0]), groups }); await refreshNav(); toast('Sidebar saved — everyone sees the new menu', 'ok'); V.owner(root); });
  };
  draw();
}
function whoBox(k, items, users, redraw) {
  const c = items[k] || {}, n = NAV.find(x => x[0] === k);
  const m = modal({ title: `${ic('users')} Who can see “${esc(c.label || n[1])}”`, body: `<p class="muted" style="margin-top:0">Tick nothing to show it to <b>everyone who has permission</b>. Otherwise only the ticked roles and people see it in their sidebar (you always see it).</p>
      <h3 style="margin:10px 0 6px">By role</h3><div class="row">${POS_LIST.map(p => `<label class="row" style="gap:6px;cursor:pointer"><input type="checkbox" data-wp="${p}" ${(c.pos || []).includes(p) ? 'checked' : ''}> ${esc(p)}</label>`).join('')}</div>
      <h3 style="margin:16px 0 6px">Specific people</h3><div class="grid" style="gap:6px;max-height:42vh;overflow:auto">${users.map(u => `<label class="row" style="gap:8px;cursor:pointer;flex-wrap:nowrap"><input type="checkbox" data-wu="${u.id}" ${(c.users || []).includes(u.id) ? 'checked' : ''}>${avatar(u, 'sm', false)}<span><b>${esc(u.name)}</b> <small class="muted">${esc(u.is_admin ? 'Super Admin' : u.position)}</small></span></label>`).join('') || '<p class="muted">No other active users.</p>'}</div>`,
    footer: `<button class="btn ghost" id="wclr">Everyone</button><button class="btn" data-close>Cancel</button><button class="btn primary" id="wok">${ic('check')} Apply</button>` });
  $('#wclr', m.el).onclick = () => $$('input[type=checkbox]', m.el).forEach(x => x.checked = false);
  $('#wok', m.el).onclick = () => { const it = (items[k] ||= {}); it.pos = $$('[data-wp]:checked', m.el).map(x => x.dataset.wp); it.users = $$('[data-wu]:checked', m.el).map(x => +x.dataset.wu);
    if (!it.pos.length) delete it.pos; if (!it.users.length) delete it.users; m.close(); redraw(); toast('Applied — press Save sidebar to keep it'); };
}

/* ---- modules on/off (enforced on the server) */
function ownerMods(root, d, head, wireTabs) {
  const off = new Set(d.nav.off || []);
  root.innerHTML = head + `<div class="notice warn" style="margin:14px 0">${ic('alert')}<span>A module that is <b>off</b> disappears for everyone except you, and the server refuses every request to it — even from Super Admins. No data is deleted: switch it back on and everything is still there.</span></div>
    <div class="grid g-auto">${d.modules.map(k => `<label class="card row own-mod" style="justify-content:space-between;flex-wrap:nowrap;cursor:pointer"><div><b>${esc(OWN_MODS[k] || k)}</b><small class="muted" style="display:block">${esc(OWN_MOD_NOTE[k] || '')}</small></div><span class="sw"><input type="checkbox" data-mod="${k}" ${off.has(k) ? '' : 'checked'}><i></i></span></label>`).join('')}
      <label class="card row own-mod" style="justify-content:space-between;flex-wrap:nowrap;cursor:pointer"><div><b>Internal chat</b><small class="muted" style="display:block">Same switch as Chat Permissions</small></div><span class="sw"><input type="checkbox" id="mchat" ${d.chat_on ? 'checked' : ''}><i></i></span></label></div>
    <div class="row" style="margin-top:16px;justify-content:flex-end"><button class="btn primary" id="msv">${ic('check')} Save modules</button></div>`;
  wireTabs();
  $('#msv').onclick = () => safe(async () => { const offNow = $$('[data-mod]', root).filter(x => !x.checked).map(x => x.dataset.mod);
    await api('owner_modules_save', { off: offNow, chat: $('#mchat').checked }); await refreshNav(); toast(offNow.length ? `Saved — ${offNow.length} module(s) off` : 'Saved — every module is on', 'ok'); V.owner(root); });
}

/* ---- Super Admins */
function ownerAdmins(root, d, head, wireTabs) {
  const admins = d.users.filter(u => u.is_admin), back = () => V.owner(root);
  root.innerHTML = head + `<div class="row" style="margin:14px 0;justify-content:space-between"><p class="muted" style="margin:0">Super Admins can do everything except what is on this page. Only you can add, change, deactivate or remove them.</p><button class="btn primary" id="na">${ic('plus')} Add Super Admin</button></div>` +
    tbl([{ h: 'Person', f: u => `<div class="row" style="flex-wrap:nowrap">${avatar(u, 'sm')}<div><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div></div>` }, { h: 'Role', f: u => roleChip(u) }, { h: 'Account', f: u => chip(u.status) }, { h: 'Live status', f: u => u.status === 'active' ? `<span class="nowrap">${presence(u)}</span>` : '<span class="grey">—</span>' },
      { h: '', act: 1, f: u => u.is_owner ? '<span class="muted">You</span>' : `<div class="acts"><button class="btn sm" data-ea="${u.id}">${ic('edit')} Edit</button>${u.status === 'active' ? `<button class="btn sm warn" data-da="${u.id}">${ic('pause')} Deactivate</button>` : `<button class="btn sm ok" data-aa="${u.id}">${ic('check')} Activate</button>`}<button class="btn sm ico danger" data-xa="${u.id}" title="Remove">${ic('trash')}</button></div>` }], admins, { empty: 'No Super Admins.' }) +
    `<div class="notice info" style="margin-top:14px">${ic('info')}<span>To make an existing staff member a Super Admin (or turn a Super Admin back into staff), open <b>Users → Edit</b> and change <b>Role</b>.</span></div>`;
  wireTabs();
  const find = id => admins.find(u => u.id == id);
  $('#na').onclick = () => userForm(null, back, 'admin');
  $$('[data-ea]', root).forEach(b => b.onclick = () => userForm(find(b.dataset.ea), back));
  $$('[data-aa]', root).forEach(b => b.onclick = () => safe(async () => { await api('user_status', { id: +b.dataset.aa, status: 'active' }); toast('Super Admin activated', 'ok'); back(); }));
  $$('[data-da]', root).forEach(b => b.onclick = async () => { const u = find(b.dataset.da);
    const why = await reasonBox({ title: 'Deactivate this Super Admin?', message: `<b>${esc(u.name)}</b>`, warning: 'They lose access immediately, even if signed in right now.' });
    if (why !== null) safe(async () => { await api('user_status', { id: u.id, status: 'inactive', reason: why }); toast('Super Admin deactivated', 'ok'); back(); }); });
  $$('[data-xa]', root).forEach(b => b.onclick = async () => { const u = find(b.dataset.xa);
    if (await confirmBox({ title: 'Remove this Super Admin?', message: `Permanently delete <b>${esc(u.name)}</b>'s account? Their history is kept. Deactivating is usually better.`, confirmText: 'Delete' })) safe(async () => { await api('user_delete', { id: u.id }); toast('Super Admin removed', 'ok'); back(); }); });
}
