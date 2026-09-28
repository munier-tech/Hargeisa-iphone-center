"""Software Department: software repair, Apple Unlock requests, New Apple ID service (+ sellable service catalogue)."""
from __future__ import annotations

from core import *
import acc
from h_ops import resolve_customer

SOFT_STATUS = {
    'repair': ['received', 'diagnosis', 'in_progress', 'waiting', 'testing', 'working', 'not_working', 'completed', 'failed', 'took', 'instore'],
    'unlock': ['request', 'received', 'in_progress', 'waiting', 'completed', 'failed', 'took', 'instore'],
    'newid': ['requested', 'creating', 'created', 'verified', 'failed', 'customer_received'],
}
SOFT_TERMINAL = ['completed', 'failed', 'took', 'instore', 'customer_received']
KIND_LABEL = {'repair': 'Software repair', 'unlock': 'Apple Unlock', 'newid': 'New Apple ID'}

def soft_kind(k) -> str:
    if k not in SOFT_STATUS: raise ApiError('Unknown service type.')
    return k

SOFT_COLS = """j.id,j.kind,j.customer_id,c.name customer_name,c.phone,j.device,j.imei,j.serial,cb.name created_name,(j.gmail_pw IS NOT NULL OR j.apple_pw IS NOT NULL) has_secret,j.problem,j.diagnosis,j.apple_id,j.lock_info,j.technician_id,u.name tech,j.status,j.notes,j.request_date,j.expected_date,j.account_date,j.price,j.discount,j.received_at,j.updated_at,
  COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0) paid,
  (SELECT COUNT(*) FROM soft_parts WHERE job_id=j.id) parts_count,
  hic_days_until(j.expected_date) days_left"""
SOFT_FROM = 'FROM soft_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.technician_id LEFT JOIN users cb ON cb.id=j.created_by'


def act_soft_list(inp):
    need('software', 'view'); kind = soft_kind(inp['kind']) if inp.get('kind') else None
    out = rows('SELECT ' + SOFT_COLS + ' ' + SOFT_FROM + (' WHERE j.kind=?' if kind else '') + ' ORDER BY j.id DESC LIMIT 1500', (kind,) if kind else ())
    for r in out: r['has_secret'] = bool(r['has_secret'])
    return out

def act_soft_get(inp):
    need('software', 'view'); id_ = I(inp.get('id'))
    j = row('SELECT j.*,c.name customer_name,c.phone,c.email,u.name tech,cb.name created_name FROM soft_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.technician_id LEFT JOIN users cb ON cb.id=j.created_by WHERE j.id=?', (id_,))
    if not j: raise ApiError('Service not found.', 404)
    parts = rows(acc.PARTS_SQL.format(t='soft_parts', fk='job_id'), (id_,))
    if not is_admin():
        for p in parts: p.pop('unit_cost', None)
    j['has_secret'] = bool(j.get('gmail_pw') or j.get('apple_pw')); j.pop('gmail_pw', None); j.pop('apple_pw', None)
    return {'job': j, 'parts': parts,
            'events': rows('SELECT e.status,e.note,e.ts,u.name by_name FROM soft_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.job_id=? ORDER BY e.id DESC', (id_,)),
            'payments': rows('SELECT p.id,p.amount,p.method,p.date,p.note,u.name by_name FROM soft_payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.job_id=? ORDER BY p.id', (id_,))}

def act_soft_save(inp):
    u = me(); id_ = I(inp.get('id')); existing = row('SELECT * FROM soft_jobs WHERE id=?', (id_,)) if id_ else None
    if id_ and not existing: raise ApiError('Service not found.', 404)
    kind = existing['kind'] if existing else soft_kind(inp.get('kind') or '')
    need('software', 'edit' if id_ else 'add')
    f = {'device': s(inp.get('device'), 120), 'imei': s(inp.get('imei'), 40), 'serial': s(inp.get('serial'), 40), 'problem': s(inp.get('problem'), 1000), 'diagnosis': s(inp.get('diagnosis'), 1000),
         'apple_id': s(inp.get('apple_id'), 150), 'lock_info': s(inp.get('lock_info'), 1000), 'notes': s(inp.get('notes'), 1500), 'tools': s(inp.get('tools'), 500),
         'progress_notes': s(inp.get('progress_notes'), 1500), 'test_result': s(inp.get('test_result'), 500),
         'request_date': d(inp.get('request_date')), 'expected_date': d(inp.get('expected_date')), 'account_date': d(inp.get('account_date')),
         'price': max(0, n(inp.get('price'))), 'discount': max(0, n(inp.get('discount'))), 'technician_id': I(inp.get('technician_id')) or None, 'updated_at': now()}
    if not f['device']: raise ApiError('Device / iPhone model is required.')
    if kind == 'newid' and not f['apple_id']: raise ApiError('Enter the new Apple ID email.')
    if f['discount'] > f['price']: raise ApiError('Discount cannot exceed the price.')
    if f['technician_id'] and not val("SELECT 1 FROM users WHERE id=? AND status='active'", (f['technician_id'],)): f['technician_id'] = None
    if kind == 'newid':
        for k, col in (('gmail_password', 'gmail_pw'), ('apple_password', 'apple_pw')):
            pw = str(inp.get(k) or '')
            if pw != '': f[col] = enc(pw)
    if existing:
        upd('soft_jobs', id_, f); audit('update', 'software', id_, f"{kind}: {f['device']}")
        return {'id': id_}
    cid, existed = resolve_customer(inp)
    if kind == 'unlock' and not f['request_date']: f['request_date'] = today()
    if kind == 'newid' and not f['account_date']: f['account_date'] = today()
    first_st = SOFT_STATUS[kind][0]
    id_ = ins('soft_jobs', {**f, 'kind': kind, 'customer_id': cid, 'status': first_st, 'received_at': now(), 'created_by': u['id']})
    ins('soft_events', {'job_id': id_, 'status': first_st, 'note': 'Service registered', 'user_id': u['id'], 'ts': now()})
    audit('create', 'software', id_, f"{kind}: {f['device']}")
    return {'id': id_, 'customer_id': cid, 'existing_customer': existed}

def act_soft_status(inp):
    u = need('software', 'status'); id_ = I(inp.get('id')); st = str(inp.get('status') or '')
    j = row('SELECT j.*,c.name cname FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.id=?', (id_,))
    if not j: raise ApiError('Service not found.', 404)
    if st not in SOFT_STATUS[j['kind']]: raise ApiError('Invalid status for this service.')
    dd = {'status': st, 'updated_at': now(), 'closed_at': now() if st in SOFT_TERMINAL else None}
    if not empty(inp.get('test_result')): dd['test_result'] = s(inp['test_result'], 500)
    if not empty(inp.get('expected_date')) and d(inp['expected_date']): dd['expected_date'] = d(inp['expected_date']); dd['last_notified'] = None
    upd('soft_jobs', id_, dd)
    ins('soft_events', {'job_id': id_, 'status': st, 'note': s(inp.get('note'), 500), 'user_id': u['id'], 'ts': now()})
    audit('status', 'software', id_, st)
    label = KIND_LABEL[j['kind']]
    def mk(t, note):
        if not val("SELECT 1 FROM followups WHERE ref_kind='software' AND ref_id=? AND type=? AND done=0", (id_, t)):
            ins('followups', {'customer_id': j['customer_id'], 'type': t, 'note': note, 'due_date': today(), 'ref_kind': 'software', 'ref_id': id_, 'created_by': u['id'], 'created_at': now()})
    if st in ('completed', 'verified'):
        mk('collect_phone', f"{label} finished — {j['device']} ready for the customer"); notify('followup', f"{label} finished: {j['device']} — {j['cname']}", 'perm:software', '#/software')
    if st in ('completed', 'verified', 'created') and j['status'] != st: cust_notify(int(j['customer_id']), 'software', f"Your {label} for {j['device']} is {'completed' if st != 'created' else 'created'}. Please come to collect / confirm.", f'ss:{id_}:{st}')
    if st in ('took', 'instore', 'customer_received'): q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='software' AND ref_id=? AND done=0", (now(), id_))
    return []

def act_soft_part_add(inp):
    u = need('software', 'edit'); jid, pid, qty = I(inp.get('job_id')), I(inp.get('product_id')), I(inp.get('qty'))
    j = row('SELECT id,status FROM soft_jobs WHERE id=?', (jid,))
    if not j: raise ApiError('Service not found.', 404)
    p = acc.part_add('soft_parts', 'job_id', jid, pid, qty, f'Software service #{jid}', u)
    ins('soft_events', {'job_id': jid, 'status': j['status'], 'note': f"Part / tool used: {p['name']} × {qty}", 'user_id': u['id'], 'ts': now()})
    audit('part_add', 'software', jid, f"{p['name']} x{qty}")
    return []

def act_soft_part_remove(inp):
    need('software', 'edit'); sp = row('SELECT * FROM soft_parts WHERE id=?', (I(inp.get('id')),))
    if not sp: raise ApiError('Part record not found.', 404)
    acc.part_remove('soft_parts', int(sp['id'])); audit('part_remove', 'software', int(sp['job_id']))
    return []

def act_soft_payment_add(inp):
    u = need('software', 'edit'); jid = I(inp.get('job_id')); amt = rnd(n(inp.get('amount')))
    if not val('SELECT 1 FROM soft_jobs WHERE id=?', (jid,)): raise ApiError('Service not found.', 404)
    if amt <= 0: raise ApiError('Enter a payment amount.')
    id_ = ins('soft_payments', {'job_id': jid, 'amount': amt, 'method': s(inp['method'] if inp.get('method') is not None else 'Cash', 30), 'date': d(inp.get('date')) or today(), 'user_id': u['id'], 'note': s(inp.get('note'), 200), 'account_id': acc.pick_account(inp, s(inp.get('method') or 'Cash', 30))})
    audit('payment', 'software', jid, str(amt))
    jj = row(f'SELECT j.customer_id,j.device,{BAL_SOFT} b FROM soft_jobs j WHERE j.id=?', (jid,))
    cust_notify(int(jj['customer_id']), 'payment', f"Payment of {amt} received for your {jj['device']} service. " + ('Fully paid — thank you!' if jj['b'] <= 0.005 else f"Remaining balance: {round(float(jj['b']), 2)}."), f'pay:j{id_}')
    return {'id': id_}

def act_soft_delete(inp):
    need('software', 'delete'); id_ = I(inp.get('id'))
    for sp in rows('SELECT id FROM soft_parts WHERE job_id=?', (id_,)): acc.part_remove('soft_parts', int(sp['id']))
    for t in ['soft_parts', 'soft_events', 'soft_payments']: q(f'DELETE FROM {t} WHERE job_id=?', (id_,))
    q("DELETE FROM followups WHERE ref_kind='software' AND ref_id=?", (id_,)); q('DELETE FROM soft_jobs WHERE id=?', (id_,)); audit('delete', 'software', id_)
    return []

def act_soft_secret(inp):
    """New Apple ID passwords: only users who can EDIT the Software Department (or the Super Admin). Every reveal is audited."""
    need('software', 'edit'); j = row("SELECT id,customer_id,gmail_pw,apple_pw FROM soft_jobs WHERE id=? AND kind='newid'", (I(inp.get('id')),))
    if not j: raise ApiError('Service not found.', 404)
    audit('reveal', 'software', int(j['id']), 'New Apple ID passwords')
    return {'gmail_password': dec(j['gmail_pw']), 'apple_password': dec(j['apple_pw'])}

def act_soft_full(inp):
    need('software', 'edit'); ids = [I(x) for x in (inp.get('ids') or [])]
    if not ids: return []
    out = rows('SELECT ' + SOFT_COLS + ',j.gmail_pw,j.apple_pw ' + SOFT_FROM + ' WHERE j.id IN (' + ','.join('?' * len(ids)) + ')', ids)
    for r in out:
        r['has_secret'] = bool(r['has_secret']); r['gmail_password'] = dec(r.pop('gmail_pw')); r['apple_password'] = dec(r.pop('apple_pw'))
    audit('export', 'software', None, f'{len(out)} service(s) printed with credentials')
    return out
