"""Customers, follow-ups, hardware repairs, Apple ID records, regional repairs."""
from __future__ import annotations

from core import *
import acc

REPAIR_STATUSES = ['received', 'diagnosis', 'progress', 'waiting_part', 'parts_installed', 'testing', 'working', 'not_working', 'finishing', 'completed', 'ready', 'took_completed', 'took_incomplete', 'in_store', 'failed']
REPAIR_OUTCOMES = ['took_completed', 'took_incomplete', 'store_completed', 'store_incomplete']
APPLE_STATUSES = ['request', 'received', 'progress', 'finished', 'failed', 'took', 'instore']
REGIONAL_STATUSES = ['received', 'sent', 'in_repair', 'returning', 'returned', 'ready', 'collected', 'failed']
FOLLOWUP_TYPES = ['collect_phone', 'return_service', 'complete_payment', 'replacement_part', 'continue_repair', 'other_service']
REMINDER_PRIORITIES = ['low', 'normal', 'high', 'urgent']
REMINDER_REPEATS = ['none', 'daily', 'weekly', 'monthly']
REMINDER_SNOOZE = {'10m': 600, '30m': 1800, '1h': 3600, '3h': 10800, '1d': 86400}

def _hhmm(v) -> str | None:
    """'HH:MM' (24h), or None if not a valid time."""
    v = s(v, 5)
    if len(v) != 5 or v[2] != ':' or not (v[:2].isdigit() and v[3:].isdigit()): return None
    hh, mm = int(v[:2]), int(v[3:])
    return v if 0 <= hh <= 23 and 0 <= mm <= 59 else None


def first(inp: dict, *keys):
    for k in keys:
        if inp.get(k) is not None: return inp[k]
    return None

def resolve_customer(inp: dict):
    """Returns (customer_id, existed). A returning customer (matched by phone) is reused — never duplicated."""
    cid = I(inp.get('customer_id'))
    if cid and val('SELECT 1 FROM customers WHERE id=?', (cid,)): return cid, True
    name = s(first(inp, 'customer_name', 'name'), 80); phone = s(first(inp, 'customer_phone', 'phone'), 30); key = phone_key(phone)
    if not name or len(key) < 5: raise ApiError('Customer name and a valid phone number are required.')
    ex = val('SELECT id FROM customers WHERE phone_key=?', (key,))
    if ex: return int(ex), True
    id_ = ins('customers', {'name': name, 'phone': phone, 'phone_key': key, 'email': s(inp.get('email'), 120), 'gender': inp.get('gender') if inp.get('gender') in ('Male', 'Female', 'Other') else None,
                            'address': s(inp.get('address'), 200), 'created_by': me()['id'], 'created_at': now()})
    audit('create', 'customer', id_, name)
    return id_, False


# ---------------------------------------------------------------- customers
CUST_POSITIONS = ('Regular', 'VIP', 'Business', 'Dealer / Wholesale', 'Family / Friend', 'Staff')
def act_customers_list(inp):
    need_any([('customers', 'view'), ('repairs', 'add'), ('appleid', 'add'), ('sales', 'add'), ('regional', 'add')])
    return rows("""SELECT c.id,c.name,c.phone,c.email,c.gender,c.address,c.position,c.created_at,
      (SELECT COUNT(*) FROM repairs r WHERE r.customer_id=c.id) repairs,
      (SELECT COUNT(*) FROM appleids a WHERE a.customer_id=c.id) appleids,
      (SELECT COUNT(*) FROM regional g WHERE g.customer_id=c.id) regional,
      (SELECT COUNT(*) FROM sdocs s WHERE s.customer_id=c.id AND s.kind IN ('invoice','receipt') AND s.status<>'void') sales,
      (SELECT COUNT(*) FROM soft_jobs sj WHERE sj.customer_id=c.id) software,
      (SELECT COUNT(*) FROM followups f WHERE f.customer_id=c.id AND f.done=0) followups,
      COALESCE((SELECT SUM(r.price-r.discount) FROM repairs r WHERE r.customer_id=c.id AND r.status<>'failed'),0) +
      COALESCE((SELECT SUM(sj.price-sj.discount) FROM soft_jobs sj WHERE sj.customer_id=c.id AND sj.status<>'failed'),0) -
      COALESCE((SELECT SUM(p.amount) FROM repair_payments p JOIN repairs r ON r.id=p.repair_id WHERE r.customer_id=c.id),0) -
      COALESCE((SELECT SUM(p.amount) FROM soft_payments p JOIN soft_jobs sj ON sj.id=p.job_id WHERE sj.customer_id=c.id),0) +
      COALESCE((SELECT SUM(s.total-s.paid) FROM sdocs s WHERE s.customer_id=c.id AND s.kind IN ('invoice','receipt') AND s.status<>'void'),0) balance,
      GREATEST(COALESCE((SELECT MAX(received_at) FROM repairs r WHERE r.customer_id=c.id),0),COALESCE((SELECT MAX(received_at) FROM soft_jobs sj WHERE sj.customer_id=c.id),0)) last_visit
      FROM customers c ORDER BY c.id DESC""")

def act_customer_save(inp):
    id_ = I(inp.get('id')); name = s(inp.get('name'), 80); phone = s(inp.get('phone'), 30); key = phone_key(phone)
    if not name or len(key) < 5: raise ApiError('Customer name and a valid phone number are required.')
    gender = inp.get('gender') if inp.get('gender') in ('Male', 'Female', 'Other') else None
    position = inp.get('position') if inp.get('position') in CUST_POSITIONS else 'Regular'
    if id_:
        need('customers', 'edit')
        if val('SELECT 1 FROM customers WHERE phone_key=? AND id<>?', (key, id_)): raise ApiError('Another customer already uses this phone number.')
        upd('customers', id_, {'name': name, 'phone': phone, 'phone_key': key, 'email': s(inp.get('email'), 120), 'gender': gender, 'position': position, 'address': s(inp.get('address'), 200), 'notes': s(inp.get('notes'), 1000)})
        audit('update', 'customer', id_, name)
        return {'id': id_, 'existing': False}
    need('customers', 'add')
    ex = val('SELECT id FROM customers WHERE phone_key=?', (key,))
    if ex: return {'id': int(ex), 'existing': True}
    id_ = ins('customers', {'name': name, 'phone': phone, 'phone_key': key, 'email': s(inp.get('email'), 120), 'gender': gender, 'position': position, 'address': s(inp.get('address'), 200), 'notes': s(inp.get('notes'), 1000), 'created_by': me()['id'], 'created_at': now()})
    audit('create', 'customer', id_, name)
    return {'id': id_, 'existing': False}

def act_customer_find(inp):
    need_any([('customers', 'view'), ('repairs', 'add'), ('appleid', 'add'), ('sales', 'add'), ('regional', 'add')])
    t = str(inp.get('q') or '').strip()
    if len(t) < 2: return []
    like = '%' + t.replace('%', '\\%').replace('_', '\\_') + '%'; k = phone_key(t)
    return rows("SELECT id,name,phone,email FROM customers WHERE name ILIKE ? ESCAPE '\\' OR " + ('phone_key LIKE ?' if k else 'phone ILIKE ?') + ' ORDER BY name LIMIT 8', (like, f'%{k}%' if k else like))

def act_customer_get(inp):
    need('customers', 'view'); id_ = I(inp.get('id'))
    c = row('SELECT * FROM customers WHERE id=?', (id_,))
    if not c: raise ApiError('Customer not found.', 404)
    adm = is_admin()
    repairs = rows("""SELECT r.id,r.device,r.problem,r.status,r.outcome,r.received_at,r.price,r.discount,r.expected_date,u.name tech,
        COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0) paid,
        (SELECT string_agg(p.name||' ×'||rp.qty, ', ' ORDER BY rp.id) FROM repair_parts rp JOIN items p ON p.id=rp.product_id WHERE rp.repair_id=r.id) parts
        FROM repairs r LEFT JOIN users u ON u.id=COALESCE(r.technician_id,r.created_by) WHERE r.customer_id=? ORDER BY r.received_at DESC""", (id_,))
    apple = rows('SELECT a.id,a.model,a.apple_id,a.status,a.date,a.expected_date,u.name handled FROM appleids a LEFT JOIN users u ON u.id=a.created_by WHERE a.customer_id=?' + ('' if adm else ' AND a.hidden=0') + ' ORDER BY a.id DESC', (id_,)) if can('appleid', 'view') else []
    regional = rows('SELECT g.id,g.device,g.problem,g.region,g.status,g.date_sent,u.name handled FROM regional g LEFT JOIN users u ON u.id=g.created_by WHERE g.customer_id=? ORDER BY g.id DESC', (id_,)) if can('regional', 'view') else []
    sales = acc.docs_query({'customer_id': id_}) if can('sales', 'view') else []
    follow = rows('SELECT f.*,u.name by_name FROM followups f LEFT JOIN users u ON u.id=f.created_by WHERE f.customer_id=? ORDER BY f.done,f.due_date NULLS FIRST', (id_,))
    pay = rows("SELECT p.id,p.amount,p.method,p.date,p.note,'Hardware: '||r.device device,u.name by_name FROM repair_payments p JOIN repairs r ON r.id=p.repair_id LEFT JOIN users u ON u.id=p.user_id WHERE r.customer_id=?", (id_,))
    soft = rows("""SELECT j.id,j.kind,j.device,j.imei,j.apple_id,j.problem,j.status,j.received_at,j.expected_date,j.price,j.discount,u.name tech,
        COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0) paid FROM soft_jobs j LEFT JOIN users u ON u.id=COALESCE(j.technician_id,j.created_by) WHERE j.customer_id=? ORDER BY j.received_at DESC""", (id_,)) if can('software', 'view') else []
    if soft: pay += rows("SELECT p.id,p.amount,p.method,p.date,p.note,'Software: '||j.device device,u.name by_name FROM soft_payments p JOIN soft_jobs j ON j.id=p.job_id LEFT JOIN users u ON u.id=p.user_id WHERE j.customer_id=?", (id_,))
    if sales: pay += rows("SELECT p.id,p.amount,p.method,p.date,p.note,'Invoice '||x.number device,u.name by_name FROM cust_payments p JOIN sdocs x ON x.id=p.doc_id LEFT JOIN users u ON u.id=p.user_id WHERE x.customer_id=?", (id_,))
    pay.sort(key=lambda p: str(p['date'] or ''), reverse=True)
    portal = row('SELECT id,status,last_login FROM portal_accounts WHERE customer_id=?', (id_,)) if adm else None
    devices = unique([x for x in [r['device'] for r in repairs] + [r['device'] for r in soft] + [r['model'] for r in apple] + [r['device'] for r in regional] if x])
    return {'customer': c, 'repairs': repairs, 'software': soft, 'appleids': apple, 'regional': regional, 'sales': sales, 'followups': follow, 'payments': pay, 'portal': portal, 'devices': devices}

def act_customer_delete(inp):
    admin(); id_ = I(inp.get('id'))
    for t in ['repairs', 'soft_jobs', 'appleids', 'regional', 'sdocs']:
        if val(f'SELECT 1 FROM {t} WHERE customer_id=?', (id_,)): raise ApiError('This customer has service history and cannot be deleted.')
    c = row('SELECT name FROM customers WHERE id=?', (id_,))
    q('DELETE FROM followups WHERE customer_id=?', (id_,)); q('DELETE FROM customers WHERE id=?', (id_,))
    audit('delete', 'customer', id_, str((c or {}).get('name') or ''))
    return []


# ---------------------------------------------------------------- follow-ups / customer-linked reminders (same table, same permissions — this IS the reminder system)
def act_followups_list(inp):
    """The Main Reminder Center: every reminder (automatic follow-ups and customer-linked reminders alike), newest/most-due first."""
    need('customers', 'view')
    return rows('SELECT f.*,c.name customer_name,c.phone,u.name by_name FROM followups f JOIN customers c ON c.id=f.customer_id LEFT JOIN users u ON u.id=f.created_by ORDER BY f.done, COALESCE(f.snooze_until,f.scheduled_at) IS NULL, COALESCE(f.snooze_until,f.scheduled_at), f.due_date IS NULL, f.due_date, f.id DESC LIMIT 1000')

def act_followup_save(inp):
    """Creates or edits a reminder. A title makes it a customer-linked reminder (date + time + priority + repeat);
    without one it behaves like the older, automatic follow-up types. Either way it lives in the same `followups` table
    the Notification Center already watches, so nothing new needs to be wired into notifications."""
    u = need('customers', 'edit'); cid = I(inp.get('customer_id'))
    if not val('SELECT 1 FROM customers WHERE id=?', (cid,)): raise ApiError('Customer not found.', 404)
    title = s(inp.get('title'), 120)
    type_ = inp.get('type') if inp.get('type') in FOLLOWUP_TYPES else ('reminder' if title else 'other_service')
    due = d(inp.get('due_date')) or today()
    time_ = _hhmm(inp.get('time'))
    hh, mm = (int(time_[:2]), int(time_[3:])) if time_ else (9, 0)          # a reminder with no time shows as due at 9am that day
    sched = date_ts(due) + hh * 3600 + mm * 60
    priority = inp.get('priority') if inp.get('priority') in REMINDER_PRIORITIES else 'normal'
    repeat = inp.get('repeat') if inp.get('repeat') in REMINDER_REPEATS else 'none'
    note = s(inp.get('note') if inp.get('note') is not None else inp.get('description'), 500)
    dd = {'customer_id': cid, 'type': type_, 'title': title or None, 'note': note, 'due_date': due, 'time': time_, 'scheduled_at': sched,
          'priority': priority, 'repeat_rule': repeat, 'updated_at': now()}
    id_ = I(inp.get('id'))
    if id_:
        if not val('SELECT 1 FROM followups WHERE id=?', (id_,)): raise ApiError('Reminder not found.', 404)
        upd('followups', id_, dd); audit('update', 'followup', id_, title or type_)
        return {'id': id_}
    dd.update({'created_by': u['id'], 'created_at': now(), 'status': 'open', 'source': 'manual' if title else 'system'})
    id_ = ins('followups', dd)
    audit('create', 'followup', id_, title or type_)
    return {'id': id_}

def act_followup_done(inp):
    need('customers', 'edit'); id_ = I(inp.get('id')); f = row('SELECT * FROM followups WHERE id=?', (id_,))
    if not f: raise ApiError('Reminder not found.', 404)
    done = 0 if not empty(inp.get('undo')) else 1
    q('UPDATE followups SET done=?,status=?,done_at=?,updated_at=?,snooze_until=NULL WHERE id=?', (done, 'done' if done else 'open', now() if done else None, now(), id_))
    audit('status', 'followup', id_, 'done' if done else 'reopened')
    next_id = None
    if done and (f['repeat_rule'] or 'none') != 'none' and f['scheduled_at']:   # repeating reminder: schedule the next occurrence automatically
        base = int(f['scheduled_at'])
        if f['repeat_rule'] == 'monthly': nxt = int(add_months(datetime.fromtimestamp(base, TZ), 1).timestamp())
        else: nxt = base + {'daily': 86400, 'weekly': 7 * 86400}.get(f['repeat_rule'], 0)
        if nxt > base:
            next_id = ins('followups', {'customer_id': f['customer_id'], 'type': f['type'], 'title': f['title'], 'note': f['note'], 'due_date': fdate(nxt, '%Y-%m-%d'), 'time': f['time'],
                'scheduled_at': nxt, 'priority': f['priority'], 'repeat_rule': f['repeat_rule'], 'status': 'open', 'source': f['source'] or 'manual', 'created_by': me()['id'], 'created_at': now(), 'updated_at': now()})
            audit('create', 'followup', next_id, f"repeat of #{id_}")
    return {'next_id': next_id}

def act_followup_snooze(inp):
    """Push a reminder's alert to a later moment without changing its original schedule or marking it done."""
    need('customers', 'edit'); id_ = I(inp.get('id'))
    if not val('SELECT 1 FROM followups WHERE id=?', (id_,)): raise ApiError('Reminder not found.', 404)
    until = I(inp.get('until')) or None
    if not until:
        preset = str(inp.get('preset') or '30m')
        until = int(add_days(1).replace(hour=9, minute=0, second=0, microsecond=0).timestamp()) if preset == 'tomorrow' else now() + REMINDER_SNOOZE.get(preset, 1800)
    q('UPDATE followups SET snooze_until=?,updated_at=?,status=? WHERE id=?', (until, now(), 'snoozed', id_))
    audit('status', 'followup', id_, 'snoozed until ' + fdate(until, '%d %b %H:%M'))
    return {'snooze_until': until}

def act_followup_delete(inp):
    need('customers', 'edit'); id_ = I(inp.get('id'))
    if not val('SELECT 1 FROM followups WHERE id=?', (id_,)): raise ApiError('Reminder not found.', 404)
    q('DELETE FROM followups WHERE id=?', (id_,)); audit('delete', 'followup', id_)
    return []


# ---------------------------------------------------------------- hardware repairs
def act_repairs_list(inp):
    need('repairs', 'view')
    return rows("""SELECT r.id,r.customer_id,c.name customer_name,c.phone,r.device,r.imei,r.problem,r.status,r.outcome,r.received_at,r.expected_date,r.price,r.discount,r.technician_id,u.name tech,r.updated_at,
      COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0) paid,
      (SELECT COUNT(*) FROM repair_parts WHERE repair_id=r.id) parts_count
      FROM repairs r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.technician_id ORDER BY r.id DESC LIMIT 1000""")

def act_repair_get(inp):
    need('repairs', 'view'); id_ = I(inp.get('id'))
    r = row('SELECT r.*,c.name customer_name,c.phone,c.email,u.name tech,cb.name created_name FROM repairs r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.technician_id LEFT JOIN users cb ON cb.id=r.created_by WHERE r.id=?', (id_,))
    if not r: raise ApiError('Repair not found.', 404)
    parts = rows(acc.PARTS_SQL.format(t='repair_parts', fk='repair_id'), (id_,))
    if not is_admin():
        for p in parts: p.pop('unit_cost', None)
    return {'repair': r, 'events': rows('SELECT e.status,e.note,e.ts,u.name by_name FROM repair_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.repair_id=? ORDER BY e.id DESC', (id_,)), 'parts': parts,
            'payments': rows('SELECT p.id,p.amount,p.method,p.date,p.note,u.name by_name FROM repair_payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.repair_id=? ORDER BY p.id', (id_,))}

def act_repair_save(inp):
    u = me(); id_ = I(inp.get('id'))
    f = {'device': s(inp.get('device'), 120), 'imei': s(inp.get('imei'), 40), 'problem': s(inp.get('problem'), 1000), 'diagnosis': s(inp.get('diagnosis'), 1000), 'diagnosis_notes': s(inp.get('diagnosis_notes'), 1500),
         'required_parts': s(inp.get('required_parts'), 500), 'progress_notes': s(inp.get('progress_notes'), 1500), 'test_result': s(inp.get('test_result'), 500), 'expected_date': d(inp.get('expected_date')),
         'price': max(0, n(inp.get('price'))), 'discount': max(0, n(inp.get('discount'))), 'technician_id': I(inp.get('technician_id')) or None, 'updated_at': now()}
    if not f['device']: raise ApiError('Device model is required.')
    if f['discount'] > f['price']: raise ApiError('Discount cannot exceed the price.')
    if f['technician_id'] and not val("SELECT 1 FROM users WHERE id=? AND status='active'", (f['technician_id'],)): f['technician_id'] = None
    if id_:
        need('repairs', 'edit')
        if not val('SELECT 1 FROM repairs WHERE id=?', (id_,)): raise ApiError('Repair not found.', 404)
        upd('repairs', id_, f); audit('update', 'repair', id_, f['device'])
        return {'id': id_}
    need('repairs', 'add')
    cid, existed = resolve_customer(inp)
    f.update({'customer_id': cid, 'status': 'received', 'received_at': now(), 'created_by': u['id']})
    if not f['technician_id']: f['technician_id'] = u['id'] if u['position'] == 'Technician' else None
    id_ = ins('repairs', f)
    ins('repair_events', {'repair_id': id_, 'status': 'received', 'note': 'Device received', 'user_id': u['id'], 'ts': now()})
    audit('create', 'repair', id_, f['device'])
    return {'id': id_, 'customer_id': cid, 'existing_customer': existed}

def act_repair_status(inp):
    u = need('repairs', 'status'); id_ = I(inp.get('id')); st = str(inp.get('status') or '')
    r = row('SELECT r.*,c.name cname FROM repairs r JOIN customers c ON c.id=r.customer_id WHERE r.id=?', (id_,))
    if not r: raise ApiError('Repair not found.', 404)
    if st not in REPAIR_STATUSES: raise ApiError('Invalid status.')
    outcome = inp.get('outcome') if inp.get('outcome') in REPAIR_OUTCOMES else r['outcome']
    if st == 'took_completed': outcome = 'took_completed'
    if st == 'took_incomplete': outcome = 'took_incomplete'
    closed = now() if st in ('completed', 'took_completed', 'took_incomplete', 'failed') else None
    dd = {'status': st, 'outcome': outcome, 'updated_at': now(), 'closed_at': closed}
    if not empty(inp.get('test_result')): dd['test_result'] = s(inp['test_result'], 500)
    upd('repairs', id_, dd)
    ins('repair_events', {'repair_id': id_, 'status': st, 'note': s(inp.get('note'), 500), 'user_id': u['id'], 'ts': now()})
    audit('status', 'repair', id_, st)
    def mk(t, note):
        if not val("SELECT 1 FROM followups WHERE ref_kind='repair' AND ref_id=? AND type=? AND done=0", (id_, t)):
            ins('followups', {'customer_id': r['customer_id'], 'type': t, 'note': note, 'due_date': today(), 'ref_kind': 'repair', 'ref_id': id_, 'created_by': u['id'], 'created_at': now()})
    if st == 'ready':
        mk('collect_phone', f"{r['device']} is ready for collection"); notify('followup', f"Ready for customer: {r['device']} — {r['cname']}", 'perm:repairs', '#/repairs')
    cm = {'ready': f"Good news! Your {r['device']} is READY for collection.", 'completed': f"Your {r['device']} repair is completed.",
          'waiting_part': f"Your {r['device']} is waiting for a replacement part — we will update you when it arrives.", 'testing': f"Your {r['device']} is being tested.",
          'took_completed': f"Thank you! You collected your {r['device']}.", 'failed': f"We could not repair your {r['device']}. Please contact the shop."}
    if st in cm and r['status'] != st: cust_notify(int(r['customer_id']), 'repair', cm[st], f'rs:{id_}:{st}:{now() // 3600}')
    if st == 'waiting_part': mk('replacement_part', f"{r['device']} waiting for a part")
    if st in ('took_completed', 'took_incomplete'): q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='repair' AND ref_id=? AND type='collect_phone' AND done=0", (now(), id_))
    if st == 'took_incomplete': mk('continue_repair', f"{r['device']} left incomplete — customer must return")
    return []

def act_repair_part_add(inp):
    u = need('repairs', 'edit'); rid, pid, qty = I(inp.get('repair_id')), I(inp.get('product_id')), I(inp.get('qty'))
    if not row('SELECT id FROM repairs WHERE id=?', (rid,)): raise ApiError('Repair not found.', 404)
    p = acc.part_add('repair_parts', 'repair_id', rid, pid, qty, f'Hardware repair #{rid}', u)
    ins('repair_events', {'repair_id': rid, 'status': val('SELECT status FROM repairs WHERE id=?', (rid,)), 'note': f"Part used: {p['name']} × {qty}", 'user_id': u['id'], 'ts': now()})
    audit('part_add', 'repair', rid, f"{p['name']} x{qty}")
    return []

def act_repair_part_remove(inp):
    need('repairs', 'edit'); rp = row('SELECT * FROM repair_parts WHERE id=?', (I(inp.get('id')),))
    if not rp: raise ApiError('Part record not found.', 404)
    acc.part_remove('repair_parts', int(rp['id'])); audit('part_remove', 'repair', int(rp['repair_id']))
    return []

def act_repair_payment_add(inp):
    u = need('repairs', 'edit'); rid = I(inp.get('repair_id')); amt = rnd(n(inp.get('amount')))
    if not val('SELECT 1 FROM repairs WHERE id=?', (rid,)): raise ApiError('Repair not found.', 404)
    if amt <= 0: raise ApiError('Enter a payment amount.')
    id_ = ins('repair_payments', {'repair_id': rid, 'amount': amt, 'method': s(inp.get('method') if inp.get('method') is not None else 'Cash', 30), 'date': d(inp.get('date')) or today(), 'user_id': u['id'], 'note': s(inp.get('note'), 200), 'account_id': acc.pick_account(inp, s(inp.get('method') or 'Cash', 30))})
    q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='repair' AND ref_id=? AND type='complete_payment' AND done=0 AND (SELECT price-discount-COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=?),0) FROM repairs WHERE id=?)<=0", (now(), rid, rid, rid))
    audit('payment', 'repair', rid, str(amt))
    rr = row(f'SELECT r.customer_id,r.device,{BAL_REPAIR} b FROM repairs r WHERE r.id=?', (rid,))
    cust_notify(int(rr['customer_id']), 'payment', f"Payment of {amt} received for your {rr['device']}. " + ('Balance: fully paid — thank you!' if rr['b'] <= 0.005 else f"Remaining balance: {round(float(rr['b']), 2)}."), f'pay:r{id_}')
    return {'id': id_}

def act_repair_delete(inp):
    need('repairs', 'delete'); id_ = I(inp.get('id'))
    for rp in rows('SELECT id FROM repair_parts WHERE repair_id=?', (id_,)): acc.part_remove('repair_parts', int(rp['id']))
    for t in ['repair_parts', 'repair_events', 'repair_payments']: q(f'DELETE FROM {t} WHERE repair_id=?', (id_,))
    q("DELETE FROM followups WHERE ref_kind='repair' AND ref_id=?", (id_,)); q('DELETE FROM repairs WHERE id=?', (id_,)); audit('delete', 'repair', id_)
    return []


# ---------------------------------------------------------------- Apple ID records (passwords encrypted; hidden records invisible to non-admins at query level)
def apple_vis() -> str: return '' if is_admin() else ' AND a.hidden=0'
APPLE_COLS = """a.id,a.customer_id,a.customer_name,a.phone,a.model,a.apple_id,a.description,a.date,a.hidden,a.status,a.request_date,a.expected_date,a.assigned_to,a.notes,a.ts,
  u.name created_name, s.name assigned_name,
  hic_days_until(a.expected_date) days_left"""

def act_appleid_list(inp):
    need('appleid', 'view')
    return rows('SELECT ' + APPLE_COLS + ' FROM appleids a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users s ON s.id=a.assigned_to WHERE 1=1' + apple_vis() + ' ORDER BY a.id DESC LIMIT 1000')

def apple_get(id_: int) -> dict:
    r = row('SELECT a.*,u.name created_name FROM appleids a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=?' + apple_vis(), (id_,))
    if not r: raise ApiError('Record not found.', 404)
    return r

def act_appleid_reveal(inp):
    need('appleid', 'view'); r = apple_get(I(inp.get('id')))
    audit('reveal', 'appleid', int(r['id']), str(r['customer_name']))
    return {'password': dec(r['pw_enc'])}

def act_appleid_full(inp):
    need('appleid', 'view'); ids = [I(x) for x in (inp.get('ids') or [])]; out = []
    for r in rows('SELECT ' + APPLE_COLS + ',a.pw_enc FROM appleids a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users s ON s.id=a.assigned_to WHERE 1=1' + apple_vis() + ' ORDER BY a.id DESC'):
        if ids and int(r['id']) not in ids: continue
        r['password'] = dec(r.pop('pw_enc')); out.append(r)
    audit('export', 'appleid', None, f'{len(out)} record(s) printed/exported')
    return out

def act_appleid_save(inp):
    u = me(); id_ = I(inp.get('id'))
    f = {'model': s(inp.get('model'), 100), 'apple_id': s(inp.get('apple_id'), 150), 'description': s(inp.get('description'), 1000), 'date': d(inp.get('date')) or today(), 'request_date': d(inp.get('request_date')) or today(),
         'expected_date': d(inp.get('expected_date')), 'assigned_to': I(inp.get('assigned_to')) or None, 'notes': s(inp.get('notes'), 1000), 'updated_at': now()}
    if not f['model'] or not f['apple_id']: raise ApiError('iPhone model and Apple ID are required.')
    pw = str(inp.get('password') or '')
    if id_:
        need('appleid', 'edit'); apple_get(id_)
        if pw != '': f['pw_enc'] = enc(pw)
        upd('appleids', id_, f); audit('update', 'appleid', id_, f['model'])
        return {'id': id_}
    need('appleid', 'add')
    if pw == '': raise ApiError('Apple ID password is required.')
    cid, _ = resolve_customer(inp)
    cname = str(val('SELECT name FROM customers WHERE id=?', (cid,))); cphone = str(val('SELECT phone FROM customers WHERE id=?', (cid,)))
    st = inp.get('status') if inp.get('status') in APPLE_STATUSES else 'request'
    id_ = ins('appleids', {**f, 'customer_id': cid, 'customer_name': cname, 'phone': cphone, 'pw_enc': enc(pw), 'created_by': u['id'], 'status': st, 'ts': now()})
    audit('create', 'appleid', id_, f['model'])
    return {'id': id_}

def act_appleid_status(inp):
    need('appleid', 'status'); id_ = I(inp.get('id')); st = str(inp.get('status') or ''); r = apple_get(id_)
    if st not in APPLE_STATUSES: raise ApiError('Invalid status.')
    notes = str(r['notes'] or '').strip()
    if not empty(inp.get('note')): notes = (notes + '\n[' + local_now().strftime('%d %b %H:%M') + '] ' + s(inp['note'], 300)).strip()
    dd = {'status': st, 'notes': notes, 'updated_at': now()}
    if not empty(inp.get('expected_date')) and d(inp['expected_date']): dd['expected_date'] = d(inp['expected_date']); dd['last_notified'] = None
    upd('appleids', id_, dd); audit('status', 'appleid', id_, st)
    if st == 'finished' and r['customer_id'] and not val("SELECT 1 FROM followups WHERE ref_kind='appleid' AND ref_id=? AND done=0", (id_,)):
        ins('followups', {'customer_id': r['customer_id'], 'type': 'collect_phone', 'note': f"Apple ID finished for {r['model']}", 'due_date': today(), 'ref_kind': 'appleid', 'ref_id': id_, 'created_by': me()['id'], 'created_at': now()})
    if st == 'took': q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='appleid' AND ref_id=? AND done=0", (now(), id_))
    return []

def act_appleid_hide(inp):
    admin(); id_ = I(inp.get('id')); h = 0 if empty(inp.get('hidden')) else 1
    upd('appleids', id_, {'hidden': h}); audit('hide' if h else 'unhide', 'appleid', id_)
    return []

def act_appleid_delete(inp):
    need('appleid', 'delete'); id_ = I(inp.get('id')); apple_get(id_)
    q('DELETE FROM appleids WHERE id=?', (id_,)); audit('delete', 'appleid', id_)
    return []


# ---------------------------------------------------------------- regional repairs
def act_regional_list(inp):
    need('regional', 'view')
    return rows('SELECT g.*,u.name created_name FROM regional g LEFT JOIN users u ON u.id=g.created_by ORDER BY g.id DESC LIMIT 1000')

def act_regional_save(inp):
    u = me(); id_ = I(inp.get('id'))
    f = {'device': s(inp.get('device'), 120), 'problem': s(inp.get('problem'), 800), 'region': s(inp.get('region'), 100), 'sent_to': s(inp.get('sent_to'), 150), 'date_sent': d(inp.get('date_sent')), 'technician': s(inp.get('technician'), 100),
         'parts': s(inp.get('parts'), 300), 'cost': max(0, n(inp.get('cost'))), 'expected_return': d(inp.get('expected_return')), 'actual_return': d(inp.get('actual_return')), 'notes': s(inp.get('notes'), 1000)}
    if not f['device'] or not f['region']: raise ApiError('Device and region are required.')
    if id_:
        need('regional', 'edit'); upd('regional', id_, f); audit('update', 'regional', id_, f['device'])
        return {'id': id_}
    need('regional', 'add')
    cid, _ = resolve_customer(inp)
    st = inp.get('status') if inp.get('status') in REGIONAL_STATUSES else 'received'
    id_ = ins('regional', {**f, 'customer_id': cid, 'customer_name': str(val('SELECT name FROM customers WHERE id=?', (cid,))), 'phone': str(val('SELECT phone FROM customers WHERE id=?', (cid,))), 'status': st, 'created_by': u['id'], 'ts': now()})
    audit('create', 'regional', id_, f['device'])
    return {'id': id_}

def act_regional_status(inp):
    need('regional', 'status'); id_ = I(inp.get('id')); st = str(inp.get('status') or '')
    if st not in REGIONAL_STATUSES: raise ApiError('Invalid status.')
    r = row('SELECT * FROM regional WHERE id=?', (id_,))
    if not r: raise ApiError('Not found.', 404)
    dd = {'status': st}
    if st == 'returned' and not r['actual_return']: dd['actual_return'] = today()
    if not empty(inp.get('note')): dd['notes'] = (str(r['notes'] or '') + '\n[' + local_now().strftime('%d %b %H:%M') + '] ' + s(inp['note'], 300)).strip()
    upd('regional', id_, dd); audit('status', 'regional', id_, st)
    if st == 'ready': notify('followup', f"Regional repair ready: {r['device']} — {r['customer_name']}", 'perm:regional', '#/regional')
    return []

def act_regional_delete(inp):
    need('regional', 'delete'); id_ = I(inp.get('id'))
    q('DELETE FROM regional WHERE id=?', (id_,)); audit('delete', 'regional', id_)
    return []
