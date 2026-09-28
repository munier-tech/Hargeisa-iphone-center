"""Accounting: items & stock, stores (suppliers) with bills and payments, quotations, invoices, customer payments, expenses.

Works like QuickBooks:
  * Items are inventory (tracked stock, moving-average cost), services or non-stock items.
  * `stock_moves` is the stock ledger: opening, purchase (bill), sale (invoice), repair (parts used), adjust.
    Quantity on hand and average cost on `items` are a cache re-derived from the ledger.
  * Stores are suppliers: a bill adds stock and creates money owed to the store; payments reduce it.
  * A quotation never touches stock or money; converting it creates an invoice.
  * An invoice takes stock out at the current average cost (that is the cost of goods sold) and is paid by one or more payments.
"""
from __future__ import annotations

from core import *

ITEM_TYPES = ['inventory', 'service', 'non_inventory']
PAY_METHODS = ['Cash', 'ZAAD', 'eDahab', 'EVC / Mobile money', 'Bank transfer', 'Card', 'Cheque', 'Other']
ADJ_REASONS = ['Stock count correction', 'Damaged / faulty', 'Lost / stolen', 'Returned to store / supplier', 'Found / extra stock', 'Own use', 'Other']
DEFAULT_EXP_CATS = ['Rent', 'Utilities (electricity, water)', 'Salaries & wages', 'Internet & phone', 'Transport', 'Maintenance & repairs', 'Marketing', 'Tools & equipment', 'Bank & mobile money fees', 'Daily expenses', 'Other expenses']
DOC_KINDS = ('quote', 'invoice', 'receipt')             # receipt = sales receipt: a sale paid in full on the spot
SALE_KINDS = ('invoice', 'receipt')
KIND_WORD = {'quote': 'quotation', 'invoice': 'invoice', 'receipt': 'sales receipt'}
EPS = 0.005


def money_(v) -> float: return rnd(max(0.0, n(v)))
def qty_(v) -> float: return round(n(v), 3)

def method_(v) -> str: return v if v in PAY_METHODS else 'Cash'

# which money account a payment method lands in when the form does not choose one
METHOD_ACCOUNT = {'Cash': 'Cash', 'ZAAD': 'ZAAD', 'eDahab': 'eDahab', 'EVC / Mobile money': 'ZAAD', 'Bank transfer': 'Bank', 'Card': 'Bank', 'Cheque': 'Bank', 'Other': 'Cash'}

def pick_account(inp, method: str = 'Cash') -> int | None:
    aid = I((inp or {}).get('account_id'))
    if aid and val('SELECT 1 FROM money_accounts WHERE id=? AND active=1', (aid,)): return aid
    by = val('SELECT id FROM money_accounts WHERE active=1 AND lower(name)=lower(?)', (METHOD_ACCOUNT.get(method, method),))
    return by or val("SELECT id FROM money_accounts WHERE active=1 ORDER BY CASE type WHEN 'cash' THEN 0 ELSE 1 END, id LIMIT 1")

def next_no(kind: str) -> str:
    """Document numbers: INV-00001, QT-00001, BILL-00001 (counters kept in settings, safe inside the request transaction)."""
    key = f'seq_{kind}'                                  # one atomic step, so two people saving at the same moment never get the same number
    nx = I(val("INSERT INTO settings(k,v) VALUES(?, '1') ON CONFLICT(k) DO UPDATE SET v=CAST((CASE WHEN settings.v ~ '^[0-9]+$' THEN CAST(settings.v AS BIGINT) ELSE 0 END)+1 AS TEXT) RETURNING v", (key,)))
    prefix = {'invoice': setting('doc_prefix', 'INV') or 'INV', 'quote': setting('quote_prefix', 'QT') or 'QT', 'receipt': setting('receipt_prefix', 'SR') or 'SR', 'bill': 'BILL', 'payment': 'PAY'}[kind]
    return f'{prefix}-{nx:05d}'

def see_cost() -> bool: return is_admin()


# ================================================================ stock engine
def item_recalc(iid: int) -> None:
    """Re-derive quantity on hand and moving-average cost from the ledger."""
    qh = 0.0; cost = 0.0
    for m in rows('SELECT qty,unit_cost FROM stock_moves WHERE item_id=? ORDER BY date,id', (iid,)):
        qm = float(m['qty'] or 0)
        if qm > 0 and m['unit_cost'] is not None:
            base = max(qh, 0.0); new = base + qm
            cost = (base * cost + qm * float(m['unit_cost'])) / new if new > 0 else float(m['unit_cost'])
        qh += qm
    q('UPDATE items SET qty=?, cost=? WHERE id=?', (round(qh, 3), round(cost, 4), iid))

def move(iid: int, qty: float, kind: str, ref_kind: str, ref_id: int, date: str, unit_cost=None, note: str = '', customer_id=None, vendor_id=None) -> float:
    """Post one stock movement. Outgoing stock is valued at the current average cost. Returns the unit cost used."""
    it = row('SELECT * FROM items WHERE id=? FOR UPDATE', (iid,))          # locked until the request commits: no overselling in parallel
    if not it or it['type'] != 'inventory': return 0.0
    if qty < 0:
        if float(it['qty'] or 0) + qty < -1e-9 and setting('allow_negative_stock', '0') != '1':
            raise ApiError(f"Not enough stock for {it['name']}: {fmt_q(it['qty'])} on hand, {fmt_q(-qty)} needed.")
        unit_cost = float(it['cost'] or 0)
    elif unit_cost is None: unit_cost = float(it['cost'] or 0)
    ins('stock_moves', {'item_id': iid, 'date': date, 'ts': now(), 'qty': qty, 'unit_cost': round(float(unit_cost), 4), 'kind': kind, 'ref_kind': ref_kind, 'ref_id': ref_id,
                        'user_id': sess_uid('staff') or None, 'note': s(note, 300), 'customer_id': customer_id, 'vendor_id': vendor_id})
    item_recalc(iid)
    return float(unit_cost)

def unmove(ref_kind: str, ref_id: int, check_negative: bool = True) -> list:
    """Remove every movement a document posted (used when it is edited, voided or deleted)."""
    ids = [r['item_id'] for r in rows('SELECT DISTINCT item_id FROM stock_moves WHERE ref_kind=? AND ref_id=?', (ref_kind, ref_id))]
    q('DELETE FROM stock_moves WHERE ref_kind=? AND ref_id=?', (ref_kind, ref_id))
    for i in ids: item_recalc(i)
    if check_negative: check_nonneg(ids)
    return ids

def check_nonneg(ids) -> None:
    if setting('allow_negative_stock', '0') == '1': return
    for i in set(ids):
        it = row('SELECT name,qty FROM items WHERE id=?', (i,))
        if it and float(it['qty']) < -1e-9:
            raise ApiError(f"This change would leave {it['name']} with negative stock ({fmt_q(it['qty'])}) — that stock was already sold or used.")

def fmt_q(v) -> str:
    v = float(v or 0); return str(int(v)) if v == int(v) else f'{v:.3f}'.rstrip('0')

def stock_out(iid: int, qty: float, ref_kind: str, ref_id: int, date: str, note: str = '', customer_id=None) -> float:
    return move(iid, -abs(qty), 'repair' if ref_kind in ('repair_part', 'soft_part') else 'sale', ref_kind, ref_id, date, note=note, customer_id=customer_id)


# ================================================================ items
def act_items_list(inp):
    need_any([('inventory', 'view'), ('sales', 'add'), ('sales', 'view'), ('repairs', 'edit'), ('software', 'edit'), ('stores', 'add'), ('stores', 'view')])
    w, p = ['1=1'], []
    if inp.get('type') in ITEM_TYPES: w.append('i.type=?'); p.append(inp['type'])
    if not inp.get('all'): w.append('i.active=1')
    out = rows('SELECT i.*,v.name vendor FROM items i LEFT JOIN vendors v ON v.id=i.vendor_id WHERE ' + ' AND '.join(w) + ' ORDER BY lower(i.name)', p)
    adm = see_cost()
    for r in out:
        r['low'] = r['type'] == 'inventory' and float(r['qty']) <= float(r['reorder'] or 0)
        if adm: r['value'] = rnd(float(r['qty']) * float(r['cost'])) if r['type'] == 'inventory' else 0
        else: r.pop('cost', None)
    return out

def act_item_save(inp):
    id_ = I(inp.get('id')); u = need('inventory', 'edit' if id_ else 'add')
    type_ = inp.get('type') if inp.get('type') in ITEM_TYPES else 'inventory'
    f = {'name': s(inp.get('name'), 120), 'sku': s(inp.get('sku'), 40), 'category': s(inp.get('category'), 60), 'unit': s(inp.get('unit'), 12) or 'pcs',
         'sale_price': money_(inp.get('sale_price')), 'reorder': max(0, I(inp.get('reorder'))), 'vendor_id': I(inp.get('vendor_id')) or None,
         'description': s(inp.get('description'), 500), 'active': 0 if inp.get('active') in (False, 0, '0') else 1, 'updated_at': now()}
    if not f['name']: raise ApiError('Item name is required.')
    if val('SELECT 1 FROM items WHERE lower(name)=lower(?) AND id<>?', (f['name'], id_)): raise ApiError('An item with this name already exists.')
    if f['sku'] and val('SELECT 1 FROM items WHERE sku=? AND id<>?', (f['sku'], id_)): raise ApiError('Another item already uses this SKU / code.')
    if f['vendor_id'] and not val('SELECT 1 FROM vendors WHERE id=?', (f['vendor_id'],)): f['vendor_id'] = None
    if id_:
        it = row('SELECT * FROM items WHERE id=?', (id_,))
        if not it: raise ApiError('Item not found.', 404)
        if it['type'] != type_ and val('SELECT 1 FROM stock_moves WHERE item_id=?', (id_,)): raise ApiError('This item already has stock history, so its type cannot be changed.')
        f['type'] = type_
        if type_ == 'non_inventory' and see_cost() and inp.get('cost') not in (None, ''): f['cost'] = money_(inp.get('cost'))
        upd('items', id_, f); audit('update', 'item', id_, f['name'])
        return {'id': id_}
    f.update({'type': type_, 'qty': 0, 'cost': money_(inp.get('cost')) if type_ == 'non_inventory' else 0, 'created_by': u['id'], 'created_at': now()})
    id_ = ins('items', f)
    oq = qty_(inp.get('opening_qty'))
    if type_ == 'inventory' and oq > 0:
        move(id_, oq, 'opening', 'opening', id_, d(inp.get('opening_date')) or today(), money_(inp.get('opening_cost')), 'Opening stock')
    audit('create', 'item', id_, f['name'])
    return {'id': id_}

def act_item_delete(inp):
    need('inventory', 'delete'); id_ = I(inp.get('id')); it = row('SELECT * FROM items WHERE id=?', (id_,))
    if not it: raise ApiError('Item not found.', 404)
    used = val('SELECT 1 FROM sdoc_lines WHERE item_id=?', (id_,)) or val('SELECT 1 FROM bill_lines WHERE item_id=?', (id_,)) or val("SELECT 1 FROM stock_moves WHERE item_id=? AND kind<>'opening'", (id_,)) \
        or val('SELECT 1 FROM repair_parts WHERE product_id=?', (id_,)) or val('SELECT 1 FROM soft_parts WHERE product_id=?', (id_,))
    if used:
        upd('items', id_, {'active': 0, 'updated_at': now()}); audit('deactivate', 'item', id_, it['name'])
        return {'deactivated': True}
    q('DELETE FROM stock_moves WHERE item_id=?', (id_,)); q('DELETE FROM items WHERE id=?', (id_,)); audit('delete', 'item', id_, it['name'])
    return {'deleted': True}

MOVE_LABEL = {'opening': 'Opening stock', 'purchase': 'Purchase (bill)', 'sale': 'Sale (invoice)', 'repair': 'Used in repair', 'adjust': 'Adjustment'}

def ref_text(kind, id_) -> str:
    if kind == 'sdoc': return str(val('SELECT number FROM sdocs WHERE id=?', (id_,)) or f'#{id_}')
    if kind == 'bill': return str(val('SELECT number FROM bills WHERE id=?', (id_,)) or f'#{id_}')
    if kind == 'repair_part': return 'Repair #' + str(val('SELECT repair_id FROM repair_parts WHERE id=?', (id_,)) or '?')
    if kind == 'soft_part': return 'Software job #' + str(val('SELECT job_id FROM soft_parts WHERE id=?', (id_,)) or '?')
    return ''

def act_item_ledger(inp):
    need('inventory', 'view'); id_ = I(inp.get('id')); it = row('SELECT * FROM items WHERE id=?', (id_,))
    if not it: raise ApiError('Item not found.', 404)
    bal = 0.0; out = []; adm = see_cost()
    for m in rows('SELECT m.*,u.name by_name,c.name customer,v.name vendor FROM stock_moves m LEFT JOIN users u ON u.id=m.user_id LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN vendors v ON v.id=m.vendor_id WHERE m.item_id=? ORDER BY m.date,m.id', (id_,)):
        bal += float(m['qty']); m['balance'] = round(bal, 3); m['label'] = MOVE_LABEL.get(m['kind'], m['kind']); m['ref'] = ref_text(m['ref_kind'], m['ref_id'])
        if not adm: m.pop('unit_cost', None)
        out.append(m)
    out.reverse()
    if not adm: it.pop('cost', None)
    return {'item': it, 'moves': out}

def act_stock_adjust(inp):
    u = need('inventory', 'edit'); iid = I(inp.get('item_id')); it = row('SELECT * FROM items WHERE id=?', (iid,))
    if not it or it['type'] != 'inventory': raise ApiError('Choose a stock (inventory) item.')
    date = d(inp.get('date')) or today(); reason = inp.get('reason') if inp.get('reason') in ADJ_REASONS else 'Other'
    diff = qty_(inp.get('qty')) - float(it['qty']) if inp.get('mode') == 'set' else qty_(inp.get('qty'))
    if abs(diff) < 1e-9: raise ApiError('Nothing to adjust — the quantity is unchanged.')
    cost = money_(inp.get('unit_cost')) if diff > 0 and inp.get('unit_cost') not in (None, '') and see_cost() else None
    aid = I(val('SELECT COALESCE(MAX(ref_id),0)+1 FROM stock_moves WHERE ref_kind=?', ('adjust',)))
    move(iid, diff, 'adjust', 'adjust', aid, date, cost, f"{reason}{' — ' + s(inp.get('note'), 200) if s(inp.get('note'), 200) else ''}")
    audit('adjust', 'item', iid, f"{it['name']} {'+' if diff > 0 else ''}{fmt_q(diff)} ({reason})")
    return {'qty': float(val('SELECT qty FROM items WHERE id=?', (iid,)))}

def act_inv_overview(inp):
    need('inventory', 'view'); adm = see_cost()
    r = row("SELECT COUNT(*) n, SUM(CASE WHEN type='inventory' THEN 1 ELSE 0 END) stock_items, SUM(CASE WHEN type='inventory' AND qty<=0 THEN 1 ELSE 0 END) out_,"
            " SUM(CASE WHEN type='inventory' AND qty>0 AND qty<=reorder THEN 1 ELSE 0 END) low, SUM(CASE WHEN type='inventory' THEN qty ELSE 0 END) units,"
            " SUM(CASE WHEN type='inventory' THEN qty*cost ELSE 0 END) value, SUM(CASE WHEN type='inventory' THEN qty*sale_price ELSE 0 END) retail FROM items WHERE active=1")
    o = {'items': int(r['n'] or 0), 'stock_items': int(r['stock_items'] or 0), 'out': int(r['out_'] or 0), 'low': int(r['low'] or 0), 'units': float(r['units'] or 0), 'retail': rnd(float(r['retail'] or 0))}
    if adm: o['value'] = rnd(float(r['value'] or 0))
    return o

def act_stock_moves(inp):
    need('inventory', 'view'); w, p = ['1=1'], []
    if inp.get('kind') in MOVE_LABEL: w.append('m.kind=?'); p.append(inp['kind'])
    if I(inp.get('item_id')): w.append('m.item_id=?'); p.append(I(inp['item_id']))
    if d(inp.get('from')): w.append('m.date>=?'); p.append(d(inp['from']))
    if d(inp.get('to')): w.append('m.date<=?'); p.append(d(inp['to']))
    out = rows('SELECT m.*,i.name item,u.name by_name,c.name customer,v.name vendor FROM stock_moves m JOIN items i ON i.id=m.item_id LEFT JOIN users u ON u.id=m.user_id LEFT JOIN customers c ON c.id=m.customer_id LEFT JOIN vendors v ON v.id=m.vendor_id WHERE ' + ' AND '.join(w) + ' ORDER BY m.date DESC,m.id DESC LIMIT 2000', p)
    adm = see_cost()
    for m in out:
        m['label'] = MOVE_LABEL.get(m['kind'], m['kind']); m['ref'] = ref_text(m['ref_kind'], m['ref_id'])
        if not adm: m.pop('unit_cost', None)
    return out


# ================================================================ stores (suppliers)
def vendor_balances() -> dict:
    return {r['vendor_id']: r for r in rows("SELECT vendor_id, COUNT(*) bills, SUM(total) billed, SUM(paid) paid, SUM(total-paid) owed, MAX(date) last FROM bills WHERE status<>'void' GROUP BY vendor_id")}

def act_vendors_list(inp):
    need_any([('stores', 'view'), ('stores', 'add'), ('inventory', 'view'), ('inventory', 'add'), ('expenses', 'add'), ('expenses', 'view')])
    bal = vendor_balances(); adm_money = can('stores', 'view')
    exp = {r['vendor_id']: float(r['v'] or 0) for r in rows('SELECT vendor_id, SUM(amount) v FROM expense_entries WHERE vendor_id IS NOT NULL GROUP BY vendor_id')}
    out = []
    for v in rows('SELECT * FROM vendors ORDER BY active DESC, lower(name)'):
        b = bal.get(v['id']) or {}
        if adm_money: v.update({'bills': int(b.get('bills') or 0), 'billed': rnd(float(b.get('billed') or 0)), 'paid': rnd(float(b.get('paid') or 0)), 'owed': rnd(float(b.get('owed') or 0)), 'last': b.get('last'), 'expenses': rnd(exp.get(v['id'], 0))})
        out.append(v)
    return out

def act_vendor_save(inp):
    id_ = I(inp.get('id')); need('stores', 'edit' if id_ else 'add')
    f = {'name': s(inp.get('name'), 100), 'contact': s(inp.get('contact'), 100), 'phone': s(inp.get('phone'), 30), 'email': s(inp.get('email'), 120), 'address': s(inp.get('address'), 200),
         'notes': s(inp.get('notes'), 500), 'active': 0 if inp.get('active') in (False, 0, '0') else 1}
    if not f['name']: raise ApiError('Store name is required.')
    if val('SELECT 1 FROM vendors WHERE lower(name)=lower(?) AND id<>?', (f['name'], id_)): raise ApiError('A store with this name already exists.')
    if id_:
        if not val('SELECT 1 FROM vendors WHERE id=?', (id_,)): raise ApiError('Store not found.', 404)
        upd('vendors', id_, f)
    else: id_ = ins('vendors', {**f, 'created_at': now()})
    audit('update' if inp.get('id') else 'create', 'store', id_, f['name'])
    return {'id': id_}

def act_vendor_delete(inp):
    need('stores', 'delete'); id_ = I(inp.get('id'))
    if val('SELECT 1 FROM bills WHERE vendor_id=?', (id_,)) or val('SELECT 1 FROM expense_entries WHERE vendor_id=?', (id_,)):
        upd('vendors', id_, {'active': 0}); audit('deactivate', 'store', id_)
        return {'deactivated': True}
    q('UPDATE items SET vendor_id=NULL WHERE vendor_id=?', (id_,)); q('DELETE FROM vendors WHERE id=?', (id_,)); audit('delete', 'store', id_)
    return {'deleted': True}

def act_vendor_get(inp):
    need('stores', 'view'); id_ = I(inp.get('id')); v = row('SELECT * FROM vendors WHERE id=?', (id_,))
    if not v: raise ApiError('Store not found.', 404)
    b = vendor_balances().get(id_) or {}
    v.update({'billed': rnd(float(b.get('billed') or 0)), 'paid': rnd(float(b.get('paid') or 0)), 'owed': rnd(float(b.get('owed') or 0))})
    return {'vendor': v, 'bills': bills_query({'vendor_id': id_}),
            'payments': rows('SELECT p.*,b.number bill_no,u.name by_name FROM vendor_payments p LEFT JOIN bills b ON b.id=p.bill_id LEFT JOIN users u ON u.id=p.user_id WHERE p.vendor_id=? ORDER BY p.date DESC,p.id DESC', (id_,)),
            'expenses': rows('SELECT e.*,c.name category FROM expense_entries e LEFT JOIN exp_categories c ON c.id=e.category_id WHERE e.vendor_id=? ORDER BY e.date DESC,e.id DESC', (id_,)) if can('expenses', 'view') else []}


# ================================================================ bills (purchases from a store)
def bill_state(b: dict) -> str:
    if b['status'] == 'void': return 'void'
    if float(b['paid']) + EPS >= float(b['total']): return 'paid'
    if b.get('due_date') and b['due_date'] < today(): return 'overdue'
    return 'partial' if float(b['paid']) > EPS else 'unpaid'

def bills_query(f: dict) -> list:
    w, p = ['1=1'], []
    if I(f.get('vendor_id')): w.append('b.vendor_id=?'); p.append(I(f['vendor_id']))
    if d(f.get('from')): w.append('b.date>=?'); p.append(d(f['from']))
    if d(f.get('to')): w.append('b.date<=?'); p.append(d(f['to']))
    out = rows('SELECT b.*,v.name vendor,u.name by_name,(SELECT string_agg(COALESCE(i.name,l.description)||\' ×\'||hic_num(l.qty), chr(10) ORDER BY l.id) FROM bill_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.bill_id=b.id) items '
               'FROM bills b JOIN vendors v ON v.id=b.vendor_id LEFT JOIN users u ON u.id=b.user_id WHERE ' + ' AND '.join(w) + ' ORDER BY b.date DESC,b.id DESC LIMIT 2000', p)
    for b in out: b['state'] = bill_state(b); b['balance'] = rnd(float(b['total']) - float(b['paid'])) if b['status'] != 'void' else 0
    st = f.get('status')
    return [b for b in out if not st or b['state'] == st or (st == 'open' and b['state'] in ('unpaid', 'partial', 'overdue'))]

def act_bills_list(inp): need('stores', 'view'); return bills_query(inp)

def act_bill_get(inp):
    need('stores', 'view'); b = row('SELECT b.*,v.name vendor,v.phone vendor_phone,u.name by_name FROM bills b JOIN vendors v ON v.id=b.vendor_id LEFT JOIN users u ON u.id=b.user_id WHERE b.id=?', (I(inp.get('id')),))
    if not b: raise ApiError('Bill not found.', 404)
    b['state'] = bill_state(b)
    return {'bill': b, 'lines': rows('SELECT l.*,i.name item,i.type item_type FROM bill_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.bill_id=? ORDER BY l.id', (b['id'],)),
            'payments': rows('SELECT p.*,u.name by_name,a.name account FROM vendor_payments p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN money_accounts a ON a.id=p.account_id WHERE p.bill_id=? ORDER BY p.date,p.id', (b['id'],))}

def act_bill_save(inp):
    id_ = I(inp.get('id')); u = need('stores', 'edit' if id_ else 'add')
    vid = I(inp.get('vendor_id'))
    if not val('SELECT 1 FROM vendors WHERE id=?', (vid,)): raise ApiError('Choose the store / supplier.')
    lines = inp.get('lines') if isinstance(inp.get('lines'), list) else []
    clean = []
    for l in lines:
        iid = I(l.get('item_id')) or None; desc = s(l.get('description'), 200); qty = qty_(l.get('qty')); cost = money_(l.get('cost'))
        it = row('SELECT * FROM items WHERE id=?', (iid,)) if iid else None
        if iid and not it: raise ApiError('One of the items no longer exists.')
        if not it and not desc: continue
        if qty <= 0: raise ApiError(f"Quantity must be more than 0 ({(it or {}).get('name') or desc}).")
        clean.append({'item_id': iid, 'description': desc or it['name'], 'qty': qty, 'cost': cost, 'amount': rnd(qty * cost), 'inv': bool(it and it['type'] == 'inventory')})
    if not clean: raise ApiError('Add at least one line.')
    total = rnd(sum(l['amount'] for l in clean)); date = d(inp.get('date')) or today()
    f = {'vendor_id': vid, 'date': date, 'due_date': d(inp.get('due_date')), 'ref': s(inp.get('ref'), 60), 'notes': s(inp.get('notes'), 500), 'total': total}
    old_items = []
    if id_:
        ex = row('SELECT * FROM bills WHERE id=?', (id_,))
        if not ex: raise ApiError('Bill not found.', 404)
        if ex['status'] == 'void': raise ApiError('This bill is void and cannot be edited.')
        if total + EPS < float(ex['paid']): raise ApiError(f"The new total ({total:,.2f}) is less than what was already paid ({float(ex['paid']):,.2f}). Delete a payment first.")
        old_items = unmove('bill', id_, check_negative=False); q('DELETE FROM bill_lines WHERE bill_id=?', (id_,))
        upd('bills', id_, {**f, 'updated_at': now()}); audit('update', 'bill', id_, f"{ex['number']} {total}")
    else:
        id_ = ins('bills', {**f, 'number': next_no('bill'), 'status': 'open', 'paid': 0, 'user_id': u['id'], 'ts': now()}); audit('create', 'bill', id_, str(total))
    for l in clean:
        ins('bill_lines', {'bill_id': id_, 'item_id': l['item_id'], 'description': l['description'], 'qty': l['qty'], 'cost': l['cost'], 'amount': l['amount']})
        if l['inv']: move(l['item_id'], l['qty'], 'purchase', 'bill', id_, date, l['cost'], 'Bought from store', vendor_id=vid)
        if l['item_id'] and see_cost() and not l['inv']: q("UPDATE items SET cost=? WHERE id=? AND type='non_inventory'", (l['cost'], l['item_id']))
    check_nonneg(old_items)                                         # an edit may not remove stock that was already sold
    pay = money_(inp.get('pay_now'))
    if pay > 0 and not inp.get('id'): vendor_pay(id_, pay, date, method_(inp.get('method')), s(inp.get('pay_ref'), 60), 'Paid when the bill was entered', u, pick_account(inp, method_(inp.get('method'))))
    return {'id': id_, 'number': val('SELECT number FROM bills WHERE id=?', (id_,))}

def bill_refresh(bid: int) -> None:
    paid = rnd(float(val('SELECT COALESCE(SUM(amount),0) FROM vendor_payments WHERE bill_id=?', (bid,)) or 0))
    q("UPDATE bills SET paid=?, status=CASE WHEN status='void' THEN 'void' WHEN ?+0.005>=total THEN 'paid' ELSE 'open' END WHERE id=?", (paid, paid, bid))

def vendor_pay(bid: int, amt: float, date: str, method: str, ref: str, note: str, u: dict, account_id=None) -> int:
    b = row('SELECT * FROM bills WHERE id=? FOR UPDATE', (bid,))
    if not b or b['status'] == 'void': raise ApiError('Bill not found or void.')
    bal = rnd(float(b['total']) - float(b['paid']))
    if amt <= 0: raise ApiError('Enter the amount paid.')
    if amt > bal + EPS: raise ApiError(f"That is more than this bill's balance ({bal:,.2f}).")
    pid = ins('vendor_payments', {'bill_id': bid, 'vendor_id': b['vendor_id'], 'date': date, 'amount': amt, 'method': method, 'ref': ref, 'note': note, 'user_id': u['id'], 'ts': now(), 'account_id': account_id or pick_account({}, method)})
    bill_refresh(bid); audit('payment', 'bill', bid, f"{b['number']} paid {amt}")
    return pid

def act_vendor_pay(inp):
    u = need('stores', 'edit')
    allocs = inp.get('allocations') if isinstance(inp.get('allocations'), list) else [{'bill_id': inp.get('bill_id'), 'amount': inp.get('amount')}]
    date = d(inp.get('date')) or today(); method = method_(inp.get('method')); ref = s(inp.get('ref'), 60); note = s(inp.get('note'), 200); done = 0.0
    for a in allocs:
        amt = money_(a.get('amount'))
        if amt > 0: vendor_pay(I(a.get('bill_id')), amt, date, method, ref, note, u, pick_account(inp, method)); done += amt
    if done <= 0: raise ApiError('Enter the amount paid.')
    return {'paid': rnd(done)}

def act_vendor_pay_delete(inp):
    need('stores', 'delete'); p = row('SELECT * FROM vendor_payments WHERE id=?', (I(inp.get('id')),))
    if not p: raise ApiError('Payment not found.', 404)
    q('DELETE FROM vendor_payments WHERE id=?', (p['id'],)); bill_refresh(int(p['bill_id'])); audit('delete', 'store_payment', int(p['id']), str(p['amount']))
    return []

def act_bill_void(inp):
    need('stores', 'edit'); b = row('SELECT * FROM bills WHERE id=?', (I(inp.get('id')),))
    if not b: raise ApiError('Bill not found.', 404)
    if b['status'] == 'void': return []
    if val('SELECT 1 FROM vendor_payments WHERE bill_id=?', (b['id'],)): raise ApiError('This bill has payments. Delete the payments first, then void it.')
    unmove('bill', int(b['id'])); upd('bills', int(b['id']), {'status': 'void', 'void_reason': s(inp.get('reason'), 200), 'voided_at': now(), 'voided_by': sess_uid('staff')})
    audit('void', 'bill', int(b['id']), b['number'])
    return []

def act_bill_delete(inp):
    need('stores', 'delete'); b = row('SELECT * FROM bills WHERE id=?', (I(inp.get('id')),))
    if not b: raise ApiError('Bill not found.', 404)
    if val('SELECT 1 FROM vendor_payments WHERE bill_id=?', (b['id'],)): raise ApiError('This bill has payments. Delete the payments first.')
    unmove('bill', int(b['id'])); q('DELETE FROM bill_lines WHERE bill_id=?', (b['id'],)); q('DELETE FROM bills WHERE id=?', (b['id'],)); audit('delete', 'bill', int(b['id']), b['number'])
    return []


# ================================================================ quotations & invoices
def doc_state(x: dict) -> str:
    if x['kind'] == 'quote':
        if x['status'] in ('accepted', 'declined', 'converted', 'void'): return x['status']
        return 'expired' if x.get('due_date') and x['due_date'] < today() else 'pending'
    if x['status'] == 'void': return 'void'
    if x['kind'] == 'receipt': return 'paid'
    if float(x['total']) <= EPS or float(x['paid']) + EPS >= float(x['total']): return 'paid'
    if x.get('due_date') and x['due_date'] < today(): return 'overdue'
    return 'partial' if float(x['paid']) > EPS else 'unpaid'

LINES_SQL = "(SELECT string_agg(COALESCE(i.name,l.description)||' ×'||hic_num(l.qty), chr(10) ORDER BY l.id) FROM sdoc_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.doc_id=x.id)"

def docs_query(f: dict, limit: int = 3000) -> list:
    w, p = ['1=1'], []
    if f.get('kind') in DOC_KINDS: w.append('x.kind=?'); p.append(f['kind'])
    elif f.get('kind') == 'sales': w.append("x.kind IN ('invoice','receipt')")
    if I(f.get('customer_id')): w.append('x.customer_id=?'); p.append(I(f['customer_id']))
    if I(f.get('user_id')): w.append('x.user_id=?'); p.append(I(f['user_id']))
    if d(f.get('from')): w.append('x.date>=?'); p.append(d(f['from']))
    if d(f.get('to')): w.append('x.date<=?'); p.append(d(f['to']))
    out = rows(f'SELECT x.*,u.name by_name,c.phone cphone,{LINES_SQL} items FROM sdocs x LEFT JOIN users u ON u.id=x.user_id LEFT JOIN customers c ON c.id=x.customer_id WHERE ' + ' AND '.join(w) + f' ORDER BY x.date DESC,x.id DESC LIMIT {int(limit)}', p)
    adm = see_cost()
    for x in out:
        x['state'] = doc_state(x); x['balance'] = rnd(float(x['total']) - float(x['paid'])) if x['kind'] == 'invoice' and x['status'] != 'void' else 0
        if adm: x['profit'] = rnd(float(x['total']) - float(x['tax']) - float(x['cost'])) if x['kind'] in SALE_KINDS and x['status'] != 'void' else 0
        else: x.pop('cost', None)
    st = f.get('status')
    if st: out = [x for x in out if x['state'] == st or (st == 'open' and x['state'] in ('unpaid', 'partial', 'overdue', 'pending'))]
    return out

def act_sdocs_list(inp): need('sales', 'view'); return docs_query(inp)

def act_sdoc_get(inp):
    need('sales', 'view'); x = row('SELECT x.*,u.name by_name,c.phone cphone,c.email cemail,c.address caddress FROM sdocs x LEFT JOIN users u ON u.id=x.user_id LEFT JOIN customers c ON c.id=x.customer_id WHERE x.id=?', (I(inp.get('id')),))
    if not x: raise ApiError('Document not found.', 404)
    x['state'] = doc_state(x); x['balance'] = rnd(float(x['total']) - float(x['paid']))
    lines = rows('SELECT l.*,i.name item,i.type item_type,i.unit FROM sdoc_lines l LEFT JOIN items i ON i.id=l.item_id WHERE l.doc_id=? ORDER BY l.id', (x['id'],))
    if not see_cost():
        x.pop('cost', None)
        for l in lines: l.pop('unit_cost', None)
    link = None
    if x['kind'] == 'quote' and x.get('invoice_id'): link = row('SELECT id,number FROM sdocs WHERE id=?', (x['invoice_id'],))
    if x['kind'] == 'invoice' and x.get('quote_id'): link = row('SELECT id,number FROM sdocs WHERE id=?', (x['quote_id'],))
    return {'doc': x, 'lines': lines, 'link': link,
            'payments': rows('SELECT p.*,u.name by_name,a.name account FROM cust_payments p LEFT JOIN users u ON u.id=p.user_id LEFT JOIN money_accounts a ON a.id=p.account_id WHERE p.doc_id=? ORDER BY p.date,p.id', (x['id'],))}

def parse_lines(inp) -> list:
    out = []
    for l in (inp.get('lines') if isinstance(inp.get('lines'), list) else []):
        iid = I(l.get('item_id')) or None; desc = s(l.get('description'), 300); qty = qty_(l.get('qty')); rate = money_(l.get('rate'))
        it = row('SELECT * FROM items WHERE id=?', (iid,)) if iid else None
        if iid and not it: raise ApiError('One of the items no longer exists.')
        if not it and not desc: continue
        if qty <= 0: raise ApiError(f"Quantity must be more than 0 ({(it or {}).get('name') or desc}).")
        out.append({'item_id': iid, 'kind': it['type'] if it else 'custom', 'description': desc or (it['description'] or ''), 'qty': qty, 'rate': rate, 'amount': rnd(qty * rate), 'item': it})
    if not out: raise ApiError('Add at least one line (item, service or description).')
    return out

def doc_totals(lines: list, inp) -> dict:
    sub = rnd(sum(l['amount'] for l in lines)); disc = min(sub, money_(inp.get('discount'))); rate = min(100.0, max(0.0, n(inp.get('tax_rate'))))
    tax = rnd((sub - disc) * rate / 100); return {'subtotal': sub, 'discount': disc, 'tax_rate': rate, 'tax': tax, 'total': rnd(sub - disc + tax)}

def post_lines(did: int, lines: list, kind: str, date: str, cid) -> float:
    """Insert the lines; an invoice takes inventory items out of stock. Returns the cost of goods sold."""
    cost = 0.0
    for l in lines:
        uc = 0.0
        if kind in SALE_KINDS and l['kind'] == 'inventory': uc = stock_out(l['item_id'], l['qty'], 'sdoc', did, date, customer_id=cid)
        elif l['kind'] == 'non_inventory': uc = float(l['item']['cost'] or 0)
        elif l['kind'] == 'inventory': uc = float(l['item']['cost'] or 0)             # quotations: estimated cost only
        ins('sdoc_lines', {'doc_id': did, 'item_id': l['item_id'], 'kind': l['kind'], 'description': l['description'], 'qty': l['qty'], 'rate': l['rate'], 'amount': l['amount'], 'unit_cost': round(uc, 4)})
        cost += uc * l['qty']
    return rnd(cost)

def customer_of(inp) -> tuple:
    if not empty(inp.get('customer_id')) or (not empty(inp.get('customer_phone')) and not empty(inp.get('customer_name'))):
        from h_ops import resolve_customer
        cid, _ = resolve_customer(inp); c = row('SELECT name,phone FROM customers WHERE id=?', (cid,))
        return cid, c['name'], c['phone']
    return None, s(inp.get('customer_name'), 80) or 'Walk-in customer', s(inp.get('customer_phone'), 30)

def act_sdoc_save(inp):
    id_ = I(inp.get('id')); u = need('sales', 'edit' if id_ else 'add')
    ex = row('SELECT * FROM sdocs WHERE id=?', (id_,)) if id_ else None
    if id_ and not ex: raise ApiError('Document not found.', 404)
    kind = ex['kind'] if ex else (inp.get('kind') if inp.get('kind') in DOC_KINDS else 'invoice')
    if ex and ex['status'] in ('void', 'converted'): raise ApiError(f"This {KIND_WORD[kind]} is {ex['status']} and cannot be edited.")
    lines = parse_lines(inp); t = doc_totals(lines, inp); cid, cname, cphone = customer_of(inp)
    date = d(inp.get('date')) or today()
    f = {'customer_id': cid, 'customer_name': cname, 'phone': cphone, 'date': date, 'due_date': d(inp.get('due_date')), 'terms': s(inp.get('terms'), 40), 'notes': s(inp.get('notes'), 1000), **t, 'updated_at': now()}
    if ex:
        if kind == 'invoice' and t['total'] + EPS < float(ex['paid']): raise ApiError(f"The new total ({t['total']:,.2f}) is less than what the customer already paid ({float(ex['paid']):,.2f}). Delete a payment first.")
        unmove('sdoc', id_, check_negative=False); q('DELETE FROM sdoc_lines WHERE doc_id=?', (id_,))
        if kind == 'receipt': q('DELETE FROM cust_payments WHERE doc_id=?', (id_,))       # re-created below for the new total
        upd('sdocs', id_, f); audit('update', 'invoice' if kind == 'invoice' else kind, id_, f"{ex['number']} {t['total']}")
    else:
        id_ = ins('sdocs', {**f, 'kind': kind, 'number': next_no(kind), 'status': 'pending' if kind == 'quote' else 'open', 'paid': 0, 'cost': 0, 'user_id': u['id'], 'created_at': now()})
        audit('create', 'invoice' if kind == 'invoice' else kind, id_, str(t['total']))
    upd('sdocs', id_, {'cost': post_lines(id_, lines, kind, date, cid)})
    if kind == 'invoice':
        doc_refresh(id_)
        pay = money_(inp.get('pay_now'))
        if pay > 0 and not ex: cust_pay(id_, pay, date, method_(inp.get('method')), s(inp.get('pay_ref'), 60), 'Paid at sale', u, pick_account(inp, method_(inp.get('method'))))
    if kind == 'receipt':                                            # paid in full now, into the chosen account
        m = method_(inp.get('method'))
        if t['total'] > EPS: ins('cust_payments', {'doc_id': id_, 'customer_id': cid, 'date': date, 'amount': t['total'], 'method': m, 'ref': s(inp.get('pay_ref'), 60), 'note': 'Sales receipt', 'user_id': u['id'], 'ts': now(), 'account_id': pick_account(inp, m)})
        doc_refresh(id_)
    return {'id': id_, 'number': val('SELECT number FROM sdocs WHERE id=?', (id_,)), 'total': t['total']}

def doc_refresh(did: int) -> None:
    paid = rnd(float(val('SELECT COALESCE(SUM(amount),0) FROM cust_payments WHERE doc_id=?', (did,)) or 0))
    q("UPDATE sdocs SET paid=?, status=CASE WHEN status='void' THEN 'void' WHEN ?+0.005>=total THEN 'paid' ELSE 'open' END WHERE id=? AND kind IN ('invoice','receipt')", (paid, paid, did))

def cust_pay(did: int, amt: float, date: str, method: str, ref: str, note: str, u: dict, account_id=None) -> int:
    x = row("SELECT * FROM sdocs WHERE id=? AND kind='invoice' FOR UPDATE", (did,))
    if not x or x['status'] == 'void': raise ApiError('Invoice not found or void.')
    bal = rnd(float(x['total']) - float(x['paid']))
    if amt <= 0: raise ApiError('Enter the amount received.')
    if amt > bal + EPS: raise ApiError(f"{x['number']}: that is more than the balance due ({bal:,.2f}).")
    pid = ins('cust_payments', {'doc_id': did, 'customer_id': x['customer_id'], 'date': date, 'amount': amt, 'method': method, 'ref': ref, 'note': note, 'user_id': u['id'], 'ts': now(), 'account_id': account_id or pick_account({}, method)})
    doc_refresh(did); audit('payment', 'invoice', did, f"{x['number']} received {amt}")
    if x['customer_id']:
        left = rnd(bal - amt)
        cust_notify(int(x['customer_id']), 'payment', f"Payment of {amt} received for invoice {x['number']}. " + ('Fully paid — thank you!' if left <= EPS else f'Remaining balance: {left}.'), f'pay:i{pid}')
    return pid

def act_cust_pay(inp):
    """Receive payment: one amount spread over one or more open invoices of the same customer."""
    u = need('sales', 'edit')
    allocs = inp.get('allocations') if isinstance(inp.get('allocations'), list) else [{'doc_id': inp.get('doc_id'), 'amount': inp.get('amount')}]
    date = d(inp.get('date')) or today(); method = method_(inp.get('method')); ref = s(inp.get('ref'), 60); note = s(inp.get('note'), 200); done = 0.0
    for a in allocs:
        amt = money_(a.get('amount'))
        if amt > 0: cust_pay(I(a.get('doc_id')), amt, date, method, ref, note, u, pick_account(inp, method)); done += amt
    if done <= 0: raise ApiError('Enter the amount received.')
    return {'received': rnd(done)}

def act_cust_pay_delete(inp):
    need('sales', 'delete'); p = row('SELECT * FROM cust_payments WHERE id=?', (I(inp.get('id')),))
    if not p: raise ApiError('Payment not found.', 404)
    if val("SELECT 1 FROM sdocs WHERE id=? AND kind='receipt'", (p['doc_id'],)): raise ApiError('A sales receipt is always paid in full — edit or void the receipt instead.')
    q('DELETE FROM cust_payments WHERE id=?', (p['id'],)); doc_refresh(int(p['doc_id'])); audit('delete', 'payment', int(p['id']), str(p['amount']))
    return []

def act_cust_payments(inp):
    need('sales', 'view'); w, p = ['1=1'], []
    if I(inp.get('customer_id')): w.append('p.customer_id=?'); p.append(I(inp['customer_id']))
    if d(inp.get('from')): w.append('p.date>=?'); p.append(d(inp['from']))
    if d(inp.get('to')): w.append('p.date<=?'); p.append(d(inp['to']))
    return rows('SELECT p.*,x.number,x.customer_name,u.name by_name,a.name account FROM cust_payments p LEFT JOIN money_accounts a ON a.id=p.account_id JOIN sdocs x ON x.id=p.doc_id LEFT JOIN users u ON u.id=p.user_id WHERE ' + ' AND '.join(w) + ' ORDER BY p.date DESC,p.id DESC LIMIT 2000', p)

def act_open_invoices(inp):
    need('sales', 'view'); cid = I(inp.get('customer_id'))
    return [x for x in docs_query({'kind': 'invoice', 'customer_id': cid} if cid else {'kind': 'invoice'}) if x['state'] in ('unpaid', 'partial', 'overdue') and (cid or not x['customer_id'])][::-1]

def act_sdoc_convert(inp):
    """Quotation → invoice (same customer and lines; stock is taken out now)."""
    u = need('sales', 'add'); qd = row("SELECT * FROM sdocs WHERE id=? AND kind='quote'", (I(inp.get('id')),))
    if not qd: raise ApiError('Quotation not found.', 404)
    if qd['status'] in ('converted', 'void', 'declined'): raise ApiError(f"This quotation is {qd['status']}.")
    lines = [{**l, 'item': row('SELECT * FROM items WHERE id=?', (l['item_id'],)) if l['item_id'] else None} for l in rows('SELECT * FROM sdoc_lines WHERE doc_id=? ORDER BY id', (qd['id'],))]
    for l in lines:
        if l['item_id'] and not l['item']: raise ApiError('An item on this quotation no longer exists — edit the quotation first.')
    date = d(inp.get('date')) or today()
    days = max(0, I(setting('inv_due_days', '0')))
    iid = ins('sdocs', {'kind': 'invoice', 'number': next_no('invoice'), 'status': 'open', 'customer_id': qd['customer_id'], 'customer_name': qd['customer_name'], 'phone': qd['phone'], 'date': date,
                        'due_date': add_days(days, datetime.strptime(date, '%Y-%m-%d').replace(tzinfo=TZ)).strftime('%Y-%m-%d') if days else date, 'terms': qd['terms'], 'notes': qd['notes'],
                        'subtotal': qd['subtotal'], 'discount': qd['discount'], 'tax_rate': qd['tax_rate'], 'tax': qd['tax'], 'total': qd['total'], 'paid': 0, 'cost': 0, 'quote_id': qd['id'], 'user_id': u['id'], 'created_at': now(), 'updated_at': now()})
    upd('sdocs', iid, {'cost': post_lines(iid, lines, 'invoice', date, qd['customer_id'])}); doc_refresh(iid)
    upd('sdocs', int(qd['id']), {'status': 'converted', 'invoice_id': iid, 'updated_at': now()})
    audit('convert', 'quote', int(qd['id']), f"{qd['number']} → invoice #{iid}")
    return {'id': iid, 'number': val('SELECT number FROM sdocs WHERE id=?', (iid,))}

def act_sdoc_status(inp):
    need('sales', 'status'); x = row("SELECT * FROM sdocs WHERE id=? AND kind='quote'", (I(inp.get('id')),)); to = inp.get('status')
    if not x: raise ApiError('Quotation not found.', 404)
    if to not in ('pending', 'accepted', 'declined'): raise ApiError('Invalid status.')
    if x['status'] in ('converted', 'void'): raise ApiError(f"This quotation is {x['status']}.")
    upd('sdocs', int(x['id']), {'status': to, 'updated_at': now()}); audit('status', 'quote', int(x['id']), to)
    return []

def act_sdoc_void(inp):
    need('sales', 'edit'); x = row('SELECT * FROM sdocs WHERE id=?', (I(inp.get('id')),))
    if not x: raise ApiError('Document not found.', 404)
    if x['status'] == 'void': return []
    if x['kind'] == 'receipt': q('DELETE FROM cust_payments WHERE doc_id=?', (x['id'],))    # the money goes back out of the account
    if val('SELECT 1 FROM cust_payments WHERE doc_id=?', (x['id'],)): raise ApiError('This invoice has payments. Delete the payments first, then void it.')
    unmove('sdoc', int(x['id']), check_negative=False)
    upd('sdocs', int(x['id']), {'status': 'void', 'void_reason': s(inp.get('reason'), 200), 'voided_at': now(), 'voided_by': sess_uid('staff'), 'updated_at': now()})
    if x['kind'] == 'invoice' and x.get('quote_id'): q("UPDATE sdocs SET status='accepted', invoice_id=NULL WHERE id=?", (x['quote_id'],))
    audit('void', 'invoice' if x['kind'] == 'invoice' else x['kind'], int(x['id']), x['number'])
    return []

def act_sdoc_delete(inp):
    need('sales', 'delete'); x = row('SELECT * FROM sdocs WHERE id=?', (I(inp.get('id')),))
    if not x: raise ApiError('Document not found.', 404)
    if x['kind'] == 'receipt': q('DELETE FROM cust_payments WHERE doc_id=?', (x['id'],))
    if val('SELECT 1 FROM cust_payments WHERE doc_id=?', (x['id'],)): raise ApiError('This invoice has payments. Delete the payments first.')
    unmove('sdoc', int(x['id']), check_negative=False)
    if x['kind'] == 'invoice' and x.get('quote_id'): q("UPDATE sdocs SET status='accepted', invoice_id=NULL WHERE id=?", (x['quote_id'],))
    q('DELETE FROM sdoc_lines WHERE doc_id=?', (x['id'],)); q('DELETE FROM sdocs WHERE id=?', (x['id'],)); audit('delete', 'invoice' if x['kind'] == 'invoice' else x['kind'], int(x['id']), x['number'])
    return []

def act_sales_overview(inp):
    need('sales', 'view'); inv = docs_query({'kind': 'invoice'}, 100000); rcp = docs_query({'kind': 'receipt'}, 100000); qts = docs_query({'kind': 'quote'}, 100000); d30 = add_days(-30).strftime('%Y-%m-%d'); month = today()[:8] + '01'
    open_ = [x for x in inv if x['state'] in ('unpaid', 'partial', 'overdue')]
    return {'unpaid': rnd(sum(x['balance'] for x in open_)), 'unpaid_n': len(open_), 'overdue': rnd(sum(x['balance'] for x in open_ if x['state'] == 'overdue')), 'overdue_n': sum(1 for x in open_ if x['state'] == 'overdue'),
            'paid30': rnd(float(val('SELECT COALESCE(SUM(amount),0) FROM cust_payments WHERE date>=?', (d30,)) or 0)),
            'month_sales': rnd(sum(float(x['total']) for x in inv + rcp if x['status'] != 'void' and x['date'] >= month)), 'month_n': sum(1 for x in inv + rcp if x['status'] != 'void' and x['date'] >= month),
            'receipts_month': rnd(sum(float(x['total']) for x in rcp if x['status'] != 'void' and x['date'] >= month)),
            'quotes_open': sum(1 for x in qts if x['state'] == 'pending'), 'quotes_amount': rnd(sum(float(x['total']) for x in qts if x['state'] == 'pending'))}

def act_acc_settings(inp):
    """Sales defaults shown on the invoice form (tax rate, payment terms, prefixes)."""
    need_any([('sales', 'view'), ('stores', 'view'), ('inventory', 'view'), ('expenses', 'view'), ('expenses', 'add')])
    return {'tax_rate': n(setting('tax_rate', '0')), 'inv_due_days': I(setting('inv_due_days', '0')), 'quote_days': I(setting('quote_days', '14')), 'doc_prefix': setting('doc_prefix', 'INV'), 'quote_prefix': setting('quote_prefix', 'QT'), 'receipt_prefix': setting('receipt_prefix', 'SR'),
            'allow_negative_stock': setting('allow_negative_stock', '0') == '1', 'methods': PAY_METHODS, 'adj_reasons': ADJ_REASONS}

def act_acc_settings_save(inp):
    admin()
    set_setting('tax_rate', str(min(100.0, max(0.0, n(inp.get('tax_rate'))))))
    set_setting('inv_due_days', str(min(365, max(0, I(inp.get('inv_due_days'))))))
    set_setting('quote_days', str(min(365, max(1, I(inp.get('quote_days')) or 14))))
    set_setting('quote_prefix', (re.sub(r'[^A-Za-z0-9]', '', s(inp.get('quote_prefix'), 8)) or 'QT').upper())
    set_setting('receipt_prefix', (re.sub(r'[^A-Za-z0-9]', '', s(inp.get('receipt_prefix'), 8)) or 'SR').upper())
    set_setting('allow_negative_stock', '1' if inp.get('allow_negative_stock') in (True, 1, '1', 'on') else '0')
    audit('update', 'settings', None, 'sales & inventory defaults')
    return act_acc_settings({})


# ================================================================ expenses
def act_expense_cats(inp):
    need_any([('expenses', 'view'), ('expenses', 'add'), ('reports', 'view')])
    return rows('SELECT c.*,(SELECT COUNT(*) FROM expense_entries e WHERE e.category_id=c.id) used FROM exp_categories c ORDER BY c.active DESC,lower(c.name)')

def act_expense_cat_save(inp):
    need('expenses', 'edit'); id_ = I(inp.get('id')); name = s(inp.get('name'), 60)
    if not name: raise ApiError('Category name is required.')
    if val('SELECT 1 FROM exp_categories WHERE lower(name)=lower(?) AND id<>?', (name, id_)): raise ApiError('That category already exists.')
    f = {'name': name, 'active': 0 if inp.get('active') in (False, 0, '0') else 1}
    if id_: upd('exp_categories', id_, f)
    else: id_ = ins('exp_categories', f)
    audit('update', 'expense_category', id_, name)
    return {'id': id_}

def act_expense_cat_delete(inp):
    need('expenses', 'delete'); id_ = I(inp.get('id'))
    if val('SELECT 1 FROM expense_entries WHERE category_id=?', (id_,)):
        upd('exp_categories', id_, {'active': 0}); return {'deactivated': True}
    q('DELETE FROM exp_categories WHERE id=?', (id_,)); return {'deleted': True}

def expenses_query(f: dict) -> list:
    w, p = ['1=1'], []
    for k, col in (('category_id', 'e.category_id'), ('vendor_id', 'e.vendor_id'), ('user_id', 'e.user_id')):
        if I(f.get(k)): w.append(f'{col}=?'); p.append(I(f[k]))
    if f.get('method') in PAY_METHODS: w.append('e.method=?'); p.append(f['method'])
    if d(f.get('from')): w.append('e.date>=?'); p.append(d(f['from']))
    if d(f.get('to')): w.append('e.date<=?'); p.append(d(f['to']))
    return rows('SELECT e.*,c.name category,v.name vendor,u.name by_name,a.name account FROM expense_entries e LEFT JOIN money_accounts a ON a.id=e.account_id LEFT JOIN exp_categories c ON c.id=e.category_id LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN users u ON u.id=e.user_id WHERE '
                + ' AND '.join(w) + ' ORDER BY e.date DESC,e.id DESC LIMIT 5000', p)

def act_expenses_list(inp): need('expenses', 'view'); return expenses_query(inp)

def act_expense_save(inp):
    id_ = I(inp.get('id')); u = need('expenses', 'edit' if id_ else 'add')
    cat = I(inp.get('category_id'))
    if not val('SELECT 1 FROM exp_categories WHERE id=?', (cat,)): raise ApiError('Choose a category.')
    amt = money_(inp.get('amount'))
    if amt <= 0: raise ApiError('Enter the amount.')
    vid = I(inp.get('vendor_id')) or None
    if vid and not val('SELECT 1 FROM vendors WHERE id=?', (vid,)): vid = None
    f = {'date': d(inp.get('date')) or today(), 'category_id': cat, 'payee': s(inp.get('payee'), 100) or (str(val('SELECT name FROM vendors WHERE id=?', (vid,))) if vid else ''), 'vendor_id': vid,
         'amount': amt, 'method': method_(inp.get('method')), 'ref': s(inp.get('ref'), 60), 'description': s(inp.get('description'), 500), 'account_id': pick_account(inp, method_(inp.get('method')))}
    if id_:
        if not val('SELECT 1 FROM expense_entries WHERE id=?', (id_,)): raise ApiError('Expense not found.', 404)
        upd('expense_entries', id_, f)
    else: id_ = ins('expense_entries', {**f, 'user_id': u['id'], 'ts': now()})
    audit('update' if inp.get('id') else 'create', 'expense', id_, f"{val('SELECT name FROM exp_categories WHERE id=?', (cat,))} {amt}")
    return {'id': id_}

def act_expense_delete(inp):
    need('expenses', 'delete'); id_ = I(inp.get('id')); q('DELETE FROM expense_entries WHERE id=?', (id_,)); audit('delete', 'expense', id_)
    return []


# ================================================================ repair / software parts (used by h_ops and h_soft)
def part_add(table: str, fk: str, pid_: int, iid: int, qty: float, note: str, u: dict) -> dict:
    it = row('SELECT * FROM items WHERE id=?', (iid,))
    if not it: raise ApiError('Item not found.', 404)
    if qty <= 0 or qty > 1000: raise ApiError('Quantity must be at least 1.')
    rid = ins(table, {fk: pid_, 'product_id': iid, 'qty': qty, 'unit_cost': 0, 'unit_price': float(it['sale_price'] or 0), 'user_id': u['id'], 'ts': now()})
    uc = stock_out(iid, qty, table[:-1] if table.endswith('s') else table, rid, today(), note) if it['type'] == 'inventory' else float(it['cost'] or 0)
    q(f'UPDATE {table} SET unit_cost=? WHERE id=?', (round(uc, 4), rid))
    return it

def part_remove(table: str, rid: int) -> None:
    unmove(table[:-1], rid, check_negative=False); q(f'DELETE FROM {table} WHERE id=?', (rid,))

PARTS_SQL = 'SELECT p.id,p.qty,p.unit_cost,p.unit_price,p.ts,i.name product,u.name by_name FROM {t} p JOIN items i ON i.id=p.product_id LEFT JOIN users u ON u.id=p.user_id WHERE p.{fk}=? ORDER BY p.id'


# ================================================================ money accounts (Cash, ZAAD, eDahab, Bank…): balances, register, transfers
ACC_TYPES = ['cash', 'mobile', 'bank', 'other']

def acct_flows(aid: int | None = None, to: str | None = None) -> list:
    """Every movement of money, oldest first: account_id, date, kind, ref, description, signed amount."""
    out = []
    def add(sql, dcol, acol, fmt, sign=1):
        p = ([aid] if aid else []) + ([to] if to else [])
        for r in rows(sql + (f' AND {acol}=?' if aid else '') + (f' AND {dcol}<=?' if to else '') + f" ORDER BY {dcol.split('.')[0]}.id", p):
            out.append({'account_id': r['aid'], 'date': r['d'], 'ts': r.get('ts') or 0, **fmt(r), 'amount': rnd(sign * float(r['amount']))})
    add("SELECT p.account_id aid,p.date d,p.ts,p.amount,p.method,p.ref,x.number,x.kind xk,x.customer_name FROM cust_payments p JOIN sdocs x ON x.id=p.doc_id WHERE p.account_id IS NOT NULL", 'p.date', 'p.account_id',
        lambda r: {'kind': 'Sales receipt' if r['xk'] == 'receipt' else 'Customer payment', 'ref': r['number'], 'desc': f"{r['customer_name']} — {r['method']}" + (f" ({r['ref']})" if r['ref'] else '')})
    add("SELECT p.account_id aid,p.date d,p.amount,p.method,r.id rid,r.device,c.name cn FROM repair_payments p JOIN repairs r ON r.id=p.repair_id JOIN customers c ON c.id=r.customer_id WHERE p.account_id IS NOT NULL", 'p.date', 'p.account_id',
        lambda r: {'kind': 'Repair payment', 'ref': f"RP-{r['rid']:05d}", 'desc': f"{r['cn']} — {r['device']}"})
    add("SELECT p.account_id aid,p.date d,p.amount,p.method,j.id jid,j.device,c.name cn FROM soft_payments p JOIN soft_jobs j ON j.id=p.job_id JOIN customers c ON c.id=j.customer_id WHERE p.account_id IS NOT NULL", 'p.date', 'p.account_id',
        lambda r: {'kind': 'Software payment', 'ref': f"SW-{r['jid']:05d}", 'desc': f"{r['cn']} — {r['device']}"})
    add("SELECT p.account_id aid,p.date d,p.ts,p.amount,p.method,b.number,v.name vn FROM vendor_payments p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN bills b ON b.id=p.bill_id WHERE p.account_id IS NOT NULL", 'p.date', 'p.account_id',
        lambda r: {'kind': 'Paid to store', 'ref': r['number'] or '', 'desc': r['vn']}, -1)
    add("SELECT e.account_id aid,e.date d,e.ts,e.amount,e.payee,c.name cat,e.ref FROM expense_entries e LEFT JOIN exp_categories c ON c.id=e.category_id WHERE e.account_id IS NOT NULL", 'e.date', 'e.account_id',
        lambda r: {'kind': 'Expense', 'ref': r['ref'] or '', 'desc': ' — '.join(x for x in (r['cat'], r['payee']) if x)}, -1)
    add("SELECT t.from_id aid,t.date d,t.ts,t.amount,t.ref,a.name other FROM acc_transfers t JOIN money_accounts a ON a.id=t.to_id WHERE 1=1", 't.date', 't.from_id',
        lambda r: {'kind': 'Transfer out', 'ref': r['ref'] or '', 'desc': f"To {r['other']}"}, -1)
    add("SELECT t.to_id aid,t.date d,t.ts,t.amount,t.ref,a.name other FROM acc_transfers t JOIN money_accounts a ON a.id=t.from_id WHERE 1=1", 't.date', 't.to_id',
        lambda r: {'kind': 'Transfer in', 'ref': r['ref'] or '', 'desc': f"From {r['other']}"})
    add("SELECT m.account_id aid,m.date d,m.ts,m.amount,m.kind k,m.ref,m.note FROM acc_moves m WHERE 1=1", 'm.date', 'm.account_id',
        lambda r: {'kind': 'Deposit' if r['amount'] >= 0 else 'Withdrawal', 'ref': r['ref'] or '', 'desc': r['note'] or r['k'] or ''})
    out.sort(key=lambda x: (x['date'], x['ts']))
    return out

def acct_balances(to: str | None = None) -> dict:
    bal = {a['id']: float(a['opening_balance'] or 0) for a in rows('SELECT id,opening_balance,opening_date FROM money_accounts') if not to or (a['opening_date'] or '') <= to}
    for f in acct_flows(None, to): bal[f['account_id']] = bal.get(f['account_id'], 0.0) + f['amount']
    return {k: rnd(v) for k, v in bal.items()}

def act_pay_accounts(inp):
    """Names only — for the 'deposit to / paid from' selector on payment forms."""
    me(); return rows('SELECT id,name,type FROM money_accounts WHERE active=1 ORDER BY id')

def act_accounts_list(inp):
    need('accounts', 'view'); bal = acct_balances(); d30 = add_days(-30).strftime('%Y-%m-%d'); inflow: dict = {}; outflow: dict = {}
    for f in acct_flows():
        if f['date'] >= d30:
            (inflow if f['amount'] > 0 else outflow)[f['account_id']] = (inflow if f['amount'] > 0 else outflow).get(f['account_id'], 0.0) + abs(f['amount'])
    out = rows('SELECT * FROM money_accounts ORDER BY active DESC, id')
    for a in out: a['balance'] = bal.get(a['id'], 0.0); a['in30'] = rnd(inflow.get(a['id'], 0.0)); a['out30'] = rnd(outflow.get(a['id'], 0.0))
    return out

def act_account_save(inp):
    id_ = I(inp.get('id')); need('accounts', 'edit' if id_ else 'add')
    f = {'name': s(inp.get('name'), 60), 'type': inp.get('type') if inp.get('type') in ACC_TYPES else 'cash', 'number': s(inp.get('number'), 60), 'notes': s(inp.get('notes'), 300),
         'opening_balance': rnd(n(inp.get('opening_balance'))), 'opening_date': d(inp.get('opening_date')) or today(), 'active': 0 if inp.get('active') in (False, 0, '0') else 1}
    if not f['name']: raise ApiError('Account name is required.')
    if val('SELECT 1 FROM money_accounts WHERE lower(name)=lower(?) AND id<>?', (f['name'], id_)): raise ApiError('An account with this name already exists.')
    if id_: upd('money_accounts', id_, f)
    else: id_ = ins('money_accounts', {**f, 'created_at': now()})
    audit('update' if inp.get('id') else 'create', 'account', id_, f"{f['name']} opening {f['opening_balance']}")
    return {'id': id_}

def act_account_delete(inp):
    need('accounts', 'delete'); id_ = I(inp.get('id'))
    used = any(val(f'SELECT 1 FROM {t} WHERE account_id=?', (id_,)) for t in ('cust_payments', 'vendor_payments', 'expense_entries', 'repair_payments', 'soft_payments', 'acc_moves')) or val('SELECT 1 FROM acc_transfers WHERE from_id=? OR to_id=?', (id_, id_))
    if used: upd('money_accounts', id_, {'active': 0}); audit('deactivate', 'account', id_); return {'deactivated': True}
    q('DELETE FROM money_accounts WHERE id=?', (id_,)); audit('delete', 'account', id_); return {'deleted': True}

def act_account_register(inp):
    need('accounts', 'view'); aid = I(inp.get('id')); a = row('SELECT * FROM money_accounts WHERE id=?', (aid,))
    if not a: raise ApiError('Account not found.', 404)
    frm = d(inp.get('from')) or ''; to = d(inp.get('to')) or today()
    run = float(a['opening_balance'] or 0); out = []                  # newest first; the first row is the balance brought forward
    for f in acct_flows(aid, to):
        run += f['amount']
        if frm and f['date'] < frm: continue
        out.append({**f, 'money_in': f['amount'] if f['amount'] > 0 else 0, 'money_out': -f['amount'] if f['amount'] < 0 else 0, 'balance': rnd(run)})
    before = rnd(run - sum(x['amount'] for x in out))
    head = [{'date': frm or (a['opening_date'] or ''), 'kind': 'Opening balance' if not frm else 'Balance brought forward', 'ref': '', 'desc': '', 'money_in': 0, 'money_out': 0, 'balance': before}]
    return {'account': {**a, 'balance': rnd(run)}, 'rows': list(reversed(head + out)), 'in': rnd(sum(x['money_in'] for x in out)), 'out': rnd(sum(x['money_out'] for x in out))}

def act_account_transfer(inp):
    u = need('accounts', 'edit'); a, b = I(inp.get('from_id')), I(inp.get('to_id')); amt = money_(inp.get('amount')); fee = money_(inp.get('fee')); date = d(inp.get('date')) or today()
    if a == b: raise ApiError('Choose two different accounts.')
    na = val('SELECT name FROM money_accounts WHERE id=? AND active=1', (a,)); nb = val('SELECT name FROM money_accounts WHERE id=? AND active=1', (b,))
    if not na or not nb: raise ApiError('Choose both accounts.')
    if amt <= 0: raise ApiError('Enter the amount to transfer.')
    have = acct_balances().get(a, 0.0)
    if amt + fee > have + EPS: raise ApiError(f'{na} only has {have:,.2f} — not enough for {amt + fee:,.2f}. (If the account really has more, set its opening balance first.)')
    fee_id = None
    if fee > 0:
        cat = val("SELECT id FROM exp_categories WHERE lower(name)='bank & mobile money fees'") or ins('exp_categories', {'name': 'Bank & mobile money fees'})
        fee_id = ins('expense_entries', {'date': date, 'category_id': cat, 'payee': na, 'amount': fee, 'method': 'Other', 'ref': s(inp.get('ref'), 60), 'description': f'Transfer fee {na} → {nb}', 'user_id': u['id'], 'ts': now(), 'account_id': a})
    id_ = ins('acc_transfers', {'date': date, 'from_id': a, 'to_id': b, 'amount': amt, 'fee': fee, 'fee_expense_id': fee_id, 'ref': s(inp.get('ref'), 60), 'note': s(inp.get('note'), 200), 'user_id': u['id'], 'ts': now()})
    audit('transfer', 'account', id_, f'{na} → {nb} {amt}' + (f' (fee {fee})' if fee else ''))
    return {'id': id_}

def act_account_transfers(inp):
    need('accounts', 'view')
    return rows('SELECT t.*,fa.name from_name,ta.name to_name,u.name by_name FROM acc_transfers t JOIN money_accounts fa ON fa.id=t.from_id JOIN money_accounts ta ON ta.id=t.to_id LEFT JOIN users u ON u.id=t.user_id ORDER BY t.date DESC,t.id DESC LIMIT 1000')

def act_account_transfer_delete(inp):
    need('accounts', 'delete'); t = row('SELECT * FROM acc_transfers WHERE id=?', (I(inp.get('id')),))
    if not t: raise ApiError('Transfer not found.', 404)
    if t['fee_expense_id']: q('DELETE FROM expense_entries WHERE id=?', (t['fee_expense_id'],))
    q('DELETE FROM acc_transfers WHERE id=?', (t['id'],)); audit('delete', 'transfer', int(t['id']), str(t['amount']))
    return []

def act_account_move(inp):
    """Deposit (owner puts money in, loan received…) or withdrawal (owner takes money out) — not income or expense."""
    u = need('accounts', 'edit'); aid = I(inp.get('account_id')); amt = money_(inp.get('amount')); kind = 'withdrawal' if inp.get('kind') == 'withdrawal' else 'deposit'
    name = val('SELECT name FROM money_accounts WHERE id=? AND active=1', (aid,))
    if not name: raise ApiError('Choose the account.')
    if amt <= 0: raise ApiError('Enter the amount.')
    if kind == 'withdrawal' and amt > acct_balances().get(aid, 0.0) + EPS: raise ApiError(f'{name} does not have {amt:,.2f}.')
    id_ = ins('acc_moves', {'account_id': aid, 'date': d(inp.get('date')) or today(), 'amount': amt if kind == 'deposit' else -amt, 'kind': kind, 'ref': s(inp.get('ref'), 60), 'note': s(inp.get('note'), 200), 'user_id': u['id'], 'ts': now()})
    audit(kind, 'account', aid, f'{name} {amt}')
    return {'id': id_}

def act_account_move_delete(inp):
    need('accounts', 'delete'); q('DELETE FROM acc_moves WHERE id=?', (I(inp.get('id')),)); audit('delete', 'account_move', I(inp.get('id')))
    return []
