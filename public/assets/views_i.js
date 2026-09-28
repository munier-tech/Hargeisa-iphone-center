/* Reports centre: catalogue of reports + one filter bar (date, customer, staff, item, store, category, status, method, grouping) */
const RPT = { st: {}, lk: null };
const RPT_FILTERS = {
  pl: ['date'], pl_month: ['date'], sales_customer: ['date', 'customer', 'user'], sales_item: ['date', 'customer', 'user', 'item'], sales_user: ['date', 'customer'], sales_period: ['date', 'group', 'customer', 'user'],
  invoices: ['date', 'customer', 'user', 'st_inv'], quotes: ['date', 'customer', 'user', 'st_q'], payments: ['date', 'customer', 'user', 'method'], ar_aging: ['asof', 'customer', 'user'], statement: ['date', 'customer'],
  expenses_cat: ['date', 'category', 'vendor', 'user'], expenses: ['date', 'category', 'vendor', 'user', 'method'], purchases: ['date', 'vendor', 'st_bill'], ap_aging: ['asof', 'vendor'], store_payments: ['date', 'vendor', 'method', 'user'],
  acct_balances: ['asof'], acct_register: ['date', 'account'], acct_transfers: ['date', 'account'],
  stock: ['asof', 'item', 'vendor'], low_stock: ['vendor'], moves: ['date', 'item', 'kind', 'customer', 'vendor', 'user'], repairs: ['date', 'customer', 'user'], software: ['date', 'customer', 'user'], followups: ['customer'],
};
const RPT_ICON = { 'Money accounts': 'send', 'Business overview': 'trend', 'Sales & customers': 'cart', 'Expenses & stores': 'store', 'Inventory': 'package', 'Operations': 'tool' };
const RPT_DESC = { pl: 'Income, cost of sales, expenses and net profit', pl_month: 'Profit & loss side by side for every month', sales_customer: 'Who buys the most and who still owes', sales_item: 'Best-selling items and services, margin per item', sales_user: 'What each staff member sold and collected',
  sales_period: 'Sales and cash received per day, week or month', invoices: 'Every invoice with filters for status, customer and staff', quotes: 'Quotations and how many were won', payments: 'Money received, by method (Cash, ZAAD, eDahab…)', ar_aging: 'Unpaid invoices by how late they are',
  statement: 'Everything a customer was charged and paid, with running balance', expenses_cat: 'Where the money goes', expenses: 'Every expense with filters', purchases: 'What you bought from each store', ap_aging: 'What you owe each store and how late', store_payments: 'Payments you made to stores',
  acct_balances: 'How much money is in Cash, ZAAD, eDahab, Bank…', acct_register: 'Every payment in and out of each account', acct_transfers: 'Money moved between accounts',
  stock: 'Quantity on hand and stock value', low_stock: 'Items to re-order', moves: 'Every stock movement — purchases, sales, repairs, adjustments', repairs: 'Hardware repairs, charges and balances', software: 'Software jobs, charges and balances', followups: 'Open customer follow-ups' };

async function rptLookups() {
  if (RPT.lk) return RPT.lk;
  const [customers, items, vendors, cats, cfg, accts] = await Promise.all([api('customers_list').catch(() => []), api('items_list', { all: 1 }).catch(() => []), api('vendors_list').catch(() => []), api('expense_cats').catch(() => []), accCfg(), payAccounts()]);
  return (RPT.lk = { customers, items, vendors, cats, methods: cfg.methods || [], accts });
}
V.reports = async (root, param) => {
  const list = await api('report_list'), groups = [...new Set(list.map(r => r.group))];
  const key = param && list.some(r => r.key === param) ? param : root.dataset.rk;
  if (!key) {
    root.innerHTML = pageHead('Reports', 'Pick a report — every report can be filtered by date, customer, staff, item, store and more, then printed or exported to Excel') +
      `<div class="grid g2">${groups.map(g => `<div class="card"><h3>${ic(RPT_ICON[g] || 'file')} ${esc(g)}</h3>${list.filter(r => r.group === g).map(r => `<a class="rpt-link" data-rk="${r.key}"><b>${esc(r.title)}</b><small class="muted">${esc(RPT_DESC[r.key] || '')}</small></a>`).join('')}</div>`).join('')}</div>`;
    $$('[data-rk]', root).forEach(a => a.onclick = () => { root.dataset.rk = a.dataset.rk; V.reports(root); });
    return;
  }
  const lk = await rptLookups(), F = RPT_FILTERS[key] || ['date'], st = RPT.st[key] ||= {};
  if (!st.preset) { const def = ['ar_aging', 'ap_aging', 'stock', 'low_stock', 'followups', 'acct_balances'].includes(key) ? 'today' : key === 'pl_month' ? 'this_year' : 'this_month'; st.preset = def; const r = presetRange(def); st.from = r[0]; st.to = r[1]; }
  const has = k => F.includes(k);
  const fields = [
    has('date') ? fs('preset', 'Date', DATE_PRESETS, st.preset, { blank: false }) + fi('from', 'From', st.from, { type: 'date' }) + fi('to', 'To', st.to, { type: 'date' }) : '',
    has('asof') ? fi('to', 'As of', st.to || todayStr(), { type: 'date' }) : '',
    has('group') ? fs('group', 'Group by', [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']], st.group || 'month', { blank: false }) : '',
    has('customer') ? fs('customer_id', key === 'statement' ? 'Customer *' : 'Customer', lk.customers.map(c => [c.id, `${c.name} — ${c.phone}`]), st.customer_id || '', { blank: key === 'statement' ? 'Choose a customer…' : 'All customers' }) : '',
    has('user') ? fs('user_id', 'Staff member', S.staff.map(u => [u.id, u.name]), st.user_id || '', { blank: 'All staff' }) : '',
    has('item') ? fs('item_id', 'Item', lk.items.map(i => [i.id, i.name]), st.item_id || '', { blank: 'All items' }) : '',
    has('vendor') ? fs('vendor_id', 'Store', lk.vendors.map(v => [v.id, v.name]), st.vendor_id || '', { blank: 'All stores' }) : '',
    has('category') ? fs('category_id', 'Expense category', lk.cats.map(c => [c.id, c.name]), st.category_id || '', { blank: 'All categories' }) : '',
    has('account') ? fs('account_id', 'Account', lk.accts.map(a => [a.id, a.name]), st.account_id || '', { blank: 'All accounts' }) : '',
    has('method') ? fs('method', 'Payment method', lk.methods, st.method || '', { blank: 'Any method' }) : '',
    has('st_inv') ? fs('status', 'Status', [['open', 'Open (unpaid / partly)'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']], st.status || '', { blank: 'Any status' }) : '',
    has('st_q') ? fs('status', 'Status', [['pending', 'Pending'], ['accepted', 'Accepted'], ['converted', 'Converted'], ['declined', 'Declined'], ['expired', 'Expired']], st.status || '', { blank: 'Any status' }) : '',
    has('st_bill') ? fs('status', 'Status', [['open', 'Owed'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['void', 'Void']], st.status || '', { blank: 'Any status' }) : '',
    has('kind') ? fs('status', 'Movement', [['opening', 'Opening stock'], ['purchase', 'Purchases'], ['sale', 'Sales'], ['repair', 'Used in repairs'], ['adjust', 'Adjustments']], st.status || '', { blank: 'All movements' }) : '',
  ].join('');
  root.innerHTML = pageHead(`<a class="btn ico" id="rback" title="All reports">${ic('back')}</a> ${esc(list.find(r => r.key === key)?.title || 'Report')}`, esc(RPT_DESC[key] || ''),
    `<select id="rsw" aria-label="Switch report" style="max-width:260px">${groups.map(g => `<optgroup label="${esc(g)}">${list.filter(r => r.group === g).map(r => `<option value="${r.key}" ${r.key === key ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</optgroup>`).join('')}</select>`) +
    `<div class="card" style="margin-bottom:14px"><form class="form" id="rf" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));align-items:end">${fields}<button class="btn primary">${ic('refresh')} Run report</button></form></div><div id="rout"><div class="empty">Loading…</div></div>`;
  $('#rback').onclick = () => { delete root.dataset.rk; V.reports(root); };
  $('#rsw').onchange = e => { root.dataset.rk = e.target.value; V.reports(root); };
  const f = $('#rf'), P = $('[name=preset]', f);
  if (P) { P.onchange = () => { const r = presetRange(P.value); if (r) { $('[name=from]', f).value = r[0]; $('[name=to]', f).value = r[1]; } }; ['from', 'to'].forEach(n => $(`[name=${n}]`, f).addEventListener('change', () => { P.value = 'custom'; })); }
  f.onsubmit = e => { e.preventDefault(); Object.assign(st, formData(f)); run(); };
  const run = () => safe(async () => {
    const body = { type: key, ...st }; if (has('asof')) body.from = '';
    if (key === 'statement' && !st.customer_id) { $('#rout').innerHTML = `<div class="card empty">${ic('user')}<div>Choose a customer, then run the statement.</div></div>`; return; }
    const r = await api('report', body); renderReport($('#rout'), r);
  });
  run();
};

const RPT_DATE = /^\d{4}-\d{2}-\d{2}$/;
function rptCell(c, v) {
  if (v === null || v === undefined || v === '') return c.m || c.n ? '' : '—';
  if (c.m) return money(v); if (c.p) return (+v).toFixed(1) + '%'; if (c.n) return fq(v); if (c.st) return stLabel(v);
  if (typeof v === 'string' && RPT_DATE.test(v)) return fdate(v); return String(v);
}
function renderReport(box, r) {
  const cols = r.columns, flat = r.rows.map(row => Object.fromEntries(cols.map(c => [c.k, rptCell(c, row[c.k])])));
  const hasTot = !r.pl && Object.keys(r.totals || {}).length && r.rows.length > 1;
  const totRow = hasTot ? Object.fromEntries(cols.map((c, i) => [c.k, i === 0 ? 'TOTAL' : r.totals[c.k] !== undefined ? rptCell(c, r.totals[c.k]) : ''])) : null;
  let table;
  if (r.pl) {
    table = `<div class="tablewrap"><table class="tbl pl" style="display:table"><thead><tr>${cols.map((c, i) => `<th class="${i ? 'right' : ''}">${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row => `<tr class="pl-${!row.style || row.style === '-' ? 'x' : row.style}">${cols.map((c, i) => `<td class="${i ? 'right' : ''}" ${row.style === 'note' && !i ? `colspan="${cols.length}"` : ''}>${i === 0 ? esc(row.label) : row.style === 'note' ? '' : row[c.k] === null || row[c.k] === undefined ? '' : `<span style="${row[c.k] < 0 ? 'color:#ef4444' : ''}">${money(row[c.k])}</span>`}</td>`).filter((_, i) => !(row.style === 'note' && i)).join('')}</tr>`).join('')}</tbody></table></div>`;
  } else {
    table = tbl(cols.map(c => ({ h: esc(c.l), cls: c.m || c.n || c.p ? 'right' : '', f: row => c.st ? chip(row[c.k]) : esc(rptCell(c, row[c.k])) })), r.rows, { empty: 'No data for these filters.' });
    if (totRow) table = table.replace('</tbody></table>', `</tbody><tfoot><tr class="rpt-tot">${cols.map(c => `<td class="${c.m || c.n || c.p ? 'right' : ''}"><b>${esc(totRow[c.k])}</b></td>`).join('')}</tr></tfoot></table>`);
  }
  box.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:10px"><div><h3 style="margin:0">${ic('file')} ${esc(r.title)}</h3><small class="muted">${esc(r.subtitle || '')} • ${r.rows.length} row${r.rows.length === 1 ? '' : 's'}</small></div><div class="row"><button class="btn" id="rpp">${ic('print')} Print / PDF</button><button class="btn" id="rpx">${ic('sheet')} Export Excel</button></div></div>
    ${r.note ? `<div class="notice info" style="margin-bottom:10px">${ic('info')}<span>${esc(r.note)}</span></div>` : ''}${r.pl ? '' : `<div class="tools">${searchBox('Search in this report…')}<span class="muted" data-count></span></div>`}${table}</div>`;
  if (!r.pl) wireLive(box);
  const pcols = cols.map(c => ({ k: c.k, l: c.l })), prow = r.pl ? r.rows.map(row => Object.fromEntries(cols.map((c, i) => [c.k, i === 0 ? row.label : row[c.k] === null || row[c.k] === undefined ? '' : money(row[c.k])]))) : [...flat, ...(totRow ? [totRow] : [])];
  $('#rpp', box).onclick = () => printTable(r.title, pcols, prow, r.subtitle + (r.note ? ' — ' + r.note : ''));
  $('#rpx', box).onclick = () => exportXls(r.title, pcols, prow);
}
