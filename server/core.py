"""HARGEISA IPHONE CENTER — core: database, sessions, security helpers, scheduled checks.
Python port of the former PHP backend. The SQLite file, the encryption key and every JSON API shape are unchanged."""
from __future__ import annotations

import base64, calendar, json, math, os, re, secrets, sqlite3, time
from datetime import datetime, timedelta, timezone

import bcrypt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import g, request, has_request_context
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
os.makedirs(DATA, exist_ok=True)
DB_FILE = os.environ.get('HIC_DB', os.path.join(DATA, 'hic.sqlite'))
TZ = timezone(timedelta(hours=3))            # Africa/Mogadishu (no daylight saving)


class ApiError(Exception):
    def __init__(self, message, code=400, extra=None):
        super().__init__(message)
        self.message, self.code, self.extra = message, code, extra or {}


# ------------------------------------------------------------------ small helpers (PHP-compatible semantics)
def now() -> int: return int(time.time())
def local_now() -> datetime: return datetime.now(TZ)
def today() -> str: return local_now().strftime('%Y-%m-%d')
def fdate(ts: int, fmt: str) -> str: return datetime.fromtimestamp(ts, TZ).strftime(fmt)
def add_days(days: int, base: datetime | None = None) -> datetime: return (base or local_now()) + timedelta(days=days)
def add_months(dt: datetime, months: int) -> datetime:
    m = dt.month - 1 + months; y = dt.year + m // 12; m = m % 12 + 1
    return dt.replace(year=y, month=m, day=min(dt.day, calendar.monthrange(y, m)[1]))
def date_ts(d: str) -> int: return int(datetime.strptime(d, '%Y-%m-%d').replace(tzinfo=TZ).timestamp())


def I(v) -> int:
    """PHP (int) cast."""
    if v is None or isinstance(v, (list, dict)): return 0
    if isinstance(v, bool): return int(v)
    if isinstance(v, (int, float)): return int(v) if math.isfinite(v) else 0
    m = re.match(r'\s*[-+]?\d+', str(v)); return int(m.group()) if m else 0

def empty(v) -> bool:
    return v is None or v is False or v == 0 or v == '' or v == '0' or v == [] or v == {}

def s(v, mx: int = 500) -> str:
    return ('' if v is None else str(v)).strip()[:mx]

def n(v) -> float:
    if isinstance(v, bool) or v is None: return 0.0
    if isinstance(v, (int, float)): return float(v) if math.isfinite(v) else 0.0
    try:
        f = float(str(v).strip()); return f if math.isfinite(f) else 0.0
    except ValueError: return 0.0

def rnd(x: float, nd: int = 2) -> float:
    k = 10 ** nd; return math.copysign(math.floor(abs(x) * k + 0.5) / k, x) if x else 0.0

def d(v) -> str | None:
    v = ('' if v is None else str(v)).strip()
    return v if re.fullmatch(r'\d{4}-\d{2}-\d{2}', v) else None

def phone_key(p: str) -> str:
    """Canonical phone identity: last 9 digits, so +252 63 4444444 / 0063 4444444 / 63 4444444 are the same customer."""
    dg = re.sub(r'\D+', '', p or ''); return dg[-9:] if len(dg) > 9 else dg

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$")
def valid_email(e: str) -> bool: return bool(EMAIL_RE.match(e or '')) and '..' not in e

def unique(seq): return list(dict.fromkeys(seq))


# ------------------------------------------------------------------ database
def db() -> sqlite3.Connection:
    if 'db' not in g:
        c = sqlite3.connect(DB_FILE, timeout=8, isolation_level=None, check_same_thread=False)
        c.row_factory = lambda cur, r: {col[0]: r[i] for i, col in enumerate(cur.description)}
        c.execute('PRAGMA journal_mode=WAL'); c.execute('PRAGMA busy_timeout=8000')
        g.db = c
    return g.db

def q(sql: str, p=()): return db().execute(sql, tuple(p))
def rows(sql: str, p=()): return q(sql, p).fetchall()
def row(sql: str, p=()): return q(sql, p).fetchone()
def val(sql: str, p=()):
    r = q(sql, p).fetchone()
    return None if r is None else next(iter(r.values()))
def ins(table: str, dct: dict) -> int:
    cols = list(dct)
    return q(f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))})", [dct[c] for c in cols]).lastrowid
def upd(table: str, id_: int, dct: dict) -> None:
    if dct: q(f"UPDATE {table} SET {','.join(c + '=?' for c in dct)} WHERE id=?", [*dct.values(), id_])


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL, position TEXT NOT NULL DEFAULT 'Technician', is_admin INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', avatar TEXT, perms TEXT DEFAULT '{}', logged_in INTEGER DEFAULT 0, last_seen INTEGER DEFAULT 0, session_start INTEGER DEFAULT 0, created_at INTEGER, approved_by INTEGER);
CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER, detail TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS ix_act_ts ON activity(ts);
CREATE INDEX IF NOT EXISTS ix_act_user ON activity(user_id);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, message TEXT, link TEXT, is_read INTEGER DEFAULT 0, ts INTEGER, ref TEXT);
CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read);
CREATE TABLE IF NOT EXISTS customers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, phone_key TEXT NOT NULL UNIQUE, email TEXT, gender TEXT, address TEXT, notes TEXT, created_by INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS followups(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, type TEXT, note TEXT, due_date TEXT, done INTEGER DEFAULT 0, ref_kind TEXT, ref_id INTEGER, created_by INTEGER, created_at INTEGER, done_at INTEGER);
CREATE TABLE IF NOT EXISTS repairs(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, device TEXT, imei TEXT, problem TEXT, diagnosis TEXT, diagnosis_notes TEXT, required_parts TEXT, technician_id INTEGER, status TEXT DEFAULT 'received', progress_notes TEXT, test_result TEXT, outcome TEXT, received_at INTEGER, expected_date TEXT, price REAL DEFAULT 0, discount REAL DEFAULT 0, created_by INTEGER, updated_at INTEGER, closed_at INTEGER);
CREATE TABLE IF NOT EXISTS repair_events(id INTEGER PRIMARY KEY AUTOINCREMENT, repair_id INTEGER, status TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS repair_parts(id INTEGER PRIMARY KEY AUTOINCREMENT, repair_id INTEGER, product_id INTEGER, lot_id INTEGER, store_id INTEGER, qty INTEGER, unit_cost REAL, unit_price REAL, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS repair_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, repair_id INTEGER, amount REAL, method TEXT, date TEXT, user_id INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS appleids(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT, phone TEXT, model TEXT, apple_id TEXT, pw_enc TEXT, description TEXT, date TEXT, created_by INTEGER, hidden INTEGER DEFAULT 0, status TEXT DEFAULT 'request', request_date TEXT, expected_date TEXT, assigned_to INTEGER, notes TEXT, last_notified TEXT, updated_at INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS regional(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT, phone TEXT, device TEXT, problem TEXT, region TEXT, sent_to TEXT, date_sent TEXT, technician TEXT, parts TEXT, cost REAL DEFAULT 0, status TEXT DEFAULT 'received', expected_return TEXT, actual_return TEXT, notes TEXT, created_by INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS portal_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, name TEXT, phone TEXT, email TEXT UNIQUE COLLATE NOCASE, password TEXT, status TEXT DEFAULT 'pending', created_at INTEGER, last_login INTEGER, approved_by INTEGER);
CREATE TABLE IF NOT EXISTS login_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS soft_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, customer_id INTEGER NOT NULL, device TEXT, imei TEXT, problem TEXT, diagnosis TEXT, apple_id TEXT, lock_info TEXT, technician_id INTEGER, status TEXT, progress_notes TEXT, test_result TEXT, notes TEXT, tools TEXT, request_date TEXT, expected_date TEXT, account_date TEXT, price REAL DEFAULT 0, discount REAL DEFAULT 0, created_by INTEGER, received_at INTEGER, updated_at INTEGER, closed_at INTEGER, last_notified TEXT);
CREATE INDEX IF NOT EXISTS ix_soft_cust ON soft_jobs(customer_id);
CREATE TABLE IF NOT EXISTS soft_events(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, status TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS soft_parts(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, product_id INTEGER, lot_id INTEGER, store_id INTEGER, qty INTEGER, unit_cost REAL, unit_price REAL, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS soft_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, amount REAL, method TEXT, date TEXT, user_id INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, kind TEXT NOT NULL, uid INTEGER NOT NULL, remember INTEGER DEFAULT 0, created INTEGER, last INTEGER);
CREATE TABLE IF NOT EXISTS cust_msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, type TEXT, message TEXT, ref TEXT, is_read INTEGER DEFAULT 0, ts INTEGER);
CREATE INDEX IF NOT EXISTS ix_cmsg ON cust_msgs(customer_id, is_read);
CREATE TABLE IF NOT EXISTS chat_convs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT, dkey TEXT UNIQUE, created_by INTEGER, created_at INTEGER);
CREATE TABLE IF NOT EXISTS chat_members(conv_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT DEFAULT 'member', joined_at INTEGER, last_read_id INTEGER DEFAULT 0, PRIMARY KEY(conv_id,user_id));
CREATE INDEX IF NOT EXISTS ix_cm_user ON chat_members(user_id);
CREATE TABLE IF NOT EXISTS chat_msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT, reply_to INTEGER, att_kind TEXT, att_name TEXT, att_file TEXT, att_size INTEGER, ts INTEGER, deleted INTEGER DEFAULT 0, deleted_by INTEGER, deleted_ts INTEGER);
CREATE INDEX IF NOT EXISTS ix_msg_conv ON chat_msgs(conv_id,id);
CREATE TABLE IF NOT EXISTS backups(file TEXT PRIMARY KEY, kind TEXT, size INTEGER, ts INTEGER, user_id INTEGER, note TEXT, verified_ts INTEGER, verified_ok INTEGER);
CREATE TABLE IF NOT EXISTS items(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'inventory', sku TEXT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, category TEXT, unit TEXT DEFAULT 'pcs', sale_price REAL DEFAULT 0, cost REAL DEFAULT 0, qty REAL DEFAULT 0, reorder INTEGER DEFAULT 0, vendor_id INTEGER, description TEXT, active INTEGER DEFAULT 1, created_by INTEGER, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS stock_moves(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, date TEXT NOT NULL, ts INTEGER, qty REAL NOT NULL, unit_cost REAL, kind TEXT NOT NULL, ref_kind TEXT, ref_id INTEGER, user_id INTEGER, note TEXT, customer_id INTEGER, vendor_id INTEGER);
CREATE INDEX IF NOT EXISTS ix_mv_item ON stock_moves(item_id, date);
CREATE INDEX IF NOT EXISTS ix_mv_ref ON stock_moves(ref_kind, ref_id);
CREATE TABLE IF NOT EXISTS vendors(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, contact TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE IF NOT EXISTS bills(id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, vendor_id INTEGER NOT NULL, date TEXT NOT NULL, due_date TEXT, ref TEXT, status TEXT DEFAULT 'open', total REAL DEFAULT 0, paid REAL DEFAULT 0, notes TEXT, user_id INTEGER, ts INTEGER, updated_at INTEGER, void_reason TEXT, voided_at INTEGER, voided_by INTEGER);
CREATE TABLE IF NOT EXISTS bill_lines(id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER NOT NULL, item_id INTEGER, description TEXT, qty REAL, cost REAL, amount REAL);
CREATE TABLE IF NOT EXISTS vendor_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER, vendor_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL, method TEXT, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS sdocs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, number TEXT UNIQUE, status TEXT, customer_id INTEGER, customer_name TEXT, phone TEXT, date TEXT NOT NULL, due_date TEXT, terms TEXT, notes TEXT, subtotal REAL DEFAULT 0, discount REAL DEFAULT 0, tax_rate REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0, paid REAL DEFAULT 0, cost REAL DEFAULT 0, quote_id INTEGER, invoice_id INTEGER, user_id INTEGER, created_at INTEGER, updated_at INTEGER, void_reason TEXT, voided_at INTEGER, voided_by INTEGER);
CREATE INDEX IF NOT EXISTS ix_sdoc_cust ON sdocs(customer_id);
CREATE INDEX IF NOT EXISTS ix_sdoc_date ON sdocs(kind, date);
CREATE TABLE IF NOT EXISTS sdoc_lines(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, item_id INTEGER, kind TEXT, description TEXT, qty REAL, rate REAL, amount REAL, unit_cost REAL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ix_sline_doc ON sdoc_lines(doc_id);
CREATE TABLE IF NOT EXISTS cust_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, customer_id INTEGER, date TEXT NOT NULL, amount REAL NOT NULL, method TEXT, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE INDEX IF NOT EXISTS ix_cpay_doc ON cust_payments(doc_id);
CREATE TABLE IF NOT EXISTS exp_categories(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS expense_entries(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, category_id INTEGER, payee TEXT, vendor_id INTEGER, amount REAL NOT NULL, method TEXT, ref TEXT, description TEXT, user_id INTEGER, ts INTEGER);
CREATE INDEX IF NOT EXISTS ix_exp_date ON expense_entries(date);
CREATE TABLE IF NOT EXISTS money_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, type TEXT DEFAULT 'cash', number TEXT, opening_balance REAL DEFAULT 0, opening_date TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE IF NOT EXISTS acc_transfers(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, amount REAL NOT NULL, fee REAL DEFAULT 0, fee_expense_id INTEGER, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS acc_moves(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL, kind TEXT, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER);
"""
OLD_ACCOUNT_TABLES = ['stores', 'products', 'lots', 'returns', 'store_payments', 'settlements', 'sales', 'sale_items', 'expenses', 'inv_tx', 'inv_settlements', 'services']

def _try(sql):
    try: q(sql)
    except sqlite3.Error: pass

def schema() -> None:
    for stmt in [x for x in SCHEMA.split(';\n') if x.strip()]: q(stmt)

def _flag(k: str) -> bool: return bool(val('SELECT 1 FROM settings WHERE k=?', (k,)))
def _set_flag(k: str) -> None: q("INSERT INTO settings(k,v) VALUES(?, '1')", (k,))

def migrate() -> None:
    """One-time upgrades. Every step is idempotent, so a database made by the old PHP server upgrades safely too."""
    if not _flag('mig_software'):
        for u in rows("SELECT id,perms FROM users WHERE is_admin=0 AND position='Software'"):
            p = json.loads(u['perms'] or '{}') or {}
            if 'software' not in p:
                p['software'] = ['view', 'add', 'edit', 'status']; q('UPDATE users SET perms=? WHERE id=?', (json.dumps(p), u['id']))
        _set_flag('mig_software')
    if not _flag('mig_phonekey'):
        for c in rows('SELECT id,phone FROM customers'):
            try: q('UPDATE customers SET phone_key=? WHERE id=?', (phone_key(c['phone'] or ''), c['id']))
            except sqlite3.Error: pass
        _set_flag('mig_phonekey')
    if not _flag('mig_v3'):
        for sql in ['ALTER TABLE soft_jobs ADD COLUMN serial TEXT', 'ALTER TABLE soft_jobs ADD COLUMN gmail_pw TEXT', 'ALTER TABLE soft_jobs ADD COLUMN apple_pw TEXT']:
            _try(sql)
        q("UPDATE soft_jobs SET status='in_progress' WHERE kind='repair' AND status='progress'")
        _set_flag('mig_v3')
    if not _flag('mig_inv') and _has('lots'):                       # (old inventory — only for databases from before the accounting rebuild)
        for sql in ['ALTER TABLE lots ADD COLUMN qty_used INTEGER DEFAULT 0', 'ALTER TABLE lots ADD COLUMN qty_transferred INTEGER DEFAULT 0', 'ALTER TABLE lots ADD COLUMN paid_amount REAL DEFAULT 0', 'ALTER TABLE lots ADD COLUMN notes TEXT',
                    "ALTER TABLE lots ADD COLUMN source TEXT DEFAULT 'supplier'", 'ALTER TABLE lots ADD COLUMN origin_lot_id INTEGER',
                    'ALTER TABLE lots ADD COLUMN qty_remaining INTEGER GENERATED ALWAYS AS (qty_received-qty_sold-qty_used-qty_returned-qty_transferred) VIRTUAL',
                    'ALTER TABLE returns ADD COLUMN reason TEXT', "ALTER TABLE returns ADD COLUMN status TEXT DEFAULT 'returned'"]:
            _try(sql)
        if not row('SELECT 1 FROM inv_tx LIMIT 1'):   # rebuild the ledger from existing history (nothing is lost)
            q("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id) SELECT 'RECEIVE',product_id,store_id,id,qty_received,cost,user_id,COALESCE(ts,strftime('%s','now')),date,'receiving',id FROM lots")
            q("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,unit_price,customer_id,user_id,ts,date,ref_kind,ref_id) SELECT 'SALE',si.product_id,si.store_id,si.lot_id,si.qty,si.unit_cost,si.unit_price,s.customer_id,s.user_id,COALESCE(s.ts,strftime('%s','now')),s.date,'sale',s.id FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.lot_id IS NOT NULL")
            q("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id,note) SELECT 'REPAIR_USAGE',rp.product_id,rp.store_id,rp.lot_id,rp.qty,rp.unit_cost,rp.user_id,rp.ts,date(rp.ts,'unixepoch','localtime'),'repair_part',rp.id,'Hardware repair #'||rp.repair_id FROM repair_parts rp WHERE rp.lot_id IS NOT NULL")
            q("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id,note) SELECT 'REPAIR_USAGE',sp.product_id,sp.store_id,sp.lot_id,sp.qty,sp.unit_cost,sp.user_id,sp.ts,date(sp.ts,'unixepoch','localtime'),'soft_part',sp.id,'Software service #'||sp.job_id FROM soft_parts sp WHERE sp.lot_id IS NOT NULL")
            q("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id,reason) SELECT 'RETURN',l.product_id,l.store_id,r.lot_id,r.qty,l.cost,r.user_id,COALESCE(strftime('%s',r.date),strftime('%s','now')),r.date,'return',r.id,'Unsold — returned to supplier' FROM returns r JOIN lots l ON l.id=r.lot_id")
            q("UPDATE lots SET qty_sold=(SELECT COALESCE(SUM(qty),0) FROM inv_tx WHERE lot_id=lots.id AND type='SALE' AND voided=0), qty_used=(SELECT COALESCE(SUM(qty),0) FROM inv_tx WHERE lot_id=lots.id AND type='REPAIR_USAGE' AND voided=0), qty_returned=(SELECT COALESCE(SUM(qty),0) FROM inv_tx WHERE lot_id=lots.id AND type='RETURN' AND voided=0), qty_transferred=0")
            q("UPDATE lots SET paid_amount=qty_received*cost WHERE type='cash'")
            q("INSERT OR IGNORE INTO inv_settlements(store_id,date,status,received,sold,returned,day_profit,payable,discrepancy,closed_by,finished_at,ts,detail) SELECT 0,date,'finished',received,sold,returned,profit,MAX(0,payable-paid),0,user_id,ts,ts,detail FROM settlements")
        _set_flag('mig_inv')
    if not _flag('mig_text'):   # repair mojibake left by an old patch
        _try("UPDATE inv_tx SET reason='Unsold — returned to supplier' WHERE reason LIKE 'Unsold â%'")
        _set_flag('mig_text')
    if not _flag('mig_v4'):   # deactivation time / reason, customer position
        for sql in ['ALTER TABLE users ADD COLUMN deactivated_at INTEGER', 'ALTER TABLE users ADD COLUMN deactivated_by INTEGER', 'ALTER TABLE users ADD COLUMN deactivate_reason TEXT',
                    "ALTER TABLE customers ADD COLUMN position TEXT DEFAULT 'Regular'"]:
            _try(sql)
        _set_flag('mig_v4')
    if not _flag('mig_v5'):   # security / audit / documents / customer messages
        for sql in ['ALTER TABLE sessions ADD COLUMN ip TEXT', 'ALTER TABLE sessions ADD COLUMN ua TEXT', 'ALTER TABLE activity ADD COLUMN ip TEXT']: _try(sql)
        _set_flag('mig_v5')
    if not _flag('mig_v6'):   # internal chat permissions
        _try('ALTER TABLE users ADD COLUMN chat_perms TEXT')
        _set_flag('mig_v6')
    if not _flag('mig_v7'):   # customer-linked reminders (extends the existing follow-up/reminder table — no new system)
        for sql in ["ALTER TABLE followups ADD COLUMN title TEXT", "ALTER TABLE followups ADD COLUMN time TEXT", "ALTER TABLE followups ADD COLUMN scheduled_at INTEGER",
                    "ALTER TABLE followups ADD COLUMN priority TEXT DEFAULT 'normal'", "ALTER TABLE followups ADD COLUMN repeat_rule TEXT DEFAULT 'none'", "ALTER TABLE followups ADD COLUMN snooze_until INTEGER",
                    "ALTER TABLE followups ADD COLUMN status TEXT DEFAULT 'open'", "ALTER TABLE followups ADD COLUMN source TEXT DEFAULT 'system'", "ALTER TABLE followups ADD COLUMN updated_at INTEGER"]:
            _try(sql)
        q("UPDATE followups SET status='done' WHERE done=1 AND (status IS NULL OR status='open')")
        _set_flag('mig_v7')
    if not _flag('mig_v8'):   # System Owner: one account above the Super Admins (the first Super Admin becomes the owner)
        _try('ALTER TABLE users ADD COLUMN is_owner INTEGER DEFAULT 0')
        if not val('SELECT 1 FROM users WHERE is_owner=1'):
            oid = val("SELECT MIN(id) FROM users WHERE is_admin=1 AND status='active'") or val('SELECT MIN(id) FROM users WHERE is_admin=1')
            if oid: q("UPDATE users SET is_owner=1, position='System Owner' WHERE id=?", (oid,))
        _set_flag('mig_v8')
    if not _flag('mig_v9'):   # QuickBooks-style accounting replaces the old sales / expenses / stores / inventory (old tables and their data are removed)
        if _has('services'):                                         # keep the service price list as service items
            for sv in rows('SELECT name,price,active FROM services'):
                if not val('SELECT 1 FROM items WHERE name=?', (sv['name'],)):
                    q("INSERT INTO items(type,name,category,sale_price,active,created_at) VALUES('service',?,'Services',?,?,?)", (sv['name'], sv['price'] or 0, 1 if sv['active'] else 0, now()))
        for t in OLD_ACCOUNT_TABLES: _try(f'DROP TABLE IF EXISTS {t}')
        q('DELETE FROM repair_parts'); q('DELETE FROM soft_parts')      # they pointed at the removed products
        if not row("SELECT 1 FROM items WHERE type='service'"):
            for nm, pr in [('Apple Unlock', 30), ('New Apple ID', 10), ('Software Repair', 20), ('iOS Restore', 10), ('Account Service', 15), ('Screen replacement (labour)', 0)]:
                q("INSERT INTO items(type,name,category,sale_price,created_at) VALUES('service',?,'Services',?,?)", (nm, pr, now()))
        if not row('SELECT 1 FROM exp_categories'):
            from acc import DEFAULT_EXP_CATS
            for nm in DEFAULT_EXP_CATS: q('INSERT INTO exp_categories(name) VALUES(?)', (nm,))
        for k in ('seq_invoice', 'seq_quote', 'seq_bill'): q('DELETE FROM settings WHERE k=?', (k,))
        _set_flag('mig_v9')
    if not _flag('mig_v10'):  # money accounts (created by the user): every payment in or out lands in an account
        for t in ('cust_payments', 'vendor_payments', 'expense_entries', 'repair_payments', 'soft_payments'): _try(f'ALTER TABLE {t} ADD COLUMN account_id INTEGER')
        from acc import METHOD_ACCOUNT
        ids = {r['name'].lower(): r['id'] for r in rows('SELECT id,name FROM money_accounts')}
        cash = ids.get('cash') or (min(ids.values()) if ids else None)
        for t in ([] if not ids else ('cust_payments', 'vendor_payments', 'expense_entries', 'repair_payments', 'soft_payments')):
            for m in rows(f'SELECT DISTINCT method FROM {t} WHERE account_id IS NULL'):
                aid = ids.get(str(METHOD_ACCOUNT.get(m['method'] or '', m['method'] or '')).lower()) or cash
                q(f"UPDATE {t} SET account_id=? WHERE account_id IS NULL AND COALESCE(method,'')=?", (aid, m['method'] or ''))
        _set_flag('mig_v10')
    if not _flag('mig_v11'):  # accounts are defined by the user: remove the four starter accounts if they were never touched
        for a in rows("SELECT id FROM money_accounts WHERE name IN ('Cash','ZAAD','eDahab','Bank') AND COALESCE(opening_balance,0)=0 AND COALESCE(number,'')='' AND COALESCE(notes,'')=''"):
            if val('SELECT 1 FROM acc_transfers WHERE from_id=? OR to_id=?', (a['id'], a['id'])) or val('SELECT 1 FROM acc_moves WHERE account_id=?', (a['id'],)): continue
            for t in ('cust_payments', 'vendor_payments', 'expense_entries', 'repair_payments', 'soft_payments'): q(f'UPDATE {t} SET account_id=NULL WHERE account_id=?', (a['id'],))
            q('DELETE FROM money_accounts WHERE id=?', (a['id'],))
        _set_flag('mig_v11')

def _has(table: str) -> bool: return bool(val("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)))


def default_perms(position: str) -> dict:
    if position == 'Software':
        return {'customers': ['view', 'add', 'edit'], 'appleid': ['view', 'add', 'edit', 'status'], 'regional': ['view', 'add', 'edit', 'status'], 'sales': ['view', 'add'], 'inventory': ['view'], 'software': ['view', 'add', 'edit', 'status']}
    return {'customers': ['view', 'add', 'edit'], 'repairs': ['view', 'add', 'edit', 'status'], 'appleid': ['view', 'add', 'edit', 'status'], 'inventory': ['view'], 'regional': ['view', 'add', 'status'], 'sales': ['view', 'add']}

def seed() -> None:
    q("INSERT INTO users(name,email,password,position,is_admin,status,perms,created_at) VALUES(?,?,?,?,1,?,?,?)", ('Super Admin', 'admin@hic.so', hash_pw('Admin@123'), 'Super Admin', 'active', '{}', now()))
    for k, v in {'company_name': 'HARGEISA IPHONE CENTER', 'slogan': 'Hubsiimo iyo Degdegsiimo', 'phone': '+252 63 0000000', 'email': 'info@hargeisaiphonecenter.com', 'address': 'Hargeisa, Somaliland',
                 'website': 'www.hargeisaiphonecenter.com', 'social': 'Facebook / Instagram / TikTok: @hargeisaiphonecenter', 'footer': '© HARGEISA IPHONE CENTER — Hubsiimo iyo Degdegsiimo', 'logo': '', 'currency': '$'}.items():
        q('INSERT INTO settings(k,v) VALUES(?,?)', (k, v))

def init_db() -> None:
    """Create / upgrade the database once at start-up."""
    fresh = not os.path.exists(DB_FILE)
    c = sqlite3.connect(DB_FILE, isolation_level=None, timeout=8)
    c.row_factory = lambda cur, r: {col[0]: r[i] for i, col in enumerate(cur.description)}
    c.execute('PRAGMA journal_mode=WAL')
    from flask import Flask
    app = Flask('init')
    with app.app_context():
        g.db = c
        schema()
        if fresh: seed()
        q('BEGIN IMMEDIATE'); migrate(); q('COMMIT')
    c.close()


# ------------------------------------------------------------------ settings & crypto
def setting(k: str, dflt: str = '') -> str:
    v = val('SELECT v FROM settings WHERE k=?', (k,)); return dflt if v is None else str(v)
def set_setting(k: str, v: str) -> None:
    q('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', (k, v))

def pw_min() -> int: return min(64, max(6, I(setting('sec_min_pw', '6'))))

def cust_notify(cid: int, type_: str, msg: str, ref: str | None = None) -> None:
    """A message shown to the customer inside the customer portal (deduplicated by ref)."""
    if not cid: return
    if ref and val('SELECT 1 FROM cust_msgs WHERE ref=?', (ref,)): return
    q('INSERT INTO cust_msgs(customer_id,type,message,ref,ts) VALUES(?,?,?,?,?)', (cid, type_, msg, ref, now()))

STATS = {'start': time.time(), 'req': 0, 'err': 0}                       # health monitor counters
ERRLOG: collections.deque = collections.deque(maxlen=30)


def appkey() -> bytes:
    f = os.path.join(DATA, 'app.key')
    if not os.path.exists(f):
        with open(f, 'w') as fh: fh.write(secrets.token_hex(32))
    with open(f) as fh: return bytes.fromhex(fh.read().strip())

def enc(text: str) -> str:
    iv = os.urandom(12); out = AESGCM(appkey()).encrypt(iv, text.encode(), None)
    return base64.b64encode(iv + out[-16:] + out[:-16]).decode()        # iv | tag | ciphertext (same layout the PHP server used)

def dec(b) -> str:
    if not b: return ''
    try:
        r = base64.b64decode(b, validate=True)
        if len(r) < 29: return ''
        return AESGCM(appkey()).decrypt(r[:12], r[28:] + r[12:28], None).decode()
    except Exception: return ''

def hash_pw(pw: str) -> str: return bcrypt.hashpw(pw.encode()[:72], bcrypt.gensalt(10)).decode()
def verify_pw(pw: str, hashed: str) -> bool:
    try: return bcrypt.checkpw((pw or '').encode()[:72], (hashed or '').replace('$2y$', '$2b$', 1).encode())
    except Exception: return False


# ------------------------------------------------------------------ sessions (server-side: revocable, survives restarts)
COOKIE = {'staff': 'HICSESS', 'portal': 'HICPORTAL'}

def _sess(kind: str):
    cache = g.setdefault('_sess', {})
    if kind not in cache:
        tok = request.cookies.get(COOKIE[kind], '')
        cache[kind] = row('SELECT * FROM sessions WHERE id=? AND kind=?', (tok, kind)) if re.fullmatch(r'[0-9a-f]{48}', tok) else None
    return cache[kind]

def sess_create(kind: str, uid: int, remember: bool = False) -> None:
    old = request.cookies.get(COOKIE[kind], '')
    if old: q('DELETE FROM sessions WHERE id=?', (old,))
    tok = secrets.token_hex(24)
    q('INSERT INTO sessions(id,kind,uid,remember,created,last,ip,ua) VALUES(?,?,?,?,?,?,?,?)', (tok, kind, uid, 1 if remember else 0, now(), now(), request.remote_addr or '', (request.headers.get('User-Agent') or '')[:200]))
    g.setdefault('_sess', {})[kind] = {'id': tok, 'kind': kind, 'uid': uid, 'remember': 1 if remember else 0}
    g.pop('_u', None)
    g.setdefault('cookies', []).append((COOKIE[kind], tok, 30 * 86400 if remember else None))

def sess_destroy(kind: str, hard: bool = True) -> None:
    s_ = _sess(kind)
    if s_ and hard: q('DELETE FROM sessions WHERE id=?', (s_['id'],))
    if s_ and not hard: defer('DELETE FROM sessions WHERE id=?', (s_['id'],))      # applied after rollback, so a failed request still logs the user out
    g.setdefault('_sess', {})[kind] = None; g.pop('_u', None)
    g.setdefault('cookies', []).append((COOKIE[kind], '', 0))

def sess_uid(kind: str) -> int:
    x = _sess(kind); return int(x['uid']) if x else 0


def defer(sql: str, params=()) -> None:
    """Run a statement AFTER the request's rollback (used for failed-login counters and forced log-outs)."""
    g.setdefault('after_rollback', []).append((sql, tuple(params)))


# ------------------------------------------------------------------ auth
def me(require: bool = True):
    if '_u' not in g:
        uid = sess_uid('staff'); g._u = row('SELECT * FROM users WHERE id=?', (uid,)) if uid else None
    u = g._u
    if not u:
        if require: raise ApiError('Please sign in.', 401, {'auth': True})
        return None
    remember = bool((_sess('staff') or {}).get('remember'))
    limit = 30 * 86400 if remember else 12 * 3600
    if u['logged_in'] and u['last_seen'] and now() - int(u['last_seen']) > limit:
        defer('UPDATE users SET logged_in=0 WHERE id=?', (u['id'],)); sess_destroy('staff', hard=False)
        raise ApiError('Your session expired. Please sign in again.', 401, {'auth': True})
    if u['status'] != 'active':
        defer('UPDATE users SET logged_in=0 WHERE id=?', (u['id'],)); sess_destroy('staff', hard=False)
        raise ApiError('Your access has been restricted; this user account has been deactivated. Please contact your owner, as you are not authorized.', 403, {'restricted': True})
    u['perms_arr'] = json.loads(u['perms'] or '{}') or {}
    return u

def can(module: str, action: str) -> bool:
    u = me()
    if u.get('is_owner'): return True
    if module in modules_off(): return False
    if u['is_admin']: return True
    p = u['perms_arr'].get(module, [])
    return action in p or 'full' in p

def need(module: str, action: str = 'view') -> dict:
    if not can(module, action): raise ApiError('You are not authorized to do this.', 403)
    return me()

def need_any(pairs) -> dict:
    for m, a in pairs:
        if can(m, a): return me()
    raise ApiError('You are not authorized to do this.', 403)

def admin() -> dict:
    u = me()
    if not u['is_admin']: raise ApiError('Super Admin only.', 403)
    return u

def is_admin() -> bool: return bool(me()['is_admin'])

def owner() -> dict:
    u = me()
    if not u.get('is_owner'): raise ApiError('System Owner only.', 403)
    return u


# ------------------------------------------------------------------ System Owner: modules on/off + sidebar layout
TOGGLE_MODULES = ['customers', 'repairs', 'software', 'appleid', 'inventory', 'stores', 'regional', 'sales', 'expenses', 'accounts', 'reports', 'portal', 'finance']
# API actions that belong to each module (prefix match). Shared look-ups (customer_find, stores_list, services_list) stay open.
MODULE_ACTIONS = [
    ('customers', ('customers_list', 'customer_save', 'customer_get', 'customer_delete', 'followup')),
    ('repairs', ('repair',)), ('software', ('soft_', 'service_save', 'service_delete')), ('appleid', ('appleid_',)),
    ('inventory', ('item_save', 'item_delete', 'item_ledger', 'stock_', 'inv_')),
    ('stores', ('vendor_', 'bill')), ('regional', ('regional_',)), ('sales', ('sdoc', 'cust_pay', 'sales_overview', 'open_invoices')),
    ('expenses', ('expense',)), ('accounts', ('account_', 'accounts_list')), ('reports', ('report',)), ('finance', ('finance',)),
    ('portal', ('portal_list', 'portal_status', 'portal_get', 'portal_register', 'portal_login', 'portal_me', 'portal_bills', 'portal_msg')),
]

def modules_off() -> set:
    if '_off' not in g:
        try: g._off = {m for m in json.loads(setting('ui_modules_off', '[]')) if m in TOGGLE_MODULES}
        except ValueError: g._off = set()
    return g._off

def action_module(action: str) -> str | None:
    for mod, prefixes in MODULE_ACTIONS:
        if action.startswith(prefixes): return mod
    return None

def check_module(action: str) -> None:
    """A module the System Owner turned off is closed for everyone else, on the server (not just hidden in the menu)."""
    mod = action_module(action)
    if not mod or mod not in modules_off(): return
    uid = sess_uid('staff')
    if uid and val('SELECT is_owner FROM users WHERE id=?', (uid,)): return
    raise ApiError('This part of the system has been turned off by the System Owner.', 403)

NAV_POSITIONS = ['Technician', 'Software', 'Super Admin']

def nav_cfg() -> dict:
    """Sidebar layout set by the System Owner: order, renamed labels, hidden items and who may see each item."""
    try: c = json.loads(setting('ui_nav', '{}')) or {}
    except ValueError: c = {}
    return {'items': c.get('items') or {}, 'order': c.get('order') or [], 'groups': c.get('groups') or {}, 'v': int(c.get('v') or 0), 'off': sorted(modules_off())}

def touch_user(u: dict) -> None:
    t = now(); start = int(u['session_start']) if (u['logged_in'] and t - int(u['last_seen'] or 0) < 300 and u['session_start']) else t
    q('UPDATE users SET last_seen=?, logged_in=1, session_start=? WHERE id=?', (t, start, u['id']))

def audit(action: str, entity: str, id_=None, detail: str = '') -> None:
    uid = sess_uid('staff') or None
    q('INSERT INTO activity(user_id,action,entity,entity_id,detail,ts,ip) VALUES(?,?,?,?,?,?,?)', (uid, action, entity, id_, detail, now(), (request.remote_addr or '') if has_request_context() else ''))

def notify(type_: str, msg: str, aud='admin', link=None, ref=None) -> None:
    if ref and val('SELECT 1 FROM notifications WHERE ref=?', (ref,)): return
    if isinstance(aud, int): ids = [aud]
    elif isinstance(aud, list): ids = aud
    elif aud == 'all': ids = [r['id'] for r in rows("SELECT id FROM users WHERE status='active'")]
    elif isinstance(aud, str) and aud.startswith('perm:'):
        mod = aud[5:]; ids = []
        for r in rows("SELECT id,is_admin,perms FROM users WHERE status='active'"):
            p = json.loads(r['perms'] or '{}') or {}
            if r['is_admin'] or mod in p: ids.append(r['id'])
    else: ids = [r['id'] for r in rows("SELECT id FROM users WHERE status='active' AND is_admin=1")]
    for i in unique(ids): q('INSERT INTO notifications(user_id,type,message,link,ts,ref) VALUES(?,?,?,?,?,?)', (i, type_, msg, link, now(), ref))


def ago_json(u: dict) -> dict:
    t = now(); online = bool(u['logged_in']) and t - int(u['last_seen'] or 0) <= 75
    return {'online': online, 'active_for': max(0, t - int(u['session_start'] or 0)) if online else 0, 'last_seen': int(u['last_seen'] or 0)}

def public_user(u: dict) -> dict:
    return {'id': int(u['id']), 'name': u['name'], 'email': u['email'], 'position': u['position'], 'is_admin': bool(u['is_admin']), 'is_owner': bool(u.get('is_owner')), 'status': u['status'], 'avatar': u['avatar'],
            'perms': json.loads(u['perms'] or '{}') or {}, 'created_at': int(u['created_at'] or 0), 'deactivated_at': int(u.get('deactivated_at') or 0),
            'deactivate_reason': u.get('deactivate_reason') or '', 'chat': chat_perm_dict(u), **ago_json(u)}

CHAT_DEFAULT = {'chat': 1, 'group': 0, 'add': 0, 'attach': 1, 'delete': 1, 'voice': 1}
def chat_perm_dict(u: dict) -> dict:
    """What this user may do in the internal chat. Super Admin can do everything; others follow the switches the Super Admin set."""
    if u.get('is_admin'): return {k: 1 for k in CHAT_DEFAULT}
    try: mine = json.loads(u.get('chat_perms') or '{}') or {}
    except ValueError: mine = {}
    return {k: 1 if mine.get(k, v) else 0 for k, v in CHAT_DEFAULT.items()}


# ------------------------------------------------------------------ finance helper
def money_by_day(frm: str, to: str) -> dict:
    m: dict = {}
    def add(rs, key):
        for r in rs:
            e = m.setdefault(r['d'], {'income': 0, 'cost': 0, 'expense': 0}); e[key] += float(r['v'] or 0)
    # income: invoices (accrual, without the sales tax collected) + repair / software job payments (cash)
    add(rows("SELECT date d, SUM(total-tax) v FROM sdocs WHERE kind IN ('invoice','receipt') AND status<>'void' AND date BETWEEN ? AND ? GROUP BY date", (frm, to)), 'income')
    add(rows('SELECT date d, SUM(amount) v FROM repair_payments WHERE date BETWEEN ? AND ? GROUP BY date', (frm, to)), 'income')
    add(rows('SELECT date d, SUM(amount) v FROM soft_payments WHERE date BETWEEN ? AND ? GROUP BY date', (frm, to)), 'income')
    # cost: cost of goods sold + parts used + stock adjustments (from the stock ledger) + cost of non-stock items sold
    add(rows("SELECT date d, SUM(-qty*unit_cost) v FROM stock_moves WHERE kind IN ('sale','repair','adjust') AND date BETWEEN ? AND ? GROUP BY date", (frm, to)), 'cost')
    add(rows("SELECT x.date d, SUM(l.qty*l.unit_cost) v FROM sdoc_lines l JOIN sdocs x ON x.id=l.doc_id WHERE x.kind IN ('invoice','receipt') AND x.status<>'void' AND l.kind='non_inventory' AND x.date BETWEEN ? AND ? GROUP BY x.date", (frm, to)), 'cost')
    add(rows("SELECT date(p.ts,'unixepoch','localtime') d, SUM(p.qty*p.unit_cost) v FROM repair_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND date(p.ts,'unixepoch','localtime') BETWEEN ? AND ? GROUP BY d", (frm, to)), 'cost')
    add(rows("SELECT date(p.ts,'unixepoch','localtime') d, SUM(p.qty*p.unit_cost) v FROM soft_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND date(p.ts,'unixepoch','localtime') BETWEEN ? AND ? GROUP BY d", (frm, to)), 'cost')
    add(rows('SELECT date d, SUM(amount) v FROM expense_entries WHERE date BETWEEN ? AND ? GROUP BY date', (frm, to)), 'expense')
    return m

def finance_breakdown(frm: str, to: str) -> dict:
    """Profit & loss figures for a period (the same rules as money_by_day, split into lines)."""
    sv = lambda sql, p=(): rnd(float(val(sql, p) or 0))
    inv = "FROM sdoc_lines l JOIN sdocs x ON x.id=l.doc_id WHERE x.kind IN ('invoice','receipt') AND x.status<>'void' AND x.date BETWEEN ? AND ?"
    b = {'product_sales': sv(f"SELECT COALESCE(SUM(l.amount),0) {inv} AND l.kind IN ('inventory','non_inventory')", (frm, to)),
         'service_sales': sv(f"SELECT COALESCE(SUM(l.amount),0) {inv} AND l.kind IN ('service','custom')", (frm, to)),
         'discounts': sv("SELECT COALESCE(SUM(discount),0) FROM sdocs WHERE kind IN ('invoice','receipt') AND status<>'void' AND date BETWEEN ? AND ?", (frm, to)),
         'tax': sv("SELECT COALESCE(SUM(tax),0) FROM sdocs WHERE kind IN ('invoice','receipt') AND status<>'void' AND date BETWEEN ? AND ?", (frm, to)),
         'hardware_charges': sv('SELECT COALESCE(SUM(amount),0) FROM repair_payments WHERE date BETWEEN ? AND ?', (frm, to)),
         'software_charges': sv('SELECT COALESCE(SUM(amount),0) FROM soft_payments WHERE date BETWEEN ? AND ?', (frm, to)),
         'product_costs': sv("SELECT COALESCE(SUM(-qty*unit_cost),0) FROM stock_moves WHERE kind='sale' AND date BETWEEN ? AND ?", (frm, to)) + sv(f"SELECT COALESCE(SUM(l.qty*l.unit_cost),0) {inv} AND l.kind='non_inventory'", (frm, to)),
         'parts_costs': sv("SELECT COALESCE(SUM(-qty*unit_cost),0) FROM stock_moves WHERE kind='repair' AND date BETWEEN ? AND ?", (frm, to))
                        + sv("SELECT COALESCE(SUM(p.qty*p.unit_cost),0) FROM repair_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND date(p.ts,'unixepoch','localtime') BETWEEN ? AND ?", (frm, to))
                        + sv("SELECT COALESCE(SUM(p.qty*p.unit_cost),0) FROM soft_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND date(p.ts,'unixepoch','localtime') BETWEEN ? AND ?", (frm, to)),
         'adjustments': sv("SELECT COALESCE(SUM(-qty*unit_cost),0) FROM stock_moves WHERE kind='adjust' AND date BETWEEN ? AND ?", (frm, to)),
         'expenses': sv('SELECT COALESCE(SUM(amount),0) FROM expense_entries WHERE date BETWEEN ? AND ?', (frm, to))}
    b['service_charges'] = rnd(b['hardware_charges'] + b['software_charges'])
    b['total_revenue'] = rnd(b['product_sales'] + b['service_sales'] - b['discounts'] + b['service_charges'])
    b['cogs'] = rnd(b['product_costs'] + b['parts_costs'] + b['adjustments'])
    b['gross_profit'] = rnd(b['total_revenue'] - b['cogs'])
    b['net_profit'] = rnd(b['gross_profit'] - b['expenses'])
    return b


# ------------------------------------------------------------------ scheduled checks (run from heartbeat)
def _when(expected: str) -> str:
    diff = round((date_ts(expected) - date_ts(today())) / 86400)
    return 'Today' if diff == 0 else ('Tomorrow' if diff == 1 else f'{abs(diff)} day(s) overdue')

def run_checks() -> None:
    t = now()
    if t - I(setting('last_check', '0')) < 50: return
    set_setting('last_check', str(t)); td = today(); tomorrow = add_days(1).strftime('%Y-%m-%d')
    admins = lambda: [r['id'] for r in rows("SELECT id FROM users WHERE status='active' AND is_admin=1")]
    for a in rows("SELECT * FROM appleids WHERE status IN ('request','received','progress') AND expected_date IS NOT NULL AND expected_date<=? AND COALESCE(last_notified,'')<>?", (tomorrow, td)):
        ids = admins() + ([int(a['assigned_to'])] if a['assigned_to'] else [])
        notify('appleid_deadline', f"Apple ID Check Required — Customer: {a['customer_name']}, Device: {a['model']}, Expected: {_when(a['expected_date'])}, Status: {str(a['status']).capitalize()}", ids, '#/appleid')
        q('UPDATE appleids SET last_notified=? WHERE id=?', (td, a['id']))
    for j in rows("SELECT j.*,c.name cname FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.kind='unlock' AND j.status IN ('request','received','in_progress','waiting') AND j.expected_date IS NOT NULL AND j.expected_date<=? AND COALESCE(j.last_notified,'')<>?", (tomorrow, td)):
        ids = admins() + ([int(j['technician_id'])] if j['technician_id'] else [])
        notify('appleid_deadline', f"Apple Unlock Check Required — Customer: {j['cname']}, Device: {j['device']}, Expected: {_when(j['expected_date'])}, Status: {str(j['status']).replace('_', ' ').capitalize()}", ids, '#/unlock')
        q('UPDATE soft_jobs SET last_notified=? WHERE id=?', (td, j['id']))
    for p in rows("SELECT id,name,qty FROM items WHERE type='inventory' AND active=1 AND reorder>0 AND qty<=reorder"):
        notify('stock', ('Out of stock: ' if p['qty'] <= 0 else 'Low stock: ') + f"{p['name']} ({round(p['qty'], 3):g} left)", 'perm:inventory', '#/inventory', f"stock:{p['id']}:{td}")
    for f in rows('SELECT f.*,c.name cname FROM followups f JOIN customers c ON c.id=f.customer_id WHERE f.done=0 AND f.due_date IS NOT NULL AND f.due_date<=? AND f.scheduled_at IS NULL', (td,)):
        notify('followup', f"Customer follow-up: {f['cname']} — {str(f['type']).replace('_', ' ')}", 'perm:customers', f"#/customers/{f['customer_id']}", f"fu:{f['id']}:{td}")
    # customer-linked reminders: fire once the exact scheduled (or snoozed) moment arrives, not just once per day
    for f in rows('SELECT f.*,c.name cname FROM followups f JOIN customers c ON c.id=f.customer_id WHERE f.done=0 AND f.scheduled_at IS NOT NULL AND COALESCE(f.snooze_until,f.scheduled_at)<=?', (t,)):
        eff = int(f['snooze_until'] or f['scheduled_at']); label = f['title'] or str(f['type'] or 'Reminder').replace('_', ' ').capitalize()
        when = 'Today' if fdate(eff, '%Y-%m-%d') == td else fdate(eff, '%d %b')
        notify('reminder', f"Customer Reminder — {f['cname']}: {label} ({when}, {fdate(eff, '%H:%M')})", 'perm:customers', f"#/customers/{f['customer_id']}", f"rem:{f['id']}:{eff}")
    try: smart_checks(td)
    except Exception: pass          # alerts must never break the heartbeat
    try:
        import h_chat; h_chat.purge_if_due(td)
    except Exception: pass


def last_backup_ts() -> int:
    """Newest backup file on disk (the file system is the source of truth, so this survives a restore)."""
    d_ = os.path.join(DATA, 'backups')
    try: return max([int(os.path.getmtime(os.path.join(d_, f))) for f in os.listdir(d_) if f.startswith('hic_') and f.endswith('.sqlite')] or [0])
    except OSError: return 0

REPAIR_OPEN ="('received','diagnosis','progress','waiting_part','parts_installed','testing','working','not_working','finishing')"
BAL_REPAIR = "r.price-r.discount-COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0)"
BAL_SOFT = "j.price-j.discount-COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0)"

def smart_checks(td: str) -> None:
    """Automatic alerts for staff (summaries, once per day) and payment reminders for customers (every 3 days)."""
    t = now(); day3 = f'{td[:8]}{(int(td[8:]) - 1) // 3}'                 # changes every ~3 days, stable in between
    n_over = int(val(f"SELECT COUNT(*) FROM repairs WHERE status IN {REPAIR_OPEN} AND expected_date IS NOT NULL AND expected_date<?", (td,)) or 0)
    if n_over: notify('overdue', f'{n_over} hardware repair(s) are past their expected date.', 'perm:repairs', '#/repairs', f'overdue:{td}')
    n_wait = int(val("SELECT COUNT(*) FROM repairs WHERE status IN ('ready','completed') AND COALESCE(updated_at,0)<?", (t - 3 * 86400,)) or 0)
    if n_wait: notify('ready_wait', f'{n_wait} finished device(s) have been waiting for the customer for over 3 days.', 'perm:repairs', '#/repairs', f'readywait:{td}')
    unpaid = row(f"SELECT COUNT(*) n, COALESCE(SUM(b),0) s FROM (SELECT {BAL_REPAIR} b FROM repairs r WHERE r.status IN ('ready','completed','took_completed','took_incomplete') AND COALESCE(r.updated_at,0)<? "
                 f"UNION ALL SELECT {BAL_SOFT} b FROM soft_jobs j WHERE j.status IN ('completed','verified','took','instore','customer_received') AND COALESCE(j.updated_at,0)<?) WHERE b>0.005", (t - 7 * 86400, t - 7 * 86400))
    if unpaid and unpaid['n']: notify('unpaid', f"{unpaid['n']} finished job(s) still have an unpaid balance older than 7 days (total {round(float(unpaid['s']), 2)}).", 'admin', '#/customers', f'unpaid:{td}')
    od = row("SELECT COUNT(*) n, COALESCE(SUM(total-paid),0) s FROM sdocs WHERE kind='invoice' AND status='open' AND due_date IS NOT NULL AND due_date<?", (td,))
    if od and od['n']: notify('overdue', f"{od['n']} invoice(s) are overdue (total due {round(float(od['s']), 2)}).", 'perm:sales', '#/invoices', f'odinv:{td}')
    bd = row("SELECT COUNT(*) n, COALESCE(SUM(total-paid),0) s FROM bills WHERE status='open' AND due_date IS NOT NULL AND due_date<=?", (td,))
    if bd and bd['n']: notify('unpaid', f"{bd['n']} store bill(s) are due for payment (total {round(float(bd['s']), 2)}).", 'perm:stores', '#/stores', f'bills:{td}')
    last_bk = last_backup_ts()
    if not last_bk or t - int(last_bk) > 2 * 86400: notify('backup', 'No recent backup — create one in System Center → Backup & Restore.', 'admin', '#/backup', f'backup:{td}')
    fails = int(val("SELECT COUNT(*) FROM login_attempts WHERE ts>?", (t - 3600,)) or 0)
    if fails >= 5: notify('security', f'{fails} failed sign-in attempts in the last hour — review the Security Center.', 'admin', '#/security', f'fails:{td}:{local_now().hour}')
    try:
        import shutil
        free = shutil.disk_usage(DATA).free
        if free < 1_000_000_000: notify('health', f'Low disk space: only {round(free / 1e9, 2)} GB free on the server drive.', 'admin', '#/health', f'disk:{td}')
    except Exception: pass
    # customer-facing reminders (shown in the customer portal)
    for r in rows(f"SELECT r.id,r.customer_id,r.device,{BAL_REPAIR} b FROM repairs r WHERE r.status IN ('ready','completed','took_completed','took_incomplete') AND COALESCE(r.updated_at,0)<? AND {BAL_REPAIR}>0.005", (t - 86400,)):
        cust_notify(int(r['customer_id']), 'payment', f"Payment reminder: a balance of {round(float(r['b']), 2)} is due for your {r['device']}.", f"payrem:r{r['id']}:{day3}")
    for j in rows(f"SELECT j.id,j.customer_id,j.device,{BAL_SOFT} b FROM soft_jobs j WHERE j.status IN ('completed','verified','took','instore','customer_received') AND COALESCE(j.updated_at,0)<? AND {BAL_SOFT}>0.005", (t - 86400,)):
        cust_notify(int(j['customer_id']), 'payment', f"Payment reminder: a balance of {round(float(j['b']), 2)} is due for your {j['device']} service.", f"payrem:j{j['id']}:{day3}")
