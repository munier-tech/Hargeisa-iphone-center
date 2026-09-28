"""Copy the whole database between PostgreSQL and a SQLite file (same tables, same columns, same ids).

Used for:
  * the one-time move of data/hic.sqlite into PostgreSQL (server/migrate_sqlite_to_pg.py),
  * System Center backups: the live PostgreSQL data is written to a normal hic_*.sqlite file (it can be downloaded,
    verified and test-restored exactly as before, and even opened by the older SQLite version of the system),
  * System Center restore: a backup file is loaded back into PostgreSQL inside the request transaction (all or nothing).

A SQLite source is only ever opened read-only.
"""
from __future__ import annotations

import os, sqlite3

import core

# The SQLite layout (identical to the database the SQLite version of the system created, including every column
# that was added later with ALTER TABLE), so a backup file is a complete, stand-alone hic.sqlite.
SQLITE_SCHEMA = """
CREATE TABLE settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL, position TEXT NOT NULL DEFAULT 'Technician', is_admin INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', avatar TEXT, perms TEXT DEFAULT '{}', logged_in INTEGER DEFAULT 0, last_seen INTEGER DEFAULT 0, session_start INTEGER DEFAULT 0, created_at INTEGER, approved_by INTEGER, deactivated_at INTEGER, deactivated_by INTEGER, deactivate_reason TEXT, chat_perms TEXT, is_owner INTEGER DEFAULT 0);
CREATE TABLE activity(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER, detail TEXT, ts INTEGER, ip TEXT);
CREATE INDEX ix_act_ts ON activity(ts);
CREATE INDEX ix_act_user ON activity(user_id);
CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT, message TEXT, link TEXT, is_read INTEGER DEFAULT 0, ts INTEGER, ref TEXT);
CREATE INDEX ix_notif_user ON notifications(user_id, is_read);
CREATE TABLE customers(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, phone_key TEXT NOT NULL UNIQUE, email TEXT, gender TEXT, address TEXT, notes TEXT, created_by INTEGER, created_at INTEGER, position TEXT DEFAULT 'Regular');
CREATE TABLE followups(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, type TEXT, note TEXT, due_date TEXT, done INTEGER DEFAULT 0, ref_kind TEXT, ref_id INTEGER, created_by INTEGER, created_at INTEGER, done_at INTEGER, title TEXT, time TEXT, scheduled_at INTEGER, priority TEXT DEFAULT 'normal', repeat_rule TEXT DEFAULT 'none', snooze_until INTEGER, status TEXT DEFAULT 'open', source TEXT DEFAULT 'system', updated_at INTEGER);
CREATE TABLE repairs(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, device TEXT, imei TEXT, problem TEXT, diagnosis TEXT, diagnosis_notes TEXT, required_parts TEXT, technician_id INTEGER, status TEXT DEFAULT 'received', progress_notes TEXT, test_result TEXT, outcome TEXT, received_at INTEGER, expected_date TEXT, price REAL DEFAULT 0, discount REAL DEFAULT 0, created_by INTEGER, updated_at INTEGER, closed_at INTEGER);
CREATE TABLE repair_events(id INTEGER PRIMARY KEY AUTOINCREMENT, repair_id INTEGER, status TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE repair_parts(id INTEGER PRIMARY KEY AUTOINCREMENT, repair_id INTEGER, product_id INTEGER, lot_id INTEGER, store_id INTEGER, qty INTEGER, unit_cost REAL, unit_price REAL, user_id INTEGER, ts INTEGER);
CREATE TABLE repair_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, repair_id INTEGER, amount REAL, method TEXT, date TEXT, user_id INTEGER, note TEXT, account_id INTEGER);
CREATE TABLE appleids(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT, phone TEXT, model TEXT, apple_id TEXT, pw_enc TEXT, description TEXT, date TEXT, created_by INTEGER, hidden INTEGER DEFAULT 0, status TEXT DEFAULT 'request', request_date TEXT, expected_date TEXT, assigned_to INTEGER, notes TEXT, last_notified TEXT, updated_at INTEGER, ts INTEGER);
CREATE TABLE regional(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT, phone TEXT, device TEXT, problem TEXT, region TEXT, sent_to TEXT, date_sent TEXT, technician TEXT, parts TEXT, cost REAL DEFAULT 0, status TEXT DEFAULT 'received', expected_return TEXT, actual_return TEXT, notes TEXT, created_by INTEGER, ts INTEGER);
CREATE TABLE portal_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, name TEXT, phone TEXT, email TEXT UNIQUE COLLATE NOCASE, password TEXT, status TEXT DEFAULT 'pending', created_at INTEGER, last_login INTEGER, approved_by INTEGER);
CREATE TABLE login_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT, ts INTEGER);
CREATE TABLE soft_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, customer_id INTEGER NOT NULL, device TEXT, imei TEXT, problem TEXT, diagnosis TEXT, apple_id TEXT, lock_info TEXT, technician_id INTEGER, status TEXT, progress_notes TEXT, test_result TEXT, notes TEXT, tools TEXT, request_date TEXT, expected_date TEXT, account_date TEXT, price REAL DEFAULT 0, discount REAL DEFAULT 0, created_by INTEGER, received_at INTEGER, updated_at INTEGER, closed_at INTEGER, last_notified TEXT, serial TEXT, gmail_pw TEXT, apple_pw TEXT);
CREATE INDEX ix_soft_cust ON soft_jobs(customer_id);
CREATE TABLE soft_events(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, status TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE soft_parts(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, product_id INTEGER, lot_id INTEGER, store_id INTEGER, qty INTEGER, unit_cost REAL, unit_price REAL, user_id INTEGER, ts INTEGER);
CREATE TABLE soft_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, amount REAL, method TEXT, date TEXT, user_id INTEGER, note TEXT, account_id INTEGER);
CREATE TABLE sessions(id TEXT PRIMARY KEY, kind TEXT NOT NULL, uid INTEGER NOT NULL, remember INTEGER DEFAULT 0, created INTEGER, last INTEGER, ip TEXT, ua TEXT);
CREATE TABLE cust_msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, type TEXT, message TEXT, ref TEXT, is_read INTEGER DEFAULT 0, ts INTEGER);
CREATE INDEX ix_cmsg ON cust_msgs(customer_id, is_read);
CREATE TABLE chat_convs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, name TEXT, dkey TEXT UNIQUE, created_by INTEGER, created_at INTEGER);
CREATE TABLE chat_members(conv_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT DEFAULT 'member', joined_at INTEGER, last_read_id INTEGER DEFAULT 0, PRIMARY KEY(conv_id,user_id));
CREATE INDEX ix_cm_user ON chat_members(user_id);
CREATE TABLE chat_msgs(id INTEGER PRIMARY KEY AUTOINCREMENT, conv_id INTEGER NOT NULL, user_id INTEGER NOT NULL, body TEXT, reply_to INTEGER, att_kind TEXT, att_name TEXT, att_file TEXT, att_size INTEGER, ts INTEGER, deleted INTEGER DEFAULT 0, deleted_by INTEGER, deleted_ts INTEGER);
CREATE INDEX ix_msg_conv ON chat_msgs(conv_id,id);
CREATE TABLE backups(file TEXT PRIMARY KEY, kind TEXT, size INTEGER, ts INTEGER, user_id INTEGER, note TEXT, verified_ts INTEGER, verified_ok INTEGER);
CREATE TABLE items(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'inventory', sku TEXT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, category TEXT, unit TEXT DEFAULT 'pcs', sale_price REAL DEFAULT 0, cost REAL DEFAULT 0, qty REAL DEFAULT 0, reorder INTEGER DEFAULT 0, vendor_id INTEGER, description TEXT, active INTEGER DEFAULT 1, created_by INTEGER, created_at INTEGER, updated_at INTEGER);
CREATE TABLE stock_moves(id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL, date TEXT NOT NULL, ts INTEGER, qty REAL NOT NULL, unit_cost REAL, kind TEXT NOT NULL, ref_kind TEXT, ref_id INTEGER, user_id INTEGER, note TEXT, customer_id INTEGER, vendor_id INTEGER);
CREATE INDEX ix_mv_item ON stock_moves(item_id, date);
CREATE INDEX ix_mv_ref ON stock_moves(ref_kind, ref_id);
CREATE TABLE vendors(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, contact TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE bills(id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT UNIQUE, vendor_id INTEGER NOT NULL, date TEXT NOT NULL, due_date TEXT, ref TEXT, status TEXT DEFAULT 'open', total REAL DEFAULT 0, paid REAL DEFAULT 0, notes TEXT, user_id INTEGER, ts INTEGER, updated_at INTEGER, void_reason TEXT, voided_at INTEGER, voided_by INTEGER);
CREATE TABLE bill_lines(id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER NOT NULL, item_id INTEGER, description TEXT, qty REAL, cost REAL, amount REAL);
CREATE TABLE vendor_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER, vendor_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL, method TEXT, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER, account_id INTEGER);
CREATE TABLE sdocs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, number TEXT UNIQUE, status TEXT, customer_id INTEGER, customer_name TEXT, phone TEXT, date TEXT NOT NULL, due_date TEXT, terms TEXT, notes TEXT, subtotal REAL DEFAULT 0, discount REAL DEFAULT 0, tax_rate REAL DEFAULT 0, tax REAL DEFAULT 0, total REAL DEFAULT 0, paid REAL DEFAULT 0, cost REAL DEFAULT 0, quote_id INTEGER, invoice_id INTEGER, user_id INTEGER, created_at INTEGER, updated_at INTEGER, void_reason TEXT, voided_at INTEGER, voided_by INTEGER);
CREATE INDEX ix_sdoc_cust ON sdocs(customer_id);
CREATE INDEX ix_sdoc_date ON sdocs(kind, date);
CREATE TABLE sdoc_lines(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, item_id INTEGER, kind TEXT, description TEXT, qty REAL, rate REAL, amount REAL, unit_cost REAL DEFAULT 0);
CREATE INDEX ix_sline_doc ON sdoc_lines(doc_id);
CREATE TABLE cust_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id INTEGER NOT NULL, customer_id INTEGER, date TEXT NOT NULL, amount REAL NOT NULL, method TEXT, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER, account_id INTEGER);
CREATE INDEX ix_cpay_doc ON cust_payments(doc_id);
CREATE TABLE exp_categories(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, active INTEGER DEFAULT 1);
CREATE TABLE expense_entries(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, category_id INTEGER, payee TEXT, vendor_id INTEGER, amount REAL NOT NULL, method TEXT, ref TEXT, description TEXT, user_id INTEGER, ts INTEGER, account_id INTEGER);
CREATE INDEX ix_exp_date ON expense_entries(date);
CREATE TABLE money_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, type TEXT DEFAULT 'cash', number TEXT, opening_balance REAL DEFAULT 0, opening_date TEXT, notes TEXT, active INTEGER DEFAULT 1, created_at INTEGER);
CREATE TABLE acc_transfers(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, amount REAL NOT NULL, fee REAL DEFAULT 0, fee_expense_id INTEGER, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE chat_files(name TEXT PRIMARY KEY, mime TEXT, size INTEGER, data BLOB, ts INTEGER);
CREATE TABLE acc_moves(id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, date TEXT NOT NULL, amount REAL NOT NULL, kind TEXT, ref TEXT, note TEXT, user_id INTEGER, ts INTEGER);
"""


def pg_columns(c) -> dict:
    """{table: [column, …]} for the system's tables in PostgreSQL (in table order)."""
    cols: dict = {t: [] for t in core.TABLES}
    for r in c.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=current_schema() ORDER BY table_name, ordinal_position").fetchall():
        if r['table_name'] in cols: cols[r['table_name']].append(r['column_name'])
    return {t: v for t, v in cols.items() if v}

def sqlite_columns(s: sqlite3.Connection) -> dict:
    return {t: [x[1] for x in s.execute(f'PRAGMA table_info("{t}")').fetchall()]
            for (t,) in s.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()}

KEEP_IF_MISSING = {'backup_files', 'chat_files'}   # a source without these tables (backup store, older backups) leaves them as they are

def _has_id(t: str) -> bool: return t not in core.NO_ID          # tables with a generated numeric id

def _cols(cols: list) -> str: return ', '.join(f'"{x}"' for x in cols)       # quoted: some column names (time, date, position) are SQL keywords


def sqlite_to_pg(src_path: str, c, log=None) -> dict:
    """Replace every table's content in PostgreSQL with the SQLite file's content. Runs inside the caller's transaction on
    connection `c` (a psycopg connection) — nothing is visible to anyone else until the caller commits.
    Returns {table: rows copied}."""
    s = sqlite3.connect(f'file:{os.path.abspath(src_path)}?mode=ro', uri=True)
    try:
        pgc, slc = pg_columns(c), sqlite_columns(s)
        seqs = dict(s.execute('SELECT name, seq FROM sqlite_sequence').fetchall()) if 'sqlite_sequence' in {r[0] for r in s.execute("SELECT name FROM sqlite_master WHERE type='table'")} else {}
        pgc = {t: v for t, v in pgc.items() if t in slc or t not in KEEP_IF_MISSING}
        c.execute('TRUNCATE ' + ', '.join(pgc))
        counts = {}
        for t, cols in pgc.items():
            common = [x for x in cols if x in slc.get(t, [])]
            n = 0
            if common:
                with c.cursor() as cur, cur.copy(f'COPY {t} ({_cols(common)}) FROM STDIN') as cp:
                    for r in s.execute(f'SELECT {_cols(common)} FROM "{t}"'):
                        cp.write_row(r); n += 1
            counts[t] = n
            if _has_id(t):                  # continue numbering after the highest id ever used (as SQLite AUTOINCREMENT did)
                top = max(int(c.execute(f'SELECT COALESCE(MAX(id),0) m FROM {t}').fetchone()['m']), int(seqs.get(t) or 0))
                c.execute(f"SELECT setval(pg_get_serial_sequence('{t}','id'), {max(top, 1)}, {'true' if top > 0 else 'false'})")
            if log: log(f'  {t:<18} {n:>7} row(s)')
        return counts
    finally: s.close()


def pg_to_sqlite(c, dest_path: str) -> dict:
    """Write a consistent snapshot of the PostgreSQL data to a new SQLite file (used by backups). `c` must be a connection
    that is not in a transaction; the snapshot is read in one REPEATABLE READ transaction."""
    tmp = dest_path + '.part'
    if os.path.exists(tmp): os.remove(tmp)
    s = sqlite3.connect(tmp)
    try:
        s.executescript(SQLITE_SCHEMA)
        slc = sqlite_columns(s); counts = {}
        c.execute('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        try:
            pgc = pg_columns(c)
            for t, cols in pgc.items():
                common = [x for x in cols if x in slc.get(t, [])]
                if not common: continue
                data = [tuple(r[x] for x in common) for r in c.execute(f'SELECT {_cols(common)} FROM {t}').fetchall()]
                s.executemany(f'INSERT INTO "{t}" ({_cols(common)}) VALUES ({", ".join("?" * len(common))})', data)
                counts[t] = len(data)
                if _has_id(t):              # keep the id counters too, so a restore never re-uses a deleted id
                    sq = c.execute(f"SELECT pg_get_serial_sequence('{t}','id') s").fetchone()['s']
                    last = c.execute(f'SELECT last_value, is_called FROM {sq}').fetchone()
                    top = int(last['last_value']) if last['is_called'] else 0
                    if top:
                        s.execute('DELETE FROM sqlite_sequence WHERE name=?', (t,))
                        s.execute('INSERT INTO sqlite_sequence(name, seq) VALUES(?, ?)', (t, top))
        finally: c.execute('COMMIT')
        s.commit()
    finally: s.close()
    os.replace(tmp, dest_path)
    return counts
