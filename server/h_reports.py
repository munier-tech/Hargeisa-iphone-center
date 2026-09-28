"""Reports (QuickBooks-style): every report takes the same filters — date range, customer, staff user, item, store, category,
status, payment method and grouping — and returns {title, subtitle, columns, rows, totals}.

Column flags: m = money, n = number (both are totalled), p = percent. Cost / profit columns are only returned to Super Admins."""
from __future__ import annotations
from datetime import timedelta

from core import *
import acc

REPORTS = {
    # key: (title, group, permission (module, action) | 'finance')
    'pl': ('Profit & Loss', 'Business overview', 'finance'),
    'pl_month': ('Profit & Loss by month', 'Business overview', 'finance'),
    'sales_customer': ('Sales by customer', 'Sales & customers', ('sales', 'view')),
    'sales_item': ('Sales by item / service', 'Sales & customers', ('sales', 'view')),
    'sales_user': ('Sales by staff member', 'Sales & customers', ('sales', 'view')),
    'sales_period': ('Sales by day / week / month', 'Sales & customers', ('sales', 'view')),
    'invoices': ('Invoice & sales receipt list', 'Sales & customers', ('sales', 'view')),
    'quotes': ('Quotation list', 'Sales & customers', ('sales', 'view')),
    'payments': ('Payments received', 'Sales & customers', ('sales', 'view')),
    'ar_aging': ('Money owed by customers (A/R aging)', 'Sales & customers', ('sales', 'view')),
    'statement': ('Customer statement', 'Sales & customers', ('sales', 'view')),
    'expenses_cat': ('Expenses by category', 'Expenses & stores', ('expenses', 'view')),
    'expenses': ('Expense detail', 'Expenses & stores', ('expenses', 'view')),
    'purchases': ('Purchases from stores (bills)', 'Expenses & stores', ('stores', 'view')),
    'ap_aging': ('Money owed to stores (A/P aging)', 'Expenses & stores', ('stores', 'view')),
    'store_payments': ('Payments to stores', 'Expenses & stores', ('stores', 'view')),
    'acct_balances': ('Account balances (Cash, ZAAD, eDahab, Bank)', 'Money accounts', ('accounts', 'view')),
    'acct_register': ('Account transactions (money in / out)', 'Money accounts', ('accounts', 'view')),
    'acct_transfers': ('Transfers between accounts', 'Money accounts', ('accounts', 'view')),
    'stock': ('Inventory valuation / stock on hand', 'Inventory', ('inventory', 'view')),
    'low_stock': ('Low & out of stock', 'Inventory', ('inventory', 'view')),
    'moves': ('Stock movement detail', 'Inventory', ('inventory', 'view')),
    'repairs': ('Hardware repair report', 'Operations', ('repairs', 'view')),
    'software': ('Software department report', 'Operations', ('software', 'view')),
    'followups': ('Customer follow-ups pending', 'Operations', ('customers', 'view')),
}

def allowed(key: str) -> bool:
    p = REPORTS[key][2]
    if p == 'finance': return is_admin() and can('finance', 'view')
    return can(*p)

def act_report_list(inp):
    need('reports', 'view')
    return [{'key': k, 'title': v[0], 'group': v[1]} for k, v in REPORTS.items() if allowed(k)]

def C(k, l, **f): return {'k': k, 'l': l, **f}

def totals(cols, rs) -> dict:
    return {c['k']: rnd(sum(float(r.get(c['k']) or 0) for r in rs)) for c in cols if (c.get('m') or c.get('n')) and not c.get('nt')}

def period_key(dt: str, group: str) -> str:
    if group == 'month': return dt[:7]
    if group == 'year': return dt[:4]
    if group == 'week':
        x = datetime.strptime(dt, '%Y-%m-%d'); return (x - timedelta(days=x.weekday())).strftime('%Y-%m-%d')
    return dt

def period_label(k: str, group: str) -> str:
    if group == 'month': return datetime.strptime(k + '-01', '%Y-%m-%d').strftime('%b %Y')
    if group == 'year': return k
    if group == 'week': return 'Week of ' + datetime.strptime(k, '%Y-%m-%d').strftime('%d %b %Y')
    return datetime.strptime(k, '%Y-%m-%d').strftime('%d %b %Y')


def act_report(inp):
    need('reports', 'view'); key = str(inp.get('type') or '')
    if key not in REPORTS: raise ApiError('Unknown report.')
    if not allowed(key): raise ApiError('You are not authorized to see this report.', 403)
    frm = d(inp.get('from')) or '2000-01-01'; to = d(inp.get('to')) or today(); adm = is_admin()
    f = {'from': frm, 'to': to, 'customer_id': I(inp.get('customer_id')), 'user_id': I(inp.get('user_id')), 'item_id': I(inp.get('item_id')), 'vendor_id': I(inp.get('vendor_id')),
         'category_id': I(inp.get('category_id')), 'account_id': I(inp.get('account_id')), 'status': s(inp.get('status'), 20), 'method': s(inp.get('method'), 30), 'group': inp.get('group') if inp.get('group') in ('day', 'week', 'month', 'year') else 'month'}
    out = globals()['r_' + key](f, adm)
    out.setdefault('title', REPORTS[key][0])
    out.setdefault('subtitle', 'As of ' + fdate(date_ts(to), '%d %b %Y') if key in ('ar_aging', 'ap_aging', 'stock', 'low_stock', 'followups', 'acct_balances') else f"{fdate(date_ts(frm), '%d %b %Y')} – {fdate(date_ts(to), '%d %b %Y')}" if frm != '2000-01-01' else 'All dates')
    out.setdefault('totals', totals(out['columns'], out['rows']))
    return out


# ---------------------------------------------------------------- business overview
PL_LINES = [('Income', None, 'h'), ('Product sales', 'product_sales', ''), ('Service sales (invoices)', 'service_sales', ''), ('Repair & software job payments', 'service_charges', ''), ('Less: discounts', 'discounts', '-'),
            ('Total income', 'total_revenue', 'b'), ('Cost of sales', None, 'h'), ('Cost of goods sold', 'product_costs', ''), ('Parts used in repairs', 'parts_costs', ''), ('Stock adjustments (loss / gain)', 'adjustments', ''),
            ('Total cost of sales', 'cogs', 'b'), ('Gross profit', 'gross_profit', 'b')]

def pl_rows(bs: list, frm: str, to: str, extra_cols: list) -> list:
    """Profit & loss lines; `bs` is one breakdown per column."""
    out = []
    for label, k, style in PL_LINES:
        r = {'label': label, 'style': style}
        for i, b in enumerate(bs): r[extra_cols[i]] = None if k is None else (-b[k] if style == '-' else b[k])
        out.append(r)
    out.append({'label': 'Expenses', 'style': 'h', **{c: None for c in extra_cols}})
    cats = rows('SELECT DISTINCT c.id,c.name,lower(c.name) sort_name FROM expense_entries e JOIN exp_categories c ON c.id=e.category_id WHERE e.date BETWEEN ? AND ? ORDER BY lower(c.name)', (frm, to))
    return out, cats

def r_pl(f, adm):
    b = finance_breakdown(f['from'], f['to']); out, cats = pl_rows([b], f['from'], f['to'], ['amount'])
    for c in cats: out.append({'label': c['name'], 'style': '', 'amount': rnd(float(val('SELECT SUM(amount) FROM expense_entries WHERE category_id=? AND date BETWEEN ? AND ?', (c['id'], f['from'], f['to'])) or 0))})
    out += [{'label': 'Total expenses', 'style': 'b', 'amount': b['expenses']}, {'label': 'NET PROFIT', 'style': 'g', 'amount': b['net_profit']}]
    if b['tax']: out.append({'label': f"Sales tax collected (owed to government, not income): {b['tax']:,.2f}", 'style': 'note', 'amount': None})
    return {'columns': [C('label', 'Account'), C('amount', 'Amount', m=1)], 'rows': out, 'totals': {}, 'pl': True}

def r_pl_month(f, adm):
    start = datetime.strptime(f['from'] if f['from'] != '2000-01-01' else today()[:5] + '01-01', '%Y-%m-%d').replace(day=1); end = datetime.strptime(f['to'], '%Y-%m-%d')
    months = []
    while start <= end and len(months) < 24:
        nxt = add_months(start, 1); months.append((start.strftime('%Y-%m'), start.strftime('%Y-%m-%d'), min(end, nxt - timedelta(days=1)).strftime('%Y-%m-%d'))); start = nxt
    bs = [finance_breakdown(a, b) for _, a, b in months] + [finance_breakdown(months[0][1] if months else f['from'], f['to'])]
    cols = [m[0] for m in months] + ['total']
    out, cats = pl_rows(bs, f['from'], f['to'], cols)
    for c in cats:
        r = {'label': c['name'], 'style': ''}
        for (k, a, b) in months: r[k] = rnd(float(val('SELECT SUM(amount) FROM expense_entries WHERE category_id=? AND date BETWEEN ? AND ?', (c['id'], a, b)) or 0))
        r['total'] = rnd(sum(r[k] for k, _, _ in months)); out.append(r)
    out += [{'label': 'Total expenses', 'style': 'b', **{c: bs[i]['expenses'] for i, c in enumerate(cols)}}, {'label': 'NET PROFIT', 'style': 'g', **{c: bs[i]['net_profit'] for i, c in enumerate(cols)}}]
    return {'columns': [C('label', 'Account')] + [C(k, datetime.strptime(k + '-01', '%Y-%m-%d').strftime('%b %y'), m=1) for k, _, _ in months] + [C('total', 'Total', m=1)], 'rows': out, 'totals': {}, 'pl': True,
            'subtitle': f"{months[0][1] if months else f['from']} – {f['to']}"}


# ---------------------------------------------------------------- sales & customers
def inv_filter(f, alias='x') -> tuple:
    w, p = [f"{alias}.kind IN ('invoice','receipt')", f"{alias}.status<>'void'", f'{alias}.date BETWEEN ? AND ?'], [f['from'], f['to']]
    if f['customer_id']: w.append(f'{alias}.customer_id=?'); p.append(f['customer_id'])
    if f['user_id']: w.append(f'{alias}.user_id=?'); p.append(f['user_id'])
    return ' AND '.join(w), p

def r_sales_customer(f, adm):
    w, p = inv_filter(f)
    rs = rows(f"SELECT MAX(COALESCE(c.name,x.customer_name,'Walk-in customer')) customer, MAX(c.phone) phone, COUNT(*) invoices, SUM(x.total) total, SUM(x.paid) paid, SUM(x.total-x.paid) balance, SUM(x.total-x.tax-x.cost) profit "
              f"FROM sdocs x LEFT JOIN customers c ON c.id=x.customer_id WHERE {w} GROUP BY COALESCE(CAST(x.customer_id AS TEXT), 'w:'||x.customer_name) ORDER BY total DESC, COALESCE(CAST(x.customer_id AS TEXT), 'w:'||x.customer_name)", p)
    cols = [C('customer', 'Customer'), C('phone', 'Phone'), C('invoices', 'Invoices', n=1), C('total', 'Sales', m=1), C('paid', 'Paid', m=1), C('balance', 'Balance due', m=1)]
    if adm: cols.append(C('profit', 'Gross profit', m=1))
    else:
        for r in rs: r.pop('profit', None)
    return {'columns': cols, 'rows': rs}

def r_sales_item(f, adm):
    w, p = inv_filter(f)
    if f['item_id']: w += ' AND l.item_id=?'; p.append(f['item_id'])
    rs = rows(f"SELECT MAX(COALESCE(i.name,l.description)) item, MAX(COALESCE(i.type,'custom')) AS type, MAX(i.category) AS category, SUM(l.qty) qty, SUM(l.amount) sales, SUM(l.qty*l.unit_cost) cost, SUM(l.amount-l.qty*l.unit_cost) profit, "
              f"CASE WHEN SUM(l.qty)>0 THEN SUM(l.amount)/SUM(l.qty) ELSE 0 END avg_price FROM sdoc_lines l JOIN sdocs x ON x.id=l.doc_id LEFT JOIN items i ON i.id=l.item_id WHERE {w} "
              "GROUP BY COALESCE(CAST(l.item_id AS TEXT), 'd:'||l.description) ORDER BY sales DESC, COALESCE(CAST(l.item_id AS TEXT), 'd:'||l.description)", p)
    for r in rs:
        r['type'] = {'inventory': 'Stock item', 'service': 'Service', 'non_inventory': 'Non-stock item', 'custom': 'Custom line'}.get(r['type'], r['type'])
        r['margin'] = round(r['profit'] / r['sales'] * 100, 1) if r['sales'] else 0; r['avg_price'] = rnd(r['avg_price'])
    cols = [C('item', 'Item / service'), C('type', 'Type'), C('category', 'Category'), C('qty', 'Qty sold', n=1), C('avg_price', 'Average price', m=1, nt=1), C('sales', 'Sales (before invoice discount)', m=1)]
    if adm: cols += [C('cost', 'Cost', m=1), C('profit', 'Gross profit', m=1), C('margin', 'Margin %', p=1)]
    else:
        for r in rs: r.pop('cost', None); r.pop('profit', None); r.pop('margin', None)
    return {'columns': cols, 'rows': rs}

def r_sales_user(f, adm):
    w, p = inv_filter(f)
    rs = rows(f"SELECT x.user_id, MAX(COALESCE(u.name,'—')) staff, MAX(u.position) AS position, COUNT(*) invoices, SUM(x.total) total, SUM(x.paid) paid, SUM(x.total-x.paid) balance, SUM(x.total-x.tax-x.cost) profit, COUNT(DISTINCT x.customer_id) customers "
              f"FROM sdocs x LEFT JOIN users u ON u.id=x.user_id WHERE {w} GROUP BY x.user_id ORDER BY total DESC, x.user_id", p)
    qs = {r['user_id']: r for r in rows("SELECT user_id, COUNT(*) n, SUM(total) v FROM sdocs WHERE kind='quote' AND status<>'void' AND date BETWEEN ? AND ? GROUP BY user_id", (f['from'], f['to']))}
    for r in rs: r['quotes'] = int((qs.get(r.pop('user_id')) or {}).get('n') or 0)
    cols = [C('staff', 'Staff member'), C('position', 'Position'), C('invoices', 'Invoices', n=1), C('customers', 'Customers served', n=1), C('total', 'Sales', m=1), C('paid', 'Collected', m=1), C('balance', 'Still owed', m=1), C('quotes', 'Quotations', n=1)]
    if adm: cols.append(C('profit', 'Gross profit', m=1))
    else:
        for r in rs: r.pop('profit', None)
    return {'columns': cols, 'rows': rs}

def r_sales_period(f, adm):
    w, p = inv_filter(f); g_ = f['group'] if f['group'] != 'year' else 'year'
    agg: dict = {}
    for x in rows(f'SELECT x.date,x.total,x.paid,x.tax,x.cost,x.discount FROM sdocs x WHERE {w}', p):
        k = period_key(x['date'], g_); a = agg.setdefault(k, {'period': k, 'invoices': 0, 'total': 0.0, 'discount': 0.0, 'tax': 0.0, 'paid': 0.0, 'profit': 0.0})
        a['invoices'] += 1; a['total'] += x['total']; a['discount'] += x['discount']; a['tax'] += x['tax']; a['paid'] += x['paid']; a['profit'] += x['total'] - x['tax'] - x['cost']
    pay = {}
    for r in rows('SELECT p.date,p.amount FROM cust_payments p JOIN sdocs x ON x.id=p.doc_id WHERE p.date BETWEEN ? AND ?' + (' AND x.customer_id=?' if f['customer_id'] else '') + (' AND x.user_id=?' if f['user_id'] else ''),
                  [f['from'], f['to']] + ([f['customer_id']] if f['customer_id'] else []) + ([f['user_id']] if f['user_id'] else [])):
        k = period_key(r['date'], g_); pay[k] = pay.get(k, 0.0) + r['amount']
    rs = []
    for k in sorted(set(agg) | set(pay), reverse=True):
        a = agg.get(k) or {'period': k, 'invoices': 0, 'total': 0.0, 'discount': 0.0, 'tax': 0.0, 'paid': 0.0, 'profit': 0.0}
        a = {kk: rnd(v) if isinstance(v, float) else v for kk, v in a.items()}; a['received'] = rnd(pay.get(k, 0.0)); a['period'] = period_label(k, g_); rs.append(a)
    cols = [C('period', {'day': 'Day', 'week': 'Week', 'month': 'Month', 'year': 'Year'}[g_]), C('invoices', 'Invoices', n=1), C('discount', 'Discounts', m=1), C('tax', 'Tax', m=1), C('total', 'Sales', m=1), C('received', 'Cash received', m=1)]
    if adm: cols.append(C('profit', 'Gross profit', m=1))
    else:
        for r in rs: r.pop('profit', None)
    return {'columns': cols, 'rows': rs}

STATE_LABEL = {'unpaid': 'Unpaid', 'partial': 'Partly paid', 'paid': 'Paid', 'overdue': 'Overdue', 'void': 'Void', 'pending': 'Pending', 'accepted': 'Accepted', 'declined': 'Declined', 'converted': 'Converted to invoice', 'expired': 'Expired', 'open': 'Open'}

def r_invoices(f, adm):
    rs = acc.docs_query({'kind': 'sales', 'from': f['from'], 'to': f['to'], 'customer_id': f['customer_id'], 'user_id': f['user_id'], 'status': f['status']}, 100000)
    out = [{'number': x['number'], 'type': 'Sales receipt' if x['kind'] == 'receipt' else 'Invoice', 'date': x['date'], 'due': x['due_date'] or '', 'customer': x['customer_name'], 'items': (x['items'] or '').replace('\n', ', '), 'total': x['total'] if x['status'] != 'void' else 0, 'paid': x['paid'], 'balance': x['balance'],
            'state': STATE_LABEL.get(x['state'], x['state']), 'by': x['by_name'], **({'profit': x['profit']} if adm else {})} for x in rs]
    cols = [C('number', 'Number'), C('type', 'Type'), C('date', 'Date'), C('due', 'Due'), C('customer', 'Customer'), C('items', 'Items'), C('total', 'Total', m=1), C('paid', 'Paid', m=1), C('balance', 'Balance', m=1), C('state', 'Status'), C('by', 'Created by')]
    if adm: cols.append(C('profit', 'Gross profit', m=1))
    return {'columns': cols, 'rows': out}

def r_quotes(f, adm):
    rs = acc.docs_query({'kind': 'quote', 'from': f['from'], 'to': f['to'], 'customer_id': f['customer_id'], 'user_id': f['user_id'], 'status': f['status']}, 100000)
    out = [{'number': x['number'], 'date': x['date'], 'valid': x['due_date'] or '', 'customer': x['customer_name'], 'items': (x['items'] or '').replace('\n', ', '), 'total': x['total'], 'state': STATE_LABEL.get(x['state'], x['state']), 'by': x['by_name']} for x in rs]
    won = sum(1 for x in rs if x['state'] in ('accepted', 'converted')); decided = sum(1 for x in rs if x['state'] in ('accepted', 'converted', 'declined', 'expired'))
    return {'columns': [C('number', 'Quotation'), C('date', 'Date'), C('valid', 'Valid until'), C('customer', 'Customer'), C('items', 'Items'), C('total', 'Amount', m=1), C('state', 'Status'), C('by', 'Created by')], 'rows': out,
            'note': f'Won {won} of {decided} decided quotations ({round(won / decided * 100)}%).' if decided else ''}

def r_payments(f, adm):
    w, p = ['p.date BETWEEN ? AND ?'], [f['from'], f['to']]
    if f['customer_id']: w.append('x.customer_id=?'); p.append(f['customer_id'])
    if f['user_id']: w.append('p.user_id=?'); p.append(f['user_id'])
    if f['method']: w.append('p.method=?'); p.append(f['method'])
    rs = rows('SELECT p.date,x.number,x.customer_name customer,p.method,p.ref,p.amount,p.note,u.name by_name FROM cust_payments p JOIN sdocs x ON x.id=p.doc_id LEFT JOIN users u ON u.id=p.user_id WHERE ' + ' AND '.join(w) + ' ORDER BY p.date DESC,p.id DESC', p)
    by_m: dict = {}
    for r in rs: by_m[r['method']] = by_m.get(r['method'], 0) + r['amount']
    return {'columns': [C('date', 'Date'), C('number', 'Invoice'), C('customer', 'Customer'), C('method', 'Method'), C('ref', 'Reference'), C('amount', 'Amount', m=1), C('note', 'Note'), C('by_name', 'Received by')], 'rows': rs,
            'note': ' • '.join(f'{k}: {v:,.2f}' for k, v in sorted(by_m.items(), key=lambda x: -x[1]))}

def aging(docs: list, as_of: str, name_key: str) -> list:
    agg: dict = {}
    for x in docs:
        due = x.get('due_date') or x['date']; days = (datetime.strptime(as_of, '%Y-%m-%d') - datetime.strptime(due, '%Y-%m-%d')).days
        b = 'current' if days <= 0 else 'd30' if days <= 30 else 'd60' if days <= 60 else 'd90' if days <= 90 else 'over'
        a = agg.setdefault(x[name_key] or '—', {'name': x[name_key] or '—', 'current': 0.0, 'd30': 0.0, 'd60': 0.0, 'd90': 0.0, 'over': 0.0, 'total': 0.0, 'docs': 0})
        a[b] += x['balance']; a['total'] += x['balance']; a['docs'] += 1
    return sorted([{k: rnd(v) if isinstance(v, float) else v for k, v in a.items()} for a in agg.values()], key=lambda a: -a['total'])

AGING_COLS = [C('current', 'Not yet due', m=1), C('d30', '1–30 days late', m=1), C('d60', '31–60 days', m=1), C('d90', '61–90 days', m=1), C('over', 'Over 90 days', m=1), C('total', 'Total owed', m=1)]

def r_ar_aging(f, adm):
    docs = [x for x in acc.docs_query({'kind': 'invoice', 'to': f['to'], 'customer_id': f['customer_id'], 'user_id': f['user_id']}, 100000) if x['state'] in ('unpaid', 'partial', 'overdue')]
    return {'columns': [C('name', 'Customer'), C('docs', 'Open invoices', n=1)] + AGING_COLS, 'rows': aging(docs, f['to'], 'customer_name')}

def r_statement(f, adm):
    if not f['customer_id']: raise ApiError('Choose a customer for the statement.')
    c = row('SELECT name,phone FROM customers WHERE id=?', (f['customer_id'],))
    if not c: raise ApiError('Customer not found.', 404)
    ev = []
    for x in rows("SELECT number,date,total,due_date FROM sdocs WHERE customer_id=? AND kind IN ('invoice','receipt') AND status<>'void' AND date<=?", (f['customer_id'], f['to'])):
        ev.append((x['date'], 0, {'date': x['date'], 'ref': x['number'], 'desc': 'Invoice' + (f" (due {x['due_date']})" if x['due_date'] else ''), 'charge': x['total'], 'payment': 0.0}))
    for p in rows("SELECT p.date,p.amount,p.method,x.number FROM cust_payments p JOIN sdocs x ON x.id=p.doc_id WHERE x.customer_id=? AND p.date<=?", (f['customer_id'], f['to'])):
        ev.append((p['date'], 1, {'date': p['date'], 'ref': p['number'], 'desc': f"Payment — {p['method']}", 'charge': 0.0, 'payment': p['amount']}))
    for r in rows("SELECT r.id,r.device,hic_day(r.received_at) d,r.price-r.discount v FROM repairs r WHERE r.customer_id=? AND r.price-r.discount>0 AND hic_day(r.received_at)<=?", (f['customer_id'], f['to'])):
        ev.append((r['d'], 0, {'date': r['d'], 'ref': f"RP-{r['id']:05d}", 'desc': f"Hardware repair — {r['device']}", 'charge': r['v'], 'payment': 0.0}))
    for p in rows('SELECT p.date,p.amount,p.method,r.id FROM repair_payments p JOIN repairs r ON r.id=p.repair_id WHERE r.customer_id=? AND p.date<=?', (f['customer_id'], f['to'])):
        ev.append((p['date'], 1, {'date': p['date'], 'ref': f"RP-{p['id']:05d}", 'desc': f"Repair payment — {p['method']}", 'charge': 0.0, 'payment': p['amount']}))
    for j in rows("SELECT j.id,j.kind,j.device,hic_day(j.received_at) d,j.price-j.discount v FROM soft_jobs j WHERE j.customer_id=? AND j.price-j.discount>0 AND hic_day(j.received_at)<=?", (f['customer_id'], f['to'])):
        ev.append((j['d'], 0, {'date': j['d'], 'ref': f"SW-{j['id']:05d}", 'desc': f"Software service — {j['device']}", 'charge': j['v'], 'payment': 0.0}))
    for p in rows('SELECT p.date,p.amount,p.method,j.id FROM soft_payments p JOIN soft_jobs j ON j.id=p.job_id WHERE j.customer_id=? AND p.date<=?', (f['customer_id'], f['to'])):
        ev.append((p['date'], 1, {'date': p['date'], 'ref': f"SW-{p['id']:05d}", 'desc': f"Software payment — {p['method']}", 'charge': 0.0, 'payment': p['amount']}))
    ev.sort(key=lambda e: (e[0], e[1])); bal = 0.0; opening = 0.0; out = []
    for dt, _, e in ev:
        bal += e['charge'] - e['payment']
        if dt < f['from']: opening = bal; continue
        out.append({**e, 'charge': rnd(e['charge']), 'payment': rnd(e['payment']), 'balance': rnd(bal)})
    if f['from'] != '2000-01-01': out.insert(0, {'date': f['from'], 'ref': '', 'desc': 'Opening balance', 'charge': 0.0, 'payment': 0.0, 'balance': rnd(opening)})
    return {'title': f"Customer statement — {c['name']}", 'columns': [C('date', 'Date'), C('ref', 'Reference'), C('desc', 'Description'), C('charge', 'Charges', m=1), C('payment', 'Payments', m=1), C('balance', 'Balance', m=1, nt=1)],
            'rows': out, 'note': f"{c['phone'] or ''} • Balance due: {rnd(bal):,.2f}"}


# ---------------------------------------------------------------- expenses & stores
def r_expenses_cat(f, adm):
    w, p = ['e.date BETWEEN ? AND ?'], [f['from'], f['to']]
    for k, col in (('category_id', 'e.category_id'), ('vendor_id', 'e.vendor_id'), ('user_id', 'e.user_id')):
        if f[k]: w.append(f'{col}=?'); p.append(f[k])
    rs = rows('SELECT MAX(c.name) category, COUNT(*) entries, SUM(e.amount) amount FROM expense_entries e LEFT JOIN exp_categories c ON c.id=e.category_id WHERE ' + ' AND '.join(w) + ' GROUP BY e.category_id ORDER BY amount DESC, e.category_id', p)
    tot = sum(r['amount'] for r in rs) or 1
    for r in rs: r['share'] = round(r['amount'] / tot * 100, 1)
    return {'columns': [C('category', 'Category'), C('entries', 'Entries', n=1), C('amount', 'Amount', m=1), C('share', '% of expenses', p=1)], 'rows': rs}

def r_expenses(f, adm):
    rs = acc.expenses_query(f)
    return {'columns': [C('date', 'Date'), C('category', 'Category'), C('payee', 'Payee'), C('description', 'Description'), C('method', 'Paid by'), C('ref', 'Reference'), C('amount', 'Amount', m=1), C('by_name', 'Entered by')], 'rows': rs}

def r_purchases(f, adm):
    rs = acc.bills_query({'vendor_id': f['vendor_id'], 'from': f['from'], 'to': f['to'], 'status': f['status']})
    out = [{'number': b['number'], 'date': b['date'], 'due': b['due_date'] or '', 'store': b['vendor'], 'ref': b['ref'], 'items': (b['items'] or '').replace('\n', ', '), 'total': b['total'] if b['status'] != 'void' else 0, 'paid': b['paid'], 'balance': b['balance'],
            'state': STATE_LABEL.get(b['state'], b['state']), 'by': b['by_name']} for b in rs]
    return {'columns': [C('number', 'Bill'), C('date', 'Date'), C('due', 'Due'), C('store', 'Store'), C('ref', 'Store ref.'), C('items', 'Items'), C('total', 'Total', m=1), C('paid', 'Paid', m=1), C('balance', 'Owed', m=1), C('state', 'Status'), C('by', 'Entered by')], 'rows': out}

def r_ap_aging(f, adm):
    docs = [{**b, 'due_date': b['due_date']} for b in acc.bills_query({'vendor_id': f['vendor_id'], 'to': f['to']}) if b['state'] in ('unpaid', 'partial', 'overdue')]
    return {'columns': [C('name', 'Store'), C('docs', 'Open bills', n=1)] + AGING_COLS, 'rows': aging(docs, f['to'], 'vendor')}

def r_store_payments(f, adm):
    w, p = ['p.date BETWEEN ? AND ?'], [f['from'], f['to']]
    if f['vendor_id']: w.append('p.vendor_id=?'); p.append(f['vendor_id'])
    if f['method']: w.append('p.method=?'); p.append(f['method'])
    if f['user_id']: w.append('p.user_id=?'); p.append(f['user_id'])
    rs = rows('SELECT p.date,v.name store,b.number bill,p.method,p.ref,p.amount,p.note,u.name by_name FROM vendor_payments p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN bills b ON b.id=p.bill_id LEFT JOIN users u ON u.id=p.user_id WHERE ' + ' AND '.join(w) + ' ORDER BY p.date DESC,p.id DESC', p)
    return {'columns': [C('date', 'Date'), C('store', 'Store'), C('bill', 'Bill'), C('method', 'Method'), C('ref', 'Reference'), C('amount', 'Amount', m=1), C('note', 'Note'), C('by_name', 'Paid by')], 'rows': rs}


# ---------------------------------------------------------------- inventory
def r_stock(f, adm):
    w, p = ["i.type='inventory'", 'i.active=1'], []
    if f['item_id']: w.append('i.id=?'); p.append(f['item_id'])
    if f['vendor_id']: w.append('i.vendor_id=?'); p.append(f['vendor_id'])
    as_of = f['to']; rs = []
    for i in rows('SELECT i.*,v.name vendor FROM items i LEFT JOIN vendors v ON v.id=i.vendor_id WHERE ' + ' AND '.join(w) + ' ORDER BY i.category NULLS FIRST,lower(i.name)', p):
        qh = float(val('SELECT COALESCE(SUM(qty),0) FROM stock_moves WHERE item_id=? AND date<=?', (i['id'], as_of)) or 0) if as_of < today() else float(i['qty'])
        r = {'item': i['name'], 'sku': i['sku'], 'category': i['category'], 'vendor': i['vendor'], 'qty': round(qh, 3), 'reorder': i['reorder'], 'price': i['sale_price'], 'retail': rnd(qh * float(i['sale_price']))}
        if adm: r.update({'cost': rnd(float(i['cost'])), 'value': rnd(qh * float(i['cost']))})
        rs.append(r)
    cols = [C('item', 'Item'), C('sku', 'SKU'), C('category', 'Category'), C('vendor', 'Usual store'), C('qty', 'On hand', n=1), C('reorder', 'Reorder at')]
    cols += ([C('cost', 'Average cost', m=1, nt=1), C('value', 'Stock value (cost)', m=1)] if adm else []) + [C('price', 'Sale price', m=1, nt=1), C('retail', 'Stock value (sale price)', m=1)]
    return {'columns': cols, 'rows': rs}

def r_low_stock(f, adm):
    rs = [{'item': i['name'], 'category': i['category'], 'vendor': i['vendor'], 'qty': float(i['qty']), 'reorder': i['reorder'], 'state': 'OUT OF STOCK' if float(i['qty']) <= 0 else 'Low',
           'suggest': max(0, int(i['reorder']) * 2 - int(float(i['qty'])))}
          for i in rows("SELECT i.*,v.name vendor FROM items i LEFT JOIN vendors v ON v.id=i.vendor_id WHERE i.type='inventory' AND i.active=1 AND i.qty<=i.reorder" + (' AND i.vendor_id=?' if f['vendor_id'] else '') + ' ORDER BY i.qty,lower(i.name)', (f['vendor_id'],) if f['vendor_id'] else ())]
    return {'columns': [C('item', 'Item'), C('category', 'Category'), C('vendor', 'Usual store'), C('qty', 'On hand', n=1), C('reorder', 'Reorder at'), C('suggest', 'Suggested order', n=1), C('state', 'Status')], 'rows': rs}

def r_moves(f, adm):
    w, p = ['m.date BETWEEN ? AND ?'], [f['from'], f['to']]
    if f['item_id']: w.append('m.item_id=?'); p.append(f['item_id'])
    if f['user_id']: w.append('m.user_id=?'); p.append(f['user_id'])
    if f['customer_id']: w.append('m.customer_id=?'); p.append(f['customer_id'])
    if f['vendor_id']: w.append('m.vendor_id=?'); p.append(f['vendor_id'])
    if f['status'] in acc.MOVE_LABEL: w.append('m.kind=?'); p.append(f['status'])
    rs = []
    for m in rows('SELECT m.*,i.name item,u.name by_name,c.name customer,v.name vendor FROM stock_moves m JOIN items i ON i.id=m.item_id LEFT JOIN users u ON u.id=m.user_id LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN vendors v ON v.id=m.vendor_id WHERE ' + ' AND '.join(w) + ' ORDER BY m.date DESC,m.id DESC', p):
        r = {'date': m['date'], 'item': m['item'], 'kind': acc.MOVE_LABEL.get(m['kind'], m['kind']), 'ref': acc.ref_text(m['ref_kind'], m['ref_id']), 'qin': m['qty'] if m['qty'] > 0 else 0, 'qout': -m['qty'] if m['qty'] < 0 else 0,
             'who': m['customer'] or m['vendor'] or '', 'note': m['note'], 'by': m['by_name']}
        if adm: r['value'] = rnd(m['qty'] * (m['unit_cost'] or 0))
        rs.append(r)
    cols = [C('date', 'Date'), C('item', 'Item'), C('kind', 'Movement'), C('ref', 'Reference'), C('qin', 'In', n=1), C('qout', 'Out', n=1), C('who', 'Customer / store'), C('note', 'Note'), C('by', 'By')]
    if adm: cols.insert(6, C('value', 'Value (cost)', m=1))
    return {'columns': cols, 'rows': rs}


# ---------------------------------------------------------------- operations (kept from the previous reports)
def r_repairs(f, adm):
    w, p = ['hic_day(r.received_at) BETWEEN ? AND ?'], [f['from'], f['to']]
    if f['customer_id']: w.append('r.customer_id=?'); p.append(f['customer_id'])
    if f['user_id']: w.append('r.technician_id=?'); p.append(f['user_id'])
    out = []
    for r in rows("SELECT r.id,hic_day(r.received_at) d,c.name cn,c.phone,r.device,r.problem,r.status,r.price,r.discount,u.name tech,COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0) paid FROM repairs r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.technician_id WHERE " + ' AND '.join(w) + ' ORDER BY r.id DESC', p):
        ch = float(r['price'] or 0) - float(r['discount'] or 0)
        out.append({'date': r['d'], 'customer': r['cn'], 'phone': r['phone'], 'device': r['device'], 'problem': r['problem'], 'status': r['status'], 'technician': r['tech'], 'price': rnd(ch), 'paid': rnd(float(r['paid'])), 'balance': rnd(ch - float(r['paid']))})
    return {'columns': [C('date', 'Received'), C('customer', 'Customer'), C('phone', 'Phone'), C('device', 'Device'), C('problem', 'Problem'), C('status', 'Status', st=1), C('technician', 'Technician'), C('price', 'Charge', m=1), C('paid', 'Paid', m=1), C('balance', 'Balance', m=1)], 'rows': out}

def r_software(f, adm):
    w, p = ['hic_day(j.received_at) BETWEEN ? AND ?'], [f['from'], f['to']]
    if f['customer_id']: w.append('j.customer_id=?'); p.append(f['customer_id'])
    if f['user_id']: w.append('j.technician_id=?'); p.append(f['user_id'])
    names = {'repair': 'Software repair', 'unlock': 'Apple Unlock', 'newid': 'New Apple ID'}; out = []
    for r in rows("SELECT j.kind,j.device,j.status,j.price,j.discount,hic_day(j.received_at) d,c.name cn,c.phone,u.name tech,COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0) paid FROM soft_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.technician_id WHERE " + ' AND '.join(w) + ' ORDER BY j.id DESC', p):
        ch = float(r['price'] or 0) - float(r['discount'] or 0)
        out.append({'date': r['d'], 'service': names.get(r['kind'], r['kind']), 'customer': r['cn'], 'phone': r['phone'], 'device': r['device'], 'status': r['status'], 'user': r['tech'], 'price': rnd(ch), 'paid': rnd(float(r['paid'])), 'balance': rnd(ch - float(r['paid']))})
    return {'columns': [C('date', 'Received'), C('service', 'Service'), C('customer', 'Customer'), C('phone', 'Phone'), C('device', 'Device'), C('status', 'Status', st=1), C('user', 'Software user'), C('price', 'Charge', m=1), C('paid', 'Paid', m=1), C('balance', 'Balance', m=1)], 'rows': out}

def r_followups(f, adm):
    out = [{'customer': x['cn'], 'phone': x['phone'], 'type': str(x['type']).replace('_', ' ').capitalize(), 'note': x['note'], 'due': x['due_date']}
           for x in rows('SELECT f.*,c.name cn,c.phone FROM followups f JOIN customers c ON c.id=f.customer_id WHERE f.done=0' + (' AND f.customer_id=?' if f['customer_id'] else '') + ' ORDER BY f.due_date NULLS FIRST', (f['customer_id'],) if f['customer_id'] else ())]
    return {'columns': [C('customer', 'Customer'), C('phone', 'Phone'), C('type', 'Follow-up'), C('note', 'Note'), C('due', 'Due')], 'rows': out}


# ---------------------------------------------------------------- money accounts
ACC_TYPE_LABEL = {'cash': 'Cash', 'mobile': 'Mobile money', 'bank': 'Bank', 'other': 'Other'}

def r_acct_balances(f, adm):
    bal = acc.acct_balances(f['to']); rs = []
    for a in rows('SELECT * FROM money_accounts ORDER BY active DESC,id'):
        if not a['active'] and abs(bal.get(a['id'], 0)) < 0.005: continue
        rs.append({'account': a['name'], 'type': ACC_TYPE_LABEL.get(a['type'], a['type']), 'number': a['number'] or '', 'balance': bal.get(a['id'], 0.0)})
    return {'columns': [C('account', 'Account'), C('type', 'Type'), C('number', 'Number'), C('balance', 'Balance', m=1)], 'rows': rs}

def r_acct_register(f, adm):
    names = {a['id']: a['name'] for a in rows('SELECT id,name FROM money_accounts')}; rs = []
    for x in acc.acct_flows(f['account_id'] or None, f['to']):
        if x['date'] < f['from']: continue
        rs.append({'date': x['date'], 'account': names.get(x['account_id'], ''), 'kind': x['kind'], 'ref': x['ref'], 'desc': x['desc'],
                   'money_in': x['amount'] if x['amount'] > 0 else 0, 'money_out': -x['amount'] if x['amount'] < 0 else 0})
    rs.reverse()
    return {'columns': [C('date', 'Date'), C('account', 'Account'), C('kind', 'Type'), C('ref', 'Reference'), C('desc', 'Description'), C('money_in', 'Money in', m=1), C('money_out', 'Money out', m=1)], 'rows': rs,
            'note': f"Net change: {rnd(sum(r['money_in'] - r['money_out'] for r in rs)):,.2f}"}

def r_acct_transfers(f, adm):
    w, p = ['t.date BETWEEN ? AND ?'], [f['from'], f['to']]
    if f['account_id']: w.append('(t.from_id=? OR t.to_id=?)'); p += [f['account_id'], f['account_id']]
    rs = rows('SELECT t.date,fa.name from_name,ta.name to_name,t.amount,t.fee,t.ref,t.note,u.name by_name FROM acc_transfers t JOIN money_accounts fa ON fa.id=t.from_id JOIN money_accounts ta ON ta.id=t.to_id LEFT JOIN users u ON u.id=t.user_id WHERE ' + ' AND '.join(w) + ' ORDER BY t.date DESC,t.id DESC', p)
    return {'columns': [C('date', 'Date'), C('from_name', 'From'), C('to_name', 'To'), C('amount', 'Amount', m=1), C('fee', 'Fee', m=1), C('ref', 'Reference'), C('note', 'Note'), C('by_name', 'By')], 'rows': rs}