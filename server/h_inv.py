"""Finance (Super Admin) and the customer portal."""
from __future__ import annotations
from datetime import timedelta

from core import *


# ---------------------------------------------------------------- finance (Super Admin only)
def act_finance(inp):
    admin(); td = today(); m = money_by_day('2000-01-01', td); now_ = local_now()
    def agg(frm, to):
        a = {'income': 0.0, 'cost': 0.0, 'expense': 0.0}
        for dd, x in m.items():
            if frm <= dd <= to:
                for f in a: a[f] += x[f]
        a['profit'] = a['income'] - a['cost'] - a['expense']
        return {k: rnd(v) for k, v in a.items()}
    sales = float(val("SELECT COALESCE(SUM(total-tax),0) FROM sdocs WHERE kind IN ('invoice','receipt') AND status<>'void'") or 0)
    repair_inc = float(val('SELECT COALESCE(SUM(amount),0) FROM repair_payments') or 0) + float(val('SELECT COALESCE(SUM(amount),0) FROM soft_payments') or 0)
    first = now_.replace(day=1); last_first = add_months(first, -1); last_last = first - timedelta(days=1)
    monday = (now_ - timedelta(days=now_.weekday())).strftime('%Y-%m-%d')
    tot = agg('2000-01-01', td); wk = agg(monday, td); mo = agg(first.strftime('%Y-%m-%d'), td); last_mo = agg(last_first.strftime('%Y-%m-%d'), last_last.strftime('%Y-%m-%d'))
    daily = []
    for i in range(29, -1, -1):
        dd = add_days(-i).strftime('%Y-%m-%d'); x = m.get(dd, {'income': 0, 'cost': 0, 'expense': 0})
        daily.append({'label': dd[5:], 'income': rnd(x['income']), 'expense': rnd(x['expense'] + x['cost']), 'v': rnd(x['income'] - x['cost'] - x['expense'])})
    monthly = {add_months(first, -i).strftime('%Y-%m'): {'income': 0.0, 'cost': 0.0, 'expense': 0.0} for i in range(11, -1, -1)}
    for dd, x in m.items():
        k = dd[:7]
        if k in monthly:
            for f, v in x.items(): monthly[k][f] += v
    mrows = [{'month': k, 'label': datetime.strptime(k + '-01', '%Y-%m-%d').strftime('%b %y'), 'income': rnd(x['income']), 'cost': rnd(x['cost']), 'expense': rnd(x['expense']), 'v': rnd(x['income'] - x['cost'] - x['expense'])} for k, x in monthly.items()]
    ar = rnd(float(val("SELECT COALESCE(SUM(total-paid),0) FROM sdocs WHERE kind='invoice' AND status='open'") or 0))
    stores = rows("SELECT v.id,v.name,v.phone,COALESCE(SUM(b.total),0) billed,COALESCE(SUM(b.paid),0) paid,COALESCE(SUM(b.total-b.paid),0) owed FROM vendors v JOIN bills b ON b.vendor_id=v.id AND b.status<>'void' GROUP BY v.id HAVING owed>0.005 ORDER BY owed DESC")
    return {'breakdown': finance_breakdown('2000-01-01', td), 'breakdown_month': finance_breakdown(first.strftime('%Y-%m-%d'), td), 'totals': {**tot, 'sales': rnd(sales), 'repair_income': rnd(repair_inc)}, 'week': wk, 'month': mo, 'last_month': last_mo, 'today': agg(td, td),
            'daily': daily, 'monthly': mrows, 'expense_cats': rows('SELECT c.name label, ROUND(SUM(e.amount),2) v FROM expense_entries e JOIN exp_categories c ON c.id=e.category_id GROUP BY c.id ORDER BY v DESC'),
            'receivable': ar, 'stores': stores, 'payable': rnd(sum(float(x['owed']) for x in stores)),
            'stock_value': rnd(float(val("SELECT COALESCE(SUM(qty*cost),0) FROM items WHERE type='inventory' AND qty>0") or 0))}

# ---------------------------------------------------------------- customer portal (customers only ever receive their own devices; credentials never leave the server)
def pme() -> dict:
    uid = sess_uid('portal'); a = row('SELECT * FROM portal_accounts WHERE id=?', (uid,)) if uid else None
    if not a: raise ApiError('Please sign in.', 401, {'auth': True})
    if a['status'] != 'active':
        sess_destroy('portal', hard=False); raise ApiError('Your account is not active.', 403, {'auth': True})
    return a

def portal_find(phone: str):
    """Portal accounts are identified by the registered mobile number (last 9 digits); an active one wins if several exist."""
    k = phone_key(phone)
    if len(k) < 7: return None
    m = [a for a in rows('SELECT * FROM portal_accounts') if phone_key(a['phone']) == k]
    return next((a for a in m if a['status'] == 'active'), m[0] if m else None)

def portal_block(a: dict) -> None:
    if a['status'] == 'pending': raise ApiError('Your registration is waiting for approval by HARGEISA IPHONE CENTER. Once it is approved you only need your number to enter.', 403, {'pending': True})
    if a['status'] == 'rejected': raise ApiError('Your registration was not approved. Please contact the shop.', 403)
    if a['status'] == 'suspended': raise ApiError('Your access has been suspended. Please contact the shop.', 403)

def portal_throttle(tag: str) -> None:
    from flask import request
    key = f"{request.remote_addr or ''}|p|{tag}"
    if int(val('SELECT COUNT(*) FROM login_attempts WHERE k=? AND ts>?', (key, now() - 600))) >= 12: raise ApiError('Too many attempts. Please try again in a few minutes.', 429)
    defer('INSERT INTO login_attempts(k,ts) VALUES(?,?)', (key, now()))

def act_portal_register(inp):
    """First visit: name + mobile number. Access starts only after a Super Admin (or a user with Portal permission) approves it."""
    name = s(inp.get('name'), 80); phone = s(inp.get('phone'), 30)
    if not name or len(phone_key(phone)) < 7: raise ApiError('Enter your full name and the mobile number you gave the shop.')
    portal_throttle('reg')
    a = portal_find(phone)
    if a:
        portal_block(a)
        raise ApiError('This number is already approved — just enter your number to sign in.', 409, {'approved': True})
    id_ = ins('portal_accounts', {'name': name, 'phone': phone, 'status': 'pending', 'created_at': now()})
    notify('portal', f'Customer portal access request: {name} ({phone})', 'perm:portal', '#/portal')
    return {'id': id_}

def act_portal_login(inp):
    """Return visits: the registered mobile number is all that is needed."""
    phone = s(inp.get('phone'), 30)
    if len(phone_key(phone)) < 7: raise ApiError('Enter your registered mobile number.')
    portal_throttle('in')
    a = portal_find(phone)
    if not a: raise ApiError('This number is not registered yet. Please register first — the shop will approve it once.', 404, {'unknown': True})
    portal_block(a)
    sess_create('portal', int(a['id']), True)
    q('UPDATE portal_accounts SET last_login=? WHERE id=?', (now(), a['id']))
    return act_portal_me({})
def act_portal_logout(inp):
    sess_destroy('portal'); return []

def portal_devices(cid: int) -> dict:
    repairs = []
    for r in rows('SELECT id,device,status,outcome,diagnosis,expected_date,received_at,closed_at,progress_notes FROM repairs WHERE customer_id=? ORDER BY id DESC', (cid,)):
        r['events'] = rows('SELECT status,ts FROM repair_events WHERE repair_id=? ORDER BY id', (r['id'],))
        r['parts'] = rows('SELECT i.name product,SUM(rp.qty) qty FROM repair_parts rp JOIN items i ON i.id=rp.product_id WHERE rp.repair_id=? GROUP BY rp.product_id', (r['id'],))
        r['parts_status'] = 'Parts used/installed' if r['parts'] else ('Waiting for part' if r['status'] == 'waiting_part' else 'No parts required yet')
        r['ready'] = r['status'] in ('ready', 'completed'); r['collected'] = r['status'] in ('took_completed', 'took_incomplete')
        r.pop('outcome', None); repairs.append(r)
    dl = "CASE WHEN expected_date IS NULL THEN NULL ELSE CAST(julianday(expected_date)-julianday(date('now','localtime')) AS INTEGER) END"
    return {'repairs': repairs,
            'software': rows(f'SELECT id,kind,device,status,request_date,expected_date,received_at,{dl} days_left FROM soft_jobs WHERE customer_id=? ORDER BY id DESC', (cid,)),
            'appleids': rows(f'SELECT id,model,status,request_date,expected_date,{dl} days_left FROM appleids WHERE customer_id=? AND hidden=0 ORDER BY id DESC', (cid,)),
            'regional': rows('SELECT id,device,status,region,date_sent,expected_return,actual_return FROM regional WHERE customer_id=? ORDER BY id DESC', (cid,))}

EMPTY_DEVICES = lambda: {'repairs': [], 'software': [], 'appleids': [], 'regional': []}

def act_portal_me(inp):
    from h_auth import all_settings
    a = pme()
    unread = int(val('SELECT COUNT(*) FROM cust_msgs WHERE customer_id=? AND is_read=0', (a['customer_id'] or 0,)) or 0)
    return {'account': {'id': int(a['id']), 'name': a['name'], 'phone': a['phone'], 'email': a['email']}, 'unread_msgs': unread, 'branding': all_settings(), **(portal_devices(int(a['customer_id'])) if a['customer_id'] else EMPTY_DEVICES())}

def act_portal_bills(inp):
    """The customer's own invoices, payments and balances (never anyone else's, never costs or credentials)."""
    a = pme(); cid = int(a['customer_id'] or 0); bills = []; pays = []
    if cid:
        for r in rows(f"SELECT r.id,r.device,r.received_at ts,r.status,r.price-r.discount total,COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0) paid FROM repairs r WHERE r.customer_id=? ORDER BY r.id DESC", (cid,)):
            r['kind'] = 'Hardware repair'; r['no'] = f"RP-{r['id']:05d}"; bills.append(r)
            pays += [{**p, 'no': r['no'], 'for': f"{r['device']} (repair #{r['id']})"} for p in rows('SELECT amount,method,date FROM repair_payments WHERE repair_id=? ORDER BY id', (r['id'],))]
        for j in rows("SELECT j.id,j.kind jk,j.device,j.received_at ts,j.status,j.price-j.discount total,COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0) paid FROM soft_jobs j WHERE j.customer_id=? ORDER BY j.id DESC", (cid,)):
            j['kind'] = {'repair': 'Software repair', 'unlock': 'Apple Unlock', 'newid': 'New Apple ID'}.get(j.pop('jk'), 'Software'); j['no'] = f"SW-{j['id']:05d}"; bills.append(j)
            pays += [{**p, 'no': j['no'], 'for': f"{j['device']} ({j['kind']} #{j['id']})"} for p in rows('SELECT amount,method,date FROM soft_payments WHERE job_id=? ORDER BY id', (j['id'],))]
        from acc import LINES_SQL
        for sl in rows(f"SELECT x.id,x.number,x.total,x.paid,x.date,x.created_at,{LINES_SQL} items FROM sdocs x WHERE x.customer_id=? AND x.kind IN ('invoice','receipt') AND x.status<>'void' ORDER BY x.id DESC", (cid,)):
            bills.append({'id': sl['id'], 'kind': 'Purchase', 'no': sl['number'], 'device': (sl['items'] or 'Items').replace('\n', ', '), 'ts': sl['created_at'] or 0, 'date': sl['date'], 'status': 'sale', 'total': sl['total'], 'paid': sl['paid']})
            pays += [{**p, 'no': sl['number'], 'for': f"Invoice {sl['number']}"} for p in rows('SELECT amount,method,date FROM cust_payments WHERE doc_id=? ORDER BY id', (sl['id'],))]
    for b in bills: b['total'] = rnd(float(b['total'] or 0)); b['paid'] = rnd(float(b['paid'] or 0)); b['balance'] = rnd(b['total'] - b['paid'])
    pays.sort(key=lambda p: p['date'] or '', reverse=True)
    return {'bills': bills, 'payments': pays, 'summary': {'billed': rnd(sum(b['total'] for b in bills)), 'paid': rnd(sum(b['paid'] for b in bills)), 'balance': rnd(sum(max(0, b['balance']) for b in bills))}, 'branding': all_settings_pub()}

def all_settings_pub() -> dict:
    from h_auth import all_settings
    return all_settings()

def act_portal_msgs(inp):
    a = pme(); cid = int(a['customer_id'] or 0)
    items = rows('SELECT id,type,message,is_read,ts FROM cust_msgs WHERE customer_id=? ORDER BY ts DESC,id DESC LIMIT 100', (cid,)) if cid else []
    return {'items': items, 'unread': sum(1 for m in items if not m['is_read'])}

def act_portal_msg_read(inp):
    a = pme(); cid = int(a['customer_id'] or 0)
    if inp.get('id') == 'all': q('UPDATE cust_msgs SET is_read=1 WHERE customer_id=?', (cid,))
    else: q('UPDATE cust_msgs SET is_read=1 WHERE customer_id=? AND id=?', (cid, I(inp.get('id'))))
    return act_portal_msgs({})

def act_portal_list(inp):
    need('portal', 'view')
    return rows("""SELECT a.id,a.name,a.phone,a.email,a.status,a.created_at,a.last_login,a.customer_id,
        (SELECT COUNT(*) FROM repairs r WHERE r.customer_id=a.customer_id) repairs,
        (SELECT r.device||' — '||r.status FROM repairs r WHERE r.customer_id=a.customer_id AND r.status NOT IN ('completed','took_completed','took_incomplete','failed') ORDER BY r.id DESC LIMIT 1) current
        FROM portal_accounts a ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.id DESC""")

def act_portal_status(inp):
    u = need('portal', 'status'); id_ = I(inp.get('id')); to = str(inp.get('status') or ''); a = row('SELECT * FROM portal_accounts WHERE id=?', (id_,))
    if not a: raise ApiError('Account not found.', 404)
    if to not in ('active', 'rejected', 'suspended'): raise ApiError('Invalid status.')
    dd = {'status': to, 'approved_by': u['id']}
    if to == 'active' and not a['customer_id']:
        ex = val('SELECT id FROM customers WHERE phone_key=?', (phone_key(a['phone']),))
        dd['customer_id'] = ex or ins('customers', {'name': a['name'], 'phone': a['phone'], 'phone_key': phone_key(a['phone']), 'email': a['email'], 'created_by': u['id'], 'created_at': now()})
    upd('portal_accounts', id_, dd)
    if to != 'active': q("DELETE FROM sessions WHERE kind='portal' AND uid=?", (id_,))
    audit('approve' if to == 'active' else to, 'portal_account', id_, a['name'])
    return []

def act_portal_get(inp):
    need('portal', 'view'); a = row('SELECT id,name,phone,email,status,created_at,last_login,customer_id FROM portal_accounts WHERE id=?', (I(inp.get('id')),))
    if not a: raise ApiError('Account not found.', 404)
    return {'account': a, **(portal_devices(int(a['customer_id'])) if a['customer_id'] else EMPTY_DEVICES())}
