"""System Center (Super Admin): backup & restore, security, system health, employee activity, analytics, audit search, settings."""
from __future__ import annotations
import os, platform, re, shutil, sqlite3, sys, threading, time
from datetime import datetime

from flask import request
from core import *
import core, pgsync

BACKUP_DIR = os.path.join(DATA, 'backups')
if not core.BACKUPS_IN_DB: os.makedirs(BACKUP_DIR, exist_ok=True)
FILE_RE = re.compile(r'^hic_(auto|manual|pre-restore)_\d{8}_\d{6}\.sqlite$')
DOC_KEYS = ['doc_prefix', 'doc_terms', 'doc_note', 'doc_paper', 'doc_show_logo']                       # public (printed on documents)
SEC_KEYS = {'sec_min_pw': (6, 64), 'sec_max_attempts': (3, 50), 'sec_lock_min': (1, 240), 'sec_idle_min': (5, 720)}
BK_KEYS = ['bk_auto', 'bk_keep']
LIVE_TABLES_SQL = "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE' AND table_name NOT IN ('backup_files') ORDER BY table_name"


# ------------------------------------------------------------------ backup engine
# The live data is in PostgreSQL; a backup is a complete snapshot written to a normal SQLite file (hic_*.sqlite), so it can be
# downloaded, verified, test-restored and restored exactly as before. It runs on its own pooled connection, so it also works
# from the background thread and never holds the request's transaction open.
# Where the files are kept: data/backups on a normal server; the backup_files table on serverless hosting (Vercel), whose disk is
# wiped between requests. The file content is identical either way.
def _tmp_path(name: str) -> str:
    os.makedirs(core.TMP, exist_ok=True); return os.path.join(core.TMP, name)

def _store_list() -> list:
    """[{file, size, mtime}] of every backup file in the store."""
    if core.BACKUPS_IN_DB: return [{'file': r['file'], 'size': int(r['size'] or 0), 'mtime': int(r['ts'] or 0)} for r in rows('SELECT file,size,ts FROM backup_files') if FILE_RE.match(r['file'])]
    return [{'file': f, 'size': os.path.getsize(os.path.join(BACKUP_DIR, f)), 'mtime': int(os.path.getmtime(os.path.join(BACKUP_DIR, f)))} for f in os.listdir(BACKUP_DIR) if FILE_RE.match(f)]

def _store_has(f: str) -> bool:
    if core.BACKUPS_IN_DB: return bool(val('SELECT 1 FROM backup_files WHERE file=?', (f,)))
    return os.path.isfile(os.path.join(BACKUP_DIR, f))

def _local(f: str) -> str:
    """A path to the backup file on this machine (on Vercel: a temporary copy taken from the database)."""
    if not core.BACKUPS_IN_DB: return os.path.join(BACKUP_DIR, f)
    data = val('SELECT data FROM backup_files WHERE file=?', (f,)); p = _tmp_path(f)
    with open(p, 'wb') as fh: fh.write(bytes(data or b''))
    return p

def _done(path: str) -> None:
    if core.BACKUPS_IN_DB:                                            # temporary copy only
        try: os.remove(path)
        except OSError: pass

def _store_drop(c, f: str) -> None:
    if core.BACKUPS_IN_DB: cq(c, 'DELETE FROM backup_files WHERE file=?', (f,)); return
    try: os.remove(os.path.join(BACKUP_DIR, f))
    except OSError: pass

def _check(path: str) -> tuple[bool, dict]:
    """Open a backup file read-only, run SQLite's integrity check and count the rows of every table."""
    try:
        c = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=10)
        try:
            ok = c.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            counts = {t[0]: c.execute(f'SELECT COUNT(*) FROM "{t[0]}"').fetchone()[0] for t in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()}
        finally: c.close()
        return ok and counts.get('users', 0) > 0 and 'settings' in counts, counts
    except Exception as e:
        return False, {'error': str(e)}

def make_backup(kind: str = 'manual', user_id: int | None = None, note: str = '') -> dict:
    name = f"hic_{kind}_{local_now().strftime('%Y%m%d_%H%M%S')}.sqlite"
    dest = _tmp_path(name) if core.BACKUPS_IN_DB else os.path.join(BACKUP_DIR, name)
    with core.pool().connection() as c:
        try:
            pgsync.pg_to_sqlite(c, dest)                       # consistent snapshot, safe while the system is in use
            ok, _ = _check(dest); size = os.path.getsize(dest)
            if core.BACKUPS_IN_DB:
                with open(dest, 'rb') as fh: data = fh.read()
                cq(c, 'INSERT INTO backup_files(file,size,ts,data) VALUES(?,?,?,?) ON CONFLICT(file) DO UPDATE SET size=excluded.size, ts=excluded.ts, data=excluded.data', (name, size, now(), data))
        finally:
            if core.BACKUPS_IN_DB and os.path.exists(dest): os.remove(dest)
        cq(c, 'INSERT INTO backups(file,kind,size,ts,user_id,note,verified_ts,verified_ok) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(file) DO UPDATE SET '
              'kind=excluded.kind, size=excluded.size, ts=excluded.ts, user_id=excluded.user_id, note=excluded.note, verified_ts=excluded.verified_ts, verified_ok=excluded.verified_ok',
           (name, kind, size, now(), user_id, note, now(), 1 if ok else 0))
        keep = max(3, I(_get(c, 'bk_keep', '14')))
        old = [r['file'] for r in cq(c, "SELECT file FROM backups WHERE kind='auto' ORDER BY ts DESC").fetchall()][keep:]
        for f in old:
            _store_drop(c, f); cq(c, 'DELETE FROM backups WHERE file=?', (f,))
    return {'file': name, 'size': size, 'ok': ok}

def _get(c, k, dflt=''):
    r = cq(c, 'SELECT v FROM settings WHERE k=?', (k,)).fetchone(); return dflt if r is None else str(r['v'])

def auto_backup_loop() -> None:
    """Background thread: one automatic backup roughly every 24 hours (when enabled), plus one shortly after start-up if none is recent."""
    time.sleep(20)
    while True:
        try:
            with core.pool().connection() as c:
                on = _get(c, 'bk_auto', 'on') != 'off'; last = cq(c, "SELECT MAX(ts) t FROM backups WHERE kind='auto'").fetchone()['t'] or 0
            if on and now() - int(last) >= 24 * 3600: make_backup('auto', None, 'Scheduled automatic backup')
        except Exception as e: core.ERRLOG.append({'ts': now(), 'where': 'auto-backup', 'msg': str(e)})
        time.sleep(1800)

def auto_backup_if_due() -> None:
    """Serverless hosting has no background thread: the heartbeat calls this (at most once a minute) instead."""
    if setting('bk_auto', 'on') == 'off': return
    if now() - int(val("SELECT MAX(ts) FROM backups WHERE kind='auto'") or 0) >= 24 * 3600: make_backup('auto', None, 'Scheduled automatic backup')

def db_size() -> int: return int(val('SELECT pg_database_size(current_database())') or 0)


def act_backup_list(inp):
    admin(); out = []
    known = {r['file']: r for r in rows('SELECT b.*,u.name by_name FROM backups b LEFT JOIN users u ON u.id=b.user_id')}
    for x in _store_list():
        f = x['file']; m = known.get(f, {})
        out.append({'file': f, 'kind': m.get('kind') or f.split('_')[1], 'size': x['size'], 'ts': m.get('ts') or x['mtime'], 'by': m.get('by_name') or ('System' if f.startswith('hic_auto') else ''),
                    'note': m.get('note') or '', 'verified_ts': m.get('verified_ts'), 'verified_ok': m.get('verified_ok')})
    out.sort(key=lambda x: -x['ts'])
    return {'items': out, 'dir': 'PostgreSQL database (backup_files table)' if core.BACKUPS_IN_DB else BACKUP_DIR, 'auto': setting('bk_auto', 'on') != 'off', 'keep': I(setting('bk_keep', '14')) or 14, 'db_size': db_size()}

def act_backup_create(inp):
    u = admin(); note = s(inp.get('note'), 120)
    r = make_backup('manual', int(u['id']), note)                    # its own connection: the snapshot and its log row are committed at once
    audit('backup', 'system', None, r['file'])
    if not r['ok']: raise ApiError('The backup was created but failed verification. Please try again.')
    return r

def _pick(inp) -> str:
    f = str(inp.get('file') or '')
    if not FILE_RE.match(f) or not _store_has(f): raise ApiError('Backup file not found.', 404)
    return f

def act_backup_delete(inp):
    admin(); f = _pick(inp); _store_drop(db(), f); q('DELETE FROM backups WHERE file=?', (f,)); audit('delete', 'backup', None, f)
    return []

def act_backup_verify(inp):
    """Backup verification: integrity check + row counts compared with the live database."""
    admin(); f = _pick(inp); p = _local(f)
    try: ok, counts = _check(p)
    finally: _done(p)
    live = {t['name']: val(f'SELECT COUNT(*) FROM "{t["name"]}"') for t in rows(LIVE_TABLES_SQL)}
    q('UPDATE backups SET verified_ts=?, verified_ok=? WHERE file=?', (now(), 1 if ok else 0, f))
    audit('verify', 'backup', None, f)
    return {'ok': ok, 'tables': [{'table': t, 'backup': counts.get(t), 'live': live.get(t)} for t in sorted(live) if t not in ('sessions', 'login_attempts')], 'error': counts.get('error')}

def act_recovery_test(inp):
    """Restore test: restores the backup into a temporary copy (the live data is never touched) and proves it opens, passes checks and holds the essential data."""
    admin(); f = _pick(inp); tmp = _tmp_path(f'_restore_test_{now()}.tmp'); steps = []; src = None
    try:
        src = _local(f); shutil.copyfile(src, tmp); steps.append(('Copy backup to a temporary restore area', True))
        ok, counts = _check(tmp); steps.append(('SQLite integrity check', ok))
        c = sqlite3.connect(tmp)
        try:
            adm = c.execute("SELECT COUNT(*) FROM users WHERE is_admin=1 AND status='active'").fetchone()[0]; steps.append(('Super Admin account present', adm > 0))
            steps.append(('Company settings present', c.execute("SELECT COUNT(*) FROM settings WHERE k='company_name'").fetchone()[0] > 0))
            steps.append(('Customers table readable', c.execute('SELECT COUNT(*) FROM customers').fetchone()[0] >= 0))
            steps.append(('Repairs table readable', c.execute('SELECT COUNT(*) FROM repairs').fetchone()[0] >= 0))
            has = lambda t: c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (t,)).fetchone()[0] > 0
            new_acc = has('sdocs')
            steps.append(('Sales & payments readable', c.execute('SELECT COUNT(*) FROM ' + ('sdocs' if new_acc else 'sales')).fetchone()[0] >= 0 and c.execute('SELECT COUNT(*) FROM repair_payments').fetchone()[0] >= 0))
            steps.append(('Inventory ledger readable', c.execute('SELECT COUNT(*) FROM ' + ('stock_moves' if new_acc else 'inv_tx')).fetchone()[0] >= 0))
            steps.append(('Current accounting format (can be restored)', new_acc))
        finally: c.close()
    except Exception as e: steps.append((f'Error: {e}', False))
    finally:
        try: os.remove(tmp)
        except OSError: pass
        if src: _done(src)
    good = all(x[1] for x in steps); q('UPDATE backups SET verified_ts=?, verified_ok=? WHERE file=?', (now(), 1 if good else 0, f)); audit('restore_test', 'backup', None, f)
    return {'ok': good, 'steps': [{'step': a, 'ok': b} for a, b in steps]}

def act_backup_restore(inp):
    """Replace the live data with a chosen backup. A safety backup of the current data is taken first.
    The whole restore runs inside this request's transaction: if anything fails, nothing changes."""
    u = admin(); f = _pick(inp)
    if str(inp.get('confirm') or '') != 'RESTORE': raise ApiError('Type RESTORE to confirm.')
    path = _local(f)
    try:
        ok, counts = _check(path)
        if not ok: raise ApiError('This backup failed verification and cannot be restored.')
        if 'sdocs' not in counts: raise ApiError('This backup was made before the accounting rebuild and cannot be restored into the PostgreSQL database.')
        sess = row('SELECT * FROM sessions WHERE id=?', (request.cookies.get('HICSESS', ''),))
        safety = make_backup('pre-restore', int(u['id']), f'Automatic safety copy before restoring {f}')
        pgsync.sqlite_to_pg(path, db())
    finally: _done(path)
    setup(fresh_seed=False)                                            # bring an older backup up to the current structure
    if sess and val('SELECT 1 FROM users WHERE id=? AND is_admin=1', (sess['uid'],)):     # keep the admin signed in
        q('INSERT INTO sessions(id,kind,uid,remember,created,last,ip,ua) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, uid=excluded.uid, remember=excluded.remember, created=excluded.created, last=excluded.last, ip=excluded.ip, ua=excluded.ua',
          (sess['id'], sess['kind'], sess['uid'], sess['remember'], sess['created'], now(), sess.get('ip'), sess.get('ua')))
    audit('restore', 'system', None, f'{f} (safety copy: {safety["file"]})')
    return {'restored': f, 'safety': safety['file']}

def act_backup_settings(inp):
    admin()
    set_setting('bk_auto', 'off' if inp.get('auto') in (False, 'off', 0, '0') else 'on')
    set_setting('bk_keep', str(min(90, max(3, I(inp.get('keep')) or 14)))); audit('update', 'settings', None, 'backup')
    return {}

def download_backup(name: str):
    """Flask route helper: stream a backup file to a signed-in Super Admin."""
    import io
    from flask import abort, send_file, send_from_directory
    u = me(False)
    if not u or not u['is_admin'] or not FILE_RE.match(name or '') or not _store_has(name): abort(404)
    audit('export', 'backup', None, name)
    if core.BACKUPS_IN_DB:
        return send_file(io.BytesIO(bytes(val('SELECT data FROM backup_files WHERE file=?', (name,)))), mimetype='application/octet-stream', as_attachment=True, download_name=name)
    return send_from_directory(BACKUP_DIR, name, as_attachment=True)


# ------------------------------------------------------------------ Security & Permission Center
def act_sec_overview(inp):
    admin(); t = now(); cur = request.cookies.get('HICSESS', '')
    sessions = []
    for x in rows("SELECT s.*,COALESCE(u.name,p.name) AS name,COALESCE(u.email,p.phone) AS who FROM sessions s LEFT JOIN users u ON s.kind='staff' AND u.id=s.uid LEFT JOIN portal_accounts p ON s.kind='portal' AND p.id=s.uid ORDER BY s.last DESC NULLS LAST LIMIT 200"):
        sessions.append({'id': x['id'][:10], 'kind': x['kind'], 'uid': x['uid'], 'name': x['name'] or '—', 'who': x['who'] or '', 'ip': x.get('ip') or '', 'ua': x.get('ua') or '', 'created': x['created'], 'last': x['last'], 'remember': bool(x['remember']), 'current': x['id'] == cur})
    fails = rows('SELECT k,COUNT(*) AS n,MAX(ts) AS last FROM login_attempts WHERE ts>? GROUP BY k ORDER BY n DESC,last DESC LIMIT 25', (t - 86400,))
    lock_min = max(1, I(setting('sec_lock_min', '10'))); max_try = max(3, I(setting('sec_max_attempts', '8')))
    for f in fails: f['locked'] = int(val('SELECT COUNT(*) FROM login_attempts WHERE k=? AND ts>?', (f['k'], t - lock_min * 60)) or 0) >= max_try
    logins = rows("SELECT a.action,a.ts,a.ip,u.name,u.email FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.action IN ('login','logout') ORDER BY a.id DESC LIMIT 40")
    users = [public_user(u) for u in rows('SELECT * FROM users ORDER BY is_owner DESC,is_admin DESC,name')]
    return {'sessions': sessions, 'fails': fails, 'fails24': int(val('SELECT COUNT(*) FROM login_attempts WHERE ts>?', (t - 86400,)) or 0), 'logins': logins, 'users': users,
            'settings': {'min_pw': pw_min(), 'max_attempts': max_try, 'lock_min': lock_min, 'idle_min': max(5, I(setting('sec_idle_min', '30')))},
            'default_password': bool(val("SELECT 1 FROM users WHERE is_admin=1 AND status='active'") and any(verify_pw('Admin@123', u['password']) for u in rows('SELECT password FROM users WHERE is_admin=1')))}

def act_sec_kill(inp):
    me_ = admin(); uid = I(inp.get('uid')); sid = str(inp.get('sid') or ''); kind = 'portal' if inp.get('kind') == 'portal' else 'staff'
    if sid:
        r = row('SELECT * FROM sessions WHERE id LIKE ?', (sid + '%',))
        if not r: raise ApiError('Session not found.', 404)
        if r['id'] == request.cookies.get('HICSESS', ''): raise ApiError('That is your current session — use Logout.')
        uid, kind = int(r['uid']), r['kind']
        if kind == 'staff' and not me_.get('is_owner') and val('SELECT is_owner FROM users WHERE id=?', (uid,)): raise ApiError('Only the System Owner can end the System Owner\'s sessions.', 403)
        q('DELETE FROM sessions WHERE id=?', (r['id'],))
    elif uid:
        if uid == int(me_['id']) and kind == 'staff': raise ApiError('Use Logout to end your own session.')
        if kind == 'staff' and not me_.get('is_owner') and val('SELECT is_owner FROM users WHERE id=?', (uid,)): raise ApiError('Only the System Owner can end the System Owner\'s sessions.', 403)
        q('DELETE FROM sessions WHERE uid=? AND kind=?', (uid, kind))
    else: raise ApiError('Nothing selected.')
    if kind == 'staff' and not val("SELECT 1 FROM sessions WHERE uid=? AND kind='staff'", (uid,)): q('UPDATE users SET logged_in=0 WHERE id=?', (uid,))
    audit('force_logout', 'user' if kind == 'staff' else 'portal_account', uid)
    return []

def act_sec_unlock(inp):
    admin(); k = str(inp.get('k') or ''); q('DELETE FROM login_attempts WHERE k=?', (k,)); audit('unlock', 'security', None, k)
    return []

def act_sec_settings_save(inp):
    admin()
    for k, (lo, hi) in SEC_KEYS.items():
        if inp.get(k) is not None: set_setting(k, str(min(hi, max(lo, I(inp[k])))))
    audit('update', 'settings', None, 'security')
    return {}


# ------------------------------------------------------------------ System Health Monitor
def act_health(inp):
    admin(); checks = []
    def add(name, status, detail): checks.append({'name': name, 'status': status, 'detail': detail})
    try:
        t0 = time.time(); ver = str(val("SELECT current_setting('server_version')")); ms = (time.time() - t0) * 1000
        add('Database connection', 'ok' if ms < 500 else 'warn', f'PostgreSQL {ver} reachable — {ms:.0f} ms per query')
    except Exception as e: add('Database connection', 'crit', str(e))
    tables = [(t['name'], int(val(f'SELECT COUNT(*) FROM "{t["name"]}"'))) for t in rows(LIVE_TABLES_SQL)]
    dbsize = db_size()
    add('Database size', 'ok' if dbsize < 2e9 else 'warn', f'{dbsize / 1e6:.1f} MB')
    try:
        du = shutil.disk_usage(DATA); free = du.free
        add('Disk space', 'ok' if free > 5e9 else 'warn' if free > 1e9 else 'crit', f'{free / 1e9:.1f} GB free of {du.total / 1e9:.0f} GB')
    except Exception as e: add('Disk space', 'warn', str(e)); du = None
    bks = _store_list(); last = core.last_backup_ts() or None; bsize = sum(x['size'] for x in bks)
    age = (now() - int(last)) / 3600 if last else None
    add('Backups', 'crit' if age is None else 'ok' if age < 30 else 'warn' if age < 72 else 'crit', 'No backup yet' if age is None else f'{len(bks)} file(s), {bsize / 1e6:.1f} MB — last {age:.0f} h ago')
    bad = int(val('SELECT COUNT(*) FROM backups WHERE verified_ok=0') or 0)
    add('Backup verification', 'ok' if not bad else 'warn', 'All checked backups are valid' if not bad else f'{bad} backup(s) failed verification')
    recent_err = [e for e in core.ERRLOG if now() - e['ts'] < 3600]
    add('Server errors (last hour)', 'ok' if not recent_err else 'warn' if len(recent_err) < 5 else 'crit', f'{len(recent_err)} error(s)')
    ks = core.appkey_source()
    add('Encryption key', 'ok' if ks != 'missing' else 'crit', f'{ks} found' if ks != 'missing' else 'app.key MISSING — Apple ID passwords cannot be decrypted')
    n_staff = int(val("SELECT COUNT(*) FROM sessions WHERE kind='staff'") or 0); n_portal = int(val("SELECT COUNT(*) FROM sessions WHERE kind='portal'") or 0)
    add('Sessions', 'ok', f'{n_staff} staff / {n_portal} customer session(s)')
    up = time.time() - core.STATS['start']
    return {'checks': checks, 'overall': 'crit' if any(c['status'] == 'crit' for c in checks) else 'warn' if any(c['status'] == 'warn' for c in checks) else 'ok',
            'server': {'uptime': int(up), 'requests': core.STATS['req'], 'errors': core.STATS['err'], 'python': sys.version.split()[0], 'os': platform.platform(), 'threads': threading.active_count(), 'time': now(), 'db_file': core.db_label()},
            'tables': tables, 'errors': list(core.ERRLOG)[-15:][::-1], 'disk': {'free': du.free, 'total': du.total} if du else None}


# ------------------------------------------------------------------ Employee Activity Center
def _range(inp):
    to = d(inp.get('to')) or today(); frm = d(inp.get('from')) or (datetime.strptime(to, '%Y-%m-%d').replace(day=1)).strftime('%Y-%m-%d')
    return frm, to, date_ts(frm), date_ts(to) + 86399

def act_employees(inp):
    admin(); frm, to, a, b = _range(inp); out = []
    for u in rows("SELECT * FROM users WHERE status='active' ORDER BY is_admin DESC,name"):
        i = int(u['id'])
        def one(sql, *p): return val(sql, (i, *p)) or 0
        rep = one('SELECT COUNT(*) FROM repairs WHERE technician_id=? AND received_at BETWEEN ? AND ?', a, b)
        rep_done = one("SELECT COUNT(*) FROM repairs WHERE technician_id=? AND status IN ('completed','ready','took_completed') AND COALESCE(updated_at,0) BETWEEN ? AND ?", a, b)
        hrs = val("SELECT AVG(closed_at-received_at)/3600.0 FROM repairs WHERE technician_id=? AND closed_at IS NOT NULL AND status IN ('completed','took_completed') AND closed_at BETWEEN ? AND ?", (i, a, b))
        soft = one('SELECT COUNT(*) FROM soft_jobs WHERE technician_id=? AND received_at BETWEEN ? AND ?', a, b)
        soft_done = one("SELECT COUNT(*) FROM soft_jobs WHERE technician_id=? AND status IN ('completed','verified','took','instore','customer_received') AND COALESCE(updated_at,0) BETWEEN ? AND ?", a, b)
        sales_n = one("SELECT COUNT(*) FROM sdocs WHERE user_id=? AND kind IN ('invoice','receipt') AND status<>'void' AND date BETWEEN ? AND ?", frm, to); sales_v = one("SELECT SUM(total) FROM sdocs WHERE user_id=? AND kind IN ('invoice','receipt') AND status<>'void' AND date BETWEEN ? AND ?", frm, to)
        cust = one('SELECT COUNT(*) FROM customers WHERE created_by=? AND created_at BETWEEN ? AND ?', a, b)
        acts = one("SELECT COUNT(*) FROM activity WHERE user_id=? AND action NOT IN ('login','logout') AND ts BETWEEN ? AND ?", a, b)
        logins = one("SELECT COUNT(*) FROM activity WHERE user_id=? AND action='login' AND ts BETWEEN ? AND ?", a, b)
        days = one("SELECT COUNT(DISTINCT hic_day(ts)) FROM activity WHERE user_id=? AND action NOT IN ('login','logout') AND ts BETWEEN ? AND ?", a, b)
        out.append({'id': i, 'name': u['name'], 'position': u['position'], 'is_admin': bool(u['is_admin']), 'online': bool(public_user(u)['online']), 'last_seen': int(u['last_seen'] or 0), 'repairs': rep, 'repairs_done': rep_done, 'avg_hours': round(float(hrs), 1) if hrs else None,
                    'soft': soft, 'soft_done': soft_done, 'sales': sales_n, 'sales_value': rnd(float(sales_v or 0)), 'customers': cust, 'actions': acts, 'logins': logins, 'active_days': days,
                    'score': rep_done * 3 + soft_done * 3 + sales_n * 2 + cust + acts // 10})
    return {'from': frm, 'to': to, 'items': out}


# ------------------------------------------------------------------ Management Analytics
def act_analytics(inp):
    admin(); months = min(24, max(3, I(inp.get('months')) or 12)); td = local_now(); labels, keys = [], []
    for k in range(months - 1, -1, -1):
        m = add_months(td.replace(day=1), -k); keys.append(m.strftime('%Y-%m')); labels.append(m.strftime('%b %y'))
    frm = keys[0] + '-01'; md = money_by_day(frm, today()); inc, cost, exp = {k: 0.0 for k in keys}, {k: 0.0 for k in keys}, {k: 0.0 for k in keys}
    for dday, v in md.items():
        mk = dday[:7]
        if mk in inc: inc[mk] += v['income']; cost[mk] += v['cost']; exp[mk] += v['expense']
    def per_month(sql, *p):
        got = {r['m']: r['n'] for r in rows(sql, p)}; return [int(got.get(k, 0)) for k in keys]
    a = date_ts(frm)
    repairs = per_month("SELECT to_char(hic_ts(received_at),'YYYY-MM') m,COUNT(*) n FROM repairs WHERE received_at>=? GROUP BY 1", a)
    soft = per_month("SELECT to_char(hic_ts(received_at),'YYYY-MM') m,COUNT(*) n FROM soft_jobs WHERE received_at>=? GROUP BY 1", a)
    newc = per_month("SELECT to_char(hic_ts(created_at),'YYYY-MM') m,COUNT(*) n FROM customers WHERE created_at>=? GROUP BY 1", a)
    profit = [rnd(inc[k] - cost[k] - exp[k]) for k in keys]
    this, prev = inc[keys[-1]], inc[keys[-2]] if len(keys) > 1 else 0
    top_dev = rows('SELECT MIN(device) label,COUNT(*) v FROM repairs WHERE received_at>=? GROUP BY LOWER(device) ORDER BY v DESC, LOWER(device) LIMIT 8', (a,))
    by_status = rows('SELECT status label,COUNT(*) v FROM repairs WHERE received_at>=? GROUP BY status ORDER BY v DESC, status', (a,))
    wd = [0] * 7
    for r in rows("SELECT CAST(EXTRACT(DOW FROM hic_ts(received_at)) AS INTEGER) w,COUNT(*) n FROM repairs WHERE received_at>=? GROUP BY 1", (a,)):
        if r['w'] is not None: wd[int(r['w'])] = int(r['n'])
    top_cust = rows("""SELECT c.name label, ROUND(CAST(COALESCE((SELECT SUM(total) FROM sdocs s WHERE s.customer_id=c.id AND s.kind IN ('invoice','receipt') AND s.status<>'void' AND s.date>=?),0)
        +COALESCE((SELECT SUM(p.amount) FROM repair_payments p JOIN repairs r ON r.id=p.repair_id WHERE r.customer_id=c.id AND p.date>=?),0)
        +COALESCE((SELECT SUM(p.amount) FROM soft_payments p JOIN soft_jobs j ON j.id=p.job_id WHERE j.customer_id=c.id AND p.date>=?),0) AS NUMERIC),2) v
        FROM customers c ORDER BY v DESC LIMIT 8""", (frm, frm, frm))
    svc = rows("SELECT kind label,COUNT(*) v FROM soft_jobs WHERE received_at>=? GROUP BY kind ORDER BY kind", (a,))
    turn = val("SELECT AVG(closed_at-received_at)/3600.0 FROM repairs WHERE closed_at IS NOT NULL AND status IN ('completed','took_completed') AND received_at>=?", (a,))
    fb = finance_breakdown(frm, today())
    prod = fb['product_sales']; srv = fb['service_sales'] \
        + float(val('SELECT COALESCE(SUM(amount),0) FROM repair_payments WHERE date>=?', (frm,)) or 0) + float(val('SELECT COALESCE(SUM(amount),0) FROM soft_payments WHERE date>=?', (frm,)) or 0)
    return {'labels': labels, 'income': [rnd(inc[k]) for k in keys], 'expense': [rnd(exp[k]) for k in keys], 'profit': profit, 'repairs': repairs, 'soft': soft, 'new_customers': newc,
            'kpi': {'revenue_month': rnd(this), 'revenue_prev': rnd(prev), 'growth': (round((this - prev) / prev * 100, 1) if prev else None), 'profit_month': profit[-1], 'repairs_month': repairs[-1], 'avg_turnaround_h': round(float(turn), 1) if turn else None,
                    'total_customers': int(val('SELECT COUNT(*) FROM customers') or 0), 'open_repairs': int(val(f'SELECT COUNT(*) FROM repairs WHERE status IN {core.REPAIR_OPEN}') or 0)},
            'top_devices': top_dev, 'repair_status': by_status, 'weekday': wd, 'top_customers': [c for c in top_cust if c['v'] > 0], 'soft_kinds': svc, 'revenue_mix': {'products': rnd(prod), 'services': rnd(srv)}}


# ------------------------------------------------------------------ Advanced Audit Log
def act_audit_search(inp):
    admin(); w, p = ['1=1'], []
    if I(inp.get('user_id')): w.append('a.user_id=?'); p.append(I(inp['user_id']))
    if inp.get('action'): w.append('a.action=?'); p.append(s(inp['action'], 30))
    if inp.get('entity'): w.append('a.entity=?'); p.append(s(inp['entity'], 40))
    if d(inp.get('from')): w.append('a.ts>=?'); p.append(date_ts(d(inp['from'])))
    if d(inp.get('to')): w.append('a.ts<=?'); p.append(date_ts(d(inp['to'])) + 86399)
    t = s(inp.get('q'), 80)
    if t: w.append("(a.detail ILIKE ? OR a.entity ILIKE ? OR u.name ILIKE ? OR a.ip ILIKE ? OR CAST(a.entity_id AS TEXT)=?)"); p += [f'%{t}%', f'%{t}%', f'%{t}%', f'%{t}%', t]
    where = ' AND '.join(w); limit = min(5000, max(10, I(inp.get('limit')) or 100)); off = max(0, I(inp.get('offset')))
    total = int(val(f'SELECT COUNT(*) FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE {where}', p) or 0)
    items = rows(f'SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.ts,a.ip,u.name AS "user",a.user_id FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE {where} ORDER BY a.id DESC LIMIT ? OFFSET ?', (*p, limit, off))
    return {'items': items, 'total': total, 'users': rows('SELECT id,name FROM users ORDER BY name'), 'actions': [r['action'] for r in rows('SELECT DISTINCT action FROM activity ORDER BY action')], 'entities': [r['entity'] for r in rows('SELECT DISTINCT entity FROM activity ORDER BY entity')]}


# ------------------------------------------------------------------ System Settings Center
def act_center_settings_get(inp):
    admin()
    return {'doc': {k: setting(k, '') for k in DOC_KEYS}, 'sec': {k: setting(k, '') for k in SEC_KEYS}, 'bk': {'auto': setting('bk_auto', 'on') != 'off', 'keep': I(setting('bk_keep', '14')) or 14}}

def act_doc_settings_save(inp):
    admin()
    for k in DOC_KEYS:
        if inp.get(k) is not None: set_setting(k, s(inp[k], 600 if k in ('doc_terms', 'doc_note') else 20))
    if s(inp.get('doc_paper'), 10) not in ('', 'A4', 'thermal'): set_setting('doc_paper', 'A4')
    audit('update', 'settings', None, 'documents')
    from h_auth import all_settings
    return all_settings()
