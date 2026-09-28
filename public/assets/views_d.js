/* Software Department: Software Repair, Apple Unlock requests, New Apple ID service */
const SK = {
  repair: { label: 'Software Repair', icon: 'zap', route: 'software', list: ['received', 'diagnosis', 'in_progress', 'waiting', 'testing', 'working', 'not_working', 'completed', 'failed', 'took', 'instore'], open: ['received', 'diagnosis', 'in_progress', 'waiting', 'testing', 'working', 'not_working'],
    flow: [['received', 'Received'], ['diagnosis', 'Diagnosis'], ['in_progress', 'In progress'], ['testing', 'Testing'], ['result', 'Result'], ['completed', 'Completed'], ['handed', 'Handed over']], idx: { received: 0, diagnosis: 1, in_progress: 2, waiting: 2, testing: 3, working: 4, not_working: 4, completed: 5, failed: 5, took: 6, instore: 6 } },
  unlock: { label: 'Apple Unlock', icon: 'lock', route: 'unlock', list: ['request', 'received', 'in_progress', 'waiting', 'completed', 'failed', 'took', 'instore'], open: ['request', 'received', 'in_progress', 'waiting'],
    flow: [['request', 'Request'], ['received', 'Received'], ['in_progress', 'In progress'], ['completed', 'Completed'], ['handed', 'Handed over']], idx: { request: 0, received: 1, in_progress: 2, waiting: 2, completed: 3, failed: 3, took: 4, instore: 4 } },
  newid: { label: 'New Apple ID', icon: 'user-check', route: 'newid', list: ['requested', 'creating', 'created', 'verified', 'failed', 'customer_received'], open: ['requested', 'creating', 'created', 'verified'],
    flow: [['requested', 'Requested'], ['creating', 'Creating'], ['created', 'Created'], ['verified', 'Verified'], ['customer_received', 'Customer received']], idx: { requested: 0, creating: 1, created: 2, verified: 3, failed: 3, customer_received: 4 } },
};
const NEW_LABEL = { repair: 'New software repair', unlock: 'New Apple Unlock request', newid: 'New Apple ID service' };
const softBal = r => r.price - r.discount - r.paid;
const payState = r => { const due = r.price - r.discount; if (due <= 0.005) return ['No charge', '#94a3b8']; if (r.paid + .005 >= due) return ['Paid', '#22c55e']; return r.paid > 0 ? ['Partial', '#f59e0b'] : ['Unpaid', '#ef4444']; };
const softPayCell = r => { const [l, c] = payState(r); return `<span class="chip" style="--c:${c}">${l}</span><small>${r.price ? money(r.price - r.discount) + (softBal(r) > .005 ? ' • owes ' + money(softBal(r)) : '') : ''}</small>`; };
function softDays(r) {
  if (!SK[r.kind].open.includes(r.status) || r.days_left === null || r.days_left === undefined) return '<span class="muted">—</span>';
  const n = r.days_left;
  if (n < 0) return `<span class="chip" style="--c:#ef4444">${-n} Day${n === -1 ? '' : 's'} Overdue</span>`;
  if (n === 0) return '<span class="chip" style="--c:#f97316">Due Today</span>';
  return `<span class="chip" style="--c:${n <= 3 ? '#f59e0b' : '#22c55e'}">${n} Day${n === 1 ? '' : 's'} Remaining</span>`;
}
const daysLeftOf = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5) : null;
const snd = j => [j.imei && 'IMEI ' + j.imei, j.serial && 'SN ' + j.serial].filter(Boolean).join(' • ') || '—';

/* ---------- print / export ---------- */
function softDocFields(j) {
  const bal = j.price - j.discount - j.paid, dl = j.days_left, [ps] = payState(j);
  const pay = [['Service charge', money(j.price)], ['Discount', money(j.discount)], ['Paid', money(j.paid)], ['Balance due', money(Math.max(0, bal))], ['Payment status', ps]];
  const common = [['Customer', j.customer_name], ['Phone', j.phone || '—'], ['iPhone / device', j.device]];
  const tail = [['Created by', j.created_name || '—'], ['Date', fdate(j.received_at)], ['Notes', j.notes || '—']];
  if (j.kind === 'unlock') return [...common, ['IMEI', j.imei || '—'], ['Serial number', j.serial || '—'], ['Apple ID', j.apple_id || '—'], ['Activation Lock information', j.lock_info || '—'], ['Request date', fdate(j.request_date)], ['Expected completion', fdate(j.expected_date)],
    ['Days remaining', SK.unlock.open.includes(j.status) && dl != null ? (dl < 0 ? `${-dl} day(s) overdue` : dl === 0 ? 'Due today' : dl + ' day(s)') : '—'], ['Assigned software user', j.tech || '—'], ['Status', stLabel(j.status)], ...pay, ...tail];
  if (j.kind === 'newid') return [...common, ['New Apple ID / Gmail', j.apple_id || '—'],
    ...(j.gmail_password !== undefined ? [['Gmail password', j.gmail_password || '—'], ['Apple ID password', j.apple_password || '—']] : []),
    ['Account creation date', fdate(j.account_date)], ['Assigned software user', j.tech || '—'], ['Status', stLabel(j.status)], ...pay, ...tail];
  return [...common, ['IMEI', j.imei || '—'], ['Serial number', j.serial || '—'], ['Problem', j.problem || '—'], ['Diagnosis', j.diagnosis || '—'], ['Assigned software user', j.tech || '—'], ['Status', stLabel(j.status)], ['Expected', fdate(j.expected_date)], ...pay, ...tail];
}
function printSoft(jobs) {
  const secret = jobs.some(j => j.gmail_password !== undefined);
  const sheets = jobs.map(j => `<div class="sheet">${letterhead()}<h2 class="dt">${SK[j.kind].label} ${j.kind === 'repair' ? 'Job Sheet' : j.kind === 'unlock' ? 'Request' : 'Service'}</h2>
    <table class="kv">${softDocFields(j).map(([k, v]) => `<tr><td>${esc(k)}</td><td${/password/i.test(k) ? ' class="pwv"' : ''}>${esc(v)}</td></tr>`).join('')}</table>
    ${j.kind === 'newid' ? `<div class="warn"><b>Confidential:</b> ${j.gmail_password !== undefined ? 'this sheet contains account credentials. Hand it only to the account owner and keep it secure.' : 'account passwords are restricted and are not shown on this copy.'}</div>` : ''}
    <div class="sig"><div>Customer signature</div><div>Authorised staff (${esc(j.tech || j.created_name || '')})</div></div><div class="ft">${esc(S.br.footer || '')} • Ref #${j.id} • ${esc(fdate(todayStr()))}</div></div>`).join('');
  printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(SK[jobs[0].kind].label)}</title><style>${docCss()}</style></head><body>${sheets}</body></html>`);
  return secret;
}
/** authorised users get New Apple ID credentials on the printed sheet; everyone else gets a sheet without them */
async function doPrintSoft(jobs) {
  const ids = jobs.filter(j => j.kind === 'newid').map(j => j.id);
  if (ids.length && can('software', 'edit')) {
    const full = await api('soft_full', { ids }); const map = Object.fromEntries(full.map(f => [f.id, f]));
    jobs = jobs.map(j => map[j.id] ? { ...j, gmail_password: map[j.id].gmail_password, apple_password: map[j.id].apple_password } : j);
  }
  printSoft(jobs);
}
function softExport(kind, jobs) {
  const cols = { repair: [['customer_name', 'Customer'], ['phone', 'Phone'], ['device', 'Device'], ['imei', 'IMEI'], ['serial', 'Serial'], ['problem', 'Problem'], ['diagnosis', 'Diagnosis'], ['tech', 'Assigned software user'], ['status_l', 'Status'], ['price', 'Service charge'], ['paid', 'Paid'], ['pay_l', 'Payment status'], ['date_l', 'Date'], ['created_name', 'Created by'], ['notes', 'Notes']],
    unlock: [['customer_name', 'Customer'], ['phone', 'Phone'], ['device', 'iPhone model'], ['imei', 'IMEI'], ['serial', 'Serial'], ['apple_id', 'Apple ID'], ['request_date', 'Request date'], ['expected_date', 'Expected completion'], ['days', 'Days remaining'], ['tech', 'Assigned software user'], ['status_l', 'Status'], ['price', 'Service charge'], ['paid', 'Paid'], ['pay_l', 'Payment status'], ['notes', 'Notes']],
    newid: [['customer_name', 'Customer'], ['phone', 'Phone'], ['device', 'iPhone model'], ['apple_id', 'New Apple ID / Gmail'], ['account_date', 'Date'], ['created_name', 'Created by'], ['tech', 'Assigned software user'], ['status_l', 'Status'], ['price', 'Service charge'], ['paid', 'Paid'], ['pay_l', 'Payment status'], ['notes', 'Notes']] }[kind].map(([k, l]) => ({ k, l }));
  exportXls(SK[kind].label.replace(/ /g, '_'), cols, jobs.map(j => ({ ...j, status_l: stLabel(j.status), pay_l: payState(j)[0], date_l: fdate(j.received_at), days: SK[kind].open.includes(j.status) && j.days_left != null ? j.days_left : '' })));
}
function showCreds(j) {
  safe(async () => {
    const c = await api('soft_secret', { id: j.id });
    const row = (l, v) => `<label class="fld"><span>${l}</span><div class="pw"><input value="${esc(v)}" readonly type="text"><button type="button" data-copy title="Copy">${ic('file')}</button></div></label>`;
    const m = modal({ title: `${ic('lock')} Credentials — ${esc(j.customer_name)}`, size: 'sm', body: `<div class="notice" style="margin-bottom:12px">${ic('shield')}<span>Restricted. This view is recorded in the audit log. Never share it outside the customer.</span></div><div class="form" style="grid-template-columns:1fr">${row('New Apple ID / Gmail', j.apple_id)}${row('Gmail password', c.gmail_password)}${row('Apple ID password', c.apple_password)}</div>`, footer: '<button class="btn" data-close>Close</button>' });
    $$('[data-copy]', m.el).forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText($('input', b.parentElement).value); toast('Copied', 'ok'); } catch (e) { toast('Copy not available on this browser', 'err'); } });
  });
}

/* ---------- list page (one page per service, each with its own menu item) ---------- */
V.software = root => softPage(root, 'repair');
V.unlock = root => softPage(root, 'unlock');
V.newid = root => softPage(root, 'newid');
async function softPage(root, tab) {
  const all = await api('soft_list'), list = all.filter(j => j.kind === tab), K = SK[tab];
  const cnt = k => all.filter(j => j.kind === k && SK[k].open.includes(j.status)).length;
  const cust = j => custLink(j.customer_id, j.customer_name) + `<small>${ic('phone')} ${esc(j.phone || '')}</small>`;
  const by = j => `${esc(j.created_name || '—')}<small>${fdate(j.received_at)}</small>`;
  const cols = {
    repair: [{ h: '#', f: j => '#' + j.id }, { h: 'Customer', f: cust }, { h: 'Device', f: j => `<b>${esc(j.device)}</b><small>${esc(snd(j))}</small>` }, { h: 'Problem', f: j => esc((j.problem || '—').slice(0, 60)) + `<small>${esc((j.diagnosis || '').slice(0, 50))}</small>` }, { h: 'Status', f: j => chip(j.status) }, { h: 'Software user', f: j => esc(j.tech || '—') }, { h: 'Payment', f: softPayCell }, { h: 'Created', f: by }],
    unlock: [{ h: 'Customer', f: cust }, { h: 'iPhone', f: j => `<b>${esc(j.device)}</b><small>${esc(snd(j))}</small>` }, { h: 'Apple ID', f: j => esc(j.apple_id || '—') }, { h: 'Status', f: j => chip(j.status) }, { h: 'Request → Expected', f: j => `${fdate(j.request_date)} → ${fdate(j.expected_date)}<small>${softDays(j)}</small>` }, { h: 'Assigned', f: j => esc(j.tech || '—') }, { h: 'Payment', f: softPayCell }, { h: 'Created by', f: j => esc(j.created_name || '—') }],
    newid: [{ h: 'Customer', f: cust }, { h: 'iPhone', f: j => `<b>${esc(j.device)}</b>` }, { h: 'New Apple ID / Gmail', f: j => esc(j.apple_id || '—') }, { h: 'Passwords', f: j => can('software', 'edit') ? `<button class="btn sm" data-cred="${j.id}">${ic('lock')} View</button>` : '<span class="chip" style="--c:#64748b">Restricted</span>' }, { h: 'Status', f: j => chip(j.status) }, { h: 'Assigned', f: j => esc(j.tech || '—') }, { h: 'Payment', f: softPayCell }, { h: 'Created', f: by }],
  }[tab];
  root.innerHTML = pageHead(K.label === 'Software Repair' ? 'Software Repair' : K.label === 'Apple Unlock' ? 'Apple Unlock Requests' : 'New Apple ID Service', tab === 'repair' ? 'Software faults, restores and iOS issues' : tab === 'unlock' ? 'Activation Lock / Apple Unlock requests with deadline tracking' : 'Creating new Apple IDs for customers — passwords are encrypted and access-controlled',
    `<button class="btn" id="sp" title="Print all visible">${ic('print')} Print all</button><button class="btn" id="sx" title="Export visible to Excel">${ic('sheet')} Export Excel</button>${can('software', 'add') ? `<button class="btn primary" id="sn">${ic('plus')} ${NEW_LABEL[tab]}</button>` : ''}`) +
    `<div class="tabs">${Object.entries(SK).map(([k, v]) => `<a href="#/${v.route}" class="${k === tab ? 'on' : ''}">${ic(v.icon)} ${v.label} <span class="chip" style="--c:${cnt(k) ? '#f59e0b' : '#64748b'}">${cnt(k)} open</span></a>`).join('')}</div>` +
    `<div class="tools">${searchBox('Search customer, phone, device, IMEI, serial, Apple ID…')}<span class="muted" data-count></span></div>${repairStrip(list, [['All', null, K.icon, '#4f8cff'], ...SW_GROUPS[tab].map(g => [g[0], g[2], g[3], g[1]])])}<div style="margin-bottom:14px">${statusChips(K.list, '', SW_GROUPS[tab])}</div>` +
    tbl([...cols, { h: '', act: 1, f: j => `<div class="acts"><button class="btn sm primary" data-open="${j.id}">${ic('eye')} Open</button><button class="btn sm ico" data-pr="${j.id}" title="Print">${ic('print')}</button></div>` }], list, { empty: `No ${K.label.toLowerCase()} records yet.`, attrs: j => `data-st="${j.status}" data-id="${j.id}"` });
  wireLive(root); wireStrip(root);
  const visible = () => list.filter(j => $(`tbody tr[data-id="${j.id}"]:not(.hidden)`, root));
  $('#sp').onclick = () => { const v = visible(); v.length ? safe(() => doPrintSoft(v)) : toast('Nothing to print', 'err'); };
  $('#sx').onclick = () => { const v = visible(); v.length ? softExport(tab, v) : toast('Nothing to export', 'err'); };
  $('#sn')?.addEventListener('click', () => softForm(tab, null, id => { softPage(root, tab); if (id) openSoft(id, () => softPage(root, tab)); }));
  $$('[data-open]', root).forEach(b => b.onclick = () => openSoft(+b.dataset.open, () => softPage(root, tab)));
  $$('[data-pr]', root).forEach(b => b.onclick = () => safe(() => doPrintSoft([list.find(j => j.id == b.dataset.pr)])));
  $$('[data-cred]', root).forEach(b => b.onclick = () => showCreds(list.find(j => j.id == b.dataset.cred)));
  every(() => { if (['software', 'unlock', 'newid'].includes(curRoute) && !$('.ov') && !$('[data-live]', root)?.value) softPage(root, tab); }, 25000);
}

/* ---------- create form (sectioned) ---------- */
function softForm(kind, c, done) {
  const K = SK[kind], me = S.user.position === 'Software' ? S.user.id : '';
  const device = {
    repair: `${fi('device', 'Device / iPhone model', '', { req: 1, ph: 'e.g. iPhone 13' })}${fi('imei', 'IMEI', '', { ph: '15-digit IMEI' })}${fi('serial', 'Serial number', '')}${ft('problem', 'Problem', '', { cls: 'full', ph: 'What is wrong with the phone?' })}${ft('diagnosis', 'Diagnosis (optional)', '', { cls: 'full' })}`,
    unlock: `${fi('device', 'iPhone model', '', { req: 1, ph: 'e.g. iPhone 14 Pro' })}${fi('imei', 'IMEI', '', { ph: '15-digit IMEI' })}${fi('serial', 'Serial number', '')}${fi('apple_id', 'Apple ID', '', { ph: 'Apple ID shown on the lock (if known)' })}${ft('lock_info', 'Activation Lock information', '', { cls: 'full', ph: 'Masked email / phone on the lock screen, MDM, notes…' })}`,
    newid: `${fi('device', 'iPhone model', '', { req: 1 })}${fi('apple_id', 'New Apple ID / Gmail', '', { req: 1, type: 'email', ph: 'newid@gmail.com' })}${fi('account_date', 'Date', todayStr(), { type: 'date' })}`,
  }[kind];
  const creds = kind === 'newid' ? `${sec('Credentials (encrypted, restricted)', 'lock')}${fp('gmail_password', 'Gmail password', '', { ph: 'Stored encrypted' })}${fp('apple_password', 'Apple ID password', '', { ph: 'Stored encrypted' })}<div class="full notice info">${ic('shield')}<span>Passwords are encrypted, shown only to authorised users, audited on every view, and <b>never</b> shown in the Customer Portal.</span></div>` : '';
  const m = modal({ title: `${ic(K.icon)} ${NEW_LABEL[kind]}`, size: 'lg', body: `<form class="form" id="sfm" novalidate>${sec('Customer', 'user')}${custPicker(c || {})}${sec('Device & request', 'mobile')}${device}${creds}${sec('Assignment & charge', 'dollar')}${fs('technician_id', 'Assigned software user', staffOpts(), me, { blank: 'Assign later' })}${kind === 'newid' ? '' : fi('request_date', 'Request date', todayStr(), { type: 'date' })}${kind === 'newid' ? '' : fi('expected_date', kind === 'unlock' ? 'Expected completion date' : 'Expected date', '', { type: 'date' })}${fi('price', 'Service charge', '', { type: 'number', attrs: 'min=0 step=0.01', ph: '0.00' })}${sec('Notes', 'file')}${ft('notes', 'Notes', '', { cls: 'full' })}</form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="sfs">${ic('check')} Register</button>`, onOpen: mm => wireCust(mm.el) });
  $('#sfs').onclick = () => safe(async () => { const r = await api('soft_save', { ...formData($('#sfm')), kind }); m.close(); toast(r.existing_customer ? 'Existing customer reused — service added to their history' : 'New customer created and service registered', 'ok'); done?.(r.id); });
}

/* ---------- detail ---------- */
async function openSoft(id, onChange) {
  const partItems = async () => (await api('items_list').catch(() => [])).filter(i => i.type !== 'service');
  const products = can('software', 'edit') ? await partItems() : [], accts = can('software', 'edit') ? await payAccounts() : [];
  const m = modal({ title: 'Service', size: 'lg', body: '<div id="sb"><div class="skeleton" style="height:120px"></div></div>' });
  const load = async () => {
    const d = await api('soft_get', { id }), j = d.job, K = SK[j.kind], adm = isAdmin(), ed = can('software', 'edit'), stc = can('software', 'status');
    const paid = d.payments.reduce((a, p) => a + p.amount, 0), charge = j.price - j.discount, fi_ = K.idx[j.status] ?? 0, col = (ST[j.status] || [0, '#3b82f6'])[1];
    const full = { ...j, paid, days_left: daysLeftOf(j.expected_date) };
    $('h3', m.box).innerHTML = `${ic(K.icon)} ${K.label}: ${esc(j.device)} <span class="muted">#${j.id}</span> ${chip(j.status)}`;
    const kindFields = {
      repair: `${ft('problem', 'Problem', j.problem)}${ft('diagnosis', 'Diagnosis', j.diagnosis)}${ft('progress_notes', 'Repair progress notes', j.progress_notes)}${fi('imei', 'IMEI', j.imei)}${fi('serial', 'Serial number', j.serial)}${fi('tools', 'Software tools used', j.tools, { ph: 'e.g. 3uTools, iTunes…' })}`,
      unlock: `${fi('imei', 'IMEI', j.imei)}${fi('serial', 'Serial number', j.serial)}${fi('apple_id', 'Apple ID', j.apple_id)}${ft('lock_info', 'Activation Lock information', j.lock_info)}${fi('request_date', 'Request date', j.request_date || '', { type: 'date' })}${fi('tools', 'Software tools used', j.tools)}`,
      newid: `${fi('apple_id', 'New Apple ID / Gmail', j.apple_id, { req: 1, type: 'email' })}${fi('account_date', 'Date', j.account_date || '', { type: 'date' })}${ed ? `<div class="notice info">${ic('lock')}<span>Passwords are encrypted. Type a new value to replace, or reveal the current ones (audited).</span></div>${fp('gmail_password', 'Gmail password', '', { ph: j.has_secret ? 'Stored — type to replace' : 'Not set' })}${fp('apple_password', 'Apple ID password', '', { ph: j.has_secret ? 'Stored — type to replace' : 'Not set' })}<button type="button" class="btn sm" id="rvl">${ic('eye')} Reveal stored passwords</button>` : `<div class="notice">${ic('lock')}<span>Passwords are restricted to authorised users.</span></div>`}`,
    }[j.kind];
    $('#sb').innerHTML = `<div class="row" style="justify-content:space-between"><div><b>${custLink(j.customer_id, j.customer_name)}</b> • ${ic('phone')} ${esc(j.phone)}<br><small class="muted">${fdt(j.received_at)} • created by ${esc(j.created_name || '—')} • software user: ${esc(j.tech || 'unassigned')}</small></div>
        <div class="row">${j.kind === 'unlock' ? softDays({ ...j, days_left: full.days_left }) : ''}<span class="chip" style="--c:${payState(full)[1]}">${payState(full)[0]}</span><button class="btn" id="sdoc">${ic('file')} Documents</button><button class="btn" id="spr">${ic('print')} Print</button></div></div>
      <div class="stepper" style="--c:${col}">${K.flow.map((s, i) => `<div class="step ${i < fi_ ? 'done' : ''} ${i === fi_ ? 'now' : ''}"><i>${i < fi_ ? '✓' : i + 1}</i>${s[1]}</div>`).join('')}</div>
      ${stc ? `<div class="card" style="background:var(--panel2);margin-bottom:14px"><h3>${ic('zap')} Update status</h3><div class="form" id="ssf">${fs('status', 'New status', K.list.map(k => [k, stLabel(k)]), j.status, { blank: false })}${fi('note', 'Note (optional)', '')}
        ${j.kind === 'newid' ? '' : fi('expected_date', 'Expected completion date', j.expected_date || '', { type: 'date' })}${j.kind === 'repair' ? fi('test_result', 'Test result', j.test_result || '', { ph: 'Working / not working — details' }) : ''}<div class="full"><button class="btn primary" id="ssu">${ic('check')} Apply status</button></div></div></div>` : ''}
      <div class="grid g2"><div class="card"><h3>${ic('edit')} Details</h3>${ed ? `<form class="form" id="sdf" style="grid-template-columns:1fr" autocomplete="off">${fi('device', 'Device / iPhone model', j.device, { req: 1 })}${kindFields}${fs('technician_id', 'Assigned software user', staffOpts(), j.technician_id || '', { blank: 'Unassigned' })}${j.kind === 'newid' ? '' : fi('expected_date', 'Expected completion date', j.expected_date || '', { type: 'date' })}
        <div class="form">${fi('price', 'Service charge', j.price, { type: 'number', attrs: 'min=0 step=0.01' })}${fi('discount', 'Discount', j.discount, { type: 'number', attrs: 'min=0 step=0.01' })}</div>${ft('notes', 'Notes', j.notes)}<div><button class="btn primary">${ic('check')} Save details</button></div></form>`
        : `<dl class="kv"><dt>Device</dt><dd>${esc(j.device)}</dd><dt>Apple ID</dt><dd>${esc(j.apple_id || '—')}</dd><dt>IMEI / Serial</dt><dd>${esc(snd(j))}</dd><dt>Problem</dt><dd>${esc(j.problem || '—')}</dd><dt>Notes</dt><dd>${esc(j.notes || '—')}</dd></dl>`}</div>
      <div>${j.kind === 'newid' ? '' : `<div class="card" style="margin-bottom:16px"><h3>${ic('package')} Parts / software tools used</h3>${j.tools ? `<p style="margin:0 0 8px"><span class="muted">Tools:</span> ${esc(j.tools)}</p>` : ''}${d.parts.length ? tbl([{ h: 'Item', f: p => `<b>${esc(p.product)}</b>` }, { h: 'Qty', f: p => '× ' + fq(p.qty) }, { h: 'Added by', f: p => esc(p.by_name || '—') + `<small>${ago(p.ts)}</small>` }, ...(adm ? [{ h: 'Cost', f: p => money(p.unit_cost * p.qty) }] : []), { h: '', act: 1, f: p => ed ? `<button class="btn sm ico danger" data-rp="${p.id}" title="Remove & return to stock">${ic('trash')}</button>` : '' }], d.parts) : '<p class="muted">No stock items used.</p>'}
        ${ed ? `<div class="form" id="spf" style="grid-template-columns:3fr 1fr auto;align-items:end;margin-top:10px">${fs('product_id', 'Item', products.map(p => [p.id, `${p.name} (${p.type === 'inventory' ? fq(p.qty) + ' in stock' : 'non-stock'})`]), '', { blank: 'Select item…' })}${fi('qty', 'Qty', 1, { type: 'number', attrs: 'min=1' })}<button class="btn primary" id="spa" title="Add">${ic('plus')}</button></div><small class="muted">Stock items are taken out of inventory automatically.</small>` : ''}</div>`}
      <div class="card"><h3>${ic('dollar')} Payment</h3><dl class="kv" style="grid-template-columns:110px 1fr"><dt>Charge</dt><dd>${money(charge)}${j.discount ? ` <small class="muted">(after ${money(j.discount)} discount)</small>` : ''}</dd><dt>Paid</dt><dd>${money(paid)}</dd><dt>Balance</dt><dd style="color:${charge - paid > .005 ? '#f59e0b' : '#22c55e'}">${money(Math.max(0, charge - paid))}</dd></dl>
        ${d.payments.map(p => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--border);padding:6px 0"><span>${fdate(p.date)} • ${esc(p.method)} <small class="muted">by ${esc(p.by_name || '')}</small></span><b>${money(p.amount)}</b></div>`).join('')}
        ${ed ? `<div class="form" id="spy" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end;margin-top:10px">${fi('amount', 'Amount', Math.max(0, charge - paid) || '', { type: 'number', attrs: 'min=0 step=0.01' })}${fs('method', 'Method', ['Cash', 'ZAAD', 'eDahab', 'EVC / Mobile money', 'Bank transfer', 'Card'], 'Cash', { blank: false })}${acctField(accts)}<button class="btn ok" id="spyb">${ic('check')} Record</button></div>` : ''}</div></div></div>
      <div class="card" style="margin-top:16px"><h3>${ic('clock')} Service history</h3><div class="tl">${d.events.map(e => `<div style="--c:${(ST[e.status] || [0, '#64748b'])[1]}">${chip(e.status)} <small class="muted">${fdt(e.ts)} • ${esc(e.by_name || '')}</small>${e.note ? `<div>${esc(e.note)}</div>` : ''}</div>`).join('')}</div></div>
      ${can('software', 'delete') ? `<div style="margin-top:14px;text-align:right"><button class="btn danger sm" id="sdel">${ic('trash')} Delete service</button></div>` : ''}`;
    const sb = $('#sb'), reload = async () => { await load(); onChange?.(); };
    $('#sdoc').onclick = () => Docs.chooser('soft', d, { noReport: false });
    $('#spr').onclick = () => safe(() => doPrintSoft([{ ...full, created_name: j.created_name }]));
    $('#rvl')?.addEventListener('click', () => safe(async () => { const c = await api('soft_secret', { id }); $('[name=gmail_password]', sb).value = c.gmail_password; $('[name=apple_password]', sb).value = c.apple_password; $$('[name=gmail_password],[name=apple_password]', sb).forEach(i => i.type = 'text'); toast('Passwords revealed (recorded in audit log)', 'ok'); }));
    $('#ssu')?.addEventListener('click', () => safe(async () => { await api('soft_status', { ...formData($('#ssf')), id }); toast('Status updated', 'ok'); reload(); }));
    $('#sdf')?.addEventListener('submit', e => { e.preventDefault(); safe(async () => { await api('soft_save', { ...formData(e.target), id }); toast('Details saved', 'ok'); reload(); }); });
    const refresh = async () => { const f = await partItems(); products.splice(0, products.length, ...f); };
    $('#spa')?.addEventListener('click', () => safe(async () => { const f = formData($('#spf')); if (!f.product_id) return toast('Select an item first', 'err'); await api('soft_part_add', { ...f, job_id: id }); toast('Item added — stock deducted', 'ok'); await refresh(); reload(); }));
    $$('[data-rp]', sb).forEach(b => b.onclick = () => safe(async () => { if (!await confirmBox({ title: 'Remove this item?', message: 'The quantity goes back into stock.', confirmText: 'Remove', color: 'warn' })) return; await api('soft_part_remove', { id: +b.dataset.rp }); await refresh(); reload(); }));
    syncAcct($('#spy') || document.createElement('div'));
    $('#spyb')?.addEventListener('click', () => safe(async () => { await api('soft_payment_add', { ...formData($('#spy')), job_id: id }); toast('Payment recorded', 'ok'); reload(); }));
    $('#sdel')?.addEventListener('click', async () => { if (await confirmBox({ title: 'Are you sure you want to delete this record?', message: 'Stock items are returned to their stores. This cannot be undone.', confirmText: 'Delete' })) await safe(async () => { await api('soft_delete', { id }); m.close(); onChange?.(); }); });
  };
  await safe(load);
}
