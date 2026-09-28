/* Customer portal — customers see only their own devices; Apple ID credentials are never sent to this page */
const PFLOW = [['received', 'Received'], ['diagnosis', 'Diagnosis'], ['progress', 'Repair'], ['testing', 'Testing'], ['finishing', 'Finishing'], ['ready', 'Ready'], ['done', 'Collected']];
const pIdx = s => ({ received: 0, diagnosis: 1, progress: 2, waiting_part: 2, parts_installed: 2, testing: 3, working: 3, not_working: 3, finishing: 4, completed: 4, ready: 5, took_completed: 6, took_incomplete: 6, in_store: 6, failed: 6 }[s] ?? 0);
const PMSG = { received: 'We have received your device.', diagnosis: 'Our technician is diagnosing the problem.', progress: 'Repair in progress.', waiting_part: 'Waiting for a replacement part to arrive.', parts_installed: 'Parts have been installed.', testing: 'Your device is being tested.', working: 'Testing passed — your device is working.', not_working: 'Testing found an issue — the technician is working on it.', finishing: 'Final inspection and finishing.', completed: 'Repair completed.', ready: 'Your device is READY — please come and collect it.', took_completed: 'You collected your device — repair completed.', took_incomplete: 'You collected your device before the repair was finished.', in_store: 'Your device is kept safely in our store.', failed: 'We could not repair this device. Please contact us.' };
let PT = null, PTAB = 'dev';
const pStat = (label, v, icn, color) => `<div class="card stat" style="--c:${color}"><div class="si">${ic(icn)}</div><div><b>${v}</b><span>${label}</span></div></div>`;

/* Billing: invoices, payments and the balance the customer owes */
async function loadBills(d) {
  const box = $('#pbill'); if (!box) return;
  try {
    const b = await api('portal_bills'), sm = b.summary;
    box.innerHTML = `<div class="grid g-auto" style="margin-bottom:16px">${pStat('Total billed', money(sm.billed), 'file', '#4f8cff')}${pStat('Paid', money(sm.paid), 'check-circle', '#22c55e')}${pStat('Balance due', money(sm.balance), 'dollar', sm.balance > 0 ? '#f59e0b' : '#22c55e')}</div>
      <h3 style="margin:0 0 10px">${ic('file')} Invoices</h3>` + tbl([{ h: 'Invoice', f: x => `<b>${esc(x.no)}</b><small>${esc(x.kind)}</small>` }, { h: 'Item', f: x => esc(x.device || '—') }, { h: 'Date', f: x => fdate(x.date || x.ts) }, { h: 'Total', f: x => money(x.total) }, { h: 'Paid', f: x => money(x.paid) },
        { h: 'Balance', f: x => x.balance > 0.005 ? `<b style="color:#f59e0b">${money(x.balance)}</b>` : '<span class="chip" style="--c:#22c55e">Paid</span>' }, { h: '', act: 1, f: x => `<button class="btn sm" data-inv="${esc(x.no)}">${ic('print')} Print</button>` }], b.bills, { empty: 'No invoices yet.' }) +
      `<h3 style="margin:22px 0 10px">${ic('clock')} Payment history</h3>` + tbl([{ h: 'Date', f: p => fdate(p.date) }, { h: 'For', f: p => esc(p.for) }, { h: 'Method', f: p => esc(p.method || '—') }, { h: 'Amount', f: p => `<b>${money(p.amount)}</b>` }], b.payments, { empty: 'No payments recorded yet.' });
    $$('[data-inv]', box).forEach(btn => btn.onclick = () => { const bill = b.bills.find(x => x.no === btn.dataset.inv); S.br = { ...S.br, ...b.branding }; Docs.portalBill(bill, d.account.name, b.payments.filter(p => bill && p.no === bill.no)); });
  } catch (e) { box.innerHTML = `<div class="card empty">${ic('alert')}<div>${esc(e.message)}</div></div>`; }
}
/* Messages: repair ready / completed, payment received and reminders */
async function loadMsgs(d) {
  const box = $('#pmsg'); if (!box) return;
  try {
    const m = await api('portal_msgs'), ico = { repair: ['tool', '#3b82f6'], software: ['zap', '#8b5cf6'], payment: ['dollar', '#f59e0b'] };
    box.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="margin:0">${ic('bell')} Messages from ${esc(S.br.company_name || 'the shop')}</h3>${m.unread ? `<button class="btn sm" id="pmr">${ic('check-circle')} Mark all as read</button>` : ''}</div>` +
      (m.items.length ? m.items.map(x => { const i = ico[x.type] || ['info', '#64748b']; return `<div class="card" style="margin-bottom:10px;--c:${i[1]};border-left:4px solid ${i[1]};${x.is_read ? 'opacity:.75' : ''}"><div class="row" style="flex-wrap:nowrap;align-items:flex-start"><span style="color:${i[1]};display:grid">${ic(i[0])}</span><div class="grow"><b>${esc(x.message)}</b><br><small class="muted">${fdt(x.ts)}${x.is_read ? '' : ' • <b style="color:#ef4444">new</b>'}</small></div></div></div>`; }).join('') : `<div class="card empty">${ic('info')}<div>No messages yet. We will tell you here when your device is ready or a payment is due.</div></div>`);
    $('#pmr')?.addEventListener('click', async () => { await api('portal_msg_read', { id: 'all' }); showHome(await api('portal_me')); });
    if (m.unread) { setTimeout(async () => { try { await api('portal_msg_read', { id: 'all' }); } catch (e) { } }, 4000); }
  } catch (e) { box.innerHTML = `<div class="card empty">${ic('alert')}<div>${esc(e.message)}</div></div>`; }
}

function head(right = '') {
  return `<header class="top" style="position:static"><div class="row" style="flex-wrap:nowrap"><img data-logo style="width:44px;height:44px;border-radius:12px;object-fit:contain;background:var(--panel2);padding:3px" alt=""><div><b data-cname style="display:block;letter-spacing:.4px"></b><small class="muted" data-slogan></small></div></div><div class="grow"></div>${right}</header>`;
}
function brandIt() { document.title = 'Customer Portal — ' + (S.br.company_name || ''); $$('[data-logo]').forEach(i => i.src = logoSrc()); $$('[data-cname]').forEach(i => i.textContent = S.br.company_name || ''); $$('[data-slogan]').forEach(i => i.textContent = S.br.slogan || ''); $$('[data-footer]').forEach(i => i.textContent = S.br.footer || ''); }
const themeSel = () => `<select id="th" style="width:auto" aria-label="Theme">${THEMES.map(t => `<option value="${t[0]}" ${document.documentElement.dataset.theme === t[0] ? 'selected' : ''}>${t[1]}</option>`).join('')}</select>`;
const wireTheme = cb => { const s = $('#th'); if (s) s.onchange = () => { applyTheme(s.value); cb?.(); }; };

function showAuth(mode = 'in', msg = '') {
  clearInterval(PT);
  $('#app').innerHTML = head(themeSel()) + `<div class="auth" style="min-height:calc(100vh - 62px)"><div class="auth-l"><img data-logo alt=""><h1>Customer Portal</h1><p data-slogan></p><div style="max-width:420px;opacity:.92;line-height:1.7">Track your device from the moment it reaches us until it is ready — repair progress, parts status and expected completion, live.</div></div>
    <div class="auth-r"><div class="auth-box"><div class="tabs"><a data-m="in" class="${mode === 'in' ? 'on' : ''}">Enter</a><a data-m="up" class="${mode === 'up' ? 'on' : ''}">Register</a></div>
    ${msg ? `<div class="notice ok" style="margin-bottom:12px">${ic('check-circle')}<span>${esc(msg)}</span></div>` : ''}
    <form id="pf" class="form">${mode === 'in' ? `<h2>Welcome</h2><p class="muted" style="margin:0">Enter the mobile number you registered with — no password needed.</p>${fi('phone', 'Registered mobile number', '', { req: 1, type: 'tel', ph: 'e.g. 063 4xx xxxx' })}<button class="btn primary" style="justify-content:center">${ic('check')} Enter</button>`
      : `<h2>First time here?</h2><p class="muted" style="margin:0">Register once with your name and mobile number. After our team approves it, you only ever enter your number.</p>${fi('name', 'Full name', '', { req: 1 })}${fi('phone', 'Mobile number', '', { req: 1, type: 'tel', ph: 'The number you gave us at the shop' })}<button class="btn primary" style="justify-content:center">${ic('user-check')} Request access</button>`}</form>
    <div id="perr" class="notice hidden" style="margin-top:12px;background:color-mix(in srgb,var(--danger) 14%,transparent);border-color:var(--danger)"></div>
    <p class="muted" style="margin-top:18px"><a href="/">${ic('back')} Staff sign in</a></p><p class="muted" style="font-size:12px" data-footer></p></div></div></div>`;
  brandIt(); wireTheme(() => showAuth(mode, msg));
  $$('.tabs a').forEach(a => a.onclick = () => showAuth(a.dataset.m));
  $('#pf').onsubmit = async e => {
    e.preventDefault(); const b = $('button', e.target), err = $('#perr'); err.classList.add('hidden'); b.disabled = true;
    try { const d = formData(e.target);
      if (mode === 'in') showHome(await api('portal_login', d));
      else { await api('portal_register', d); showAuth('in', 'Thank you! Your request was sent. As soon as the shop approves it, come back and enter your number.'); }
    } catch (x) { if (x.unknown && mode === 'in') { showAuth('up'); const e2 = $('#perr'); e2.textContent = x.message; e2.classList.remove('hidden'); return; } err.textContent = x.message; err.classList.remove('hidden'); b.disabled = false; }
  };
}

function repairCard(r) {
  const col = (ST[r.status] || [0, '#3b82f6'])[1], idx = pIdx(r.status);
  return `<div class="card" style="--c:${col}"><div class="row" style="justify-content:space-between"><div><h3 style="margin:0;font-size:19px">${ic('mobile')} ${esc(r.device)}</h3><small class="muted">Received ${fdate(r.received_at)}</small></div>${chip(r.status)}</div>
    <p style="margin:12px 0 4px;font-weight:600">${esc(PMSG[r.status] || '')}</p>
    <div class="stepper" style="--c:${col}">${PFLOW.map((s, i) => `<div class="step ${i < idx ? 'done' : ''} ${i === idx ? 'now' : ''}"><i>${i < idx ? '✓' : i + 1}</i>${s[1]}</div>`).join('')}</div>
    <dl class="kv"><dt>Repair progress</dt><dd>${esc(stLabel(r.status))}</dd><dt>Diagnosis summary</dt><dd>${esc(r.diagnosis || 'Not available yet')}</dd><dt>Parts status</dt><dd>${esc(r.parts_status)}${r.parts.length ? `<br><small class="muted">${esc(r.parts.map(p => `${p.product} × ${p.qty}`).join(', '))}</small>` : ''}</dd>
      <dt>Expected completion</dt><dd>${r.expected_date ? fdate(r.expected_date) : 'To be confirmed'}</dd><dt>Ready</dt><dd>${r.ready || r.collected ? '<span class="chip" style="--c:#22c55e">Yes</span>' : '<span class="chip" style="--c:#f59e0b">Not yet</span>'}</dd>
      <dt>Collection</dt><dd>${r.collected ? '<span class="chip" style="--c:#22c55e">Collected</span>' : r.status === 'in_store' ? 'Kept in store' : 'Not collected'}</dd></dl>
    ${r.events.length ? `<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--primary2)">Progress history</summary><div class="tl" style="margin-top:10px">${[...r.events].reverse().map(e => `<div style="--c:${(ST[e.status] || [0, '#64748b'])[1]}">${chip(e.status)} <small class="muted">${fdt(e.ts)}</small></div>`).join('')}</div></details>` : ''}</div>`;
}
function showHome(d) {
  const first = (d.account.name || '').split(' ')[0];
  $('#app').innerHTML = head(`${themeSel()}<button class="btn" id="lo">${ic('logout')} Logout</button>`) + `<main class="view" style="max-width:1100px;margin:auto">
    <div class="page-h"><div><h2>Hello, ${esc(first)} 👋</h2><p>Live status of your devices <span class="muted">• updated <span id="upd">just now</span></span></p></div><button class="btn" id="rf">${ic('refresh')} Refresh</button></div>
    <div class="tabs" id="ptabs" style="margin-bottom:14px"><a data-t="dev" class="${PTAB === 'dev' ? 'on' : ''}">${ic('mobile')} My devices</a><a data-t="bill" class="${PTAB === 'bill' ? 'on' : ''}">${ic('dollar')} Billing</a><a data-t="msg" class="${PTAB === 'msg' ? 'on' : ''}">${ic('bell')} Messages ${d.unread_msgs ? `<span class="chip" style="--c:#ef4444">${d.unread_msgs}</span>` : ''}</a></div>
    <div id="pdev" class="${PTAB === 'dev' ? '' : 'hidden'}"><h3 style="margin-bottom:10px">${ic('tool')} My Device${d.repairs.length === 1 ? '' : 's'}</h3>
    <div class="grid g2">${d.repairs.map(repairCard).join('') || `<div class="card empty">${ic('info')}<div>You have no devices with us right now.</div></div>`}</div>
    ${(d.software || []).length ? `<h3 style="margin:22px 0 10px">${ic('zap')} Software services</h3><div class="grid g2">${d.software.map(a => `<div class="card"><div class="row" style="justify-content:space-between"><b>${esc({ repair: 'Software repair', unlock: 'Apple Unlock', newid: 'New Apple ID' }[a.kind] || a.kind)}</b>${chip(a.status)}</div><p class="muted" style="margin:6px 0">${esc(a.device)}</p><dl class="kv"><dt>Registered</dt><dd>${fdate(a.received_at)}</dd><dt>Expected</dt><dd>${a.expected_date ? fdate(a.expected_date) : 'To be confirmed'}${a.kind === 'unlock' && ['request', 'received', 'in_progress', 'waiting'].includes(a.status) && a.days_left !== null ? ` <span class="muted">(${a.days_left > 0 ? a.days_left + ' day(s) remaining' : a.days_left === 0 ? 'today' : -a.days_left + ' day(s) overdue'})</span>` : ''}</dd></dl></div>`).join('')}</div>` : ''}
    ${d.appleids.length ? `<h3 style="margin:22px 0 10px">${ic('key')} Apple ID requests</h3><div class="grid g2">${d.appleids.map(a => `<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(a.model)}</b>${chip(a.status)}</div><dl class="kv" style="margin-top:10px"><dt>Requested</dt><dd>${fdate(a.request_date)}</dd><dt>Expected</dt><dd>${a.expected_date ? fdate(a.expected_date) : 'To be confirmed'}${['request', 'received', 'progress'].includes(a.status) && a.days_left !== null ? ` <span class="muted">(${a.days_left > 0 ? a.days_left + ' day(s) remaining' : a.days_left === 0 ? 'today' : -a.days_left + ' day(s) overdue'})</span>` : ''}</dd></dl><p class="muted" style="margin:8px 0 0"><small>${ic('lock')} For your security, account credentials are never shown online.</small></p></div>`).join('')}</div>` : ''}
    ${d.regional.length ? `<h3 style="margin:22px 0 10px">${ic('globe')} Repairs sent to other regions</h3><div class="grid g2">${d.regional.map(a => `<div class="card"><div class="row" style="justify-content:space-between"><b>${esc(a.device)}</b>${chip(a.status)}</div><dl class="kv" style="margin-top:10px"><dt>Location</dt><dd>${esc(a.region || '—')}</dd><dt>Sent</dt><dd>${fdate(a.date_sent)}</dd><dt>Expected back</dt><dd>${fdate(a.expected_return)}</dd></dl></div>`).join('')}</div>` : ''}
    </div><div id="pbill" class="${PTAB === 'bill' ? '' : 'hidden'}"></div><div id="pmsg" class="${PTAB === 'msg' ? '' : 'hidden'}"></div>
    <div class="card" style="margin-top:22px"><h3>${ic('phone')} Contact us</h3><p style="margin:0">${esc([S.br.phone, S.br.email, S.br.address].filter(Boolean).join('  •  '))}</p></div></main><div class="foot" data-footer></div>`;
  brandIt(); wireTheme(() => showHome(d));
  $$('#ptabs a').forEach(a => a.onclick = () => { PTAB = a.dataset.t; showHome(d); });
  if (PTAB === 'bill') loadBills(d); if (PTAB === 'msg') loadMsgs(d);
  $('#rf').onclick = async () => { try { showHome(await api('portal_me')); toast('Updated', 'ok'); } catch (e) { toast(e.message, 'err'); } };
  $('#lo').onclick = async () => { if (await confirmBox({ title: 'Are you sure you want to logout?', message: 'You can sign in again any time.', confirmText: 'Logout', color: 'danger', icon: 'logout' })) { await api('portal_logout').catch(() => { }); showAuth(); } };
  clearInterval(PT); PT = setInterval(async () => { if ($('.ov')) return; try { const n = await api('portal_me'); showHome(n); } catch (e) { showAuth(); } }, 30000);
}

(async function () {
  try { S.br = await api('branding'); } catch (e) { S.br = {}; }
  try { showHome(await api('portal_me')); } catch (e) { showAuth(); }
})();
