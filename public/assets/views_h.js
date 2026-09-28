/* Accounting (QuickBooks-style): Sales centre, Invoices, Quotations, Inventory, Stores (suppliers + bills), Expenses */
const ACC = { cfg: null };
async function accCfg() { if (!ACC.cfg) ACC.cfg = await api('acc_settings').catch(() => ({ tax_rate: 0, inv_due_days: 0, quote_days: 14, methods: ['Cash'], adj_reasons: ['Other'] })); return ACC.cfg; }
const fq = v => { v = +v || 0; return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, ''); };
const addDays = (d, n) => { const x = new Date((d || todayStr()) + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const ITEM_TYPE = { inventory: ['Stock item', '#3b82f6', 'package'], service: ['Service', '#8b5cf6', 'zap'], non_inventory: ['Non-stock item', '#06b6d4', 'file'] };
const typeChip = t => `<span class="chip" style="--c:${(ITEM_TYPE[t] || ['', '#64748b'])[1]}">${(ITEM_TYPE[t] || [t])[0]}</span>`;
const qtyChip = i => i.type !== 'inventory' ? '<span class="muted">—</span>' : `<span class="chip" style="--c:${i.qty <= 0 ? '#ef4444' : i.low ? '#f59e0b' : '#22c55e'}">${fq(i.qty)} ${esc(i.unit || '')}${i.qty <= 0 ? ' — out' : i.low ? ' — low' : ''}</span>`;
const docChip = x => chip(x.state);
/* item lines ("name ×qty" separated by new lines) shown one under the other */
const itemsCell = s => { const ls = String(s || '').split('\n').filter(Boolean); if (!ls.length) return '<span class="muted">—</span>';
  return `<div class="li-items">${ls.slice(0, 5).map(l => { const i = l.lastIndexOf(' ×'); return `<div><span>${esc(i > 0 ? l.slice(0, i) : l)}</span>${i > 0 ? `<b>×${esc(fq(l.slice(i + 2)))}</b>` : ''}</div>`; }).join('')}${ls.length > 5 ? `<small class="muted">+${ls.length - 5} more</small>` : ''}</div>`; };
/* the whole row opens the record (buttons, links and inputs inside keep working) */
function rowOpen(box, fn) { $$('tr[data-open]', box).forEach(tr => tr.onclick = e => { if (e.target.closest('button,a,input,select,label,textarea')) return; fn(tr.dataset.open); }); }
/* money accounts on payment forms: "Deposit to" / "Paid from"; picks the account that matches the method */
const METHOD_ACCOUNT = { Cash: 'Cash', ZAAD: 'ZAAD', eDahab: 'eDahab', 'EVC / Mobile money': 'ZAAD', 'Bank transfer': 'Bank', Card: 'Bank', Cheque: 'Bank', Other: 'Cash' };
async function payAccounts() { if (!ACC.accts) ACC.accts = await api('pay_accounts').catch(() => []); return ACC.accts; }
const acctField = (accts, label = 'Deposit to account', method = 'Cash') => !accts.length ? `<label class="fld"><span>${label}</span><small class="muted" style="padding:10px 0;display:block">No accounts yet — <a href="#/accounts">add one in Accounts & Wallets</a></small></label>` : fs('account_id', label, accts.map(a => [a.id, a.name]), (accts.find(a => a.name === (METHOD_ACCOUNT[method] || method)) || accts[0]).id, { blank: false });
function syncAcct(root) { const m = $('[name=method]', root), a = $('[name=account_id]', root); if (!m || !a) return;
  m.addEventListener('change', () => { const want = METHOD_ACCOUNT[m.value] || m.value, o = [...a.options].find(x => x.textContent === want); if (o) a.value = o.value; }); }

/* ---- date range presets (shared with Reports) */
const DATE_PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['last30', 'Last 30 days'], ['this_quarter', 'This quarter'], ['this_year', 'This year'], ['last_year', 'Last year'], ['all', 'All dates'], ['custom', 'Custom…']];
function presetRange(k) {
  const t = new Date(todayStr() + 'T12:00:00'), f = d => d.toISOString().slice(0, 10), y = t.getFullYear(), m = t.getMonth(), dow = (t.getDay() + 6) % 7;
  const day = n => { const x = new Date(t); x.setDate(x.getDate() + n); return x; };
  return ({ today: [f(t), f(t)], yesterday: [f(day(-1)), f(day(-1))], this_week: [f(day(-dow)), f(t)], last_week: [f(day(-dow - 7)), f(day(-dow - 1))], this_month: [f(new Date(y, m, 1, 12)), f(t)], last_month: [f(new Date(y, m - 1, 1, 12)), f(new Date(y, m, 0, 12))],
    last30: [f(day(-29)), f(t)], this_quarter: [f(new Date(y, m - m % 3, 1, 12)), f(t)], this_year: [f(new Date(y, 0, 1, 12)), f(t)], last_year: [f(new Date(y - 1, 0, 1, 12)), f(new Date(y - 1, 11, 31, 12))], all: ['', ''] })[k] || null;
}
function dateBar(st, extra = '') {
  return `<div class="card" style="margin-bottom:14px"><form class="form acc-filter" data-df style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));align-items:end">${fs('preset', 'Date', DATE_PRESETS, st.preset || 'this_month', { blank: false })}${fi('from', 'From', st.from || '', { type: 'date' })}${fi('to', 'To', st.to || '', { type: 'date' })}${extra}<button class="btn primary">${ic('refresh')} Apply</button></form></div>`;
}
function wireDateBar(root, st, rerun) {
  const f = $('[data-df]', root); if (!f) return;
  const P = $('[name=preset]', f), A = $('[name=from]', f), B = $('[name=to]', f);
  P.onchange = () => { const r = presetRange(P.value); if (r) { A.value = r[0]; B.value = r[1]; } if (P.value !== 'custom') f.requestSubmit(); };
  [A, B].forEach(x => x.onchange = () => { P.value = 'custom'; });
  f.onsubmit = e => { e.preventDefault(); Object.assign(st, formData(f)); rerun(); };
}
function initRange(st, def = 'this_month') { if (!st.preset) { st.preset = def; const r = presetRange(def); st.from = r[0]; st.to = r[1]; } return st; }

/* ================================================================ SALES CENTRE / INVOICES / QUOTATIONS */
const SALES_ST = {};
V.sales = (root, param) => salesPage(root, 'all', param);
V.invoices = (root, param) => salesPage(root, 'invoice', param);
V.quotes = (root, param) => salesPage(root, 'quote', param);
V.receipts = (root, param) => salesPage(root, 'receipt', param);
const KIND_L = { quote: 'Quotation', invoice: 'Invoice', receipt: 'Sales receipt' };
async function salesPage(root, mode, param) {
  const st = initRange(SALES_ST[mode] ||= {}, mode === 'quote' ? 'last30' : 'this_month');
  const [ov, list] = await Promise.all([api('sales_overview'), mode === 'payments' ? [] : api('sdocs_list', { kind: mode === 'all' ? '' : mode, from: st.from, to: st.to })]);
  const back = () => salesPage(root, mode), add = can('sales', 'add');
  const card = (l, v, sub, icn, c, go) => `<div class="card stat ${go ? 'click' : ''}" style="--c:${c}" ${go ? `data-go="${go}" role="button" tabindex="0"` : ''}><div class="si">${ic(icn)}</div><div><b>${v}</b><span>${l}</span>${sub ? `<small class="muted">${sub}</small>` : ''}</div></div>`;
  const title = { all: 'Sales', invoice: 'Invoices', quote: 'Quotations', receipt: 'Sales receipts' }[mode];
  const sub = { all: 'Sales receipts, quotations, invoices and payments — balances and overdue tracking', invoice: 'Every invoice, what was paid and what is still owed', quote: 'Price offers to customers — convert to an invoice when accepted', receipt: 'Cash sales paid in full on the spot — the money goes straight into an account' }[mode];
  const newMenu = add || can('sales', 'edit') ? `<div class="rel"><button class="btn primary" id="newdd" aria-haspopup="true">${ic('plus')} New ${ic('chev-down')}</button><div class="pop small hidden new-pop" id="newpop">${add ? `<a class="mi" data-new="receipt">${ic('dollar')} Sales receipt</a><a class="mi" data-new="invoice">${ic('sheet')} Invoice</a><a class="mi" data-new="quote">${ic('file')} Quotation</a>` : ''}${can('sales', 'edit') ? `<a class="mi" id="rcv">${ic('check-circle')} Receive payment</a>` : ''}</div></div>` : '';
  root.innerHTML = pageHead(title, sub, newMenu) +
    `<div class="grid g-auto" style="margin-bottom:14px">${card('Unpaid invoices', money(ov.unpaid), `${ov.unpaid_n} open`, 'clock', '#f59e0b', 'open')}${card('Overdue', money(ov.overdue), `${ov.overdue_n} late`, 'alert', ov.overdue_n ? '#ef4444' : '#64748b', 'overdue')}${card('Paid in last 30 days', money(ov.paid30), '', 'check-circle', '#22c55e', '')}${card('Sales this month', money(ov.month_sales), `${ov.month_n} sales`, 'trend', '#4f8cff', '')}${card('Sales receipts this month', money(ov.receipts_month || 0), 'paid on the spot', 'dollar', '#10b981', 'receipt')}${card('Open quotations', ov.quotes_open, money(ov.quotes_amount), 'file', '#8b5cf6', 'pending')}</div>` +
    dateBar(st) + `<div class="tools">${searchBox('Search number, customer, items, staff…')}<span class="muted" data-count></span></div>
    <div style="margin-bottom:12px"><div class="chips" data-chips><span class="chip on" data-v="" style="--c:#64748b">All</span>${mode === 'all' ? `<span class="chip" data-v="receipt" style="--c:#10b981">Sales receipts</span><span class="chip" data-v="invoice" style="--c:#4f8cff">Invoices</span>` : ''}${['all', 'invoice'].includes(mode) ? `<span class="chip" data-v="unpaid,partial,overdue" style="--c:#f59e0b">Open (unpaid)</span><span class="chip" data-v="overdue" style="--c:#dc2626">Overdue</span><span class="chip" data-v="paid" style="--c:#22c55e">Paid</span>` : ''}${['all', 'quote'].includes(mode) ? `<span class="chip" data-v="pending" style="--c:#3b82f6">Pending quotes</span><span class="chip" data-v="accepted" style="--c:#10b981">Accepted</span><span class="chip" data-v="converted" style="--c:#8b5cf6">Converted</span><span class="chip" data-v="declined,expired" style="--c:#94a3b8">Declined / expired</span>` : ''}<span class="chip" data-v="void" style="--c:#64748b">Void</span></div></div>` +
    tbl([{ h: 'Customer', f: x => `<div class="cust-cell"><b>${esc(x.customer_name)}</b><small>${esc(x.phone || x.cphone || '')}</small></div>` },
      { h: 'No. / date', f: x => `<b class="docno">${esc(x.number)}</b><small>${KIND_L[x.kind]} • ${fdate(x.date)}</small><small>${x.kind === 'receipt' ? 'Paid on the spot' : (x.kind === 'quote' ? 'Valid to ' : 'Due ') + (x.due_date ? fdate(x.due_date) : '—')}</small>` },
      { h: 'Items', f: x => itemsCell(x.items) },
      { h: 'Total', cls: 'right', f: x => `<b>${money(x.total)}</b>` }, { h: 'Balance', cls: 'right', f: x => x.kind === 'invoice' && x.status !== 'void' ? (x.balance > .005 ? `<b style="color:#f59e0b">${money(x.balance)}</b>` : `<span class="muted">${money(0)}</span>`) : '—' },
      ...(isAdmin() ? [{ h: 'Profit', f: x => x.kind !== 'quote' && x.status !== 'void' ? money(x.profit) : '—' }] : []), { h: 'Status', f: docChip }, { h: 'By', f: x => esc(x.by_name || '—') },
      { h: '', act: 1, f: x => `<div class="acts">${x.kind === 'invoice' && x.balance > .005 && can('sales', 'edit') ? `<button class="btn sm ok" data-pay="${x.id}">${ic('dollar')} Pay</button>` : ''}${x.kind === 'quote' && ['pending', 'accepted', 'expired'].includes(x.state) && add ? `<button class="btn sm primary" data-cv="${x.id}">${ic('repeat')} To invoice</button>` : ''}</div>` }],
      list, { empty: { quote: 'No quotations in this period.', receipt: 'No sales receipts in this period. Use “New sales receipt” for a cash sale.' }[mode] || 'Nothing in this period. Create a sales receipt or an invoice.', attrs: x => `data-st="${x.state},${x.kind}" data-open="${x.id}"` });
  wireLive(root); wireDateBar(root, st, back); rowOpen(root, id => openSdoc(+id, back));
  $$('[data-go]', root).forEach(c => c.onclick = () => { const ch = $$('[data-chips] .chip', root).find(x => x.dataset.v.split(',').includes(c.dataset.go === 'open' ? 'unpaid' : c.dataset.go)); if (ch) ch.click(); else location.hash = c.dataset.go === 'pending' ? '#/quotes' : c.dataset.go === 'receipt' ? '#/sales' : '#/invoices'; });
  const pop = $('#newpop', root);
  $('#newdd', root)?.addEventListener('click', e => { e.stopPropagation(); pop.classList.toggle('hidden'); });
  document.addEventListener('click', e => { if (!e.target.closest('#newdd,#newpop')) pop?.classList.add('hidden'); });
  $$('[data-new]', root).forEach(b => b.onclick = () => { pop.classList.add('hidden'); sdocForm(b.dataset.new, null, {}, back); });
  $$('[data-od]', root).forEach(b => b.onclick = () => openSdoc(+b.dataset.od, back));
  $$('[data-pay]', root).forEach(b => b.onclick = () => receivePayment({ doc: list.find(x => x.id == b.dataset.pay) }, back));
  $$('[data-cv]', root).forEach(b => b.onclick = () => convertQuote(+b.dataset.cv, back));
  $('#rcv', root)?.addEventListener('click', () => { pop.classList.add('hidden'); receivePayment({}, back); });
  if (param && root.dataset.opened !== String(param)) { root.dataset.opened = String(param); openSdoc(+param, back); }
}

/* ---- one line of an invoice / quotation / bill */
function itemOpts(items, forBill) {
  const g = t => items.filter(i => i.type === t && (!forBill || t !== 'service'));
  const o = (i) => `<option value="${i.id}" data-rate="${forBill ? (i.cost ?? '') : i.sale_price}" data-type="${i.type}">${esc(i.name)}${i.type === 'inventory' ? ` (${fq(i.qty)} in stock)` : ''}${i.sku ? ' · ' + esc(i.sku) : ''}</option>`;
  return `<option value="">Choose item…</option>${g('inventory').length ? `<optgroup label="Stock items">${g('inventory').map(o).join('')}</optgroup>` : ''}${g('service').length ? `<optgroup label="Services">${g('service').map(o).join('')}</optgroup>` : ''}${g('non_inventory').length ? `<optgroup label="Non-stock items">${g('non_inventory').map(o).join('')}</optgroup>` : ''}<option value="custom">✎ Other — type a description</option>`;
}
function lineRow(items, l = {}, forBill = false) {
  const custom = !l.item_id && l.description;
  return `<tr class="ln"><td style="min-width:220px"><select name="item_id">${itemOpts(items, forBill)}</select><input name="description" placeholder="Description" value="${esc(l.description || '')}" style="margin-top:6px" class="${custom || l.item_id ? '' : 'hidden'}"></td>
    <td style="width:90px"><input name="qty" type="number" min="0" step="any" value="${esc(l.qty ?? 1)}"></td><td style="width:120px"><input name="rate" type="number" min="0" step="0.01" value="${esc(l.rate ?? l.cost ?? '')}"></td>
    <td style="width:120px" class="right"><b data-amt>${money(0)}</b></td><td style="width:44px"><button type="button" class="btn sm ico danger" data-rml title="Remove line">${ic('x')}</button></td></tr>`;
}
function wireLines(box, items, onCalc, prefill = []) {
  const wire = tr => {
    const sel = $('[name=item_id]', tr), desc = $('[name=description]', tr), rate = $('[name=rate]', tr);
    sel.onchange = () => { const o = sel.selectedOptions[0]; if (sel.value === 'custom') { desc.classList.remove('hidden'); desc.value = ''; desc.focus(); } else if (sel.value) { desc.classList.remove('hidden'); if (o.dataset.rate !== '') rate.value = o.dataset.rate; if (!desc.dataset.touched) desc.value = ''; desc.placeholder = 'Extra description (optional)'; } else desc.classList.add('hidden'); onCalc(); };
    desc.oninput = () => { desc.dataset.touched = '1'; };
    $('[data-rml]', tr).onclick = () => { if ($$('tr.ln', box).length > 1) { tr.remove(); onCalc(); } else { sel.value = ''; desc.value = ''; desc.classList.add('hidden'); rate.value = ''; onCalc(); } };
  };
  $$('tr.ln', box).forEach((tr, i) => { const l = prefill[i]; if (l) { const sel = $('[name=item_id]', tr); sel.value = l.item_id ? String(l.item_id) : (l.description ? 'custom' : ''); if (l.item_id && !sel.value) { sel.value = 'custom'; } } wire(tr); });
  box.addEventListener('input', onCalc); box.addEventListener('change', onCalc);
  return () => { const tb = $('tbody', box); tb.insertAdjacentHTML('beforeend', lineRow(items, {}, box.dataset.bill === '1')); wire(tb.lastElementChild); $('[name=item_id]', tb.lastElementChild).focus(); };
}
function readLines(box, rateKey = 'rate') {
  return $$('tr.ln', box).map(tr => { const v = $('[name=item_id]', tr).value; return { item_id: v && v !== 'custom' ? +v : null, description: $('[name=description]', tr).value.trim(), qty: +$('[name=qty]', tr).value || 0, [rateKey]: +$('[name=rate]', tr).value || 0 }; })
    .filter(l => l.item_id || l.description);
}

/* ---- create / edit a quotation or invoice */
async function sdocForm(kind, d, opts, done) {
  const x = d?.doc || {}, lines = d?.lines?.length ? d.lines : (opts.lines || [{}]), q = kind === 'quote', r = kind === 'receipt', edit = !!x.id, pay0 = d?.payments?.[0] || {}, used = new Set(lines.map(l => l.item_id).filter(Boolean));
  const [cfg, all, accts] = await Promise.all([accCfg(), api('items_list', { all: 1 }), payAccounts()]), items = all.filter(i => i.active || used.has(i.id));
  const cust = x.customer_id ? { id: x.customer_id, name: x.customer_name, phone: x.phone || x.cphone } : opts.customer || null;
  const date0 = x.date || todayStr(), due0 = x.due_date || (q ? addDays(date0, cfg.quote_days || 14) : addDays(date0, cfg.inv_due_days || 0));
  const TERMS = [['0', 'Due on receipt'], ['7', 'Net 7 days'], ['15', 'Net 15 days'], ['30', 'Net 30 days'], ['custom', 'Custom date']];
  const who = q ? 'Quotation for' : r ? 'Sold to' : 'Bill to';
  const m = modal({ title: `${ic(q ? 'file' : r ? 'dollar' : 'sheet')} ${edit ? 'Edit' : 'New'} ${KIND_L[kind].toLowerCase()} ${edit ? esc(x.number) : ''}`, size: 'lg', body: `<form id="sdf" novalidate>
    <div class="cust-top">${cust ? `<div class="cust-sel" id="cfix"><div class="avatar">${esc(initials(cust.name))}</div><div class="grow"><small class="muted">${who}</small><b>${esc(cust.name)}</b><small>${esc(cust.phone || '')}</small></div><a class="btn sm" id="cchg">${ic('edit')} Change</a><input type="hidden" name="customer_id" value="${cust.id}"></div><div id="cpk" class="hidden"></div>`
      : `<div class="row" style="justify-content:space-between;margin-bottom:4px"><b>${ic('user')} ${who} — customer</b><label class="row" style="gap:6px;cursor:pointer;font-size:13px"><input type="checkbox" id="walkin" ${(x.id ? !x.customer_id && (!x.customer_name || x.customer_name === 'Walk-in customer') : r) ? 'checked' : ''}> Walk-in customer (no name)</label></div><div class="form" id="cpk">${custPicker(x.customer_name && !x.customer_id && x.customer_name !== 'Walk-in customer' ? { name: x.customer_name, phone: x.phone } : {})}</div>`}</div>
    <div class="form" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${fi('date', q ? 'Quotation date' : r ? 'Sale date' : 'Invoice date', date0, { type: 'date' })}${r ? '' : q ? '' : fs('terms_sel', 'Terms', TERMS, x.id ? 'custom' : String(cfg.inv_due_days || 0) === '0' ? '0' : 'custom', { blank: false })}${r ? '' : fi('due_date', q ? 'Valid until' : 'Due date', due0, { type: 'date' })}</div>
    <div class="form" style="margin-top:6px">${sec(q ? 'What you are offering' : 'Products & services sold', 'package')}</div>
    <div class="tablewrap" id="lns" style="margin-top:8px;overflow:auto"><table class="tbl acc-lines" style="display:table"><thead><tr><th>Item / service</th><th>Qty</th><th>Rate</th><th class="right">Amount</th><th></th></tr></thead><tbody>${lines.map(l => lineRow(items, l)).join('')}</tbody></table></div>
    <div class="row" style="margin:8px 0 14px"><button type="button" class="btn sm" id="adl">${ic('plus')} Add line</button>${can('inventory', 'add') ? `<button type="button" class="btn sm ghost" id="nit">${ic('package')} New item</button>` : ''}</div>
    <div class="grid g2" style="align-items:start"><div class="form" style="grid-template-columns:1fr 1fr">${fi('discount', 'Discount (amount)', x.discount ?? 0, { type: 'number', attrs: 'min=0 step=0.01' })}${fi('tax_rate', 'Tax %', x.tax_rate ?? cfg.tax_rate ?? 0, { type: 'number', attrs: 'min=0 max=100 step=0.01' })}${ft('notes', 'Notes shown on the document', x.notes || '', { cls: 'full', ph: q ? 'e.g. Delivery in 2 days, 3-month warranty on parts' : 'e.g. Thank you for your business' })}
      ${r ? `<div class="full">${sec('Payment — paid in full now', 'dollar')}</div>${fs('method', 'Payment method', cfg.methods, pay0.method || 'Cash', { blank: false })}${accts.length ? fs('account_id', 'Deposit to account', accts.map(a => [a.id, a.name]), pay0.account_id || (accts.find(a => a.name === (METHOD_ACCOUNT[pay0.method || 'Cash'] || 'Cash')) || accts[0]).id, { blank: false }) : acctField(accts)}${fi('pay_ref', 'Payment reference', pay0.ref || '', { ph: 'ZAAD / receipt no. (optional)' })}` : ''}
      ${!q && !r && !edit ? `<div class="full">${sec('Payment received now', 'dollar')}</div>${fs('paynow', 'Customer paid', [['none', 'Nothing yet (on credit)'], ['full', 'Paid in full'], ['part', 'Part payment']], opts.cash ? 'full' : 'none', { blank: false })}${fi('pay_now', 'Amount', '', { type: 'number', attrs: 'min=0 step=0.01', cls: 'hidden' })}${fs('method', 'Method', cfg.methods, 'Cash', { blank: false })}${acctField(accts)}${fi('pay_ref', 'Payment reference', '', { ph: 'ZAAD / receipt no. (optional)' })}` : ''}</div>
      <div class="card" style="background:var(--panel2)"><div class="row" style="justify-content:space-between"><span>Subtotal</span><b id="t_sub"></b></div><div class="row" style="justify-content:space-between"><span>Discount</span><b id="t_dis"></b></div><div class="row" style="justify-content:space-between"><span>Tax</span><b id="t_tax"></b></div>
        <div class="row" style="justify-content:space-between;border-top:1px solid var(--border);padding-top:8px;margin-top:6px;font-size:19px"><b>Total</b><b id="t_tot"></b></div>${x.paid ? `<div class="row" style="justify-content:space-between"><span>Already paid</span><b>${money(x.paid)}</b></div>` : ''}</div></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="sds">${ic('check')} ${edit ? 'Save changes' : 'Save ' + KIND_L[kind].toLowerCase()}</button>`, onOpen: mm => wireCust(mm.el) });
  const el = m.el, box = $('#lns', el);
  const calc = () => { let sub = 0; $$('tr.ln', box).forEach(tr => { const a = (+$('[name=qty]', tr).value || 0) * (+$('[name=rate]', tr).value || 0); sub += a; $('[data-amt]', tr).textContent = money(a); });
    const dis = Math.min(sub, +$('[name=discount]', el).value || 0), tax = Math.round((sub - dis) * (+$('[name=tax_rate]', el).value || 0)) / 100, tot = sub - dis + tax;
    $('#t_sub').textContent = money(sub); $('#t_dis').textContent = '−' + money(dis); $('#t_tax').textContent = money(tax); $('#t_tot').textContent = money(tot); el.dataset.total = tot; };
  const addLine = wireLines(box, items, calc, lines);
  $('#adl').onclick = addLine; el.addEventListener('input', calc); calc();
  $('#nit')?.addEventListener('click', () => itemForm(null, async id => { const fresh = await api('items_list'); items.splice(0, items.length, ...fresh); addLine(); const tr = $$('tr.ln', box).pop(); const s_ = $('[name=item_id]', tr); s_.innerHTML = itemOpts(items); s_.value = String(id); s_.dispatchEvent(new Event('change')); }));
  $('#cchg')?.addEventListener('click', () => { $('#cfix').remove(); const p = $('#cpk', el); p.classList.remove('hidden'); p.className = 'form'; p.innerHTML = custPicker({}); wireCust(el); });
  const ts = $('[name=terms_sel]', el), dd = $('[name=due_date]', el), dt = $('[name=date]', el);
  const syncDue = () => { if (ts && dd && ts.value !== 'custom') dd.value = addDays(dt.value, +ts.value); };
  ts?.addEventListener('change', syncDue); dt.addEventListener('change', () => { if (!dd) return; if (q) dd.value = addDays(dt.value, cfg.quote_days || 14); else syncDue(); }); dd?.addEventListener('change', () => { if (ts) ts.value = 'custom'; });
  const pn = $('[name=paynow]', el); pn?.addEventListener('change', () => $('[name=pay_now]', el).closest('label').classList.toggle('hidden', pn.value !== 'part'));
  syncAcct(el);
  const wk = $('#walkin', el), syncWalk = () => $('#cpk', el).classList.toggle('hidden', !!wk?.checked); wk?.addEventListener('change', syncWalk); syncWalk();
  $('#sds').onclick = () => safe(async () => {
    const f = formData($('#sdf', el)), ls = readLines(box); if (!ls.length) return toast('Add at least one line', 'err');
    const body = { id: x.id, kind, lines: ls, date: f.date, due_date: f.due_date, discount: f.discount, tax_rate: f.tax_rate, notes: f.notes, terms: ts ? ts.selectedOptions[0].textContent : '' };
    const walk = !!wk?.checked;
    if (f.customer_id && !walk) body.customer_id = f.customer_id; else if (!walk && f.customer_name && f.customer_phone) { body.customer_name = f.customer_name; body.customer_phone = f.customer_phone; body.gender = f.gender; } else if (!walk && f.customer_name) body.customer_name = f.customer_name;
    if (!walk && !body.customer_id && !body.customer_name && !q && !r) return toast('Enter the customer (or tick “Walk-in customer”)', 'err');
    if (r) { body.method = f.method; body.account_id = f.account_id; body.pay_ref = f.pay_ref; delete body.due_date; }
    if (pn) { body.pay_now = pn.value === 'full' ? el.dataset.total : pn.value === 'part' ? f.pay_now : 0; body.method = f.method; body.pay_ref = f.pay_ref; body.account_id = f.account_id; }
    const res = await api('sdoc_save', body); m.close(); toast(`${KIND_L[kind]} ${res.number} saved — ${money(res.total)}`, 'ok'); done?.(); openSdoc(res.id, done);
  });
}

/* ---- view one quotation / invoice */
async function openSdoc(id, onChange) {
  const d = await safe(() => api('sdoc_get', { id })); if (!d) return;
  const x = d.doc, q = x.kind === 'quote', rc = x.kind === 'receipt', ed = can('sales', 'edit'), live = !['void', 'converted'].includes(x.status), p0 = d.payments[0];
  const m = modal({ title: `${ic(q ? 'file' : rc ? 'dollar' : 'sheet')} ${KIND_L[x.kind]} ${esc(x.number)} ${docChip(x)}`, size: 'lg', body: `
    <div class="doc-head"><div class="grow"><small class="muted">${q ? 'QUOTATION FOR' : rc ? 'SOLD TO' : 'BILL TO'}</small><div class="doc-cust">${x.customer_id ? custLink(x.customer_id, x.customer_name) : esc(x.customer_name)}</div><small class="muted">${esc([x.phone || x.cphone, x.cemail, x.caddress].filter(Boolean).join(' • '))}</small></div>
      <div class="doc-big">${rc ? `<small>${x.status === 'void' ? 'VOID' : 'PAID IN FULL'}</small><b style="color:${x.status === 'void' ? 'var(--muted)' : '#22c55e'}">${money(x.total)}</b>` : `<small>${q ? 'AMOUNT' : x.status === 'void' ? 'VOID' : 'BALANCE DUE'}</small><b style="color:${q || x.balance <= .005 ? 'var(--text)' : '#f59e0b'}">${money(q ? x.total : Math.max(0, x.balance))}</b>${!q && x.status !== 'void' ? `<small>of ${money(x.total)}</small>` : ''}`}</div></div>
    <div class="doc-meta"><div><small>${KIND_L[x.kind]} no.</small><b>${esc(x.number)}</b></div><div><small>Date</small><b>${fdate(x.date)}</b></div>${rc ? `<div><small>Payment</small><b>${esc(p0 ? p0.method + (p0.account ? ' → ' + p0.account : '') : '—')}</b></div>` : `<div><small>${q ? 'Valid until' : 'Due date'}</small><b>${x.due_date ? fdate(x.due_date) : '—'}</b></div>`}${x.terms ? `<div><small>Terms</small><b>${esc(x.terms)}</b></div>` : ''}<div><small>Created by</small><b>${esc(x.by_name || '—')}</b></div>${d.link ? `<div><small>${q ? 'Invoice' : 'From quotation'}</small><b><a data-link="${d.link.id}" style="cursor:pointer">${esc(d.link.number)}</a></b></div>` : ''}</div>
    ${x.status === 'void' ? `<div class="notice" style="margin:10px 0">${ic('alert')}<span>This document is <b>void</b>${x.void_reason ? ': ' + esc(x.void_reason) : ''}. It does not count in sales or stock.</span></div>` : ''}
    <div style="margin-top:12px">${tbl([{ h: 'Item / service', f: l => `<b>${esc(l.item || l.description)}</b>${l.item && l.description ? `<small>${esc(l.description)}</small>` : ''}` }, { h: 'Type', f: l => l.item_type ? typeChip(l.item_type) : '<span class="chip" style="--c:#64748b">Custom</span>' }, { h: 'Qty', f: l => fq(l.qty) }, { h: 'Rate', f: l => money(l.rate) }, ...(isAdmin() && !q ? [{ h: 'Cost', f: l => money(l.unit_cost * l.qty) }] : []), { h: 'Amount', cls: 'right', f: l => `<b>${money(l.amount)}</b>` }], d.lines)}</div>
    <div class="grid g2" style="margin-top:12px;align-items:start"><div>${!q ? `<h3 style="margin:0 0 6px">${ic('dollar')} Payments</h3>${d.payments.length ? d.payments.map(p => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--border);padding:6px 0"><span>${fdate(p.date)} • ${esc(p.method)}${p.account ? ' → ' + esc(p.account) : ''}${p.ref ? ' • ' + esc(p.ref) : ''} <small class="muted">by ${esc(p.by_name || '')}</small></span><span class="row"><b>${money(p.amount)}</b>${can('sales', 'delete') && !rc ? `<button class="btn sm ico danger" data-dpay="${p.id}" title="Delete payment">${ic('trash')}</button>` : ''}</span></div>`).join('') : '<p class="muted">No payments yet.</p>'}` : ''}${x.notes ? `<p class="muted" style="white-space:pre-wrap">${esc(x.notes)}</p>` : ''}</div>
      <div class="card" style="background:var(--panel2)"><div class="row" style="justify-content:space-between"><span>Subtotal</span><b>${money(x.subtotal)}</b></div>${+x.discount ? `<div class="row" style="justify-content:space-between"><span>Discount</span><b>−${money(x.discount)}</b></div>` : ''}${+x.tax ? `<div class="row" style="justify-content:space-between"><span>Tax (${+x.tax_rate}%)</span><b>${money(x.tax)}</b></div>` : ''}
        <div class="row" style="justify-content:space-between;border-top:1px solid var(--border);padding-top:8px;margin-top:6px;font-size:18px"><b>Total</b><b>${money(x.total)}</b></div>${!q ? `<div class="row" style="justify-content:space-between"><span>Paid</span><b>${money(x.paid)}</b></div><div class="row ${rc ? 'hidden' : ''}" style="justify-content:space-between;font-size:16px"><b>Balance due</b><b style="color:${x.balance > .005 ? '#f59e0b' : '#22c55e'}">${money(Math.max(0, x.balance))}</b></div>${isAdmin() && x.cost !== undefined && x.status !== 'void' ? `<div class="row" style="justify-content:space-between"><span class="muted">Gross profit</span><span class="muted">${money(x.total - x.tax - x.cost)}</span></div>` : ''}` : ''}</div></div>`,
    footer: `<div class="row" style="flex:1;flex-wrap:wrap;gap:6px">${can('sales', 'delete') ? `<button class="btn sm danger" id="sdel">${ic('trash')} Delete</button>` : ''}${ed && x.status !== 'void' ? `<button class="btn sm warn" id="svoid">${ic('x')} Void</button>` : ''}${q && ed && live ? `<button class="btn sm" data-qs="accepted">${ic('check')} Accepted</button><button class="btn sm" data-qs="declined">${ic('x')} Declined</button>` : ''}</div>
      <button class="btn" id="sprt">${ic('print')} Print / PDF</button>${!q && !rc && d.payments.length ? `<button class="btn" id="srct">${ic('file')} Receipt</button>` : ''}${can('sales', 'add') ? `<button class="btn" id="sdup">${ic('repeat')} Duplicate</button>` : ''}${ed && live ? `<button class="btn" id="sedt">${ic('edit')} Edit</button>` : ''}${q && live && can('sales', 'add') && x.state !== 'declined' ? `<button class="btn primary" id="scv">${ic('repeat')} Convert to invoice</button>` : ''}${!q && !rc && x.balance > .005 && ed && x.status !== 'void' ? `<button class="btn ok" id="spay">${ic('dollar')} Receive payment</button>` : ''}` });
  const again = () => { m.close(); onChange?.(); openSdoc(id, onChange); };
  $('#sprt', m.el).onclick = () => Docs.sdoc(d); $('#srct', m.el)?.addEventListener('click', () => Docs.sdocReceipt(d));
  $('[data-link]', m.el)?.addEventListener('click', e => { m.close(); openSdoc(+e.target.dataset.link, onChange); });
  $('#sedt', m.el)?.addEventListener('click', () => { m.close(); sdocForm(x.kind, d, {}, onChange); });
  $('#sdup', m.el)?.addEventListener('click', () => { m.close(); sdocForm(x.kind, null, { lines: d.lines.map(l => ({ item_id: l.item_id, description: l.description, qty: l.qty, rate: l.rate })), customer: x.customer_id ? { id: x.customer_id, name: x.customer_name, phone: x.phone } : null }, onChange); });
  $('#scv', m.el)?.addEventListener('click', () => { m.close(); convertQuote(id, onChange); });
  $('#spay', m.el)?.addEventListener('click', () => { m.close(); receivePayment({ doc: x }, () => { onChange?.(); openSdoc(id, onChange); }); });
  $$('[data-qs]', m.el).forEach(b => b.onclick = () => safe(async () => { await api('sdoc_status', { id, status: b.dataset.qs }); toast('Quotation marked ' + b.dataset.qs, 'ok'); again(); }));
  $$('[data-dpay]', m.el).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this payment?', message: 'The invoice balance goes up again by this amount.', confirmText: 'Delete' })) safe(async () => { await api('cust_pay_delete', { id: +b.dataset.dpay }); toast('Payment deleted', 'ok'); again(); }); });
  $('#svoid', m.el)?.addEventListener('click', async () => { const why = await reasonBox({ title: `Void ${x.number}?`, message: 'The document stays in the list, marked VOID, and stops counting in sales. Stock taken out by it goes back.', warning: rc ? 'The money of this receipt is taken back out of its account.' : 'Payments must be deleted first.' }); if (why !== null) safe(async () => { await api('sdoc_void', { id, reason: why }); toast(`${x.number} voided`, 'ok'); again(); }); });
  $('#sdel', m.el)?.addEventListener('click', async () => { if (await confirmBox({ title: `Delete ${x.number}?`, message: 'It is removed completely (stock goes back). Voiding keeps a record — usually better.', confirmText: 'Delete' })) safe(async () => { await api('sdoc_delete', { id }); m.close(); toast('Deleted', 'ok'); onChange?.(); }); });
}
async function convertQuote(id, done) {
  if (!await confirmBox({ title: 'Convert this quotation to an invoice?', message: 'An invoice is created with the same customer and lines. Stock items are taken out of stock now.', confirmText: 'Create invoice', color: 'primary', icon: 'repeat' })) return;
  const r = await safe(() => api('sdoc_convert', { id })); if (!r) return;
  toast(`Invoice ${r.number} created`, 'ok'); done?.(); openSdoc(r.id, done);
}

/* ---- receive payment: one amount spread over a customer's open invoices (oldest first) */
async function receivePayment(opts, done) {
  const [cfg, accts] = await Promise.all([accCfg(), payAccounts()]);
  const open = opts.doc ? [opts.doc] : await api('sdocs_list', { kind: 'invoice', status: 'open' });
  if (!open.length) return toast('There are no unpaid invoices.', 'ok');
  const custs = [...new Map(open.map(x => [x.customer_id || 'w:' + x.customer_name, [x.customer_id || 'w:' + x.customer_name, `${x.customer_name} — owes ${money(open.filter(y => (y.customer_id || 'w:' + y.customer_name) === (x.customer_id || 'w:' + x.customer_name)).reduce((a, y) => a + y.balance, 0))}`]])).values()];
  const m = modal({ title: `${ic('dollar')} Receive payment`, size: 'lg', body: `<form id="rpf" class="form" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${opts.doc ? `<div class="full notice info">${ic('user')}<span>${esc(opts.doc.customer_name)} — invoice <b>${esc(opts.doc.number)}</b></span></div>` : fs('cust', 'Customer', custs, custs[0][0], { blank: false, cls: 'full' })}
    ${fi('amount', 'Amount received', '', { type: 'number', attrs: 'min=0 step=0.01', req: 1 })}${fi('date', 'Date', todayStr(), { type: 'date' })}${fs('method', 'Method', cfg.methods, 'Cash', { blank: false })}${acctField(accts)}${fi('ref', 'Reference', '', { ph: 'ZAAD / cheque / receipt no.' })}${fi('note', 'Note', '', { cls: 'full' })}</form>
    <h3 style="margin:14px 0 6px">${ic('sheet')} Apply to invoices <small class="muted" style="font-weight:400">— oldest first; change the amounts if you like</small></h3><div id="rpl"></div><div class="row" style="justify-content:flex-end;margin-top:8px;font-size:16px"><span>Applied:&nbsp;</span><b id="rpa">${money(0)}</b></div>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn ok" id="rps">${ic('check')} Save payment</button>` });
  const el = m.el, pick = () => opts.doc ? open : open.filter(x => String(x.customer_id || 'w:' + x.customer_name) === $('[name=cust]', el).value).sort((a, b) => (a.due_date || a.date).localeCompare(b.due_date || b.date));
  const sumApplied = () => { const t = $$('[data-al]', el).reduce((a, i) => a + (+i.value || 0), 0); $('#rpa').textContent = money(t); return t; };
  const spread = () => { let left = +$('[name=amount]', el).value || 0; $$('[data-al]', el).forEach(i => { const b = +i.dataset.bal, v = Math.min(b, left); i.value = v > 0 ? v.toFixed(2) : ''; left -= v; }); sumApplied(); };
  const draw = () => { const ls = pick(); $('#rpl').innerHTML = tbl([{ h: 'Invoice', f: x => `<b>${esc(x.number)}</b>` }, { h: 'Date', f: x => fdate(x.date) }, { h: 'Due', f: x => x.due_date ? fdate(x.due_date) : '—' }, { h: 'Status', f: docChip }, { h: 'Total', f: x => money(x.total) }, { h: 'Balance', f: x => `<b>${money(x.balance)}</b>` }, { h: 'Payment', f: x => `<input type="number" min="0" step="0.01" data-al="${x.id}" data-bal="${x.balance}" style="width:120px">` }], ls);
    $('[name=amount]', el).value = ls.reduce((a, x) => a + x.balance, 0).toFixed(2); spread(); $$('[data-al]', el).forEach(i => i.oninput = sumApplied); };
  $('[name=cust]', el)?.addEventListener('change', draw); $('[name=amount]', el).addEventListener('input', spread); draw(); syncAcct(el);
  $('#rps').onclick = () => safe(async () => { const f = formData($('#rpf', el)), allocations = $$('[data-al]', el).map(i => ({ doc_id: +i.dataset.al, amount: +i.value || 0 })).filter(a => a.amount > 0);
    if (!allocations.length) return toast('Enter the amount received', 'err');
    const r = await api('cust_pay', { allocations, date: f.date, method: f.method, account_id: f.account_id, ref: f.ref, note: f.note }); m.close(); toast(`Payment of ${money(r.received)} saved`, 'ok'); done?.(); });
}

/* ================================================================ INVENTORY */
V.inventory = async (root, param) => {
  const tab = root.dataset.itab || 'items', adm = isAdmin();
  const [ov, items] = await Promise.all([api('inv_overview'), api('items_list', { all: 1 })]);
  const back = () => V.inventory(root);
  root.innerHTML = pageHead('Inventory', 'Stock items, services and non-stock items — quantity on hand, average cost and every movement',
    `${can('stores', 'add') ? `<button class="btn" id="ipb">${ic('download')} Buy stock (bill)</button>` : ''}${can('inventory', 'edit') ? `<button class="btn" id="iad">${ic('sliders')} Adjust stock</button>` : ''}${can('inventory', 'add') ? `<button class="btn primary" id="ini">${ic('plus')} New item</button>` : ''}`) +
    `<div class="grid g-auto" style="margin-bottom:14px">${statCard('Active items', ov.items, 'package', '#4f8cff')}${statCard('Units in stock', fq(ov.units), 'store', '#10b981')}${adm ? statCard('Stock value (cost)', money(ov.value), 'dollar', '#8b5cf6') : ''}${statCard('Stock value (sale price)', money(ov.retail), 'trend', '#06b6d4')}${statCard('Low stock', ov.low, 'alert', ov.low ? '#f59e0b' : '#64748b')}${statCard('Out of stock', ov.out, 'x', ov.out ? '#ef4444' : '#64748b')}</div>` +
    tabsBar([['items', 'Items', 'package'], ['moves', 'Stock movements', 'list']], tab) + '<div id="ibx" style="margin-top:12px"></div>';
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.itab = a.dataset.tab; back(); });
  $('#ini')?.addEventListener('click', () => itemForm(null, back));
  $('#iad')?.addEventListener('click', () => adjustForm(null, items, back));
  $('#ipb')?.addEventListener('click', () => billForm(null, {}, back));
  const box = $('#ibx');
  if (tab === 'items') {
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
    box.innerHTML = `<div class="tools">${searchBox('Search name, SKU, category, store…')}<span class="muted" data-count></span></div><div style="margin-bottom:12px"><div class="chips" data-chips><span class="chip on" data-v="" style="--c:#64748b">All</span><span class="chip" data-v="inventory" style="--c:#3b82f6">Stock items</span><span class="chip" data-v="service" style="--c:#8b5cf6">Services</span><span class="chip" data-v="non_inventory" style="--c:#06b6d4">Non-stock</span><span class="chip" data-v="low" style="--c:#f59e0b">Low / out</span><span class="chip" data-v="inactive" style="--c:#64748b">Inactive</span>${cats.map(c => `<span class="chip" data-v="cat:${esc(c)}" style="--c:var(--primary)">${esc(c)}</span>`).join('')}</div></div>` +
      tbl([{ h: 'Item', f: i => `<b>${esc(i.name)}</b><small>${esc([i.sku, i.category].filter(Boolean).join(' • '))}</small>` }, { h: 'Type', f: i => typeChip(i.type) + (i.active ? '' : ' <span class="chip" style="--c:#64748b">Inactive</span>') }, { h: 'On hand', f: qtyChip }, { h: 'Reorder at', f: i => i.type === 'inventory' ? i.reorder : '—' },
        ...(adm ? [{ h: 'Avg. cost', f: i => i.type === 'service' ? '—' : money(i.cost) }, { h: 'Stock value', f: i => i.type === 'inventory' ? money(i.value) : '—' }] : []), { h: 'Sale price', f: i => money(i.sale_price) }, { h: 'Usual store', f: i => esc(i.vendor || '—') },
        { h: '', act: 1, f: i => `<div class="acts">${i.type === 'inventory' ? `<button class="btn sm ico" data-led="${i.id}" title="Stock history">${ic('clock')}</button>${can('inventory', 'edit') ? `<button class="btn sm ico" data-adj="${i.id}" title="Adjust stock">${ic('sliders')}</button>` : ''}` : ''}${can('inventory', 'edit') ? `<button class="btn sm ico" data-ei="${i.id}" title="Edit">${ic('edit')}</button>` : ''}${can('inventory', 'delete') ? `<button class="btn sm ico danger" data-di="${i.id}" title="Delete">${ic('trash')}</button>` : ''}</div>` }],
        items, { empty: 'No items yet. Add your products, parts and services with “New item”.', attrs: i => `data-open="${i.id}" data-st="${i.type},${i.low ? 'low' : ''},${i.active ? '' : 'inactive'},cat:${esc(i.category || '')}"` });
    wireLive(box);
    const find = id => items.find(i => i.id == id);
    rowOpen(box, id => { const i = find(id); if (i.type === 'inventory') itemLedger(i.id); else if (can('inventory', 'edit')) itemForm(i, back); });
    $$('[data-ei]', box).forEach(b => b.onclick = () => itemForm(find(b.dataset.ei), back));
    $$('[data-led]', box).forEach(b => b.onclick = () => itemLedger(+b.dataset.led));
    $$('[data-adj]', box).forEach(b => b.onclick = () => adjustForm(find(b.dataset.adj), items, back));
    $$('[data-di]', box).forEach(b => b.onclick = async () => { const i = find(b.dataset.di); if (await confirmBox({ title: `Delete ${esc(i.name)}?`, message: 'An item that was already bought, sold or used is made <b>inactive</b> instead, so history stays correct.', confirmText: 'Delete' })) safe(async () => { const r = await api('item_delete', { id: i.id }); toast(r.deactivated ? 'Item has history — made inactive' : 'Item deleted', 'ok'); back(); }); });
  } else {
    const st = initRange(root._mst ||= {}, 'last30');
    const mv = await api('stock_moves', { from: st.from, to: st.to });
    box.innerHTML = dateBar(st) + `<div class="tools">${searchBox('Search item, reference, customer, store, user…')}<span class="muted" data-count></span></div><div style="margin-bottom:12px"><div class="chips" data-chips><span class="chip on" data-v="" style="--c:#64748b">All</span>${[['opening', 'Opening', '#64748b'], ['purchase', 'Purchases', '#3b82f6'], ['sale', 'Sales', '#22c55e'], ['repair', 'Repairs', '#8b5cf6'], ['adjust', 'Adjustments', '#f59e0b']].map(x => `<span class="chip" data-v="${x[0]}" style="--c:${x[2]}">${x[1]}</span>`).join('')}</div></div>` +
      tbl([{ h: 'Date', f: x => fdate(x.date) }, { h: 'Item', f: x => `<b>${esc(x.item)}</b>` }, { h: 'Movement', f: x => esc(x.label) }, { h: 'Reference', f: x => esc(x.ref || '—') }, { h: 'Qty', f: x => `<b style="color:${x.qty > 0 ? '#22c55e' : '#ef4444'}">${x.qty > 0 ? '+' : ''}${fq(x.qty)}</b>` }, ...(adm ? [{ h: 'Unit cost', f: x => money(x.unit_cost) }] : []), { h: 'Customer / store', f: x => esc(x.customer || x.vendor || '—') }, { h: 'Note', f: x => esc(x.note || '') }, { h: 'By', f: x => esc(x.by_name || '—') }],
        mv, { empty: 'No stock movements in this period.', attrs: x => `data-st="${x.kind}"` });
    wireLive(box); wireDateBar(box, st, back);
  }
  if (param && root.dataset.opened !== String(param)) { root.dataset.opened = String(param); const i = items.find(x => x.id == param); if (i?.type === 'inventory') itemLedger(i.id); else if (i && can('inventory', 'edit')) itemForm(i, back); }
};
async function itemForm(it, done) {
  const vendors = await api('vendors_list').catch(() => []), items = await api('items_list', { all: 1 }).catch(() => []), cats = [...new Set(items.map(i => i.category).filter(Boolean))].sort(), adm = isAdmin();
  const t0 = it?.type || 'inventory';
  const m = modal({ title: `${ic('package')} ${it ? 'Edit item' : 'New item'}`, body: `<form class="form" id="itf" novalidate>${fs('type', 'Type', [['inventory', 'Stock item — count the quantity (phones, screens, batteries…)'], ['service', 'Service — no stock (repair labour, unlocking…)'], ['non_inventory', 'Non-stock item — sold but not counted']], t0, { blank: false, cls: 'full' })}
    ${fi('name', 'Name', it?.name, { req: 1 })}${fi('sku', 'SKU / code', it?.sku, { ph: 'optional' })}<label class="fld"><span>Category</span><input name="category" list="icats" value="${esc(it?.category || '')}" placeholder="e.g. Screens, Batteries, Accessories"><datalist id="icats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></label>${fi('unit', 'Unit', it?.unit || 'pcs', { attrs: 'maxlength=12' })}
    ${fi('sale_price', 'Sale price', it?.sale_price ?? '', { type: 'number', attrs: 'min=0 step=0.01' })}<span data-t="inventory">${fi('reorder', 'Low-stock alert at', it?.reorder ?? 2, { type: 'number', attrs: 'min=0' })}</span><span data-t="non_inventory">${adm ? fi('cost', 'Cost price', it?.cost ?? '', { type: 'number', attrs: 'min=0 step=0.01' }) : ''}</span>
    <span data-t="inventory,non_inventory">${fs('vendor_id', 'Usual store / supplier', vendors.filter(v => v.active).map(v => [v.id, v.name]), it?.vendor_id || '', { blank: '— None —' })}</span>${ft('description', 'Description (shown on invoices)', it?.description || '', { cls: 'full' })}
    ${!it ? `<div class="full" data-t="inventory">${sec('Opening stock (optional)', 'download')}<p class="muted" style="margin:0">Stock you already have today. Later purchases are entered as bills from a store.</p></div><span data-t="inventory">${fi('opening_qty', 'Quantity on hand now', '', { type: 'number', attrs: 'min=0 step=any' })}</span><span data-t="inventory">${fi('opening_cost', 'Cost per unit', '', { type: 'number', attrs: 'min=0 step=0.01' })}</span><span data-t="inventory">${fi('opening_date', 'As of date', todayStr(), { type: 'date' })}</span>` : ''}
    ${it ? `<label class="row full" style="gap:8px;cursor:pointer"><input type="checkbox" name="active" ${it.active ? 'checked' : ''}> Active (shown when selling)</label>` : ''}</form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="its">${ic('check')} Save item</button>` });
  const sync = () => { const t = $('[name=type]', m.el).value; $$('[data-t]', m.el).forEach(x => x.classList.toggle('hidden', !x.dataset.t.split(',').includes(t))); };
  $('[name=type]', m.el).onchange = sync; sync();
  $('#its').onclick = () => safe(async () => { const f = formData($('#itf', m.el)); if (!it) delete f.active; const r = await api('item_save', { ...f, id: it?.id }); m.close(); toast('Item saved', 'ok'); done?.(r.id); });
}
async function itemLedger(id) {
  const d = await safe(() => api('item_ledger', { id })); if (!d) return; const i = d.item;
  modal({ title: `${ic('clock')} ${esc(i.name)} — stock history`, size: 'lg', body: `<div class="grid g-auto" style="margin-bottom:12px">${statCard('On hand', fq(i.qty) + ' ' + esc(i.unit || ''), 'package', '#10b981')}${isAdmin() ? statCard('Average cost', money(i.cost), 'dollar', '#8b5cf6') + statCard('Value', money(i.qty * i.cost), 'trend', '#06b6d4') : ''}${statCard('Sale price', money(i.sale_price), 'cart', '#4f8cff')}</div>` +
    tbl([{ h: 'Date', f: m => fdate(m.date) }, { h: 'Movement', f: m => esc(m.label) }, { h: 'Reference', f: m => esc(m.ref || '—') }, { h: 'In / out', f: m => `<b style="color:${m.qty > 0 ? '#22c55e' : '#ef4444'}">${m.qty > 0 ? '+' : ''}${fq(m.qty)}</b>` }, { h: 'Balance', f: m => `<b>${fq(m.balance)}</b>` }, ...(isAdmin() ? [{ h: 'Unit cost', f: m => money(m.unit_cost) }] : []), { h: 'Customer / store', f: m => esc(m.customer || m.vendor || '—') }, { h: 'Note', f: m => esc(m.note || '') }, { h: 'By', f: m => esc(m.by_name || '—') }], d.moves, { empty: 'No movements yet.' }),
    footer: '<button class="btn primary" data-close>Close</button>' });
}
async function adjustForm(it, items, done) {
  const cfg = await accCfg(), stock = items.filter(i => i.type === 'inventory' && i.active);
  if (!stock.length) return toast('Add a stock item first', 'err');
  const m = modal({ title: `${ic('sliders')} Adjust stock`, size: 'sm', body: `<form class="form" id="adf" style="grid-template-columns:1fr">${fs('item_id', 'Item', stock.map(i => [i.id, `${i.name} (${fq(i.qty)} on hand)`]), it?.id || '', { req: 1 })}
    ${fs('mode', 'Adjustment', [['set', 'Set the counted quantity'], ['change', 'Add (+) or remove (−) a quantity']], 'set', { blank: false })}${fi('qty', 'Quantity', it ? fq(it.qty) : '', { type: 'number', attrs: 'step=any', req: 1 })}
    ${fs('reason', 'Reason', cfg.adj_reasons, cfg.adj_reasons[0], { blank: false })}${fi('date', 'Date', todayStr(), { type: 'date' })}${isAdmin() ? fi('unit_cost', 'Cost per unit for added stock (optional)', '', { type: 'number', attrs: 'min=0 step=0.01' }) : ''}${fi('note', 'Note', '')}
    <div class="notice info">${ic('info')}<span id="adh">Enter what you physically counted.</span></div></form>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="ads">${ic('check')} Save adjustment</button>` });
  const el = m.el, hint = () => { const i = stock.find(x => x.id == $('[name=item_id]', el).value), md = $('[name=mode]', el).value, q = +$('[name=qty]', el).value || 0; $('#adh').textContent = !i ? 'Choose an item.' : md === 'set' ? `System has ${fq(i.qty)} — the difference ${q - i.qty >= 0 ? '+' : ''}${fq(q - i.qty)} is recorded.` : `New quantity will be ${fq(i.qty + q)}.`; };
  el.addEventListener('input', hint); el.addEventListener('change', hint); hint();
  $('#ads').onclick = () => safe(async () => { const r = await api('stock_adjust', formData($('#adf', el))); m.close(); toast(`Stock adjusted — now ${fq(r.qty)}`, 'ok'); done?.(); });
}

/* ================================================================ STORES (suppliers), BILLS, PAYMENTS */
V.stores = async (root, param) => {
  const tab = root.dataset.vtab || 'stores', list = await api('vendors_list'), back = () => V.stores(root), money_ = can('stores', 'view');
  const owed = list.reduce((a, v) => a + (v.owed || 0), 0);
  root.innerHTML = pageHead('Stores / Suppliers', 'Where you buy stock: bills (purchases), payments to each store and what you still owe',
    `${can('stores', 'edit') ? `<button class="btn ok" id="vpy">${ic('dollar')} Pay a store</button>` : ''}${can('stores', 'add') ? `<button class="btn" id="vnb">${ic('download')} New bill (purchase)</button><button class="btn primary" id="vns">${ic('plus')} Add store</button>` : ''}`) +
    (money_ ? `<div class="grid g-auto" style="margin-bottom:14px">${statCard('Stores', list.filter(v => v.active).length, 'store', '#4f8cff')}${statCard('Total owed to stores', money(owed), 'alert', owed > .005 ? '#f59e0b' : '#22c55e')}${statCard('Total purchased', money(list.reduce((a, v) => a + (v.billed || 0), 0)), 'download', '#8b5cf6')}${statCard('Total paid to stores', money(list.reduce((a, v) => a + (v.paid || 0), 0)), 'check-circle', '#10b981')}</div>` : '') +
    tabsBar([['stores', 'Stores', 'store'], ['bills', 'Bills (purchases)', 'file']], tab) + '<div id="vbx" style="margin-top:12px"></div>';
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.vtab = a.dataset.tab; back(); });
  $('#vns')?.addEventListener('click', () => vendorForm(null, back)); $('#vnb')?.addEventListener('click', () => billForm(null, {}, back)); $('#vpy')?.addEventListener('click', () => payStore({}, back));
  const box = $('#vbx');
  if (tab === 'stores') {
    box.innerHTML = `<div class="tools">${searchBox('Search stores…')}<span class="muted" data-count></span></div>` +
      tbl([{ h: 'Store', f: v => `<b>${esc(v.name)}</b>${v.active ? '' : ' <span class="chip" style="--c:#64748b">Inactive</span>'}<small>${esc(v.notes || '')}</small>` }, { h: 'Contact', f: v => `${esc(v.contact || '—')}<small>${esc([v.phone, v.email].filter(Boolean).join(' • '))}</small>` },
        ...(money_ ? [{ h: 'Bills', f: v => v.bills }, { h: 'Purchased', f: v => money(v.billed) }, { h: 'Paid', f: v => money(v.paid) }, { h: 'You owe', f: v => `<b style="color:${v.owed > .005 ? '#f59e0b' : '#22c55e'}">${money(v.owed)}</b>` }, { h: 'Last purchase', f: v => v.last ? fdate(v.last) : '—' }] : []),
        { h: '', act: 1, f: v => `<div class="acts">${money_ ? `<button class="btn sm" data-ov="${v.id}">${ic('eye')} Open</button>` : ''}${v.owed > .005 && can('stores', 'edit') ? `<button class="btn sm ok" data-pv="${v.id}">${ic('dollar')} Pay</button>` : ''}${can('stores', 'edit') ? `<button class="btn sm ico" data-ev="${v.id}" title="Edit">${ic('edit')}</button>` : ''}${can('stores', 'delete') ? `<button class="btn sm ico danger" data-dv="${v.id}" title="Delete">${ic('trash')}</button>` : ''}</div>` }],
        list, { empty: 'No stores yet. Add the shops / suppliers you buy from.', attrs: v => money_ ? `data-open="${v.id}"` : '' });
    wireLive(box);
    const find = id => list.find(v => v.id == id);
    $$('[data-ov]', box).forEach(b => b.onclick = () => storeDetail(+b.dataset.ov, back)); rowOpen(box, id => storeDetail(+id, back));
    $$('[data-pv]', box).forEach(b => b.onclick = () => payStore({ vendor_id: +b.dataset.pv }, back));
    $$('[data-ev]', box).forEach(b => b.onclick = () => vendorForm(find(b.dataset.ev), back));
    $$('[data-dv]', box).forEach(b => b.onclick = async () => { const v = find(b.dataset.dv); if (await confirmBox({ title: `Delete ${esc(v.name)}?`, message: 'A store with bills or expenses is made inactive instead.', confirmText: 'Delete' })) safe(async () => { const r = await api('vendor_delete', { id: v.id }); toast(r.deactivated ? 'Store has history — made inactive' : 'Store deleted', 'ok'); back(); }); });
  } else {
    const st = initRange(root._bst ||= {}, 'this_year'), bills = await api('bills_list', { from: st.from, to: st.to });
    box.innerHTML = dateBar(st) + `<div class="tools">${searchBox('Search bill, store, items…')}<span class="muted" data-count></span></div><div style="margin-bottom:12px"><div class="chips" data-chips><span class="chip on" data-v="" style="--c:#64748b">All</span><span class="chip" data-v="unpaid,partial,overdue" style="--c:#f59e0b">Owed</span><span class="chip" data-v="overdue" style="--c:#dc2626">Overdue</span><span class="chip" data-v="paid" style="--c:#22c55e">Paid</span><span class="chip" data-v="void" style="--c:#64748b">Void</span></div></div>` +
      billsTable(bills) ;
    wireLive(box); wireDateBar(box, st, back); wireBills(box, bills, back);
  }
  if (param && root.dataset.opened !== String(param)) { root.dataset.opened = String(param); storeDetail(+param, back); }
};
const billsTable = bills => tbl([{ h: 'Date', f: b => fdate(b.date) + `<small>due ${b.due_date ? fdate(b.due_date) : '—'}</small>` }, { h: 'Bill', f: b => `<b>${esc(b.number)}</b><small>${esc(b.ref || '')}</small>` }, { h: 'Store', f: b => esc(b.vendor) }, { h: 'Items', f: b => itemsCell(b.items) },
  { h: 'Total', f: b => `<b>${money(b.total)}</b>` }, { h: 'Owed', f: b => b.balance > .005 ? `<b style="color:#f59e0b">${money(b.balance)}</b>` : '—' }, { h: 'Status', f: b => chip(b.state) }, { h: 'By', f: b => esc(b.by_name || '—') },
  { h: '', act: 1, f: b => `<div class="acts">${b.balance > .005 && can('stores', 'edit') ? `<button class="btn sm ok" data-pb="${b.id}">${ic('dollar')} Pay</button>` : ''}</div>` }], bills, { empty: 'No bills in this period.', attrs: b => `data-st="${b.state}" data-open="${b.id}"` });
function wireBills(box, bills, back) {
  rowOpen(box, id => openBill(+id, back));
  $$('[data-ob]', box).forEach(b => b.onclick = () => openBill(+b.dataset.ob, back));
  $$('[data-pb]', box).forEach(b => b.onclick = () => { const x = bills.find(y => y.id == b.dataset.pb); payStore({ vendor_id: x.vendor_id, bill: x }, back); });
}
function vendorForm(v, done) {
  const m = modal({ title: `${ic('store')} ${v ? 'Edit store' : 'Add store'}`, body: `<form class="form" id="vf">${fi('name', 'Store / supplier name', v?.name, { req: 1 })}${fi('contact', 'Contact person', v?.contact)}${fi('phone', 'Phone', v?.phone, { type: 'tel' })}${fi('email', 'Email', v?.email, { type: 'email' })}${fi('address', 'Address / location', v?.address, { cls: 'full' })}${ft('notes', 'Notes', v?.notes, { cls: 'full' })}${v ? `<label class="row full" style="gap:8px;cursor:pointer"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Active</label>` : ''}</form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="vs">${ic('check')} Save</button>` });
  $('#vs').onclick = () => safe(async () => { const f = formData($('#vf', m.el)); if (!v) delete f.active; const r = await api('vendor_save', { ...f, id: v?.id }); m.close(); toast('Store saved', 'ok'); done?.(r.id); });
}
async function storeDetail(id, back) {
  const d = await safe(() => api('vendor_get', { id })); if (!d) return; const v = d.vendor;
  const m = modal({ title: `${ic('store')} ${esc(v.name)}`, size: 'lg', body: `<p class="muted" style="margin-top:0">${esc([v.contact, v.phone, v.email, v.address].filter(Boolean).join(' • ') || 'No contact details')}</p>
    <div class="grid g-auto" style="margin-bottom:12px">${statCard('Purchased', money(v.billed), 'download', '#8b5cf6')}${statCard('Paid', money(v.paid), 'check-circle', '#10b981')}${statCard('You owe', money(v.owed), 'alert', v.owed > .005 ? '#f59e0b' : '#22c55e')}</div>
    <h3>${ic('file')} Bills</h3><div id="sdb">${billsTable(d.bills)}</div><h3 style="margin-top:14px">${ic('dollar')} Payments</h3>` +
    tbl([{ h: 'Date', f: p => fdate(p.date) }, { h: 'Bill', f: p => esc(p.bill_no || '—') }, { h: 'Method', f: p => esc(p.method) + (p.ref ? `<small>${esc(p.ref)}</small>` : '') }, { h: 'Amount', f: p => `<b>${money(p.amount)}</b>` }, { h: 'By', f: p => esc(p.by_name || '—') }, { h: '', act: 1, f: p => can('stores', 'delete') ? `<button class="btn sm ico danger" data-dvp="${p.id}" title="Delete payment">${ic('trash')}</button>` : '' }], d.payments, { empty: 'No payments yet.' }) +
    (d.expenses.length ? `<h3 style="margin-top:14px">${ic('dollar')} Expenses paid to this store</h3>` + tbl([{ h: 'Date', f: e => fdate(e.date) }, { h: 'Category', f: e => esc(e.category) }, { h: 'Description', f: e => esc(e.description || '') }, { h: 'Amount', f: e => money(e.amount) }], d.expenses) : ''),
    footer: `<button class="btn" data-close>Close</button>${can('stores', 'add') ? `<button class="btn" id="sdnb">${ic('download')} New bill</button>` : ''}${v.owed > .005 && can('stores', 'edit') ? `<button class="btn ok" id="sdpy">${ic('dollar')} Pay store</button>` : ''}` });
  const again = () => { m.close(); back?.(); storeDetail(id, back); };
  wireBills(m.el, d.bills, again);
  $('#sdnb', m.el)?.addEventListener('click', () => { m.close(); billForm(null, { vendor_id: id }, again); });
  $('#sdpy', m.el)?.addEventListener('click', () => { m.close(); payStore({ vendor_id: id }, again); });
  $$('[data-dvp]', m.el).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this payment?', message: 'What you owe the store goes up again by this amount.', confirmText: 'Delete' })) safe(async () => { await api('vendor_pay_delete', { id: +b.dataset.dvp }); toast('Payment deleted', 'ok'); again(); }); });
}
async function billForm(d, opts, done) {
  const used = new Set((d?.lines || []).map(l => l.item_id).filter(Boolean));
  const [cfg, vendors, itemsAll, accts] = await Promise.all([accCfg(), api('vendors_list'), api('items_list', { all: 1 }), payAccounts()]), items = itemsAll.filter(i => i.type !== 'service' && (i.active || used.has(i.id)));
  const x = d?.bill || {}, lines = d?.lines?.length ? d.lines.map(l => ({ item_id: l.item_id, description: l.item ? (l.description !== l.item ? l.description : '') : l.description, qty: l.qty, cost: l.cost })) : [{}];
  if (!vendors.filter(v => v.active).length) { toast('Add a store first', 'err'); return vendorForm(null, () => billForm(d, opts, done)); }
  const m = modal({ title: `${ic('download')} ${x.id ? 'Edit bill ' + esc(x.number) : 'New bill — buying from a store'}`, size: 'lg', body: `<form id="bf" novalidate><div class="form" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${fs('vendor_id', 'Store / supplier', vendors.filter(v => v.active || v.id == x.vendor_id).map(v => [v.id, v.name]), x.vendor_id || opts.vendor_id || '', { req: 1 })}${fi('date', 'Bill date', x.date || todayStr(), { type: 'date' })}${fi('due_date', 'Pay by', x.due_date || '', { type: 'date' })}${fi('ref', "Store's invoice no.", x.ref || '')}</div>
    <div class="form" style="margin-top:6px">${sec('What you bought', 'package')}</div><p class="muted" style="margin:4px 0 0">Stock items are added to inventory at this cost. Non-stock lines (e.g. packaging) are just costs.</p>
    <div class="tablewrap" id="bln" data-bill="1" style="margin-top:8px;overflow:auto"><table class="tbl acc-lines" style="display:table"><thead><tr><th>Item</th><th>Qty</th><th>Cost per unit</th><th class="right">Amount</th><th></th></tr></thead><tbody>${lines.map(l => lineRow(items, l, true)).join('')}</tbody></table></div>
    <div class="row" style="margin:8px 0 14px"><button type="button" class="btn sm" id="badl">${ic('plus')} Add line</button>${can('inventory', 'add') ? `<button type="button" class="btn sm ghost" id="bnit">${ic('package')} New item</button>` : ''}</div>
    <div class="grid g2" style="align-items:start"><div class="form" style="grid-template-columns:1fr 1fr">${ft('notes', 'Notes', x.notes || '', { cls: 'full' })}${x.id ? '' : `<div class="full">${sec('Paid to the store now', 'dollar')}</div>${fs('paynow', 'Paid now', [['none', 'Nothing — pay later (on credit)'], ['full', 'Paid in full'], ['part', 'Part payment']], 'none', { blank: false })}${fi('pay_now', 'Amount', '', { type: 'number', attrs: 'min=0 step=0.01', cls: 'hidden' })}${fs('method', 'Method', cfg.methods, 'Cash', { blank: false })}${acctField(accts, 'Paid from account')}${fi('pay_ref', 'Reference', '')}`}</div>
      <div class="card" style="background:var(--panel2)"><div class="row" style="justify-content:space-between;font-size:19px"><b>Bill total</b><b id="bt"></b></div>${x.paid ? `<div class="row" style="justify-content:space-between"><span>Already paid</span><b>${money(x.paid)}</b></div>` : ''}</div></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="bs">${ic('check')} Save bill</button>` });
  const el = m.el, box = $('#bln', el);
  const calc = () => { let t = 0; $$('tr.ln', box).forEach(tr => { const a = (+$('[name=qty]', tr).value || 0) * (+$('[name=rate]', tr).value || 0); t += a; $('[data-amt]', tr).textContent = money(a); }); $('#bt').textContent = money(t); el.dataset.total = t; };
  const addLine = wireLines(box, items, calc, lines); $('#badl').onclick = addLine; calc();
  $('#bnit')?.addEventListener('click', () => itemForm(null, async id => { const fresh = (await api('items_list')).filter(i => i.type !== 'service'); items.splice(0, items.length, ...fresh); addLine(); const tr = $$('tr.ln', box).pop(), s_ = $('[name=item_id]', tr); s_.innerHTML = itemOpts(items, true); s_.value = String(id); s_.dispatchEvent(new Event('change')); }));
  const pn = $('[name=paynow]', el); pn?.addEventListener('change', () => $('[name=pay_now]', el).closest('label').classList.toggle('hidden', pn.value !== 'part')); syncAcct(el);
  $('#bs').onclick = () => safe(async () => { const f = formData($('#bf', el)), ls = readLines(box, 'cost'); if (!ls.length) return toast('Add at least one line', 'err');
    const body = { id: x.id, vendor_id: f.vendor_id, date: f.date, due_date: f.due_date, ref: f.ref, notes: f.notes, lines: ls };
    if (pn) { body.pay_now = pn.value === 'full' ? el.dataset.total : pn.value === 'part' ? f.pay_now : 0; body.method = f.method; body.pay_ref = f.pay_ref; body.account_id = f.account_id; }
    const r = await api('bill_save', body); m.close(); toast(`Bill ${r.number} saved — stock updated`, 'ok'); done?.(); });
}
async function openBill(id, onChange) {
  const d = await safe(() => api('bill_get', { id })); if (!d) return; const x = d.bill, ed = can('stores', 'edit');
  const m = modal({ title: `${ic('file')} Bill ${esc(x.number)} ${chip(x.state)}`, size: 'lg', body: `<div class="row" style="justify-content:space-between"><div><b style="font-size:17px">${esc(x.vendor)}</b><br><small class="muted">${esc(x.vendor_phone || '')}</small></div><dl class="kv" style="grid-template-columns:110px auto;margin:0"><dt>Date</dt><dd>${fdate(x.date)}</dd><dt>Pay by</dt><dd>${x.due_date ? fdate(x.due_date) : '—'}</dd><dt>Store ref.</dt><dd>${esc(x.ref || '—')}</dd><dt>Entered by</dt><dd>${esc(x.by_name || '—')}</dd></dl></div>
    ${tbl([{ h: 'Item', f: l => `<b>${esc(l.item || l.description)}</b>` }, { h: 'Type', f: l => l.item_type ? typeChip(l.item_type) : '—' }, { h: 'Qty', f: l => fq(l.qty) }, { h: 'Cost', f: l => money(l.cost) }, { h: 'Amount', cls: 'right', f: l => `<b>${money(l.amount)}</b>` }], d.lines)}
    <div class="grid g2" style="margin-top:12px;align-items:start"><div><h3 style="margin:0 0 6px">${ic('dollar')} Payments</h3>${d.payments.map(p => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--border);padding:6px 0"><span>${fdate(p.date)} • ${esc(p.method)}${p.ref ? ' • ' + esc(p.ref) : ''}</span><span class="row"><b>${money(p.amount)}</b>${can('stores', 'delete') ? `<button class="btn sm ico danger" data-dvp="${p.id}">${ic('trash')}</button>` : ''}</span></div>`).join('') || '<p class="muted">No payments yet.</p>'}${x.notes ? `<p class="muted">${esc(x.notes)}</p>` : ''}</div>
      <div class="card" style="background:var(--panel2)"><div class="row" style="justify-content:space-between;font-size:18px"><b>Total</b><b>${money(x.total)}</b></div><div class="row" style="justify-content:space-between"><span>Paid</span><b>${money(x.paid)}</b></div><div class="row" style="justify-content:space-between;font-size:16px"><b>You owe</b><b style="color:${x.total - x.paid > .005 ? '#f59e0b' : '#22c55e'}">${money(x.status === 'void' ? 0 : x.total - x.paid)}</b></div></div></div>`,
    footer: `<div class="row" style="flex:1;gap:6px">${can('stores', 'delete') ? `<button class="btn sm danger" id="bdel">${ic('trash')} Delete</button>` : ''}${ed && x.status !== 'void' ? `<button class="btn sm warn" id="bvoid">${ic('x')} Void</button>` : ''}</div><button class="btn" id="bprt">${ic('print')} Print</button>${ed && x.status !== 'void' ? `<button class="btn" id="bedt">${ic('edit')} Edit</button>` : ''}${ed && x.status !== 'void' && x.total - x.paid > .005 ? `<button class="btn ok" id="bpay">${ic('dollar')} Pay</button>` : ''}` });
  const again = () => { m.close(); onChange?.(); openBill(id, onChange); };
  $('#bprt', m.el).onclick = () => Docs.bill(d);
  $('#bedt', m.el)?.addEventListener('click', () => { m.close(); billForm(d, {}, onChange); });
  $('#bpay', m.el)?.addEventListener('click', () => { m.close(); payStore({ vendor_id: x.vendor_id, bill: { ...x, balance: x.total - x.paid } }, () => { onChange?.(); openBill(id, onChange); }); });
  $$('[data-dvp]', m.el).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this payment?', message: 'What you owe goes up again.', confirmText: 'Delete' })) safe(async () => { await api('vendor_pay_delete', { id: +b.dataset.dvp }); again(); }); });
  $('#bvoid', m.el)?.addEventListener('click', async () => { const why = await reasonBox({ title: `Void ${x.number}?`, message: 'The stock it added is taken back out and it stops counting as owed.', warning: 'Payments must be deleted first. Not possible if that stock was already sold.' }); if (why !== null) safe(async () => { await api('bill_void', { id, reason: why }); toast('Bill voided', 'ok'); again(); }); });
  $('#bdel', m.el)?.addEventListener('click', async () => { if (await confirmBox({ title: `Delete ${x.number}?`, message: 'The bill and the stock it added are removed.', confirmText: 'Delete' })) safe(async () => { await api('bill_delete', { id }); m.close(); toast('Bill deleted', 'ok'); onChange?.(); }); });
}
async function payStore(opts, done) {
  const [cfg, vendors, accts] = await Promise.all([accCfg(), api('vendors_list'), payAccounts()]), owing = vendors.filter(v => v.owed > .005);
  if (!owing.length && !opts.bill) return toast('You do not owe any store money.', 'ok');
  const m = modal({ title: `${ic('dollar')} Pay a store`, size: 'lg', body: `<form id="psf" class="form" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${fs('vendor_id', 'Store', owing.map(v => [v.id, `${v.name} — you owe ${money(v.owed)}`]), opts.vendor_id || owing[0]?.id, { blank: false, cls: 'full' })}
    ${fi('amount', 'Amount paid', '', { type: 'number', attrs: 'min=0 step=0.01', req: 1 })}${fi('date', 'Date', todayStr(), { type: 'date' })}${fs('method', 'Method', cfg.methods, 'Cash', { blank: false })}${acctField(accts, 'Paid from account')}${fi('ref', 'Reference', '')}${fi('note', 'Note', '', { cls: 'full' })}</form>
    <h3 style="margin:14px 0 6px">${ic('file')} Apply to bills <small class="muted" style="font-weight:400">— oldest first</small></h3><div id="psl"></div>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn ok" id="pss">${ic('check')} Save payment</button>` });
  const el = m.el;
  const draw = async () => { const vid = $('[name=vendor_id]', el).value, bills = opts.bill && vid == opts.bill.vendor_id ? [opts.bill] : (await api('bills_list', { vendor_id: vid, status: 'open' })).sort((a, b) => (a.due_date || a.date).localeCompare(b.due_date || b.date));
    $('#psl').innerHTML = tbl([{ h: 'Bill', f: b => `<b>${esc(b.number)}</b>` }, { h: 'Date', f: b => fdate(b.date) }, { h: 'Pay by', f: b => b.due_date ? fdate(b.due_date) : '—' }, { h: 'Total', f: b => money(b.total) }, { h: 'Owed', f: b => `<b>${money(b.balance)}</b>` }, { h: 'Payment', f: b => `<input type="number" min="0" step="0.01" data-al="${b.id}" data-bal="${b.balance}" style="width:120px">` }], bills, { empty: 'No open bills.' });
    $('[name=amount]', el).value = bills.reduce((a, b) => a + b.balance, 0).toFixed(2); spread(); };
  const spread = () => { let left = +$('[name=amount]', el).value || 0; $$('[data-al]', el).forEach(i => { const v = Math.min(+i.dataset.bal, left); i.value = v > 0 ? v.toFixed(2) : ''; left -= v; }); };
  $('[name=vendor_id]', el).onchange = draw; $('[name=amount]', el).oninput = spread; draw(); syncAcct(el);
  $('#pss').onclick = () => safe(async () => { const f = formData($('#psf', el)), allocations = $$('[data-al]', el).map(i => ({ bill_id: +i.dataset.al, amount: +i.value || 0 })).filter(a => a.amount > 0);
    if (!allocations.length) return toast('Enter the amount paid', 'err');
    const r = await api('vendor_pay', { allocations, date: f.date, method: f.method, account_id: f.account_id, ref: f.ref, note: f.note }); m.close(); toast(`Paid ${money(r.paid)}`, 'ok'); done?.(); });
}

/* ================================================================ EXPENSES */
const EXP_ST = {};
V.expenses = async root => {
  const st = initRange(EXP_ST, 'this_month'), back = () => V.expenses(root);
  const [cats, vendors] = await Promise.all([api('expense_cats'), api('vendors_list').catch(() => [])]);
  const list = await api('expenses_list', { from: st.from, to: st.to, category_id: st.category_id, method: st.method, vendor_id: st.vendor_id });
  const total = list.reduce((a, e) => a + e.amount, 0), byCat = {}; list.forEach(e => byCat[e.category || '—'] = (byCat[e.category || '—'] || 0) + e.amount);
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]), cfg = await accCfg();
  root.innerHTML = pageHead('Expenses', 'Rent, salaries, utilities, transport and every other running cost', `${can('expenses', 'edit') ? `<button class="btn" id="ecat">${ic('list')} Categories</button>` : ''}${can('expenses', 'add') ? `<button class="btn primary" id="nexp">${ic('plus')} Add expense</button>` : ''}`) +
    `<div class="grid g-auto" style="margin-bottom:14px">${statCard('Total in period', money(total), 'dollar', '#ef4444')}${statCard('Entries', list.length, 'list', '#4f8cff')}${top.slice(0, 3).map((c, i) => statCard(c[0], money(c[1]), 'trend', ['#f59e0b', '#8b5cf6', '#06b6d4'][i])).join('')}</div>` +
    dateBar(st, fs('category_id', 'Category', cats.map(c => [c.id, c.name]), st.category_id || '', { blank: 'All categories' }) + fs('method', 'Paid by', cfg.methods, st.method || '', { blank: 'Any method' }) + fs('vendor_id', 'Store / payee', vendors.map(v => [v.id, v.name]), st.vendor_id || '', { blank: 'Any' })) +
    `<div class="tools">${searchBox('Search payee, description, category, user…')}<span class="muted" data-count></span></div>` +
    tbl([{ h: 'Date', f: e => fdate(e.date) }, { h: 'Category', f: e => `<span class="chip" style="--c:var(--primary)">${esc(e.category || '—')}</span>` }, { h: 'Payee', f: e => esc(e.payee || e.vendor || '—') }, { h: 'Description', f: e => esc(e.description || '') }, { h: 'Paid by', f: e => esc(e.method || '') + (e.account ? ' → ' + esc(e.account) : '') + (e.ref ? `<small>${esc(e.ref)}</small>` : '') }, { h: 'Amount', f: e => `<b>${money(e.amount)}</b>` }, { h: 'Entered by', f: e => esc(e.by_name || '—') },
      { h: '', act: 1, f: e => `<div class="acts">${can('expenses', 'edit') ? `<button class="btn sm ico" data-ee="${e.id}" title="Edit">${ic('edit')}</button>` : ''}${can('expenses', 'delete') ? `<button class="btn sm ico danger" data-de="${e.id}" title="Delete">${ic('trash')}</button>` : ''}</div>` }], list, { empty: 'No expenses in this period.', attrs: e => can('expenses', 'edit') ? `data-open="${e.id}"` : '' });
  wireLive(root); wireDateBar(root, st, back); rowOpen(root, id => expenseForm(list.find(x => x.id == id), cats, vendors, back));
  $('#nexp')?.addEventListener('click', () => expenseForm(null, cats, vendors, back));
  $('#ecat')?.addEventListener('click', () => manageExpCats(back));
  $$('[data-ee]', root).forEach(b => b.onclick = () => expenseForm(list.find(x => x.id == b.dataset.ee), cats, vendors, back));
  $$('[data-de]', root).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this expense?', message: 'It is removed from profit & loss.', confirmText: 'Delete' })) safe(async () => { await api('expense_delete', { id: +b.dataset.de }); back(); }); });
};
async function expenseForm(e, cats, vendors, done) {
  const [cfg, accts] = await Promise.all([accCfg(), payAccounts()]);
  const m = modal({ title: `${ic('dollar')} ${e ? 'Edit expense' : 'Add expense'}`, body: `<form class="form" id="exf">${fi('date', 'Date', e?.date || todayStr(), { type: 'date' })}${fs('category_id', 'Category', cats.filter(c => c.active || c.id == e?.category_id).map(c => [c.id, c.name]), e?.category_id || '', { req: 1 })}${fi('amount', 'Amount', e?.amount ?? '', { req: 1, type: 'number', attrs: 'min=0 step=0.01' })}
    ${fs('method', 'Paid by', cfg.methods, e?.method || 'Cash', { blank: false })}${accts.length ? fs('account_id', 'Paid from account', accts.map(a => [a.id, a.name]), e?.account_id || (accts.find(a => a.name === (METHOD_ACCOUNT[e?.method || 'Cash'])) || accts[0]).id, { blank: false }) : ''}${fs('vendor_id', 'Paid to a store (optional)', vendors.filter(v => v.active).map(v => [v.id, v.name]), e?.vendor_id || '', { blank: '— Not a store —' })}${fi('payee', 'Payee', e?.payee || '', { ph: 'e.g. Landlord, Electricity company, staff name' })}${fi('ref', 'Reference / receipt no.', e?.ref || '')}${ft('description', 'Description', e?.description || '', { cls: 'full' })}</form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="exs">${ic('check')} Save expense</button>` });
  syncAcct(m.el);
  $('#exs').onclick = () => safe(async () => { await api('expense_save', { ...formData($('#exf', m.el)), id: e?.id }); m.close(); toast('Expense saved', 'ok'); done?.(); });
}
async function manageExpCats(done) {
  const m = modal({ title: `${ic('list')} Expense categories`, size: 'sm', body: '<div id="ecb"></div>', footer: '<button class="btn" data-close>Close</button>', onClose: done });
  const draw = async () => { const cats = await api('expense_cats');
    $('#ecb', m.el).innerHTML = cats.map(c => `<div class="form" style="grid-template-columns:1fr auto auto;align-items:end;margin-bottom:8px" data-ec="${c.id}">${fi('name', c.active ? 'Category' : 'Category (inactive)', c.name)}<button class="btn sm ok" data-s title="Save">${ic('check')}</button><button class="btn sm ico danger" data-d title="${c.used ? 'Make inactive' : 'Delete'}">${ic(c.used ? 'pause' : 'trash')}</button></div>`).join('') +
      `<div class="form" style="grid-template-columns:1fr auto;align-items:end;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)" id="ecn">${fi('name', 'New category', '', { ph: 'e.g. Generator fuel' })}<button class="btn sm primary" id="eca">${ic('plus')} Add</button></div>`;
    $$('[data-ec]', m.el).forEach(r => { $('[data-s]', r).onclick = () => safe(async () => { await api('expense_cat_save', { id: +r.dataset.ec, name: $('[name=name]', r).value, active: true }); toast('Saved', 'ok'); draw(); }); $('[data-d]', r).onclick = () => safe(async () => { await api('expense_cat_delete', { id: +r.dataset.ec }); draw(); }); });
    $('#eca', m.el).onclick = () => safe(async () => { await api('expense_cat_save', { name: $('[name=name]', $('#ecn', m.el)).value }); draw(); }); };
  draw();
}

/* ================================================================ ACCOUNTS / WALLETS (Cash, ZAAD, eDahab, Bank…) */
const ACC_T = { cash: ['Cash', 'dollar', '#22c55e'], mobile: ['Mobile money', 'mobile', '#8b5cf6'], bank: ['Bank', 'store', '#3b82f6'], other: ['Other', 'package', '#64748b'] };
V.accounts = async (root, param) => {
  const tab = root.dataset.atab || 'accounts', list = await api('accounts_list'), act = list.filter(a => a.active), back = () => { ACC.accts = null; V.accounts(root); };
  const total = act.reduce((a, x) => a + x.balance, 0), ed = can('accounts', 'edit');
  root.innerHTML = pageHead('Accounts & Wallets', 'Where your money is — every payment in or out lands in an account; move money between them with a transfer',
    `${ed ? `<button class="btn" id="amv">${ic('repeat')} Deposit / withdraw</button><button class="btn ok" id="atr">${ic('send')} Transfer</button>` : ''}${can('accounts', 'add') ? `<button class="btn primary" id="anw">${ic('plus')} New account</button>` : ''}`) +
    (list.length ? '' : `<div class="card empty" style="padding:34px">${ic('dollar')}<div><b>No accounts yet.</b><br>Add the places your money is kept — for example <i>Cash drawer</i>, <i>ZAAD 063…</i>, <i>eDahab</i>, <i>Dahabshiil bank</i>. Set the opening balance to what is in it today.</div>${can('accounts', 'add') ? `<button class="btn primary" id="anw2" style="margin-top:12px">${ic('plus')} Add your first account</button>` : ''}</div>`) +
    `<div class="acct-total card"><div><small class="muted">TOTAL MONEY IN ALL ACCOUNTS</small><b>${money(total)}</b></div><div class="muted">${act.length} active account${act.length === 1 ? '' : 's'}</div></div>
    <div class="acct-grid">${list.map(a => { const t = ACC_T[a.type] || ACC_T.other; return `<div class="acct-card ${a.active ? '' : 'off'}" data-acc="${a.id}" style="--c:${t[2]}" role="button" tabindex="0"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><div class="si">${ic(t[1])}</div><span class="chip" style="--c:${t[2]}">${t[0]}${a.active ? '' : ' • inactive'}</span></div>
      <div class="acct-name">${esc(a.name)}</div><small class="muted">${esc(a.number || ' ')}</small><div class="acct-bal" style="color:${a.balance < -.005 ? '#ef4444' : 'var(--text)'}">${money(a.balance)}</div>
      <div class="row" style="justify-content:space-between;font-size:12px"><span style="color:#22c55e">▲ ${money(a.in30)}</span><span style="color:#ef4444">▼ ${money(a.out30)}</span><span class="muted">30 days</span></div></div>`; }).join('')}</div>` +
    tabsBar([['accounts', 'All accounts', 'list'], ['transfers', 'Transfers', 'repeat']], tab) + '<div id="abx" style="margin-top:12px"></div>';
  $$('[data-tab]', root).forEach(a => a.onclick = () => { root.dataset.atab = a.dataset.tab; back(); });
  $$('[data-acc]', root).forEach(c => { const go = () => accountRegister(+c.dataset.acc, back); c.onclick = go; c.onkeydown = e => { if (e.key === 'Enter') go(); }; });
  $('#anw')?.addEventListener('click', () => accountForm(null, back)); $('#anw2')?.addEventListener('click', () => accountForm(null, back)); $('#atr')?.addEventListener('click', () => transferForm(act, {}, back)); $('#amv')?.addEventListener('click', () => moveForm(act, {}, back));
  const box = $('#abx');
  if (tab === 'accounts') {
    box.innerHTML = tbl([{ h: 'Account', f: a => `<b>${esc(a.name)}</b><small>${esc(a.number || '')}</small>` }, { h: 'Type', f: a => `<span class="chip" style="--c:${(ACC_T[a.type] || ACC_T.other)[2]}">${(ACC_T[a.type] || ACC_T.other)[0]}</span>${a.active ? '' : ' <span class="chip" style="--c:#64748b">Inactive</span>'}` }, { h: 'Opening balance', cls: 'right', f: a => money(a.opening_balance) + `<small>${fdate(a.opening_date)}</small>` },
      { h: 'In (30 days)', cls: 'right', f: a => `<span style="color:#22c55e">${money(a.in30)}</span>` }, { h: 'Out (30 days)', cls: 'right', f: a => `<span style="color:#ef4444">${money(a.out30)}</span>` }, { h: 'Balance', cls: 'right', f: a => `<b>${money(a.balance)}</b>` },
      { h: '', act: 1, f: a => `<div class="acts">${ed ? `<button class="btn sm ico" data-ea="${a.id}" title="Edit">${ic('edit')}</button>` : ''}${can('accounts', 'delete') ? `<button class="btn sm ico danger" data-da="${a.id}" title="Delete">${ic('trash')}</button>` : ''}</div>` }], list, { empty: 'No accounts yet.', attrs: a => `data-open="${a.id}"` });
    rowOpen(box, id => accountRegister(+id, back));
    $$('[data-ea]', box).forEach(b => b.onclick = () => accountForm(list.find(a => a.id == b.dataset.ea), back));
    $$('[data-da]', box).forEach(b => b.onclick = async () => { const a = list.find(x => x.id == b.dataset.da); if (await confirmBox({ title: `Delete ${esc(a.name)}?`, message: 'An account that already has payments is made inactive instead.', confirmText: 'Delete' })) safe(async () => { const r = await api('account_delete', { id: a.id }); toast(r.deactivated ? 'Account has history — made inactive' : 'Account deleted', 'ok'); back(); }); });
  } else {
    const tr = await api('account_transfers');
    box.innerHTML = `<div class="tools">${searchBox('Search transfers…')}<span class="muted" data-count></span></div>` + tbl([{ h: 'Date', f: t => fdate(t.date) }, { h: 'From', f: t => `<b>${esc(t.from_name)}</b>` }, { h: 'To', f: t => `<b>${esc(t.to_name)}</b>` }, { h: 'Amount', cls: 'right', f: t => `<b>${money(t.amount)}</b>` }, { h: 'Fee', cls: 'right', f: t => t.fee ? money(t.fee) : '—' }, { h: 'Reference', f: t => esc(t.ref || '') + (t.note ? `<small>${esc(t.note)}</small>` : '') }, { h: 'By', f: t => esc(t.by_name || '—') },
      { h: '', act: 1, f: t => can('accounts', 'delete') ? `<button class="btn sm ico danger" data-dt="${t.id}" title="Delete transfer">${ic('trash')}</button>` : '' }], tr, { empty: 'No transfers yet.' });
    wireLive(box);
    $$('[data-dt]', box).forEach(b => b.onclick = async () => { if (await confirmBox({ title: 'Delete this transfer?', message: 'Both account balances go back to what they were (a fee expense is removed too).', confirmText: 'Delete' })) safe(async () => { await api('account_transfer_delete', { id: +b.dataset.dt }); toast('Transfer deleted', 'ok'); back(); }); });
  }
  if (param && root.dataset.opened !== String(param)) { root.dataset.opened = String(param); accountRegister(+param, back); }
};
function accountForm(a, done) {
  const m = modal({ title: `${ic('dollar')} ${a ? 'Edit account' : 'New account'}`, body: `<form class="form" id="acf2">${fi('name', 'Account name', a?.name, { req: 1, ph: 'e.g. Cash drawer, ZAAD 063…, Dahabshiil bank' })}${fs('type', 'Type', Object.entries(ACC_T).map(([k, v]) => [k, v[0]]), a?.type || 'cash', { blank: false })}${fi('number', 'Number / phone (optional)', a?.number || '')}
    ${fi('opening_balance', 'Opening balance', a?.opening_balance ?? 0, { type: 'number', attrs: 'step=0.01' })}${fi('opening_date', 'Opening balance date', a?.opening_date || todayStr(), { type: 'date' })}${ft('notes', 'Notes', a?.notes || '', { cls: 'full' })}
    ${a ? `<label class="row full" style="gap:8px;cursor:pointer"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Active</label>` : ''}<div class="full notice info">${ic('info')}<span>Opening balance = the money that was already in this account on that date, before it was used in the system.</span></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="acs2">${ic('check')} Save account</button>` });
  $('#acs2').onclick = () => safe(async () => { const f = formData($('#acf2', m.el)); if (!a) delete f.active; await api('account_save', { ...f, id: a?.id }); m.close(); toast('Account saved', 'ok'); done?.(); });
}
function transferForm(accts, opts, done) {
  if (accts.length < 2) return toast('You need at least two accounts to transfer', 'err');
  const lbl = a => `${a.name} — ${money(a.balance)}`;
  const m = modal({ title: `${ic('send')} Transfer money between accounts`, body: `<form class="form" id="tff2">${fs('from_id', 'From account', accts.map(a => [a.id, lbl(a)]), opts.from || accts[0].id, { blank: false })}${fs('to_id', 'To account', accts.map(a => [a.id, lbl(a)]), opts.to || accts[1].id, { blank: false })}
    ${fi('amount', 'Amount', '', { req: 1, type: 'number', attrs: 'min=0 step=0.01' })}${fi('fee', 'Transfer fee (optional)', '', { type: 'number', attrs: 'min=0 step=0.01' })}${fi('date', 'Date', todayStr(), { type: 'date' })}${fi('ref', 'Reference', '', { ph: 'transaction no.' })}${fi('note', 'Note', '', { cls: 'full', ph: 'e.g. Cash deposited to ZAAD' })}
    <div class="full notice info" id="tfh">${ic('info')}<span></span></div></form>`, footer: `<button class="btn" data-close>Cancel</button><button class="btn ok" id="tfs2">${ic('send')} Transfer</button>` });
  const el = m.el, hint = () => { const f = formData($('#tff2', el)), a = accts.find(x => x.id == f.from_id), b = accts.find(x => x.id == f.to_id), amt = +f.amount || 0, fee = +f.fee || 0;
    $('#tfh span', el).textContent = a && b ? (a.id === b.id ? 'Choose two different accounts.' : `${a.name}: ${money(a.balance)} → ${money(a.balance - amt - fee)}   •   ${b.name}: ${money(b.balance)} → ${money(b.balance + amt)}${fee ? '   •   fee recorded as an expense' : ''}`) : ''; };
  el.addEventListener('input', hint); el.addEventListener('change', hint); hint();
  $('#tfs2').onclick = () => safe(async () => { await api('account_transfer', formData($('#tff2', el))); m.close(); toast('Transfer saved', 'ok'); done?.(); });
}
function moveForm(accts, opts, done) {
  const m = modal({ title: `${ic('repeat')} Deposit or withdraw`, size: 'sm', body: `<form class="form" id="mvf" style="grid-template-columns:1fr">${fs('kind', 'Type', [['deposit', 'Deposit — money put in (owner capital, loan…)'], ['withdrawal', 'Withdrawal — money taken out (owner drawings…)']], opts.kind || 'deposit', { blank: false })}${fs('account_id', 'Account', accts.map(a => [a.id, `${a.name} — ${money(a.balance)}`]), opts.account || accts[0]?.id, { blank: false })}
    ${fi('amount', 'Amount', '', { req: 1, type: 'number', attrs: 'min=0 step=0.01' })}${fi('date', 'Date', todayStr(), { type: 'date' })}${fi('ref', 'Reference', '')}${fi('note', 'Note', '', { ph: 'e.g. Owner added capital' })}<div class="notice info">${ic('info')}<span>Deposits and withdrawals change the account balance only — they are not sales income or expenses. Use Expenses for running costs.</span></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="mvs">${ic('check')} Save</button>` });
  $('#mvs').onclick = () => safe(async () => { await api('account_move', formData($('#mvf', m.el))); m.close(); toast('Saved', 'ok'); done?.(); });
}
async function accountRegister(id, onChange, st = {}) {
  if (!st.preset) { st.preset = 'this_month'; const r = presetRange('this_month'); st.from = r[0]; st.to = r[1]; }
  const d = await safe(() => api('account_register', { id, from: st.from, to: st.to })); if (!d) return; const a = d.account, t = ACC_T[a.type] || ACC_T.other;
  const cols = [{ k: 'date', l: 'Date' }, { k: 'kind', l: 'Type' }, { k: 'ref', l: 'Reference' }, { k: 'desc', l: 'Description' }, { k: 'money_in', l: 'Money in' }, { k: 'money_out', l: 'Money out' }, { k: 'balance', l: 'Balance' }];
  const m = modal({ title: `${ic(t[1])} ${esc(a.name)} — account register`, size: 'lg', body: `<div class="doc-head"><div class="grow"><small class="muted">${esc(t[0].toUpperCase())}${a.number ? ' • ' + esc(a.number) : ''}</small><div class="doc-cust">${esc(a.name)}</div></div><div class="doc-big"><small>BALANCE</small><b>${money(a.balance)}</b></div></div>
    ${dateBar(st)}<div class="row" style="gap:10px;margin-bottom:10px"><span class="chip" style="--c:#22c55e">Money in ${money(d.in)}</span><span class="chip" style="--c:#ef4444">Money out ${money(d.out)}</span></div>` +
    tbl([{ h: 'Date', f: r => fdate(r.date) }, { h: 'Type', f: r => esc(r.kind) }, { h: 'Reference', f: r => esc(r.ref || '') }, { h: 'Description', f: r => esc(r.desc || '') }, { h: 'Money in', cls: 'right', f: r => r.money_in ? `<span style="color:#22c55e">${money(r.money_in)}</span>` : '' }, { h: 'Money out', cls: 'right', f: r => r.money_out ? `<span style="color:#ef4444">${money(r.money_out)}</span>` : '' }, { h: 'Balance', cls: 'right', f: r => `<b>${money(r.balance)}</b>` }], d.rows, { empty: 'No money movements in this period.' }),
    footer: `<button class="btn" id="arp">${ic('print')} Print</button><button class="btn" id="arx">${ic('sheet')} Excel</button>${can('accounts', 'edit') ? `<button class="btn" id="arm">${ic('repeat')} Deposit / withdraw</button><button class="btn ok" id="art">${ic('send')} Transfer</button>` : ''}<button class="btn primary" data-close>Close</button>` });
  const flat = d.rows.map(r => ({ ...r, date: fdate(r.date), money_in: r.money_in ? money(r.money_in) : '', money_out: r.money_out ? money(r.money_out) : '', balance: money(r.balance) }));
  wireDateBar(m.el, st, () => { m.close(); accountRegister(id, onChange, st); });
  $('#arp', m.el).onclick = () => printTable(`${a.name} — account register`, cols, flat, `${st.from ? fdate(st.from) : 'Start'} – ${fdate(st.to || todayStr())} • Balance ${money(a.balance)}`);
  $('#arx', m.el).onclick = () => exportXls(a.name + '_register', cols, flat);
  const reload = () => { m.close(); onChange?.(); };
  $('#art', m.el)?.addEventListener('click', async () => { const accts = (await api('accounts_list')).filter(x => x.active); transferForm(accts, { from: id }, reload); });
  $('#arm', m.el)?.addEventListener('click', async () => { const accts = (await api('accounts_list')).filter(x => x.active); moveForm(accts, { account: id }, reload); });
}
