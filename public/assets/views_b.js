/* Apple ID, inventory, stores, regional, sales, expenses */

/* ------------------------------------------------ Apple ID */
const APPLE_OPEN = ['request', 'received', 'progress'];
function daysCell(r) {
  if (!APPLE_OPEN.includes(r.status) || r.days_left === null || r.days_left === undefined) return '<span class="muted">—</span>';
  const n = r.days_left;
  if (n < 0) return `<span class="chip" style="--c:#ef4444">${-n} Day${n === -1 ? '' : 's'} Overdue</span>`;
  if (n === 0) return '<span class="chip" style="--c:#f97316">Due Today</span>';
  return `<span class="chip" style="--c:${n <= 3 ? '#f59e0b' : '#22c55e'}">${n} Day${n === 1 ? '' : 's'} Remaining</span>`;
}
const APPLE_XLS = [{ k: 'customer_name', l: 'Customer' }, { k: 'phone', l: 'Phone' }, { k: 'model', l: 'iPhone model' }, { k: 'apple_id', l: 'Apple ID' }, { k: 'password', l: 'Apple ID password' }, { k: 'description', l: 'Description' }, { k: 'date', l: 'Date' }, { k: 'status_l', l: 'Status' }, { k: 'expected_date', l: 'Expected date' }, { k: 'created_name', l: 'Entered by' }];

V.appleid = async root => {
  const list = await api('appleid_list'), adm = isAdmin();
  root.innerHTML = pageHead('Apple ID Requests', 'Secure Apple ID records, request tracking and printable documents',
    `<button class="btn" id="pa" title="Print all visible records">${ic('print')} Print all</button><button class="btn" id="xl" title="Export visible records to Excel">${ic('sheet')} Export Excel</button>${can('appleid', 'add') ? `<button class="btn primary" id="na">${ic('plus')} New request</button>` : ''}`) +
    `<div class="tools">${searchBox('Search customer, phone, model, Apple ID, user…')}<span class="muted" data-count></span></div><div style="margin-bottom:14px">${statusChips(APPLE_LIST)}</div>` +
    tbl([{ h: 'Customer', f: r => custLink(r.customer_id, r.customer_name) + (r.hidden ? ` <span class="chip" style="--c:#64748b" title="Hidden from other users">Hidden</span>` : '') + `<small>${esc(r.phone || '')}</small>` }, { h: 'iPhone', f: r => `<b>${esc(r.model)}</b><small>${esc(r.description || '')}</small>` },
      { h: 'Apple ID', f: r => esc(r.apple_id) }, { h: 'Password', f: r => `<span class="nowrap"><span data-pwv="${r.id}" style="font-family:Consolas,monospace">••••••••</span> <button class="btn sm ico ghost" data-pw="${r.id}" title="Show password">${ic('eye')}</button></span>` },
      { h: 'Status', f: r => chip(r.status) + (r.assigned_name ? `<small>Assigned: ${esc(r.assigned_name)}</small>` : '') }, { h: 'Expected', f: r => `${fdate(r.expected_date)}<small>${daysCell(r)}</small>` },
      { h: 'Entered by', f: r => `${esc(r.created_name || '—')}<small>${fdate(r.date)}</small>` },
      { h: 'Actions', act: 1, f: r => `<div class="acts"><button class="btn sm ico" data-print="${r.id}" title="Print">${ic('print')}</button>${can('appleid', 'status') ? `<button class="btn sm ico" data-ust="${r.id}" title="Update status">${ic('zap')}</button>` : ''}${can('appleid', 'edit') ? `<button class="btn sm ico" data-ed="${r.id}" title="Edit">${ic('edit')}</button>` : ''}${can('appleid', 'delete') ? `<button class="btn sm ico danger" data-dl="${r.id}" title="Delete">${ic('trash')}</button>` : ''}${adm ? `<button class="btn sm ico" data-hide="${r.id}" title="${r.hidden ? 'Unhide' : 'Hide from other users'}">${ic(r.hidden ? 'eye' : 'eye-off')}</button>` : ''}</div>` }],
      list, { empty: 'No Apple ID records yet.', attrs: r => `data-st="${r.status}" data-id="${r.id}"` });
  wireLive(root);
  const visibleIds = () => $$('tbody tr[data-id]:not(.hidden)', root).map(t => +t.dataset.id);
  const full = async ids => (await api('appleid_full', { ids })).map(r => ({ ...r, status_l: stLabel(r.status) }));
  $('#pa').onclick = () => safe(async () => { const ids = visibleIds(); if (!ids.length) return toast('Nothing to print', 'err'); printAppleDocs(await full(ids)); });
  $('#xl').onclick = () => safe(async () => { const ids = visibleIds(); if (!ids.length) return toast('Nothing to export', 'err'); exportXls('Apple_ID_records', APPLE_XLS, await full(ids)); });
  $('#na')?.addEventListener('click', () => appleForm(null, null, () => V.appleid(root)));
  $$('[data-print]', root).forEach(b => b.onclick = () => safe(async () => printAppleDocs(await full([+b.dataset.print]))));
  $$('[data-ed]', root).forEach(b => b.onclick = () => appleForm(list.find(r => r.id == b.dataset.ed), null, () => V.appleid(root)));
  $$('[data-ust]', root).forEach(b => b.onclick = () => appleStatus(list.find(r => r.id == b.dataset.ust), () => V.appleid(root)));
  $$('[data-dl]', root).forEach(b => b.onclick = async () => { const r = list.find(x => x.id == b.dataset.dl); if (await confirmBox({ title: 'Delete Apple ID record?', message: `Delete the record for <b>${esc(r.customer_name)}</b> (${esc(r.model)})? This cannot be undone.`, confirmText: 'Delete' })) await safe(async () => { await api('appleid_delete', { id: r.id }); toast('Deleted', 'ok'); V.appleid(root); }); });
  $$('[data-hide]', root).forEach(b => b.onclick = () => safe(async () => { const r = list.find(x => x.id == b.dataset.hide); await api('appleid_hide', { id: r.id, hidden: !r.hidden }); toast(r.hidden ? 'Record visible to authorised users again' : 'Record hidden from all other users', 'ok'); V.appleid(root); }));
  $$('[data-pw]', root).forEach(b => b.onclick = () => safe(async () => {
    const span = $(`[data-pwv="${b.dataset.pw}"]`, root);
    if (b.dataset.on) { span.textContent = '••••••••'; b.innerHTML = ic('eye'); delete b.dataset.on; return; }
    const r = await api('appleid_reveal', { id: +b.dataset.pw }); span.textContent = r.password || '(empty)'; b.innerHTML = ic('eye-off'); b.dataset.on = 1;
    setTimeout(() => { if (b.dataset.on) b.click(); }, 20000);
  }));
  every(() => { if (curRoute === 'appleid' && !$('.ov') && !$('[data-live]', root)?.value) V.appleid(root); }, 30000);
};
async function appleForm(rec, cust, done) {
  const edit = !!rec; let pw = '';
  if (edit) pw = (await safe(() => api('appleid_reveal', { id: rec.id })))?.password || '';
  const m = modal({ title: edit ? `${ic('key')} Edit Apple ID record` : `${ic('key')} New Apple ID request`, size: 'lg', body: `<form class="form" id="af2" novalidate>${edit ? `<div class="full notice info">${ic('user')}<span>Customer: <b>${esc(rec.customer_name)}</b> ${esc(rec.phone || '')}</span></div>` : custPicker(cust || {})}
    ${fi('model', 'iPhone model', rec?.model, { req: 1, ph: 'e.g. iPhone 15 Pro Max' })}${fi('apple_id', 'Apple ID', rec?.apple_id, { req: 1, ph: 'example@email.com' })}
    <label class="fld"><span>Apple ID password *</span><div class="pw"><input name="password" type="password" autocomplete="new-password" placeholder="Apple Passwords" value="${esc(pw)}"><button type="button" data-eye title="Show / hide">${ic('eye')}</button></div></label>
    ${fi('date', 'Date', rec?.date || todayStr(), { type: 'date' })}${fi('request_date', 'Request date', rec?.request_date || todayStr(), { type: 'date' })}${fi('expected_date', 'Expected opening date', rec?.expected_date || '', { type: 'date' })}
    ${fs('assigned_to', 'Assigned user', staffOpts(), rec?.assigned_to || '', { blank: 'Unassigned' })}${edit ? '' : fs('status', 'Status', APPLE_LIST.map(k => [k, stLabel(k)]), 'request', { blank: false })}
    ${ft('description', 'Description', rec?.description, { cls: 'full' })}${ft('notes', 'Notes', rec?.notes, { cls: 'full' })}</form>`,
    footer: `${edit ? `<button class="btn warn" id="cp" style="margin-right:auto">${ic('key')} Change Apple Password</button>` : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" id="as">${ic('check')} Save</button>`, onOpen: mm => wireCust(mm.el) });
  $('#as').onclick = () => safe(async () => { const f = formData($('#af2')); if (!edit && !f.password) return toast('Enter the Apple ID password', 'err'); await api('appleid_save', { ...f, id: rec?.id }); m.close(); toast('Apple ID record saved', 'ok'); done?.(); });
  $('#cp')?.addEventListener('click', () => {
    const mm = modal({ title: `${ic('key')} Change Apple Password`, size: 'sm', body: `<div class="notice info" style="margin-bottom:12px">${ic('info')}<span>To change the <b>real</b> Apple Account password, the account owner or an authorised technician must do it on Apple's official page. After that, update the stored copy here.</span></div>
      <a class="btn" href="https://account.apple.com/" target="_blank" rel="noopener" style="margin-bottom:6px">${ic('ext')} Apple Account (official)</a> <a class="btn" href="https://iforgot.apple.com/" target="_blank" rel="noopener" style="margin-bottom:12px">${ic('ext')} Reset password (iForgot)</a>
      <form id="cpf">${fp('password', 'New stored Apple password', '', { ph: 'Apple Passwords', req: 1 })}</form>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="cps">${ic('check')} Save stored password</button>` });
    $('#cps').onclick = () => safe(async () => { const v = formData($('#cpf')).password; if (!v) return toast('Enter the new password', 'err'); await api('appleid_save', { id: rec.id, model: rec.model, apple_id: rec.apple_id, password: v, date: rec.date, request_date: rec.request_date, expected_date: rec.expected_date, assigned_to: rec.assigned_to, description: rec.description, notes: rec.notes }); mm.close(); $('[name=password]', m.el).value = v; toast('Stored password updated', 'ok'); });
  });
}
function appleStatus(r, done) {
  const m = modal({ title: `Update status — ${esc(r.customer_name)}`, size: 'sm', body: `<div class="form" id="asf" style="grid-template-columns:1fr">${fs('status', 'Status', APPLE_LIST.map(k => [k, stLabel(k)]), r.status, { blank: false })}${fi('expected_date', 'New expected date (optional)', r.expected_date || '', { type: 'date' })}${ft('note', 'Note after checking the account')}</div>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="ass">${ic('check')} Update</button>` });
  $('#ass').onclick = () => safe(async () => { const f = formData($('#asf')); await api('appleid_status', { ...f, id: r.id }); m.close(); toast('Status updated', 'ok'); done?.(); });
}

/* ------------------------------------------------ regional repairs */
V.regional = async root => {
  const list = await api('regional_list');
  root.innerHTML = pageHead('External / Regional Repairs', 'Phones sent outside Hargeisa or to other regions for repair', can('regional', 'add') ? `<button class="btn primary" id="nrg">${ic('plus')} New regional repair</button>` : '') +
    `<div class="tools">${searchBox('Search customer, device, region…')}<span class="muted" data-count></span></div><div style="margin-bottom:14px">${statusChips(REGIONAL_LIST)}</div>` +
    tbl([{ h: 'Customer', f: r => custLink(r.customer_id, r.customer_name) + `<small>${esc(r.phone || '')}</small>` }, { h: 'Device', f: r => `<b>${esc(r.device)}</b><small>${esc(r.problem || '')}</small>` }, { h: 'Region', f: r => `${ic('pin')} ${esc(r.region)}<small>${esc(r.sent_to || '')}</small>` },
      { h: 'Status', f: r => chip(r.status) }, { h: 'Sent', f: r => fdate(r.date_sent) }, { h: 'Expected return', f: r => ['returned', 'ready', 'collected', 'failed'].includes(r.status) ? fdate(r.expected_return) : dueBadge(r.expected_return) }, { h: 'Returned', f: r => fdate(r.actual_return) },
      { h: 'Cost', f: r => r.cost ? money(r.cost) : '—' }, { h: 'By', f: r => esc(r.created_name || '—') },
      { h: '', act: 1, f: r => `<div class="acts">${can('regional', 'status') ? `<button class="btn sm ico" data-rs="${r.id}" title="Update status">${ic('zap')}</button>` : ''}${can('regional', 'edit') ? `<button class="btn sm ico" data-re="${r.id}" title="Edit">${ic('edit')}</button>` : ''}${can('regional', 'delete') ? `<button class="btn sm ico danger" data-rd="${r.id}" title="Delete">${ic('trash')}</button>` : ''}</div>` }], list, { empty: 'No regional repairs yet.', attrs: r => `data-st="${r.status}"` });
  wireLive(root);
  const form = r => { const m = modal({ title: r ? 'Edit regional repair' : 'New regional repair', size: 'lg', body: `<form class="form" id="gf" novalidate>${r ? `<div class="full notice info">${ic('user')}<span>Customer: <b>${esc(r.customer_name)}</b> ${esc(r.phone || '')}</span></div>` : custPicker({})}
      ${fi('device', 'Device', r?.device, { req: 1 })}${fi('region', 'Region / location', r?.region, { req: 1, ph: 'e.g. Burao, Borama, Berbera' })}${ft('problem', 'Problem', r?.problem, { cls: 'full' })}${fi('sent_to', 'Where it was sent (shop / person)', r?.sent_to)}${fi('technician', 'Person / technician', r?.technician)}
      ${fi('date_sent', 'Date sent', r?.date_sent || todayStr(), { type: 'date' })}${fi('expected_return', 'Expected return date', r?.expected_return || '', { type: 'date' })}${fi('actual_return', 'Actual return date', r?.actual_return || '', { type: 'date' })}${fi('cost', 'Cost', r?.cost ?? '', { type: 'number', attrs: 'min=0 step=0.01' })}
      ${fi('parts', 'Parts', r?.parts, { cls: 'full' })}${r ? '' : fs('status', 'Status', REGIONAL_LIST.map(k => [k, stLabel(k)]), 'received', { blank: false })}${ft('notes', 'Notes', r?.notes, { cls: 'full' })}</form>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="gs">${ic('check')} Save</button>`, onOpen: mm => wireCust(mm.el) });
    $('#gs').onclick = () => safe(async () => { await api('regional_save', { ...formData($('#gf')), id: r?.id }); m.close(); toast('Saved', 'ok'); V.regional(root); }); };
  $('#nrg')?.addEventListener('click', () => form(null));
  $$('[data-re]', root).forEach(b => b.onclick = () => form(list.find(x => x.id == b.dataset.re)));
  $$('[data-rs]', root).forEach(b => b.onclick = () => { const r = list.find(x => x.id == b.dataset.rs); const m = modal({ title: `Update status — ${esc(r.device)}`, size: 'sm', body: `<div class="form" id="gsf" style="grid-template-columns:1fr">${fs('status', 'Status', REGIONAL_LIST.map(k => [k, stLabel(k)]), r.status, { blank: false })}${ft('note', 'Note')}</div>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="gsu">${ic('check')} Update</button>` });
    $('#gsu').onclick = () => safe(async () => { await api('regional_status', { ...formData($('#gsf')), id: r.id }); m.close(); toast('Status updated', 'ok'); V.regional(root); }); });
  $$('[data-rd]', root).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this regional repair?', message: 'This cannot be undone.', confirmText: 'Delete' })) safe(async () => { await api('regional_delete', { id: +b.dataset.rd }); V.regional(root); }); });
};
