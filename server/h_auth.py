"""Auth, users, profile, settings, notifications, audit log, dashboard, global search."""
from __future__ import annotations
import json, re

from flask import request

from core import *

MODULES = ['customers', 'repairs', 'software', 'appleid', 'inventory', 'stores', 'regional', 'sales', 'expenses', 'accounts', 'reports', 'portal']
ACTIONS = ['view', 'add', 'edit', 'status', 'delete', 'full']
RESTRICTED_MSG = 'Your access has been restricted; this user account has been deactivated. Please contact your owner, as you are not authorized.'


def all_settings() -> dict:
    return {r['k']: r['v'] for r in rows('SELECT k,v FROM settings') if r['k'] not in ('last_check',) and not r['k'].startswith(('mig_', 'sec_', 'bk_', 'ui_', 'seq_'))}   # branding + document settings only (this is a public read)

def act_branding(inp): return all_settings()

def unread_count(uid: int) -> int: return int(val('SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0', (uid,)))

def _ip() -> str: return request.remote_addr or ''


def act_login(inp):
    email = s(inp.get('email'), 120); pw = str(inp.get('password') or '')
    key = f'{_ip()}|{email.lower()}'
    q('DELETE FROM login_attempts WHERE ts<?', (now() - 7 * 86400,))         # kept a week so the Security Center can show recent failures
    lock_min = max(1, I(setting('sec_lock_min', '10'))); max_try = max(3, I(setting('sec_max_attempts', '8')))
    if int(val('SELECT COUNT(*) FROM login_attempts WHERE k=? AND ts>?', (key, now() - lock_min * 60))) >= max_try: raise ApiError(f'Too many attempts. Please try again in {lock_min} minutes.', 429)
    u = row('SELECT * FROM users WHERE email=?', (email,))
    if not u or not verify_pw(pw, u['password']):
        defer('INSERT INTO login_attempts(k,ts) VALUES(?,?)', (key, now()))     # must survive the rollback of this failed request
        raise ApiError('Invalid email or password.', 401)
    if u['status'] == 'pending': raise ApiError('Your account is awaiting Super Admin approval.', 403)
    if u['status'] != 'active': raise ApiError(RESTRICTED_MSG, 403, {'restricted': True})
    sess_create('staff', int(u['id']), not empty(inp.get('remember')))
    q('UPDATE users SET logged_in=1,last_seen=?,session_start=? WHERE id=?', (now(), now(), u['id']))
    q('DELETE FROM login_attempts WHERE k=?', (key,))
    audit('login', 'user', int(u['id']))
    return act_me({})

def act_logout(inp):
    try: u = me(False)
    except ApiError: u = None
    if u:
        q('UPDATE users SET logged_in=0,last_seen=? WHERE id=?', (now(), u['id'])); audit('logout', 'user', int(u['id']))
    sess_destroy('staff')
    return []

def act_me(inp):
    u = me(); touch_user(u); run_checks()
    fresh = row('SELECT * FROM users WHERE id=?', (u['id'],))
    return {'user': public_user(fresh), 'unread': unread_count(int(u['id'])), 'portal_pending': portal_pending(), **chat_ping(u), 'idle_min': max(5, I(setting('sec_idle_min', '30'))), 'branding': all_settings(), 'nav': nav_cfg(), 'default_password': bool(u['is_admin']) and verify_pw('Admin@123', u['password'])}

def chat_ping(u: dict) -> dict:
    import h_chat
    on = h_chat.chat_on() and bool(chat_perm_dict(u)['chat'])
    return {'chat_on': on, 'chat_unread': h_chat.unread_total(int(u['id'])) if on else 0}

def portal_pending() -> int:
    from core import can
    return int(val("SELECT COUNT(*) FROM portal_accounts WHERE status='pending'") or 0) if can('portal', 'view') else 0

def act_ping(inp):
    u = me(); touch_user(u); run_checks()
    return {'unread': unread_count(int(u['id'])), 'portal_pending': portal_pending(), **chat_ping(u), 'nav_v': nav_cfg()['v']}

def act_staff_register(inp):
    name = s(inp.get('name'), 80); email = s(inp.get('email'), 120).lower(); pw = str(inp.get('password') or '')
    pos = 'Software' if inp.get('position') == 'Software' else 'Technician'
    if not name or not valid_email(email): raise ApiError('Enter a valid name and email.')
    if len(pw.encode()) < pw_min(): raise ApiError(f'Password must be at least {pw_min()} characters.')
    if val('SELECT 1 FROM users WHERE email=?', (email,)): raise ApiError('That email is already registered.')
    id_ = ins('users', {'name': name, 'email': email, 'password': hash_pw(pw), 'position': pos, 'status': 'pending', 'perms': json.dumps(default_perms(pos)), 'created_at': now()})
    notify('new_user', f'New user registration: {name} ({pos}) is awaiting approval.', 'admin', '#/users')
    return {'id': id_}


# ---------------------------------------------------------------- users
def act_users_list(inp):
    admin()
    tasks = {r['user_id']: r['n'] for r in rows("SELECT user_id,COUNT(*) n FROM activity WHERE action NOT IN ('login','logout') GROUP BY user_id")}
    tasks30 = {r['user_id']: r['n'] for r in rows("SELECT user_id,COUNT(*) n FROM activity WHERE action NOT IN ('login','logout') AND ts>=? GROUP BY user_id", (now() - 30 * 86400,))}
    names = {r['id']: r['name'] for r in rows('SELECT id,name FROM users')}
    out = []
    for u in rows('SELECT * FROM users ORDER BY is_owner DESC, is_admin DESC, name'):
        p = public_user(u); p['tasks'] = int(tasks.get(u['id'], 0)); p['tasks30'] = int(tasks30.get(u['id'], 0))
        p['deactivated_by'] = names.get(u.get('deactivated_by')) or ''; out.append(p)
    return out

def act_user_detail(inp):
    """Everything about one user: role, permitted functions, activity timeline, sign-in history and totals (Super Admin only)."""
    admin(); id_ = I(inp.get('id')); u = row('SELECT * FROM users WHERE id=?', (id_,))
    if not u: raise ApiError('User not found.', 404)
    p = public_user(u); p['deactivated_by'] = val('SELECT name FROM users WHERE id=?', (u.get('deactivated_by'),)) or '' if u.get('deactivated_by') else ''
    p['approved_by'] = val('SELECT name FROM users WHERE id=?', (u['approved_by'],)) if u['approved_by'] else ''
    t = now()
    return {'user': p,
            'activity': rows("SELECT action,entity,entity_id,detail,ts FROM activity WHERE user_id=? AND action NOT IN ('login','logout') ORDER BY id DESC LIMIT 100", (id_,)),
            'sessions': rows("SELECT action,ts FROM activity WHERE user_id=? AND action IN ('login','logout') ORDER BY id DESC LIMIT 30", (id_,)),
            'by_entity': rows("SELECT entity,COUNT(*) n FROM activity WHERE user_id=? AND action NOT IN ('login','logout') GROUP BY entity ORDER BY n DESC", (id_,)),
            'totals': {'all': int(val("SELECT COUNT(*) FROM activity WHERE user_id=? AND action NOT IN ('login','logout')", (id_,)) or 0),
                       'days30': int(val("SELECT COUNT(*) FROM activity WHERE user_id=? AND action NOT IN ('login','logout') AND ts>=?", (id_, t - 30 * 86400)) or 0),
                       'today': int(val("SELECT COUNT(*) FROM activity WHERE user_id=? AND action NOT IN ('login','logout') AND ts>=?", (id_, t - t % 86400)) or 0),
                       'logins': int(val("SELECT COUNT(*) FROM activity WHERE user_id=? AND action='login'", (id_,)) or 0)}}

def act_staff_lookup(inp):
    me(); return rows("SELECT id,name,position FROM users WHERE status='active' ORDER BY name")

def clean_perms(p) -> dict:
    o = {}
    for m, acts in (p.items() if isinstance(p, dict) else []):
        if m not in MODULES or not isinstance(acts, list): continue
        a = [x for x in acts if x in ACTIONS]
        if a: o[m] = list(dict.fromkeys(a))
    return o

def guard_target(me_: dict, u: dict) -> None:
    """Super Admins manage staff; only the System Owner manages Super Admins. Nobody changes the owner (or themself) from here."""
    if u.get('is_owner') or int(u['id']) == int(me_['id']): raise ApiError('This account cannot be changed here — use My Profile.')
    if u['is_admin'] and not me_.get('is_owner'): raise ApiError('Only the System Owner can change a Super Admin.', 403)

def act_user_save(inp):
    me_ = admin(); id_ = I(inp.get('id')); name = s(inp.get('name'), 80); email = s(inp.get('email'), 120).lower()
    pos = 'Software' if inp.get('position') == 'Software' else 'Technician'
    if not name or not valid_email(email): raise ApiError('Enter a valid name and email.')
    if val('SELECT id FROM users WHERE email=? AND id<>?', (email, id_)): raise ApiError('That email is already used by another user.')
    pw = str(inp.get('password') or '')
    role = inp.get('role') if me_.get('is_owner') and inp.get('role') in ('admin', 'staff') else None     # only the owner may grant / remove Super Admin
    if id_:
        u = row('SELECT * FROM users WHERE id=?', (id_,))
        if not u: raise ApiError('User not found.', 404)
        guard_target(me_, u)
        dd = {'name': name, 'email': email}
        make_admin = (role == 'admin') if role else bool(u['is_admin'])
        if make_admin: dd['is_admin'] = 1; dd['position'] = 'Super Admin'
        else: dd['is_admin'] = 0; dd['position'] = pos; dd['perms'] = json.dumps(clean_perms(inp.get('perms') or {}))
        if pw != '':
            if len(pw) < pw_min(): raise ApiError(f'Password must be at least {pw_min()} characters.')
            dd['password'] = hash_pw(pw)
        upd('users', id_, dd); audit('update', 'user', id_, name + ('' if bool(u['is_admin']) == make_admin else (' → Super Admin' if make_admin else ' → staff')))
    else:
        if len(pw) < pw_min(): raise ApiError(f'Password must be at least {pw_min()} characters.')
        if role == 'admin':
            id_ = ins('users', {'name': name, 'email': email, 'password': hash_pw(pw), 'position': 'Super Admin', 'is_admin': 1, 'status': 'active', 'perms': '{}', 'created_at': now(), 'approved_by': me_['id']})
            audit('create', 'user', id_, name + ' (Super Admin)')
        else:
            perms = clean_perms(inp['perms']) if 'perms' in inp and inp['perms'] is not None else default_perms(pos)
            id_ = ins('users', {'name': name, 'email': email, 'password': hash_pw(pw), 'position': pos, 'status': 'active', 'perms': json.dumps(perms), 'created_at': now(), 'approved_by': me_['id']})
            audit('create', 'user', id_, name)
    return {'id': id_}

def act_user_status(inp):
    me_ = admin(); id_ = I(inp.get('id')); to = inp.get('status') or ''
    u = row('SELECT * FROM users WHERE id=?', (id_,))
    if not u: raise ApiError('User not found.', 404)
    guard_target(me_, u)
    if to not in ('active', 'inactive'): raise ApiError('Invalid status.')
    dd = {'status': to}
    if to == 'inactive':
        dd['logged_in'] = 0; dd['last_seen'] = now(); dd['deactivated_at'] = now(); dd['deactivated_by'] = me_['id']; dd['deactivate_reason'] = s(inp.get('reason'), 200)
    else:
        dd['approved_by'] = me_['id']; dd['deactivated_at'] = None; dd['deactivated_by'] = None; dd['deactivate_reason'] = None
    upd('users', id_, dd)
    if to == 'active':
        type_ = 'user_approved' if u['status'] == 'pending' else 'user_activated'
        notify(type_, ('User approved: ' if type_ == 'user_approved' else 'User activated: ') + u['name'], 'admin', '#/users')
        audit('approve' if type_ == 'user_approved' else 'activate', 'user', id_, u['name'])
    else:
        notify('user_deactivated', 'User deactivated: ' + u['name'], 'admin', '#/users'); audit('deactivate', 'user', id_, u['name'])
    return []

def act_user_delete(inp):
    me_ = admin(); id_ = I(inp.get('id')); u = row('SELECT * FROM users WHERE id=?', (id_,))
    if not u: raise ApiError('This user cannot be deleted.')
    guard_target(me_, u)
    q('DELETE FROM users WHERE id=?', (id_,)); q('DELETE FROM notifications WHERE user_id=?', (id_,)); q('DELETE FROM sessions WHERE uid=? AND kind=?', (id_, 'staff'))
    audit('delete', 'user', id_, u['name'])
    return []

def act_profile_update(inp):
    u = me(); dd = {}
    if 'name' in inp and inp['name'] is not None:
        dd['name'] = s(inp['name'], 80)
        if not dd['name']: raise ApiError('Name is required.')
    if 'email' in inp and inp['email'] is not None:
        e = s(inp['email'], 120).lower()
        if not valid_email(e): raise ApiError('Enter a valid email.')
        if val('SELECT 1 FROM users WHERE email=? AND id<>?', (e, u['id'])): raise ApiError('That email is already used.')
        dd['email'] = e
    if not empty(inp.get('new_password')):
        if not verify_pw(str(inp.get('current_password') or ''), u['password']): raise ApiError('Current password is incorrect.')
        if len(str(inp['new_password'])) < pw_min(): raise ApiError(f'New password must be at least {pw_min()} characters.')
        dd['password'] = hash_pw(str(inp['new_password']))
    if 'avatar' in inp:
        a = str(inp['avatar'] or '')
        if a != '' and (not re.match(r'^data:image/(png|jpeg|webp);base64,', a) or len(a) > 400000): raise ApiError('Invalid or too large picture.')
        dd['avatar'] = a or None
    upd('users', int(u['id']), dd); audit('update', 'profile', int(u['id']))
    return act_me({})

def act_settings_save(inp):
    admin()
    for k in ['company_name', 'slogan', 'phone', 'email', 'address', 'website', 'social', 'footer', 'currency']:
        if inp.get(k) is not None: set_setting(k, s(inp[k], 300))
    if 'logo' in inp:
        l = str(inp['logo'] or '')
        if l != '' and (not re.match(r'^data:image/(png|jpeg|webp|svg\+xml);base64,', l) or len(l) > 600000): raise ApiError('Invalid or too large logo.')
        set_setting('logo', l)
    audit('update', 'settings')
    return all_settings()


# ---------------------------------------------------------------- notifications / audit
def act_notifs_list(inp):
    u = me()
    return {'items': rows('SELECT id,type,message,link,ref,is_read,ts FROM notifications WHERE user_id=? ORDER BY ts DESC,id DESC LIMIT 200', (u['id'],)), 'unread': unread_count(int(u['id']))}

def act_notif_read(inp):
    u = me()
    if inp.get('id') == 'all': q('UPDATE notifications SET is_read=1 WHERE user_id=?', (u['id'],))
    else: q('UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?', (u['id'], I(inp.get('id'))))
    return {'unread': unread_count(int(u['id']))}

def act_audit_list(inp):
    admin()
    return rows('SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.ts,u.name user FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500')

def act_my_activity(inp):
    u = me()
    return rows("SELECT action,entity,entity_id,detail,ts FROM activity WHERE user_id=? AND action NOT IN ('login','logout') ORDER BY id DESC LIMIT 15", (u['id'],))

def act_password_request(inp):
    """Public. A user who forgot the password asks the Super Admin to set a new one. Same answer for every email."""
    email = s(inp.get('email'), 120).lower(); key = f'{_ip()}|pr'
    if int(val('SELECT COUNT(*) FROM login_attempts WHERE k=? AND ts>?', (key, now() - 600))) >= 5: raise ApiError('Too many requests. Please try again later.', 429)
    ins('login_attempts', {'k': key, 'ts': now()})
    u = row("SELECT id,name FROM users WHERE email=? AND status='active'", (email,))
    if u: notify('system', f"Password reset requested by {u['name']} ({email}). Open Users → Edit to set a new password.", 'admin', '#/users', f"pr:{u['id']}:" + local_now().strftime('%Y%m%d%H'))
    return []


# ---------------------------------------------------------------- dashboard
def act_dashboard(inp):
    u = me(); adm = bool(u['is_admin']); t = now(); td = today()
    users = rows('SELECT * FROM users')
    st = {'total_users': len(users), 'technicians': 0, 'software': 0, 'online': 0, 'offline': 0, 'active': 0, 'inactive': 0}
    for x in users:
        if x['position'] == 'Technician': st['technicians'] += 1
        if x['position'] == 'Software': st['software'] += 1
        if x['status'] == 'active':
            st['active'] += 1
            st['online' if ago_json(x)['online'] else 'offline'] += 1
        if x['status'] == 'inactive': st['inactive'] += 1
    v = lambda sql: int(val(sql) or 0)
    st['customers'] = v('SELECT COUNT(*) FROM customers'); st['inventory'] = int(float(val("SELECT COALESCE(SUM(qty),0) FROM items WHERE type='inventory' AND active=1") or 0))
    st['open_repairs'] = v("SELECT COUNT(*) FROM repairs WHERE status NOT IN ('completed','took_completed','took_incomplete','failed')")
    st['followups'] = v('SELECT COUNT(*) FROM followups WHERE done=0')
    st['appleid_open'] = v("SELECT COUNT(*) FROM appleids WHERE status IN ('request','received','progress')" + ('' if adm else ' AND hidden=0'))
    st['regional_open'] = v("SELECT COUNT(*) FROM regional WHERE status NOT IN ('collected','failed','ready')")
    gender = rows("SELECT COALESCE(NULLIF(gender,''),'Unknown') label, COUNT(*) v FROM customers GROUP BY 1")
    repairs_by = rows('SELECT status label, COUNT(*) v FROM repairs GROUP BY status')
    start = t - 24 * 3600; wave = [0] * 24
    for r in rows("SELECT ts FROM activity WHERE ts>=? AND action NOT IN ('login','logout')", (start,)): wave[min(23, (r['ts'] - start) // 3600)] += 1
    wave_labels = [fdate(start + i * 3600 + 3600, '%H:%M') for i in range(24)]
    active = rows("SELECT u.name,COUNT(a.id) v FROM activity a JOIN users u ON u.id=a.user_id WHERE a.ts>=? AND a.action NOT IN ('login','logout') GROUP BY u.id ORDER BY v DESC LIMIT 6", (t - 30 * 86400,))
    prod = rows("SELECT u.name,COUNT(a.id) v FROM activity a JOIN users u ON u.id=a.user_id WHERE a.ts>=? AND a.action='status' AND a.detail IN ('completed','ready','working','finished','took_completed','returned','collected','parts_installed') GROUP BY u.id ORDER BY v DESC LIMIT 6", (t - 30 * 86400,))
    fin = None
    if adm and can('finance', 'view'):
        first = local_now().replace(day=1); mp_map = money_by_day(add_months(first, -11).strftime('%Y-%m-%d'), td)
        daily = []
        for i in range(29, -1, -1):
            dd = add_days(-i).strftime('%Y-%m-%d'); m = mp_map.get(dd, {'income': 0, 'cost': 0, 'expense': 0})
            daily.append({'label': dd[5:], 'v': rnd(m['income'] - m['cost'] - m['expense'])})
        monthly = {add_months(first, -i).strftime('%Y-%m'): {'income': 0, 'cost': 0, 'expense': 0} for i in range(11, -1, -1)}
        for dd, m in mp_map.items():
            k = dd[:7]
            if k in monthly:
                for f, x in m.items(): monthly[k][f] += x
        mp = [{'label': datetime.strptime(k + '-01', '%Y-%m-%d').strftime('%b'), 'v': rnd(m['income'] - m['cost'] - m['expense']), 'income': rnd(m['income']), 'expense': rnd(m['expense'])} for k, m in monthly.items()]
        inc = cost = exp = 0.0
        for m in money_by_day('2000-01-01', td).values(): inc += m['income']; cost += m['cost']; exp += m['expense']
        fin = {'sales': rnd(inc), 'expenses': rnd(exp), 'profit': rnd(inc - cost - exp), 'daily': daily, 'monthly': mp, 'expense_cats': rows('SELECT c.name label, ROUND(SUM(e.amount),2) v FROM expense_entries e JOIN exp_categories c ON c.id=e.category_id GROUP BY c.id ORDER BY v DESC')}
        st['sales'], st['expenses'], st['profit'] = fin['sales'], fin['expenses'], fin['profit']
    recent = {'repairs': [], 'software': [], 'customers': [], 'sales': [], 'due': [], 'low_stock': [], 'activity': []}
    if can('repairs', 'view'): recent['repairs'] = rows('SELECT r.id,r.device,r.status,r.received_at,c.name customer FROM repairs r JOIN customers c ON c.id=r.customer_id ORDER BY r.id DESC LIMIT 5')
    if can('software', 'view'): recent['software'] = rows('SELECT j.id,j.kind,j.device,j.status,j.received_at,c.name customer FROM soft_jobs j JOIN customers c ON c.id=j.customer_id ORDER BY j.id DESC LIMIT 5')
    if can('customers', 'view'): recent['customers'] = rows('SELECT id,name,phone,created_at FROM customers ORDER BY id DESC LIMIT 5')
    if can('sales', 'view'): recent['sales'] = rows("SELECT id,number,date,customer_name,total,paid,status FROM sdocs WHERE kind IN ('invoice','receipt') AND status<>'void' ORDER BY id DESC LIMIT 5")
    if can('inventory', 'view'): recent['low_stock'] = rows("SELECT name,reorder min_stock,qty rem FROM items WHERE type='inventory' AND active=1 AND qty<=reorder ORDER BY qty LIMIT 6")
    dl = "CASE WHEN expected_date IS NULL THEN NULL ELSE CAST(julianday(expected_date)-julianday(date('now','localtime')) AS INTEGER) END"
    if can('appleid', 'view'): recent['due'] += rows(f"SELECT 'Apple ID' k,customer_name c,model d,status,expected_date,{dl} days FROM appleids WHERE status IN ('request','received','progress') AND expected_date IS NOT NULL" + ('' if adm else ' AND hidden=0') + ' ORDER BY expected_date LIMIT 6')
    if can('software', 'view'): recent['due'] += rows("SELECT 'Apple Unlock' k,c.name c,j.device d,j.status,j.expected_date,CASE WHEN j.expected_date IS NULL THEN NULL ELSE CAST(julianday(j.expected_date)-julianday(date('now','localtime')) AS INTEGER) END days FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.kind='unlock' AND j.status IN ('request','received','in_progress','waiting') AND j.expected_date IS NOT NULL ORDER BY j.expected_date LIMIT 6")
    recent['due'] = sorted(recent['due'], key=lambda r: 999 if r['days'] is None else r['days'])[:6]
    recent['activity'] = rows("SELECT a.action,a.entity,a.entity_id,a.detail,a.ts,u.name user FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.action NOT IN ('login','logout')" + ('' if adm else f" AND a.user_id={int(u['id'])}") + ' ORDER BY a.id DESC LIMIT 8')
    return {'recent': recent, 'stats': st, 'gender': gender, 'repairs_by': repairs_by, 'wave': {'values': wave, 'labels': wave_labels, 'online': st['online']}, 'most_active': active, 'most_productive': prod, 'finance': fin}


# ---------------------------------------------------------------- global search (respects permissions; never returns secrets)
DOC_NO = re.compile(r'(?i)\s*(?:(inv|invoice|rc|rct|r|rp|rpr|job)[-\s]?)?#?(\d{1,9})\s*')

def doc_hits(no: int, kind: str) -> list:
    """Invoice / repair numbers: 'INV-123', '#123', 'R-45' or a bare number."""
    out = []
    if can('sales', 'view') and kind in ('', 'inv', 'invoice', 'rc', 'rct'):
        for r in rows("SELECT id,kind,number,customer_name,total,date FROM sdocs WHERE number LIKE ? ORDER BY id DESC LIMIT 5", (f'%-{no:05d}',)):
            out.append({'g': 'Invoices & quotations', 'ic': 'file', 't': f"{r['number']} — {r['customer_name'] or 'Walk-in'}", 's': f"{r['date']} • {r['total']}", 'l': f"#/{'invoices' if r['kind'] == 'invoice' else 'quotes'}/{r['id']}"})
    if can('repairs', 'view') and kind in ('', 'r', 'rp', 'rpr', 'job'):
        for r in rows('SELECT r.id,r.device,r.status,c.name FROM repairs r JOIN customers c ON c.id=r.customer_id WHERE r.id=?', (no,)):
            out.append({'g': 'Hardware repairs', 'ic': 'tool', 't': f"Repair #{r['id']} — {r['device']} ({r['name']})", 's': r['status'], 'l': f"#/repairs/{r['id']}", 'st': r['status']})
    return out

def act_search(inp):
    me(); t = str(inp.get('q') or '').strip()
    if len(t) < 2: return []
    dm = DOC_NO.fullmatch(t)
    if dm and dm.group(1): return doc_hits(int(dm.group(2)), dm.group(1).lower())          # 'INV-12' / 'R-45' go straight to the document
    like = '%' + t.replace('%', '\\%').replace('_', '\\_') + '%'; k = phone_key(t); out = []; L = " LIKE ? ESCAPE '\\'"
    if can('customers', 'view'):
        for r in rows(f'SELECT id,name,phone FROM customers WHERE name{L} OR phone{L}' + (' OR phone_key LIKE ?' if k else '') + ' LIMIT 5', (like, like, f'%{k}%') if k else (like, like)):
            out.append({'g': 'Customers', 'ic': 'user', 't': r['name'], 's': r['phone'], 'l': f"#/customers/{r['id']}"})
    if can('repairs', 'view'):
        for r in rows(f'SELECT r.id,r.device,r.status,c.name FROM repairs r JOIN customers c ON c.id=r.customer_id WHERE r.device{L} OR c.name{L} OR r.imei{L} ORDER BY r.id DESC LIMIT 5', (like, like, like)):
            out.append({'g': 'Hardware repairs', 'ic': 'tool', 't': f"{r['device']} — {r['name']}", 's': r['status'], 'l': '#/repairs', 'st': r['status']})
    if can('software', 'view'):
        for r in rows(f'SELECT j.id,j.kind,j.device,j.status,c.name FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.device{L} OR c.name{L} OR j.imei{L} OR j.serial{L} ORDER BY j.id DESC LIMIT 6', (like, like, like, like)):
            out.append({'g': 'Software', 'ic': 'zap', 't': f"{r['device']} — {r['name']}", 's': r['kind'], 'l': '#/' + ('software' if r['kind'] == 'repair' else r['kind']), 'st': r['status']})
    if can('appleid', 'view'):
        for r in rows(f'SELECT a.id,a.customer_name,a.model,a.status FROM appleids a WHERE (a.customer_name{L} OR a.model{L} OR a.apple_id{L})' + ('' if is_admin() else ' AND a.hidden=0') + ' LIMIT 4', (like, like, like)):
            out.append({'g': 'Apple ID', 'ic': 'key', 't': f"{r['customer_name']} — {r['model']}", 's': r['status'], 'l': '#/appleid', 'st': r['status']})
    if can('inventory', 'view'):
        for r in rows(f'SELECT id,name,type,qty FROM items WHERE name{L} OR sku{L} LIMIT 5', (like, like)):
            out.append({'g': 'Items', 'ic': 'package', 't': r['name'], 's': f"{float(r['qty']):g} in stock" if r['type'] == 'inventory' else r['type'].replace('_', '-'), 'l': f"#/inventory/{r['id']}"})
    m = DOC_NO.fullmatch(t)
    if m: out += doc_hits(int(m.group(2)), (m.group(1) or '').lower())
    elif can('sales', 'view'):
        for r in rows(f'SELECT id,kind,number,customer_name,total,date FROM sdocs WHERE customer_name{L} OR number{L} ORDER BY id DESC LIMIT 5', (like, like)):
            out.append({'g': 'Invoices & quotations', 'ic': 'file', 't': f"{r['number']} — {r['customer_name']}", 's': f"{r['date']} • {r['total']}", 'l': f"#/{'invoices' if r['kind'] == 'invoice' else 'quotes'}/{r['id']}"})
    return out
