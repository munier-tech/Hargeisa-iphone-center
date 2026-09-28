/* Customers + Hardware repairs */
const FU_TYPES = { collect_phone: 'Collect their phone', return_service: 'Return for additional service', complete_payment: 'Complete a payment', replacement_part: 'Receive a replacement part', continue_repair: 'Continue a repair', other_service: 'Receive another service', reminder: 'Reminder' };
const custLink = (id, name) => `<a href="#/customers/${id}"><b>${esc(name)}</b></a>`;
const tsOf = d => typeof d === 'number' ? d : (d ? Date.parse(d + 'T12:00:00') / 1000 : 0);
const dueBadge = d => { if (!d) return '—'; const diff = Math.round((new Date(d + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5); return `${fdate(d)} ${diff < 0 ? `<span class="chip" style="--c:#ef4444">${-diff}d overdue</span>` : diff === 0 ? '<span class="chip" style="--c:#f59e0b">Today</span>' : ''}`; };

/* ------------------------------------------------ customer-linked reminders (extends the existing follow-up / Notification Center system — not a new one) */
const REM_PRI = { low: ['Low', '#64748b'], normal: ['Normal', '#3b82f6'], high: ['High', '#f59e0b'], urgent: ['Urgent', '#ef4444'] };
const REM_PRI_OPTS = Object.entries(REM_PRI).map(([k, v]) => [k, v[0]]);
const REM_REPEAT = { none: 'Does not repeat', daily: 'Repeats daily', weekly: 'Repeats weekly', monthly: 'Repeats monthly' };
const REM_REPEAT_OPTS = Object.entries(REM_REPEAT);
const REM_BUCKET = { upcoming: ['Upcoming', '#3b82f6'], due: ['Due today', '#f59e0b'], overdue: ['Overdue', '#ef4444'], completed: ['Completed', '#22c55e'] };
const priChip = p => { const [l, c] = REM_PRI[p] || REM_PRI.normal; return `<span class="chip" style="--c:${c}">${l}</span>`; };
const remLabel = f => f.title || FU_TYPES[f.type] || f.type || 'Reminder';
const remWhen = f => f.snooze_until || f.scheduled_at || null;
const addDaysStr = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const tomorrowStr = () => addDaysStr(1);
function remBucket(f) {
  if (f.done) return 'completed';
  const t = remWhen(f); if (!t) return 'upcoming';
  const n = nowTs(); if (t <= n) return 'overdue';
  return new Date(t * 1000).toDateString() === new Date(n * 1000).toDateString() ? 'due' : 'upcoming';
}
const remBucketChip = f => { const [l, c] = REM_BUCKET[remBucket(f)]; return `<span class="chip" style="--c:${c}">${l}</span>`; };
const remWhenText = f => { const t = remWhen(f); if (!t) return f.due_date ? fdate(f.due_date) : '—';
  const txt = fdate(t) + ((f.time || f.snooze_until) ? ' ' + new Date(t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  return f.snooze_until ? `${txt} <small class="muted">(snoozed)</small>` : txt; };
const SNOOZE_OPTS = [['', 'Snooze…'], ['10m', '10 minutes'], ['30m', '30 minutes'], ['1h', '1 hour'], ['3h', '3 hours'], ['tomorrow', 'Tomorrow 9am']];
function reminderFieldsHtml(px, v = {}) {
  return `<div class="form" style="grid-template-columns:1fr 1fr">${fi(px + 'title', 'Reminder title', v.title || '', { req: 1, cls: 'full', ph: 'e.g. Call customer regarding repair' })}
    ${fi(px + 'date', 'Date', v.date || tomorrowStr(), { type: 'date', req: 1 })}${fi(px + 'time', 'Time', v.time || '10:30', { type: 'time', req: 1 })}
    ${fs(px + 'priority', 'Priority', REM_PRI_OPTS, v.priority || 'normal', { blank: false })}${fs(px + 'repeat', 'Repeat', REM_REPEAT_OPTS, v.repeat || 'none', { blank: false })}
    ${ft(px + 'note', 'Note (optional)', v.note || '', { cls: 'full' })}</div>`;
}
function readReminderFields(scope, px) {
  const g = n => $(`[name="${px}${n}"]`, scope)?.value || '';
  return { title: g('title').trim(), date: g('date'), time: g('time'), priority: g('priority') || 'normal', repeat: g('repeat') || 'none', note: g('note') };
}
/* Optional "Add a reminder" section embedded directly in the customer registration form — no need to leave the page */
function reminderToggleHtml(px) {
  return `<div class="full"><label class="row" style="gap:8px;cursor:pointer;margin:10px 0 0;font-weight:600"><input type="checkbox" name="${px}on" id="${px}on">${ic('phone')} Add a reminder for this customer</label>
    <div id="${px}box" class="hidden" style="margin-top:10px;background:var(--panel2);padding:12px;border-radius:12px">${reminderFieldsHtml(px)}</div></div>`;
}
function wireReminderToggle(scope, px) {
  const cb = $(`#${px}on`, scope), box = $(`#${px}box`, scope);
  cb.onchange = () => { box.classList.toggle('hidden', !cb.checked); const t = $(`[name="${px}title"]`, scope); if (t) t.required = cb.checked; };
}
async function maybeCreateReminder(scope, px, customerId) {
  const cb = $(`#${px}on`, scope); if (!cb || !cb.checked) return;
  const f = readReminderFields(scope, px); if (!f.title) return;
  const r = await safe(() => api('followup_save', { customer_id: customerId, title: f.title, note: f.note, due_date: f.date, time: f.time, priority: f.priority, repeat: f.repeat }));
  if (r) toast('Reminder linked to the customer', 'ok');
}
/* Add / edit one reminder for a known customer — used from the profile page, the row "Edit" action and the Reminder Center */
function reminderModal(customer, existing, done) {
  const px = 'rm_', v = existing ? { title: existing.title || '', date: existing.due_date || tomorrowStr(), time: existing.time || '10:30', priority: existing.priority || 'normal', repeat: existing.repeat_rule || 'none', note: existing.note || '' } : {};
  const m = modal({ title: `${ic('phone')} ${existing ? 'Edit reminder' : 'Add reminder'} — ${esc(customer.name)}`, size: 'sm', body: `<form id="rmf">${reminderFieldsHtml(px, v)}</form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="rmok">${ic('check')} Save reminder</button>` });
  $('#rmok', m.el).onclick = () => safe(async () => {
    const f = readReminderFields(m.el, px); if (!f.title) return toast('Enter a reminder title', 'err');
    await api('followup_save', { id: existing?.id, customer_id: customer.id, title: f.title, note: f.note, due_date: f.date, time: f.time, priority: f.priority, repeat: f.repeat });
    m.close(); toast('Reminder saved', 'ok'); done?.();
  });
}
/* Reminder Center "Add reminder": search for the customer first, then open the same modal */
function pickCustomerForReminder(done) {
  const m = modal({ title: `${ic('search')} Choose a customer for the reminder`, size: 'sm', body: `<div class="search" style="max-width:none">${ic('search')}<input type="search" id="pcq" placeholder="Type a name or phone number…" autocomplete="off"></div><div id="pcr" style="margin:10px 0"><p class="muted">Start typing to search.</p></div>` });
  const q = $('#pcq', m.el), res = $('#pcr', m.el); let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    if (q.value.trim().length < 2) { res.innerHTML = '<p class="muted">Start typing to search.</p>'; return; }
    const r = await safe(() => api('customer_find', { q: q.value })) || [];
    res.innerHTML = r.length ? r.map(c => `<div class="nt" data-go="${c.id}" data-name="${esc(c.name)}">${avatar({ name: c.name }, '', false)}<div class="grow"><b>${esc(c.name)}</b><br><small>${esc(c.phone)}</small></div></div>`).join('') : `<div class="notice info">${ic('info')}<span>No matching customer. Register them first from “Find / register customer”.</span></div>`;
    $$('[data-go]', res).forEach(el => el.onclick = () => { m.close(); reminderModal({ id: +el.dataset.go, name: el.dataset.name }, null, done); });
  }, 200); };
}
/* Shared row actions (Complete/Reopen, Snooze, Edit) for every place reminders are listed */
function remActionsCell(f) {
  if (!can('customers', 'edit')) return '';
  if (f.done) return `<button class="btn sm" data-fu="${f.id}" data-undo="1">${ic('refresh')} Reopen</button>`;
  return `<div class="acts"><button class="btn sm ok" data-fu="${f.id}">${ic('check')} Complete</button><select data-snooze="${f.id}" style="width:auto" aria-label="Snooze">${SNOOZE_OPTS.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select><button class="btn sm ico" data-edit-fu="${f.id}" title="Edit reminder">${ic('edit')}</button></div>`;
}
function wireReminderActions(root, list, refresh) {
  $$('[data-fu]', root).forEach(b => b.onclick = () => safe(async () => { await api('followup_done', { id: +b.dataset.fu, undo: b.dataset.undo === '1' }); toast(b.dataset.undo === '1' ? 'Reminder reopened' : 'Marked as done', 'ok'); refresh(); }));
  $$('[data-snooze]', root).forEach(sel => sel.onchange = () => { if (!sel.value) return; safe(async () => { await api('followup_snooze', { id: +sel.dataset.snooze, preset: sel.value }); toast('Reminder snoozed', 'ok'); refresh(); }); });
  $$('[data-edit-fu]', root).forEach(b => b.onclick = () => { const f = list.find(x => x.id == b.dataset.editFu); if (f) reminderModal({ id: f.customer_id, name: f.customer_name }, f, refresh); });
}
const REM_FILTERS = [['', 'All', '#64748b'], ['due', 'Due today', '#f59e0b'], ['overdue', 'Overdue', '#ef4444'], ['upcoming', 'Upcoming', '#3b82f6'], ['completed', 'Completed', '#22c55e']];
const remChips = () => `<div class="chips" data-chips>${REM_FILTERS.map((x, i) => `<span class="chip ${i === 0 ? 'on' : ''}" data-v="${x[0]}" style="--c:${x[2]}">${x[1]}</span>`).join('')}</div>`;

/* ------------------------------------------------ customers */
const CUST_POS = { 'Regular': '#64748b', 'VIP': '#f59e0b', 'Business': '#3b82f6', 'Dealer / Wholesale': '#8b5cf6', 'Family / Friend': '#ec4899', 'Staff': '#10b981' };
const posChip = p => `<span class="chip" style="--c:${CUST_POS[p] || '#64748b'}">${esc(p || 'Regular')}</span>`;
V.customers = async (root, param) => {
  if (param) return customerProfile(root, +param);
  const tab = root.dataset.tab || 'list';
  const [list, fus] = await Promise.all([api('customers_list'), api('followups_list')]);
  const open = fus.filter(f => !f.done);
  const canEditRem = can('customers', 'edit');
  root.innerHTML = pageHead('Customers', 'One record per customer — returning customers reuse their profile and add to their history', `${can('customers', 'add') || can('repairs', 'add') || can('software', 'add') ? `<button class="btn primary" id="nc">${ic('search')} Find / register customer</button>` : ''}${canEditRem ? `<button class="btn" id="nrem">${ic('phone')} Add reminder</button>` : ''}`) +
    tabsBar([['list', 'All customers', 'users'], ['fu', `Reminders (${open.length})`, 'phone']], tab) +
    (tab === 'list' ? `<div class="tools">${searchBox('Search by name, phone, email…')}<span class="muted" data-count></span></div>` +
      tbl([{ h: 'Customer', f: c => custLink(c.id, c.name) + `<small>${esc(c.gender || '')}</small>` }, { h: 'Position', f: c => posChip(c.position) }, { h: 'Phone', f: c => `<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>` }, { h: 'Email', f: c => esc(c.email || '—') },
        { h: 'Visits', f: c => `${c.repairs + c.software + c.appleids + c.regional + c.sales}<small>${c.repairs} hardware • ${c.software} software • ${c.appleids} Apple ID • ${c.regional} regional • ${c.sales} sales</small>` },
        { h: 'Last visit', f: c => c.last_visit ? fdate(c.last_visit) : '—' }, { h: 'Balance due', f: c => c.balance > 0.005 ? `<b style="color:#f59e0b">${money(c.balance)}</b>` : '<span class="muted">—</span>' },
        { h: 'Reminders', f: c => c.followups ? `<span class="chip" style="--c:#8b5cf6">${c.followups} pending</span>` : '—' },
        { h: '', act: 1, f: c => `<div class="acts"><a class="btn sm" href="#/customers/${c.id}">${ic('eye')} Open</a>${can('customers', 'edit') ? `<button class="btn sm ico" data-edit="${c.id}" title="Edit">${ic('edit')}</button>` : ''}${isAdmin() ? `<button class="btn sm ico danger" data-del="${c.id}" title="Delete">${ic('trash')}</button>` : ''}</div>` }], list, { empty: 'No customers yet. They are created automatically when you register a repair, or add one here.' })
      : `<div class="tools">${searchBox('Search reminders…')}<span class="muted" data-count></span></div>${remChips()}` + tbl([
        { h: 'Customer', f: f => custLink(f.customer_id, f.customer_name) + `<small>${esc(f.phone)}</small>` }, { h: 'Reminder', f: f => `<b>${esc(remLabel(f))}</b>${f.note ? `<small>${esc(f.note)}</small>` : ''}` },
        { h: 'Priority', f: f => priChip(f.priority) }, { h: 'When', f: f => remWhenText(f) }, { h: 'Status', f: f => remBucketChip(f) }, { h: 'By', f: f => esc(f.by_name || '—') },
        { h: '', act: 1, f: f => remActionsCell(f) }], fus, { empty: 'No reminders yet. Use “Add reminder” to create one for a customer.', attrs: f => `data-st="${remBucket(f)}"` }));
  wireLive(root);
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.tab = a.dataset.tab; V.customers(root); });
  $('#nc')?.addEventListener('click', () => customerFinder());
  $('#nrem')?.addEventListener('click', () => pickCustomerForReminder(() => V.customers(root)));
  $$('[data-edit]', root).forEach(b => b.onclick = () => customerForm(list.find(c => c.id == b.dataset.edit), () => V.customers(root)));
  $$('[data-del]', root).forEach(b => b.onclick = async () => { const c = list.find(x => x.id == b.dataset.del); if (await confirmBox({ title: 'Delete customer?', message: `Delete ${esc(c.name)}? This only works if they have no service history.`, confirmText: 'Delete' })) await safe(async () => { await api('customer_delete', { id: c.id }); toast('Customer deleted', 'ok'); V.customers(root); }); });
  wireReminderActions(root, fus, () => V.customers(root));
};
function customerForm(c, done) {
  const px = 'ncr_';
  const m = modal({ title: c ? 'Edit customer' : 'New customer', body: `<form class="form" id="cf">${fi('name', 'Full name', c?.name, { req: 1 })}${fi('phone', 'Phone number', c?.phone, { req: 1, type: 'tel' })}${fi('email', 'Email', c?.email, { type: 'email' })}${fs('gender', 'Gender', ['Male', 'Female', 'Other'], c?.gender || '', { blank: '— Optional —' })}${fs('position', 'Position / customer type', Object.keys(CUST_POS), c?.position || 'Regular', { blank: false })}${fi('address', 'Address', c?.address, { cls: 'full' })}${c ? '' : reminderToggleHtml(px)}</form>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="cs">${ic('check')} Save</button>` });
  if (!c) wireReminderToggle($('#cf', m.el), px);
  $('#cs').onclick = () => safe(async () => { const r = await api('customer_save', { ...formData($('#cf')), id: c?.id }); if (!c) await maybeCreateReminder($('#cf', m.el), px, r.id); m.close(); if (r.existing) toast('This phone number already belongs to an existing customer — opening their profile.', 'ok'); else toast('Customer saved', 'ok'); done?.(); if (r.existing) location.hash = '#/customers/' + r.id; });
}
/* Find-or-register: always search first so a returning customer is never duplicated */
function customerFinder() {
  const px = 'cfr_';
  const m = modal({ title: `${ic('search')} Find or register customer`, body: `<p class="muted" style="margin-top:0">Search by name or phone first. A returning customer keeps one profile — you just add the new service to it.</p>
    <div class="search" style="max-width:none">${ic('search')}<input type="search" id="cfq" placeholder="Type a name or phone number…" autocomplete="off"></div><div id="cfr" style="margin:10px 0"></div>
    <details id="cfn"><summary style="cursor:pointer;color:var(--primary2);font-weight:600">${ic('plus')} Not found — register a new customer</summary><form class="form" id="cff" style="margin-top:12px">${fi('name', 'Full name', '', { req: 1 })}${fi('phone', 'Phone number', '', { req: 1, type: 'tel' })}${fi('email', 'Email', '', { type: 'email' })}${fs('gender', 'Gender', ['Male', 'Female', 'Other'], '', { blank: '— Optional —' })}${fs('position', 'Position / customer type', Object.keys(CUST_POS), 'Regular', { blank: false })}${reminderToggleHtml(px)}<div class="full"><button class="btn primary">${ic('check')} Register customer</button></div></form></details>` });
  wireReminderToggle($('#cff', m.el), px);
  const q = $('#cfq', m.el), res = $('#cfr', m.el); let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(async () => {
    if (q.value.trim().length < 2) { res.innerHTML = ''; return; }
    const r = await safe(() => api('customer_find', { q: q.value })) || [];
    res.innerHTML = r.length ? r.map(c => `<div class="nt" data-go="${c.id}"><div class="ni" style="--c:var(--primary)">${ic('user')}</div><div class="grow"><b>${esc(c.name)}</b><br><small>${esc(c.phone)}</small></div><span class="btn sm primary">Open profile ${ic('ext')}</span></div>`).join('') : `<div class="notice info">${ic('info')}<span>No customer found — register a new one below.</span></div>`;
    if (!r.length) { $('#cfn', m.el).open = true; const isNum = /^[\d+\s-]+$/.test(q.value.trim()); $(isNum ? '[name=phone]' : '[name=name]', m.el).value = q.value.trim(); }
    $$('[data-go]', res).forEach(el => el.onclick = () => { m.close(); location.hash = '#/customers/' + el.dataset.go; });
  }, 200); };
  $('#cff', m.el).onsubmit = e => { e.preventDefault(); safe(async () => { const r = await api('customer_save', formData(e.target)); await maybeCreateReminder($('#cff', m.el), px, r.id); m.close(); toast(r.existing ? 'That phone number already belongs to an existing customer — opening their profile.' : 'Customer registered', 'ok'); location.hash = '#/customers/' + r.id; }); };
}

/* ------------------------------------------------ customer profile: the central place for everything a customer has done */
const HW_DONE = ['completed', 'took_completed', 'took_incomplete', 'failed', 'in_store'];
const SVC_ICON = { hardware: 'tool', srepair: 'zap', unlock: 'lock', newid: 'key', appleid: 'key', regional: 'globe', sale: 'cart' };
async function customerProfile(root, id) {
  const d = await api('customer_get', { id }), c = d.customer, tab = root.dataset.ctab || 'all';
  const items = [
    ...d.repairs.map(r => ({ type: 'hardware', k: 'Hardware repair', t: tsOf(r.received_at), title: r.device, sub: r.problem, st: r.status, open: !HW_DONE.includes(r.status), who: r.tech, amt: r.price - r.discount, paid: r.paid, ref: r.id, extra: r.parts ? 'Parts: ' + r.parts : '' })),
    ...d.software.map(r => ({ type: r.kind === 'repair' ? 'srepair' : r.kind, k: SK[r.kind].label, t: tsOf(r.received_at), title: r.device, sub: r.kind === 'newid' ? r.apple_id : r.kind === 'unlock' ? 'IMEI ' + (r.imei || '—') : r.problem, st: r.status, open: SK[r.kind].open.includes(r.status), who: r.tech, amt: r.price - r.discount, paid: r.paid, ref: r.id })),
    ...d.appleids.map(r => ({ type: 'appleid', k: 'Apple ID record', t: tsOf(r.date), title: r.model, sub: r.apple_id, st: r.status, open: APPLE_OPEN.includes(r.status), who: r.handled, ref: r.id })),
    ...d.regional.map(r => ({ type: 'regional', k: 'Regional repair', t: tsOf(r.date_sent), title: r.device, sub: r.problem + (r.region ? ' → ' + r.region : ''), st: r.status, open: !['collected', 'failed'].includes(r.status), who: r.handled, ref: r.id })),
    ...d.sales.map(r => ({ type: 'sale', k: KIND_L[r.kind] || 'Invoice', t: tsOf(r.date), title: r.number, sub: r.items || '', st: r.state, open: false, who: r.by_name, amt: r.total, paid: r.kind !== 'quote' ? r.paid : null, ref: r.id })),
  ].sort((a, b) => b.t - a.t);
  const svc = items.filter(i => i.type !== 'sale'), active = svc.filter(i => i.open), done = svc.filter(i => !i.open), invs = d.sales.filter(s => s.kind !== 'quote' && s.status !== 'void');
  const billed = d.repairs.filter(r => r.status !== 'failed').reduce((a, r) => a + r.price - r.discount, 0) + d.software.filter(r => r.status !== 'failed').reduce((a, r) => a + r.price - r.discount, 0) + invs.reduce((a, s) => a + s.total, 0);
  const paid = d.payments.reduce((a, p) => a + p.amount, 0), disc = d.repairs.reduce((a, r) => a + r.discount, 0) + d.software.reduce((a, r) => a + r.discount, 0) + invs.reduce((a, s) => a + s.discount, 0);
  const openIt = i => { const back = () => customerProfile(root, id); if (i.type === 'hardware') openRepair(i.ref, back); else if (['srepair', 'unlock', 'newid'].includes(i.type)) openSoft(i.ref, back); else if (i.type === 'sale') openSdoc(i.ref, back); else location.hash = i.type === 'appleid' ? '#/appleid' : '#/regional'; };
  const svcTable = (rows, empty) => tbl([{ h: 'Date', f: h => fdate(h.t) }, { h: 'Service', f: h => `${ic(SVC_ICON[h.type])} ${h.k}` }, { h: 'Device / item', f: h => `<b>${esc(h.title)}</b><small>${esc(h.sub || '')} ${esc(h.extra || '')}</small>` }, { h: 'Status', f: h => h.st ? chip(h.st) : '—' },
    { h: 'Handled by', f: h => esc(h.who || '—') }, { h: 'Amount', f: h => h.amt != null ? money(h.amt) + (h.paid != null ? `<small>paid ${money(h.paid)}</small>` : '') : '—' }, { h: '', act: 1, f: h => `<button class="btn sm" data-oi="${items.indexOf(h)}">${ic('eye')} Open</button>` }], rows, { empty });
  const TABS = [['all', 'All history', items.length], ['done', 'Completed', done.length], ['reminders', 'Reminders', d.followups.length], ['hardware', 'Hardware', d.repairs.length], ['srepair', 'Software repair', d.software.filter(x => x.kind === 'repair').length], ['unlock', 'Apple Unlock', d.software.filter(x => x.kind === 'unlock').length],
    ['newid', 'New Apple ID', d.software.filter(x => x.kind === 'newid').length], ['appleid', 'Apple ID records', d.appleids.length], ['regional', 'Regional', d.regional.length], ['sale', 'Sales', d.sales.length], ['payments', 'Payments', d.payments.length]];
  const shown = tab === 'all' ? items : tab === 'done' ? done : items.filter(i => i.type === tab);
  const canSoft = can('software', 'add'), canEditRem = can('customers', 'edit');
  const remOrder = { overdue: 0, due: 1, upcoming: 2, completed: 3 }, remSorted = [...d.followups].sort((a, b) => { const ba = remBucket(a), bb = remBucket(b); return ba !== bb ? remOrder[ba] - remOrder[bb] : (remWhen(a) || 0) - (remWhen(b) || 0); });
  const remBody = tab === 'reminders' ? `${remChips()}` + tbl([{ h: 'Reminder', f: f => `<b>${esc(remLabel(f))}</b>${f.note ? `<small>${esc(f.note)}</small>` : ''}` }, { h: 'Priority', f: f => priChip(f.priority) }, { h: 'When', f: f => remWhenText(f) },
    { h: 'Repeat', f: f => f.repeat_rule && f.repeat_rule !== 'none' ? `<span class="chip" style="--c:#06b6d4">${esc(REM_REPEAT[f.repeat_rule] || f.repeat_rule)}</span>` : '—' }, { h: 'Status', f: f => remBucketChip(f) }, { h: 'By', f: f => esc(f.by_name || '—') },
    { h: '', act: 1, f: f => remActionsCell(f) }], remSorted, { empty: 'No reminders for this customer yet.', attrs: f => `data-st="${remBucket(f)}"` }) : '';
  root.innerHTML = `<div class="page-h"><div class="row"><a class="btn ico" href="#/customers" title="Back">${ic('back')}</a><div class="row"><div class="avatar lg" style="width:64px;height:64px;font-size:22px">${esc(initials(c.name))}</div><div><h2>${esc(c.name)} ${posChip(c.position)}</h2><p>${ic('phone')} ${esc(c.phone)} ${c.email ? ` • ${ic('mail')} ${esc(c.email)}` : ''} ${c.gender ? '• ' + esc(c.gender) : ''}</p></div></div></div>
    <div class="row">${can('customers', 'edit') ? `<button class="btn" id="ce">${ic('edit')} Edit</button><button class="btn" id="fu">${ic('phone')} Add reminder</button>` : ''}</div></div>
    <div class="card" style="margin-bottom:16px"><h3>${ic('plus')} Add a new service to this customer's history</h3><div class="row">${can('repairs', 'add') ? `<button class="btn primary" id="nr">${ic('tool')} Hardware repair</button>` : ''}${canSoft ? `<button class="btn primary" data-ns="repair">${ic('zap')} Software repair</button><button class="btn primary" data-ns="unlock">${ic('lock')} Apple Unlock</button><button class="btn primary" data-ns="newid">${ic('key')} New Apple ID</button>` : ''}${can('appleid', 'add') ? `<button class="btn" id="na">${ic('key')} Apple ID record</button>` : ''}${can('sales', 'add') ? `<button class="btn" data-nd="receipt">${ic('dollar')} Sales receipt</button><button class="btn" data-nd="invoice">${ic('sheet')} Invoice</button><button class="btn" data-nd="quote">${ic('file')} Quotation</button>` : ''}</div></div>
    <div class="grid g-auto" style="margin-bottom:16px">${statCard('Current active services', active.length, 'activity', active.length ? '#f59e0b' : '#64748b')}${statCard('Completed services', done.length, 'check-circle', '#22c55e')}${statCard('Total billed', money(billed), 'dollar', '#8b5cf6')}${statCard('Paid', money(paid), 'check-circle', '#10b981')}${statCard('Balance due', money(Math.max(0, billed - paid)), 'alert', billed - paid > .005 ? '#f59e0b' : '#64748b')}${statCard('Discounts given', money(disc), 'repeat', '#06b6d4')}</div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>${ic('mobile')} Previous devices</h3>${d.devices.length ? `<div class="chips">${d.devices.map(x => `<span class="chip" style="--c:var(--primary)">${esc(x)}</span>`).join('')}</div>` : '<span class="muted">None yet</span>'}
      ${isAdmin() ? `<p class="muted" style="margin:14px 0 0">${ic('shield')} Customer Portal: ${d.portal ? `${chip(d.portal.status)} <small>${d.portal.last_login ? 'last login ' + ago(d.portal.last_login) : 'never logged in'}</small>` : '<span class="chip" style="--c:#64748b">Not registered</span>'}</p>` : ''}</div>
      <div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${ic('phone')} Reminders</h3>${d.followups.length > 6 ? `<a data-tab="reminders" style="cursor:pointer;font-size:13px;color:var(--primary2)">View all (${d.followups.length}) ${ic('ext')}</a>` : ''}</div>
        ${remSorted.length ? remSorted.slice(0, 6).map(f => `<div class="row" style="justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);gap:8px;flex-wrap:nowrap"><div class="grow"><b>${esc(remLabel(f))}</b> ${priChip(f.priority)}<br><small class="muted">${remWhenText(f)}</small></div>${!f.done && canEditRem ? `<button class="btn sm ok" data-fu="${f.id}" title="Mark done">${ic('check')}</button>` : remBucketChip(f)}</div>`).join('') : '<span class="muted">No reminders yet</span>'}</div></div>
    <div class="card" style="margin-bottom:16px"><h3>${ic('activity')} Current active services <span class="chip" style="--c:#f59e0b">${active.length}</span></h3>${svcTable(active, 'No active services right now.')}</div>
    <div class="card"><h3>${ic('clock')} Complete service history</h3>${tabsBar(TABS.map(t => [t[0], `${t[1]} (${t[2]})`]), tab)}${tab === 'payments' ? tbl([{ h: 'Date', f: p => fdate(p.date) }, { h: 'For', f: p => esc(p.device) }, { h: 'Amount', f: p => money(p.amount) }, { h: 'Method', f: p => esc(p.method) }, { h: 'Received by', f: p => esc(p.by_name || '—') }], d.payments, { empty: 'No payments recorded.' }) : tab === 'reminders' ? remBody : svcTable(shown, 'Nothing in this category yet.')}</div>`;
  const back = () => customerProfile(root, id);
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.ctab = a.dataset.tab; back(); });
  $$('[data-oi]', root).forEach(b => b.onclick = () => openIt(items[+b.dataset.oi]));
  $('#nr')?.addEventListener('click', () => repairForm(c, rid => { back(); if (rid) openRepair(rid, back); }));
  $$('[data-ns]', root).forEach(b => b.onclick = () => softForm(b.dataset.ns, c, sid => { back(); if (sid) openSoft(sid, back); }));
  $('#na')?.addEventListener('click', () => appleForm(null, c, back));
  $$('[data-nd]', root).forEach(b => b.onclick = () => sdocForm(b.dataset.nd, null, { customer: { id, name: c.name, phone: c.phone } }, back));
  $('#ce')?.addEventListener('click', () => customerForm(c, back));
  $('#fu')?.addEventListener('click', () => reminderModal({ id, name: c.name }, null, back));
  wireReminderActions(root, d.followups, back);
  if (tab === 'reminders') { const chips = $$('.chips[data-chips] .chip', root); chips.forEach(ch => ch.onclick = () => { chips.forEach(x => x.classList.toggle('on', x === ch)); $$('table.tbl tbody tr', root).forEach(tr => tr.classList.toggle('hidden', !!ch.dataset.v && tr.dataset.st !== ch.dataset.v)); }); }
}

/* ------------------------------------------------ repairs */
const FLOW = [['received', 'Received'], ['diagnosis', 'Diagnosis'], ['progress', 'Progress'], ['testing', 'Testing'], ['finishing', 'Finishing'], ['ready', 'Ready'], ['done', 'Collected']];
const flowIdx = s => ({ received: 0, diagnosis: 1, progress: 2, waiting_part: 2, parts_installed: 2, testing: 3, working: 3, not_working: 3, finishing: 4, completed: 4, ready: 5, took_completed: 6, took_incomplete: 6, in_store: 6, failed: 6 }[s] ?? 0);
const OUTCOMES = [['took_completed', 'Customer Took Phone — Completed'], ['took_incomplete', 'Customer Took Phone — Not Completed'], ['store_completed', 'In Store — Completed'], ['store_incomplete', 'In Store — Not Completed']];

V.repairs = async (root, param) => {
  const list = await api('repairs_list');
  root.innerHTML = pageHead('Hardware Repairs', 'Real-time repair progress from device received to customer collection', can('repairs', 'add') ? `<button class="btn primary" id="nr">${ic('plus')} New repair</button>` : '') +
    `<div class="tools">${searchBox('Search customer, phone, device, problem…')}<span class="muted" data-count></span></div>${repairStrip(list, [['All repairs', null, 'tool', '#4f8cff'], ...HW_GROUPS.map(g => [g[0], g[2], g[3], g[1]])])}<div style="margin-bottom:14px">${statusChips(REPAIR_LIST, '', HW_GROUPS)}</div>` +
    tbl([{ h: '#', f: r => '#' + r.id }, { h: 'Customer', f: r => custLink(r.customer_id, r.customer_name) + `<small>${esc(r.phone)}</small>` }, { h: 'Device', f: r => `<b>${esc(r.device)}</b><small>${esc(r.problem || '')}</small>` },
      { h: 'Status', f: r => chip(r.status) }, { h: 'Technician', f: r => esc(r.tech || '—') }, { h: 'Received', f: r => fdate(r.received_at) + `<small>${ago(r.received_at)}</small>` },
      { h: 'Expected', f: r => fdate(r.expected_date) }, { h: 'Balance', f: r => { const b = r.price - r.discount - r.paid; return r.price ? (b > .005 ? `<b style="color:#f59e0b">${money(b)}</b>` : '<span class="chip" style="--c:#22c55e">Paid</span>') : '—'; } },
      { h: '', act: 1, f: r => `<div class="acts"><button class="btn sm primary" data-open="${r.id}">${ic('eye')} Open</button></div>` }], list, { empty: 'No repairs yet.', attrs: r => `data-st="${r.status}"` });
  wireLive(root); wireStrip(root);
  if (param && !root.dataset.opened) { root.dataset.opened = '1'; openRepair(+param, () => V.repairs(root)); }
  $('#nr')?.addEventListener('click', () => repairForm(null, id => { V.repairs(root); if (id) openRepair(id, () => V.repairs(root)); }));
  $$('[data-open]', root).forEach(b => b.onclick = () => openRepair(+b.dataset.open, () => V.repairs(root)));
  every(() => { if (curRoute === 'repairs' && !$('.ov') && !$('[data-live]', root)?.value) V.repairs(root); }, 20000);
};
function repairForm(c, done) {
  const m = modal({ title: 'Register device for repair', size: 'lg', body: `<form class="form" id="rf">${custPicker(c || {})}${fi('device', 'Device / iPhone model', '', { req: 1, ph: 'e.g. iPhone 15 Pro' })}${fi('imei', 'IMEI / serial', '')}${ft('problem', 'Fault / problem reported', '', { cls: 'full' })}
    ${fs('technician_id', 'Technician', staffOpts(), '', { blank: 'Assign later' })}${fi('expected_date', 'Expected ready date', '', { type: 'date' })}${fi('price', 'Estimated charge', '', { type: 'number', attrs: 'min=0 step=0.01' })}</form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="rs">${ic('check')} Receive device</button>`, onOpen: mm => wireCust(mm.el) });
  $('#rs').onclick = () => safe(async () => { const f = formData($('#rf')); const r = await api('repair_save', f); m.close(); toast(r.existing_customer ? 'Existing customer reused — repair added to their history' : 'New customer created and repair registered', 'ok'); done?.(r.id); });
}
async function openRepair(id, onChange) {
  const partItems = async () => (await api('items_list').catch(() => [])).filter(i => i.type !== 'service');
  const products = can('repairs', 'edit') ? await partItems() : [], accts = can('repairs', 'edit') ? await payAccounts() : [];
  const m = modal({ title: 'Repair', size: 'lg', body: '<div id="rb"><div class="empty">Loading…</div></div>' });
  const load = async () => {
    const d = await api('repair_get', { id }), r = d.repair, adm = isAdmin(), ed = can('repairs', 'edit'), stc = can('repairs', 'status');
    $('h3', m.box).innerHTML = `${ic('tool')} ${esc(r.device)} <span class="muted">#${r.id}</span> ${chip(r.status)}`;
    const fi_ = flowIdx(r.status), col = (ST[r.status] || [0, '#3b82f6'])[1], charge = r.price - r.discount, paid = d.payments.reduce((a, p) => a + p.amount, 0);
    $('#rb').innerHTML = `<div class="row" style="justify-content:space-between"><div><b>${custLink(r.customer_id, r.customer_name)}</b> • ${ic('phone')} ${esc(r.phone)} ${r.imei ? '• IMEI ' + esc(r.imei) : ''}<br><small class="muted">Received ${fdt(r.received_at)} by ${esc(r.created_name || '—')} • Technician: ${esc(r.tech || 'unassigned')}</small></div><button class="btn" id="rdoc">${ic('file')} Documents</button></div>
      <div class="stepper" style="--c:${col}">${FLOW.map((s, i) => `<div class="step ${i < fi_ ? 'done' : ''} ${i === fi_ ? 'now' : ''}"><i>${i < fi_ ? '✓' : i + 1}</i>${s[1]}</div>`).join('')}</div>
      ${stc ? `<div class="card" style="background:var(--panel2);margin-bottom:14px"><h3>${ic('zap')} Update progress</h3><div class="form" id="sf">${fs('status', 'New status', REPAIR_LIST.map(k => [k, stLabel(k)]), r.status, { blank: false })}${fi('note', 'Note (optional)', '')}
        ${fs('outcome', 'Customer outcome', OUTCOMES, r.outcome || '', { blank: '— Not decided —' })}${fi('test_result', 'Test result', r.test_result || '', { ph: 'Working / Not working — details' })}<div class="full"><button class="btn primary" id="su">${ic('check')} Apply status</button></div></div></div>` : ''}
      <div class="grid g2"><div class="card"><h3>${ic('edit')} Diagnosis & work</h3>${ed ? `<form class="form" id="df" style="grid-template-columns:1fr">${ft('problem', 'Fault / problem', r.problem)}${ft('diagnosis', 'Diagnosis', r.diagnosis)}${ft('diagnosis_notes', 'Diagnosis notes', r.diagnosis_notes)}${fi('required_parts', 'Required parts', r.required_parts)}${ft('progress_notes', 'Technician / progress notes', r.progress_notes)}
        ${fs('technician_id', 'Technician', staffOpts(), r.technician_id || '', { blank: 'Unassigned' })}${fi('expected_date', 'Expected ready date', r.expected_date || '', { type: 'date' })}<div class="form">${fi('price', 'Charge', r.price, { type: 'number', attrs: 'min=0 step=0.01' })}${fi('discount', 'Discount', r.discount, { type: 'number', attrs: 'min=0 step=0.01' })}</div><input type="hidden" name="device" value="${esc(r.device)}"><div><button class="btn primary">${ic('check')} Save details</button></div></form>`
        : `<dl class="kv"><dt>Problem</dt><dd>${esc(r.problem || '—')}</dd><dt>Diagnosis</dt><dd>${esc(r.diagnosis || '—')}</dd><dt>Notes</dt><dd>${esc(r.diagnosis_notes || '—')}</dd><dt>Progress</dt><dd>${esc(r.progress_notes || '—')}</dd></dl>`}</div>
      <div><div class="card" style="margin-bottom:16px"><h3>${ic('package')} Parts used</h3>${d.parts.length ? tbl([{ h: 'Part', f: p => `<b>${esc(p.product)}</b>` }, { h: 'Qty', f: p => '× ' + fq(p.qty) }, { h: 'Added by', f: p => esc(p.by_name || '—') + `<small>${ago(p.ts)}</small>` }, ...(adm ? [{ h: 'Cost', f: p => money(p.unit_cost * p.qty) }] : []), { h: '', act: 1, f: p => ed ? `<button class="btn sm ico danger" data-rp="${p.id}" title="Remove & return to stock">${ic('trash')}</button>` : '' }], d.parts).replace('tablewrap', 'tablewrap" style="margin-bottom:10px') : '<p class="muted">No parts recorded yet.</p>'}
        ${ed ? `<div class="form" id="pf" style="grid-template-columns:3fr 1fr auto;align-items:end;margin-top:10px">${fs('product_id', 'Part', products.map(p => [p.id, `${p.name} (${p.type === 'inventory' ? fq(p.qty) + ' in stock' : 'non-stock'})`]), '', { blank: 'Select part…' })}${fi('qty', 'Qty', 1, { type: 'number', attrs: 'min=1' })}<button class="btn primary" id="pa" title="Add part">${ic('plus')}</button></div><small class="muted">Stock items are taken out of inventory automatically.</small>` : ''}</div>
      <div class="card"><h3>${ic('dollar')} Payments</h3><dl class="kv" style="grid-template-columns:110px 1fr"><dt>Charge</dt><dd>${money(charge)} ${r.discount ? `<small class="muted">(after ${money(r.discount)} discount)</small>` : ''}</dd><dt>Paid</dt><dd>${money(paid)}</dd><dt>Balance</dt><dd style="color:${charge - paid > .005 ? '#f59e0b' : '#22c55e'}">${money(Math.max(0, charge - paid))}</dd></dl>
        ${d.payments.length ? `<div style="margin-top:8px">${d.payments.map(p => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--border);padding:6px 0"><span>${fdate(p.date)} • ${esc(p.method)} <small class="muted">by ${esc(p.by_name || '')}</small></span><b>${money(p.amount)}</b></div>`).join('')}</div>` : ''}
        ${ed ? `<div class="form" id="pyf" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end;margin-top:10px">${fi('amount', 'Amount', Math.max(0, charge - paid) || '', { type: 'number', attrs: 'min=0 step=0.01' })}${fs('method', 'Method', ['Cash', 'ZAAD', 'eDahab', 'EVC / Mobile money', 'Bank transfer', 'Card'], 'Cash', { blank: false })}${acctField(accts)}<button class="btn ok" id="py">${ic('check')} Record</button></div>` : ''}</div></div></div>
      <div class="card" style="margin-top:16px"><h3>${ic('clock')} Progress timeline</h3><div class="tl">${d.events.map(e => `<div style="--c:${(ST[e.status] || [0, '#64748b'])[1]}">${chip(e.status)} <small class="muted">${fdt(e.ts)} • ${esc(e.by_name || '')}</small>${e.note ? `<div>${esc(e.note)}</div>` : ''}</div>`).join('')}</div></div>
      ${can('repairs', 'delete') ? `<div style="margin-top:14px;text-align:right"><button class="btn danger sm" id="rdel">${ic('trash')} Delete repair</button></div>` : ''}`;
    const rb = $('#rb'), reload = async () => { await load(); onChange?.(); };
    $('#rdoc')?.addEventListener('click', () => Docs.chooser('repair', d));
    $('#su')?.addEventListener('click', () => safe(async () => { await api('repair_status', { ...formData($('#sf')), id }); toast('Status updated', 'ok'); reload(); }));
    $('#df')?.addEventListener('submit', e => { e.preventDefault(); safe(async () => { await api('repair_save', { ...formData(e.target), id }); toast('Details saved', 'ok'); reload(); }); });
    $('#pa')?.addEventListener('click', () => safe(async () => { const f = formData($('#pf')); if (!f.product_id) return toast('Select a part first', 'err'); await api('repair_part_add', { ...f, repair_id: id }); toast('Part added — stock deducted', 'ok'); const fresh = await partItems(); products.splice(0, products.length, ...fresh); reload(); }));
    $$('[data-rp]', rb).forEach(b => b.onclick = () => safe(async () => { if (!await confirmBox({ title: 'Remove this part?', message: 'The quantity goes back into stock.', confirmText: 'Remove', color: 'warn' })) return; await api('repair_part_remove', { id: +b.dataset.rp }); const fresh = await partItems(); products.splice(0, products.length, ...fresh); reload(); }));
    syncAcct($('#pyf') || document.createElement('div'));
    $('#py')?.addEventListener('click', () => safe(async () => { await api('repair_payment_add', { ...formData($('#pyf')), repair_id: id }); toast('Payment recorded', 'ok'); reload(); }));
    $('#rdel')?.addEventListener('click', async () => { if (await confirmBox({ title: 'Delete this repair?', message: 'Parts used are returned to stock. This cannot be undone.', confirmText: 'Delete' })) await safe(async () => { await api('repair_delete', { id }); m.close(); onChange?.(); }); });
  };
  await safe(load);
}
