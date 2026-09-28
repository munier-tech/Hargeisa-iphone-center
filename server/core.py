"""HARGEISA IPHONE CENTER — core: database, sessions, security helpers, scheduled checks.
Python port of the former PHP backend. The data now lives in PostgreSQL (Neon) — the connection string comes from the
DATABASE_URL environment variable (or a local, git-ignored .env file). The encryption key and every JSON API shape are unchanged."""
from __future__ import annotations

import base64, calendar, json, math, os, re, secrets, threading, time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import bcrypt
import psycopg
from psycopg.adapt import Dumper, Loader
from psycopg.pq import TransactionStatus
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from flask import g, request, has_request_context
import collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ON_VERCEL = bool(os.environ.get('VERCEL'))
DATA = os.path.abspath(os.environ.get('HIC_DATA_DIR', os.path.join(ROOT, 'data')))
if not ON_VERCEL:
    os.makedirs(DATA, exist_ok=True)
TZ = timezone(timedelta(hours=3))            # Africa/Mogadishu (no daylight saving)
PG_TZ = "INTERVAL '+03:00'"                # the same fixed offset, for SQL (needs no time-zone database on the server)


def _load_env_file() -> None:
    """Read KEY=VALUE lines from <project>/.env into the environment (real environment variables always win).
    Lets the Windows start-up script work without typing the connection string; .env is git-ignored."""
    f = os.path.join(ROOT, '.env')
    if not os.path.isfile(f): return
    with open(f, encoding='utf-8-sig') as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1); k = k.strip().removeprefix('export ').strip(); v = v.strip().strip('"').strip("'")
            if k and k not in os.environ: os.environ[k] = v

_load_env_file()
DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
# Serverless hosting (Vercel): the disk is read-only (only a temporary /tmp that is wiped), and nothing runs between requests.
# There, chat attachments and backups are kept inside PostgreSQL, and the daily automatic backup runs from the heartbeat.
BACKUPS_IN_DB = ON_VERCEL or os.environ.get('HIC_BACKUP_STORE', '').lower() == 'db'
TMP = os.environ.get('HIC_TMP') or os.path.join('/tmp' if ON_VERCEL else DATA, 'tmp')    # scratch space for backup files


def redact_secrets(text: str) -> str:
    for name, value in os.environ.items():
        if value and re.search(r'PASSWORD|SECRET|TOKEN|DATABASE_URL|(?:API|ENCRYPTION|FLASK|HIC)_KEY', name, re.I):
            text = text.replace(value, '[REDACTED]')
    text = re.sub(r'(?i)(postgres(?:ql)?://[^:/@\s]+:)[^@\s]+(@)', r'\1[REDACTED]\2', text)
    return re.sub(r'(?i)\b(password|passwd|secret|token|api[_-]?key)(\s*[=:]\s*)([^\s,;]+)', r'\1\2[REDACTED]', text)


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


# ------------------------------------------------------------------ database (PostgreSQL / Neon)
# SQL in this code base is written with `?` placeholders (as before); q() turns them into PostgreSQL parameters.
# Python ints / bools are sent *untyped*, so PostgreSQL casts them to whatever the column needs — the same forgiving
# behaviour SQLite had (e.g. comparing a TEXT column with a number). NUMERIC results (SUM of integers, AVG, ROUND) come
# back as int when whole, otherwise float — exactly the values SQLite used to return, so every JSON response is unchanged.
class _LooseInt(Dumper):
    oid = 0                                                     # "unknown": PostgreSQL infers the type from the context
    def dump(self, obj): return str(int(obj)).encode()

class _NumLoader(Loader):
    def load(self, data):
        t = bytes(data).decode()
        try: return int(t)
        except ValueError: return float(t)

psycopg.adapters.register_dumper(int, _LooseInt)
psycopg.adapters.register_dumper(bool, _LooseInt)
psycopg.adapters.register_loader('numeric', _NumLoader)

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()

def db_url() -> str:
    if not DATABASE_URL:
        raise RuntimeError('DATABASE_URL is not set. Put your Neon connection string in the DATABASE_URL environment variable '
                           '(or in a .env file in the project folder) and start the server again.')
    return DATABASE_URL

def db_label() -> str:
    """Where the data lives, for the System Health page — never includes the password."""
    try:
        i = psycopg.conninfo.conninfo_to_dict(db_url()); return f"PostgreSQL — {i.get('host', '?')}/{i.get('dbname', '?')}"
    except Exception: return 'PostgreSQL'

def pool() -> ConnectionPool:
    """One shared pool of connections (a new TLS connection to Neon for every request would be slow)."""
    global _pool
    with _pool_lock:
        if _pool is None:
            max_size = max(2 if ON_VERCEL else 1, int(os.environ.get('HIC_DB_POOL', '2' if ON_VERCEL else '12')))
            _pool = ConnectionPool(db_url(), min_size=0 if ON_VERCEL else 1, max_size=max_size, name='hic', open=True,
                                   timeout=10 if ON_VERCEL else 30, max_idle=60 if ON_VERCEL else 240,
                                   kwargs={'autocommit': True, 'row_factory': dict_row, 'prepare_threshold': None, 'connect_timeout': 8 if ON_VERCEL else 20},
                                   check=ConnectionPool.check_connection)          # a connection closed by Neon while idle is replaced transparently
    return _pool

def db() -> psycopg.Connection:
    if 'db' not in g: g.db = pool().getconn()
    return g.db

def release(c) -> None:
    try: pool().putconn(c)                                      # rolls back anything left open and returns it to the pool
    except Exception: pass

_SQL: dict = {}
_QUOTED = re.compile(r"('(?:[^']|'')*'|\"[^\"]*\")")

def pg(sql: str) -> str:
    """`?` placeholders -> psycopg text parameters; a literal `%` must be doubled. Quoted strings are left alone."""
    out = _SQL.get(sql)
    if out is None:
        parts = _QUOTED.split(sql)
        out = ''.join(x.replace('%', '%%') if i % 2 else x.replace('%', '%%').replace('?', '%t') for i, x in enumerate(parts))
        if len(_SQL) < 20000: _SQL[sql] = out
    return out

def cq(c, sql: str, p=()):
    """Run a statement on a given connection (background threads, backups)."""
    return c.execute(pg(sql), tuple(p))

def q(sql: str, p=()): return cq(db(), sql, p)
def rows(sql: str, p=()): return q(sql, p).fetchall()
def row(sql: str, p=()): return q(sql, p).fetchone()
def val(sql: str, p=()):
    r = q(sql, p).fetchone()
    return None if r is None else next(iter(r.values()))

NO_ID = {'settings', 'sessions', 'chat_members', 'backups', 'chat_files', 'backup_files'}     # tables whose key is not an `id` column
def ins(table: str, dct: dict) -> int:
    cols = list(dct); sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join('?' * len(cols))})"
    if table in NO_ID: q(sql, [dct[c] for c in cols]); return 0
    return int(q(sql + ' RETURNING id', [dct[c] for c in cols]).fetchone()['id'])
def upd(table: str, id_: int, dct: dict) -> None:
    if dct: q(f"UPDATE {table} SET {','.join(c + '=?' for c in dct)} WHERE id=?", [*dct.values(), id_])

def in_tx() -> bool: return db().info.transaction_status != TransactionStatus.IDLE

@contextmanager
def savepoint():
    """Lets a statement fail without aborting the whole request transaction (PostgreSQL aborts a transaction on any error)."""
    sp = in_tx()
    if sp: q('SAVEPOINT hic_sp')
    try: yield
    except BaseException:
        if sp: q('ROLLBACK TO SAVEPOINT hic_sp'); q('RELEASE SAVEPOINT hic_sp')
        raise
    else:
        if sp: q('RELEASE SAVEPOINT hic_sp')

def _try(sql: str, p=()) -> bool:
    try:
        with savepoint(): q(sql, p)
        return True
    except psycopg.Error: return False


# SQLite-era column types map to: INTEGER -> BIGINT, REAL -> DOUBLE PRECISION. Columns that were TEXT COLLATE NOCASE UNIQUE get a
# unique index on lower(column), and are looked up with lower(), so e-mail logins and item / store / category / account names
# stay case-insensitive exactly as before (works on any PostgreSQL, no extension needed).
# Every column that older versions added later with ALTER TABLE is part of the table definition here.
SCHEMA = [
    # local date / time helpers (Africa/Mogadishu, UTC+3) used instead of SQLite's date(ts,'unixepoch','localtime') and julianday()
    f"CREATE OR REPLACE FUNCTION hic_ts(t BIGINT) RETURNS TIMESTAMP LANGUAGE sql IMMUTABLE AS $$ SELECT to_timestamp(t) AT TIME ZONE {PG_TZ} $$",
    f"CREATE OR REPLACE FUNCTION hic_day(t BIGINT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT to_char(to_timestamp(t) AT TIME ZONE {PG_TZ}, 'YYYY-MM-DD') $$",
    f"CREATE OR REPLACE FUNCTION hic_days_until(d TEXT) RETURNS INTEGER LANGUAGE plpgsql STABLE AS $$ BEGIN RETURN d::date - (now() AT TIME ZONE {PG_TZ})::date; EXCEPTION WHEN others THEN RETURN NULL; END $$",
    # a REAL shown as text the way SQLite did (1.0 -> '1.0', 2.5 -> '2.5'), for the item summaries on invoices and bills
    "CREATE OR REPLACE FUNCTION hic_num(x DOUBLE PRECISION) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN x = trunc(x) AND abs(x) < 1e15 THEN CAST(CAST(x AS BIGINT) AS TEXT) || '.0' ELSE CAST(x AS TEXT) END $$",
    'CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT)',
    "CREATE TABLE IF NOT EXISTS users(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, password TEXT NOT NULL, position TEXT NOT NULL DEFAULT 'Technician', is_admin BIGINT DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', avatar TEXT, perms TEXT DEFAULT '{}', logged_in BIGINT DEFAULT 0, last_seen BIGINT DEFAULT 0, session_start BIGINT DEFAULT 0, created_at BIGINT, approved_by BIGINT, deactivated_at BIGINT, deactivated_by BIGINT, deactivate_reason TEXT, chat_perms TEXT, is_owner BIGINT DEFAULT 0)",
    'CREATE TABLE IF NOT EXISTS activity(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, user_id BIGINT, action TEXT, entity TEXT, entity_id BIGINT, detail TEXT, ts BIGINT, ip TEXT)',
    'CREATE INDEX IF NOT EXISTS ix_act_ts ON activity(ts)',
    'CREATE INDEX IF NOT EXISTS ix_act_user ON activity(user_id)',
    'CREATE TABLE IF NOT EXISTS notifications(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, user_id BIGINT, type TEXT, message TEXT, link TEXT, is_read BIGINT DEFAULT 0, ts BIGINT, ref TEXT)',
    'CREATE INDEX IF NOT EXISTS ix_notif_user ON notifications(user_id, is_read)',
    'CREATE INDEX IF NOT EXISTS ix_notif_ref ON notifications(ref)',
    "CREATE TABLE IF NOT EXISTS customers(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, phone_key TEXT NOT NULL UNIQUE, email TEXT, gender TEXT, address TEXT, notes TEXT, created_by BIGINT, created_at BIGINT, position TEXT DEFAULT 'Regular')",
    "CREATE TABLE IF NOT EXISTS followups(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, customer_id BIGINT NOT NULL, type TEXT, note TEXT, due_date TEXT, done BIGINT DEFAULT 0, ref_kind TEXT, ref_id BIGINT, created_by BIGINT, created_at BIGINT, done_at BIGINT, title TEXT, time TEXT, scheduled_at BIGINT, priority TEXT DEFAULT 'normal', repeat_rule TEXT DEFAULT 'none', snooze_until BIGINT, status TEXT DEFAULT 'open', source TEXT DEFAULT 'system', updated_at BIGINT)",
    "CREATE TABLE IF NOT EXISTS repairs(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, customer_id BIGINT NOT NULL, device TEXT, imei TEXT, problem TEXT, diagnosis TEXT, diagnosis_notes TEXT, required_parts TEXT, technician_id BIGINT, status TEXT DEFAULT 'received', progress_notes TEXT, test_result TEXT, outcome TEXT, received_at BIGINT, expected_date TEXT, price DOUBLE PRECISION DEFAULT 0, discount DOUBLE PRECISION DEFAULT 0, created_by BIGINT, updated_at BIGINT, closed_at BIGINT)",
    'CREATE INDEX IF NOT EXISTS ix_rep_cust ON repairs(customer_id)',
    'CREATE TABLE IF NOT EXISTS repair_events(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, repair_id BIGINT, status TEXT, note TEXT, user_id BIGINT, ts BIGINT)',
    'CREATE TABLE IF NOT EXISTS repair_parts(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, repair_id BIGINT, product_id BIGINT, lot_id BIGINT, store_id BIGINT, qty BIGINT, unit_cost DOUBLE PRECISION, unit_price DOUBLE PRECISION, user_id BIGINT, ts BIGINT)',
    'CREATE TABLE IF NOT EXISTS repair_payments(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, repair_id BIGINT, amount DOUBLE PRECISION, method TEXT, date TEXT, user_id BIGINT, note TEXT, account_id BIGINT)',
    "CREATE TABLE IF NOT EXISTS appleids(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, customer_id BIGINT, customer_name TEXT, phone TEXT, model TEXT, apple_id TEXT, pw_enc TEXT, description TEXT, date TEXT, created_by BIGINT, hidden BIGINT DEFAULT 0, status TEXT DEFAULT 'request', request_date TEXT, expected_date TEXT, assigned_to BIGINT, notes TEXT, last_notified TEXT, updated_at BIGINT, ts BIGINT)",
    "CREATE TABLE IF NOT EXISTS regional(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, customer_id BIGINT, customer_name TEXT, phone TEXT, device TEXT, problem TEXT, region TEXT, sent_to TEXT, date_sent TEXT, technician TEXT, parts TEXT, cost DOUBLE PRECISION DEFAULT 0, status TEXT DEFAULT 'received', expected_return TEXT, actual_return TEXT, notes TEXT, created_by BIGINT, ts BIGINT)",
    "CREATE TABLE IF NOT EXISTS portal_accounts(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, customer_id BIGINT, name TEXT, phone TEXT, email TEXT, password TEXT, status TEXT DEFAULT 'pending', created_at BIGINT, last_login BIGINT, approved_by BIGINT)",
    'CREATE TABLE IF NOT EXISTS login_attempts(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, k TEXT, ts BIGINT)',
    'CREATE INDEX IF NOT EXISTS ix_login_k ON login_attempts(k, ts)',
    'CREATE TABLE IF NOT EXISTS soft_jobs(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, kind TEXT NOT NULL, customer_id BIGINT NOT NULL, device TEXT, imei TEXT, problem TEXT, diagnosis TEXT, apple_id TEXT, lock_info TEXT, technician_id BIGINT, status TEXT, progress_notes TEXT, test_result TEXT, notes TEXT, tools TEXT, request_date TEXT, expected_date TEXT, account_date TEXT, price DOUBLE PRECISION DEFAULT 0, discount DOUBLE PRECISION DEFAULT 0, created_by BIGINT, received_at BIGINT, updated_at BIGINT, closed_at BIGINT, last_notified TEXT, serial TEXT, gmail_pw TEXT, apple_pw TEXT)',
    'CREATE INDEX IF NOT EXISTS ix_soft_cust ON soft_jobs(customer_id)',
    'CREATE TABLE IF NOT EXISTS soft_events(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, job_id BIGINT, status TEXT, note TEXT, user_id BIGINT, ts BIGINT)',
    'CREATE TABLE IF NOT EXISTS soft_parts(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, job_id BIGINT, product_id BIGINT, lot_id BIGINT, store_id BIGINT, qty BIGINT, unit_cost DOUBLE PRECISION, unit_price DOUBLE PRECISION, user_id BIGINT, ts BIGINT)',
    'CREATE TABLE IF NOT EXISTS soft_payments(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, job_id BIGINT, amount DOUBLE PRECISION, method TEXT, date TEXT, user_id BIGINT, note TEXT, account_id BIGINT)',
    'CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, kind TEXT NOT NULL, uid BIGINT NOT NULL, remember BIGINT DEFAULT 0, created BIGINT, last BIGINT, ip TEXT, ua TEXT)',
    'CREATE TABLE IF NOT EXISTS cust_msgs(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, customer_id BIGINT NOT NULL, type TEXT, message TEXT, ref TEXT, is_read BIGINT DEFAULT 0, ts BIGINT)',
    'CREATE INDEX IF NOT EXISTS ix_cmsg ON cust_msgs(customer_id, is_read)',
    'CREATE TABLE IF NOT EXISTS chat_convs(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, kind TEXT NOT NULL, name TEXT, dkey TEXT UNIQUE, created_by BIGINT, created_at BIGINT)',
    "CREATE TABLE IF NOT EXISTS chat_members(conv_id BIGINT NOT NULL, user_id BIGINT NOT NULL, role TEXT DEFAULT 'member', joined_at BIGINT, last_read_id BIGINT DEFAULT 0, PRIMARY KEY(conv_id,user_id))",
    'CREATE INDEX IF NOT EXISTS ix_cm_user ON chat_members(user_id)',
    'CREATE TABLE IF NOT EXISTS chat_msgs(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, conv_id BIGINT NOT NULL, user_id BIGINT NOT NULL, body TEXT, reply_to BIGINT, att_kind TEXT, att_name TEXT, att_file TEXT, att_size BIGINT, ts BIGINT, deleted BIGINT DEFAULT 0, deleted_by BIGINT, deleted_ts BIGINT)',
    'CREATE INDEX IF NOT EXISTS ix_msg_conv ON chat_msgs(conv_id,id)',
    'CREATE TABLE IF NOT EXISTS backups(file TEXT PRIMARY KEY, kind TEXT, size BIGINT, ts BIGINT, user_id BIGINT, note TEXT, verified_ts BIGINT, verified_ok BIGINT)',
    "CREATE TABLE IF NOT EXISTS items(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, type TEXT NOT NULL DEFAULT 'inventory', sku TEXT, name TEXT NOT NULL, category TEXT, unit TEXT DEFAULT 'pcs', sale_price DOUBLE PRECISION DEFAULT 0, cost DOUBLE PRECISION DEFAULT 0, qty DOUBLE PRECISION DEFAULT 0, reorder BIGINT DEFAULT 0, vendor_id BIGINT, description TEXT, active BIGINT DEFAULT 1, created_by BIGINT, created_at BIGINT, updated_at BIGINT)",
    'CREATE TABLE IF NOT EXISTS stock_moves(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, item_id BIGINT NOT NULL, date TEXT NOT NULL, ts BIGINT, qty DOUBLE PRECISION NOT NULL, unit_cost DOUBLE PRECISION, kind TEXT NOT NULL, ref_kind TEXT, ref_id BIGINT, user_id BIGINT, note TEXT, customer_id BIGINT, vendor_id BIGINT)',
    'CREATE INDEX IF NOT EXISTS ix_mv_item ON stock_moves(item_id, date)',
    'CREATE INDEX IF NOT EXISTS ix_mv_ref ON stock_moves(ref_kind, ref_id)',
    'CREATE TABLE IF NOT EXISTS vendors(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, contact TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT, active BIGINT DEFAULT 1, created_at BIGINT)',
    "CREATE TABLE IF NOT EXISTS bills(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, number TEXT UNIQUE, vendor_id BIGINT NOT NULL, date TEXT NOT NULL, due_date TEXT, ref TEXT, status TEXT DEFAULT 'open', total DOUBLE PRECISION DEFAULT 0, paid DOUBLE PRECISION DEFAULT 0, notes TEXT, user_id BIGINT, ts BIGINT, updated_at BIGINT, void_reason TEXT, voided_at BIGINT, voided_by BIGINT)",
    'CREATE TABLE IF NOT EXISTS bill_lines(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, bill_id BIGINT NOT NULL, item_id BIGINT, description TEXT, qty DOUBLE PRECISION, cost DOUBLE PRECISION, amount DOUBLE PRECISION)',
    'CREATE TABLE IF NOT EXISTS vendor_payments(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, bill_id BIGINT, vendor_id BIGINT NOT NULL, date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, method TEXT, ref TEXT, note TEXT, user_id BIGINT, ts BIGINT, account_id BIGINT)',
    'CREATE TABLE IF NOT EXISTS sdocs(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, kind TEXT NOT NULL, number TEXT UNIQUE, status TEXT, customer_id BIGINT, customer_name TEXT, phone TEXT, date TEXT NOT NULL, due_date TEXT, terms TEXT, notes TEXT, subtotal DOUBLE PRECISION DEFAULT 0, discount DOUBLE PRECISION DEFAULT 0, tax_rate DOUBLE PRECISION DEFAULT 0, tax DOUBLE PRECISION DEFAULT 0, total DOUBLE PRECISION DEFAULT 0, paid DOUBLE PRECISION DEFAULT 0, cost DOUBLE PRECISION DEFAULT 0, quote_id BIGINT, invoice_id BIGINT, user_id BIGINT, created_at BIGINT, updated_at BIGINT, void_reason TEXT, voided_at BIGINT, voided_by BIGINT)',
    'CREATE INDEX IF NOT EXISTS ix_sdoc_cust ON sdocs(customer_id)',
    'CREATE INDEX IF NOT EXISTS ix_sdoc_date ON sdocs(kind, date)',
    'CREATE TABLE IF NOT EXISTS sdoc_lines(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, doc_id BIGINT NOT NULL, item_id BIGINT, kind TEXT, description TEXT, qty DOUBLE PRECISION, rate DOUBLE PRECISION, amount DOUBLE PRECISION, unit_cost DOUBLE PRECISION DEFAULT 0)',
    'CREATE INDEX IF NOT EXISTS ix_sline_doc ON sdoc_lines(doc_id)',
    'CREATE TABLE IF NOT EXISTS cust_payments(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, doc_id BIGINT NOT NULL, customer_id BIGINT, date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, method TEXT, ref TEXT, note TEXT, user_id BIGINT, ts BIGINT, account_id BIGINT)',
    'CREATE INDEX IF NOT EXISTS ix_cpay_doc ON cust_payments(doc_id)',
    'CREATE TABLE IF NOT EXISTS exp_categories(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, active BIGINT DEFAULT 1)',
    'CREATE TABLE IF NOT EXISTS expense_entries(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, date TEXT NOT NULL, category_id BIGINT, payee TEXT, vendor_id BIGINT, amount DOUBLE PRECISION NOT NULL, method TEXT, ref TEXT, description TEXT, user_id BIGINT, ts BIGINT, account_id BIGINT)',
    'CREATE INDEX IF NOT EXISTS ix_exp_date ON expense_entries(date)',
    "CREATE TABLE IF NOT EXISTS money_accounts(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'cash', number TEXT, opening_balance DOUBLE PRECISION DEFAULT 0, opening_date TEXT, notes TEXT, active BIGINT DEFAULT 1, created_at BIGINT)",
    'CREATE TABLE IF NOT EXISTS acc_transfers(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, date TEXT NOT NULL, from_id BIGINT NOT NULL, to_id BIGINT NOT NULL, amount DOUBLE PRECISION NOT NULL, fee DOUBLE PRECISION DEFAULT 0, fee_expense_id BIGINT, ref TEXT, note TEXT, user_id BIGINT, ts BIGINT)',
    'CREATE TABLE IF NOT EXISTS acc_moves(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, account_id BIGINT NOT NULL, date TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, kind TEXT, ref TEXT, note TEXT, user_id BIGINT, ts BIGINT)',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_users_email ON users(lower(email))',                   # case-insensitive unique (was COLLATE NOCASE)
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_portal_email ON portal_accounts(lower(email))',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_items_name ON items(lower(name))',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_vendors_name ON vendors(lower(name))',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_expcat_name ON exp_categories(lower(name))',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_name ON money_accounts(lower(name))',
]
SCHEMA += [
    # chat attachments (the file content lives in the database, so it works on read-only / serverless hosting too)
    'CREATE TABLE IF NOT EXISTS chat_files(name TEXT PRIMARY KEY, mime TEXT, size BIGINT, data BYTEA, ts BIGINT)',
    # backup files, when they are kept in the database (Vercel) instead of data/backups
    'CREATE TABLE IF NOT EXISTS backup_files(file TEXT PRIMARY KEY, size BIGINT, ts BIGINT, data BYTEA)',
]
TABLES = [m.group(1) for m in (re.match(r'CREATE TABLE IF NOT EXISTS (\w+)', x) for x in SCHEMA) if m]

def schema() -> None:
    for stmt in SCHEMA: q(stmt)

def _flag(k: str) -> bool: return bool(val('SELECT 1 FROM settings WHERE k=?', (k,)))
def _set_flag(k: str) -> None: q("INSERT INTO settings(k,v) VALUES(?, '1') ON CONFLICT(k) DO NOTHING", (k,))

def migrate() -> None:
    """One-time upgrades. Every step is idempotent. A database moved over from SQLite already carries every flag, so
    nothing here runs again for it; on a brand-new database these steps just fill in the defaults.
    (The SQLite-only upgrades — old inventory ledger, ALTER TABLE columns, dropping the pre-accounting tables — are not needed:
    PostgreSQL tables are created complete, and the old tables never exist here.)"""
    if not _flag('mig_software'):
        for u in rows("SELECT id,perms FROM users WHERE is_admin=0 AND position='Software'"):
            p = json.loads(u['perms'] or '{}') or {}
            if 'software' not in p:
                p['software'] = ['view', 'add', 'edit', 'status']; q('UPDATE users SET perms=? WHERE id=?', (json.dumps(p), u['id']))
        _set_flag('mig_software')
    if not _flag('mig_phonekey'):
        for c in rows('SELECT id,phone FROM customers'):
            _try('UPDATE customers SET phone_key=? WHERE id=?', (phone_key(c['phone'] or ''), c['id']))
        _set_flag('mig_phonekey')
    if not _flag('mig_v3'):
        q("UPDATE soft_jobs SET status='in_progress' WHERE kind='repair' AND status='progress'")
        _set_flag('mig_v3')
    for k in ('mig_inv', 'mig_text', 'mig_v4', 'mig_v5', 'mig_v6'): _set_flag(k)    # SQLite-only steps (see above)
    if not _flag('mig_v7'):   # customer-linked reminders (extends the existing follow-up/reminder table — no new system)
        q("UPDATE followups SET status='done' WHERE done=1 AND (status IS NULL OR status='open')")
        _set_flag('mig_v7')
    if not _flag('mig_v8'):   # System Owner: one account above the Super Admins (the first Super Admin becomes the owner)
        if not val('SELECT 1 FROM users WHERE is_owner=1'):
            oid = val("SELECT MIN(id) FROM users WHERE is_admin=1 AND status='active'") or val('SELECT MIN(id) FROM users WHERE is_admin=1')
            if oid: q("UPDATE users SET is_owner=1, position='System Owner' WHERE id=?", (oid,))
        _set_flag('mig_v8')
    if not _flag('mig_v9'):   # QuickBooks-style accounting: starter service items and expense categories
        if not row("SELECT 1 FROM items WHERE type='service'"):
            for nm, pr in [('Apple Unlock', 30), ('New Apple ID', 10), ('Software Repair', 20), ('iOS Restore', 10), ('Account Service', 15), ('Screen replacement (labour)', 0)]:
                q("INSERT INTO items(type,name,category,sale_price,created_at) VALUES('service',?,'Services',?,?)", (nm, pr, now()))
        if not row('SELECT 1 FROM exp_categories'):
            from acc import DEFAULT_EXP_CATS
            for nm in DEFAULT_EXP_CATS: q('INSERT INTO exp_categories(name) VALUES(?)', (nm,))
        _set_flag('mig_v9')
    if not _flag('mig_v10'):  # money accounts (created by the user): every payment in or out lands in an account
        from acc import METHOD_ACCOUNT
        ids = {r['name'].lower(): r['id'] for r in rows('SELECT id,name FROM money_accounts')}
        cash = ids.get('cash') or (min(ids.values()) if ids else None)
        for t in ([] if not ids else ('cust_payments', 'vendor_payments', 'expense_entries', 'repair_payments', 'soft_payments')):
            for m in rows(f'SELECT DISTINCT method FROM {t} WHERE account_id IS NULL'):
                aid = ids.get(str(METHOD_ACCOUNT.get(m['method'] or '', m['method'] or '')).lower()) or cash
                q(f"UPDATE {t} SET account_id=? WHERE account_id IS NULL AND COALESCE(method,'')=?", (aid, m['method'] or ''))
        _set_flag('mig_v10')
    if not _flag('mig_v11'):  # accounts are defined by the user: remove the four starter accounts if they were never touched
        for a in rows("SELECT id FROM money_accounts WHERE lower(name) IN ('cash','zaad','edahab','bank') AND COALESCE(opening_balance,0)=0 AND COALESCE(number,'')='' AND COALESCE(notes,'')=''"):
            if val('SELECT 1 FROM acc_transfers WHERE from_id=? OR to_id=?', (a['id'], a['id'])) or val('SELECT 1 FROM acc_moves WHERE account_id=?', (a['id'],)): continue
            for t in ('cust_payments', 'vendor_payments', 'expense_entries', 'repair_payments', 'soft_payments'): q(f'UPDATE {t} SET account_id=NULL WHERE account_id=?', (a['id'],))
            q('DELETE FROM money_accounts WHERE id=?', (a['id'],))
        _set_flag('mig_v11')
    if not _flag('mig_chat_db'):  # chat attachments move from data/chat_files into the database
        d_ = os.path.join(DATA, 'chat_files')
        for f in (sorted(os.listdir(d_)) if os.path.isdir(d_) else []):
            p = os.path.join(d_, f)
            if os.path.isfile(p) and not val('SELECT 1 FROM chat_files WHERE name=?', (f,)):
                with open(p, 'rb') as fh: data = fh.read()
                q('INSERT INTO chat_files(name,mime,size,data,ts) VALUES(?,?,?,?,?)', (f, None, len(data), data, int(os.path.getmtime(p))))
        _set_flag('mig_chat_db')

def _has(table: str) -> bool: return bool(val("SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?", (table,)))


def default_perms(position: str) -> dict:
    if position == 'Software':
        return {'customers': ['view', 'add', 'edit'], 'appleid': ['view', 'add', 'edit', 'status'], 'regional': ['view', 'add', 'edit', 'status'], 'sales': ['view', 'add'], 'inventory': ['view'], 'software': ['view', 'add', 'edit', 'status']}
    return {'customers': ['view', 'add', 'edit'], 'repairs': ['view', 'add', 'edit', 'status'], 'appleid': ['view', 'add', 'edit', 'status'], 'inventory': ['view'], 'regional': ['view', 'add', 'status'], 'sales': ['view', 'add']}

def seed() -> None:
    q("INSERT INTO users(name,email,password,position,is_admin,status,perms,created_at) VALUES(?,?,?,?,1,?,?,?)", ('Super Admin', 'admin@hic.so', hash_pw('Admin@123'), 'Super Admin', 'active', '{}', now()))
    for k, v in {'company_name': 'HARGEISA IPHONE CENTER', 'slogan': 'Hubsiimo iyo Degdegsiimo', 'phone': '+252 63 0000000', 'email': 'info@hargeisaiphonecenter.com', 'address': 'Hargeisa, Somaliland',
                 'website': 'www.hargeisaiphonecenter.com', 'social': 'Facebook / Instagram / TikTok: @hargeisaiphonecenter', 'footer': '© HARGEISA IPHONE CENTER — Hubsiimo iyo Degdegsiimo', 'logo': '', 'currency': '$'}.items():
        q('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO NOTHING', (k, v))

INIT_LOCK = 72_001_001                                           # advisory lock id: only one server process sets up the database at a time

def setup(fresh_seed: bool = True) -> None:
    """Create / upgrade the tables inside the current transaction (also used after a restore and by the SQLite import)."""
    q('SELECT pg_advisory_xact_lock(?)', (INIT_LOCK,))
    schema()
    if fresh_seed and not val('SELECT 1 FROM users LIMIT 1'): seed()   # brand-new, empty database
    migrate()

SCHEMA_ID = __import__('hashlib').sha1('\n'.join(SCHEMA).encode()).hexdigest()[:16]    # changes whenever the table layout changes

def init_db() -> None:
    """Create / upgrade the database once at start-up. When the database already has this exact layout, nothing is re-run
    (keeps serverless cold starts fast)."""
    from flask import Flask
    app = Flask('init'); c = pool().getconn()
    try:
        with app.app_context():
            g.db = c
            try: current = val("SELECT v FROM settings WHERE k='schema_id'")
            except psycopg.Error: current = None                      # brand-new database: no tables yet
            if current == SCHEMA_ID: return
            q('BEGIN')
            try: setup(); set_setting('schema_id', SCHEMA_ID); q('COMMIT')
            except BaseException: q('ROLLBACK'); raise
    finally: release(c)


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


_KEY: list = []
def appkey() -> bytes:
    """The Apple ID encryption key: HIC_ENCRYPTION_KEY (or legacy HIC_APP_KEY), else data/app.key locally.
    A new key is only ever created on a normal server — on serverless hosting a missing key is an error, because a key made
    there would be lost and every password saved with it could never be read again."""
    if _KEY: return _KEY[0]
    k = (os.environ.get('HIC_ENCRYPTION_KEY') or os.environ.get('HIC_APP_KEY') or '').strip()
    if not k:
        f = os.path.join(DATA, 'app.key')
        if not os.path.exists(f):
            if ON_VERCEL: raise RuntimeError('The encryption key is missing; configure HIC_ENCRYPTION_KEY in the Vercel project settings.')
            with open(f, 'w') as fh: fh.write(secrets.token_hex(32))
        with open(f) as fh: k = fh.read().strip()
    try: key = bytes.fromhex(k)
    except ValueError as e: raise RuntimeError('The encryption key must be 64 hexadecimal characters.') from e
    if len(key) != 32: raise RuntimeError('The encryption key must be 64 hexadecimal characters.')
    _KEY.append(key); return key

def appkey_source() -> str:
    if os.environ.get('HIC_ENCRYPTION_KEY', '').strip(): return 'HIC_ENCRYPTION_KEY'
    if os.environ.get('HIC_APP_KEY', '').strip(): return 'HIC_APP_KEY'
    return 'app.key' if os.path.exists(os.path.join(DATA, 'app.key')) else 'missing'

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
    elif aud == 'all': ids = [r['id'] for r in rows("SELECT id FROM users WHERE status='active' ORDER BY id")]
    elif isinstance(aud, str) and aud.startswith('perm:'):
        mod = aud[5:]; ids = []
        for r in rows("SELECT id,is_admin,perms FROM users WHERE status='active' ORDER BY id"):
            p = json.loads(r['perms'] or '{}') or {}
            if r['is_admin'] or mod in p: ids.append(r['id'])
    else: ids = [r['id'] for r in rows("SELECT id FROM users WHERE status='active' AND is_admin=1 ORDER BY id")]
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
    add(rows("SELECT hic_day(p.ts) d, SUM(p.qty*p.unit_cost) v FROM repair_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND hic_day(p.ts) BETWEEN ? AND ? GROUP BY hic_day(p.ts)", (frm, to)), 'cost')
    add(rows("SELECT hic_day(p.ts) d, SUM(p.qty*p.unit_cost) v FROM soft_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND hic_day(p.ts) BETWEEN ? AND ? GROUP BY hic_day(p.ts)", (frm, to)), 'cost')
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
                        + sv("SELECT COALESCE(SUM(p.qty*p.unit_cost),0) FROM repair_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND hic_day(p.ts) BETWEEN ? AND ?", (frm, to))
                        + sv("SELECT COALESCE(SUM(p.qty*p.unit_cost),0) FROM soft_parts p JOIN items i ON i.id=p.product_id WHERE i.type<>'inventory' AND hic_day(p.ts) BETWEEN ? AND ?", (frm, to)),
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
    # claim this run atomically: requests run in parallel on PostgreSQL, and only one of them may send the alerts
    if not val("INSERT INTO settings(k,v) VALUES('last_check',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v "
               "WHERE (CASE WHEN settings.v ~ '^[0-9]+$' THEN CAST(settings.v AS BIGINT) ELSE 0 END) <= ? RETURNING k", (str(t), t - 50)): return
    td = today(); tomorrow = add_days(1).strftime('%Y-%m-%d')
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
    try:
        with savepoint(): smart_checks(td)
    except Exception: pass          # alerts must never break the heartbeat
    try:
        import h_chat
        with savepoint(): h_chat.purge_if_due(td)
    except Exception: pass
    if ON_VERCEL:                   # no background thread on serverless hosting: the heartbeat takes the daily automatic backup
        try:
            import h_center; h_center.auto_backup_if_due()
        except Exception as e: ERRLOG.append({'ts': now(), 'where': 'auto-backup', 'msg': redact_secrets(str(e))[:300]})


def last_backup_ts() -> int:
    """Newest backup (the file system — or the backup store in the database — is the source of truth, so this survives a restore)."""
    if BACKUPS_IN_DB: return int(val('SELECT COALESCE(MAX(ts),0) FROM backup_files') or 0)
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
                 f"UNION ALL SELECT {BAL_SOFT} b FROM soft_jobs j WHERE j.status IN ('completed','verified','took','instore','customer_received') AND COALESCE(j.updated_at,0)<?) x WHERE b>0.005", (t - 7 * 86400, t - 7 * 86400))
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
