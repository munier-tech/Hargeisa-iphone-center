"""One-time move of the existing SQLite database (data/hic.sqlite) into PostgreSQL / Neon.

    python server/migrate_sqlite_to_pg.py                 # import data/hic.sqlite
    python server/migrate_sqlite_to_pg.py --sqlite PATH   # import another SQLite file (e.g. a backup)
    python server/migrate_sqlite_to_pg.py --replace       # allow replacing data already in PostgreSQL

Safety:
  * The SQLite file is NEVER opened or changed: it is first copied to a temporary folder and only the copy is read.
  * Everything is written in ONE PostgreSQL transaction — if anything fails, PostgreSQL is left exactly as it was.
  * After the copy, the row count of every table is compared between SQLite and PostgreSQL before committing.
  * If PostgreSQL already holds business data, the script stops unless --replace is given.

The connection string is read from the DATABASE_URL environment variable (or the project's .env file) — never from this file.
Stop the server before running this, so no new records are written to SQLite during the move.
"""
from __future__ import annotations

import argparse, os, shutil, sqlite3, sys, tempfile, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core, pgsync
from flask import Flask, g

SEED_ONLY = {'settings', 'users', 'items', 'exp_categories', 'activity', 'notifications', 'login_attempts', 'sessions', 'backups', 'backup_files', 'chat_files'}   # what a brand-new, never-used database contains


def main() -> int:
    ap = argparse.ArgumentParser(description='Copy the SQLite database into PostgreSQL (Neon).')
    ap.add_argument('--sqlite', default=os.path.join(core.DATA, 'hic.sqlite'), help='SQLite file to import (default: data/hic.sqlite)')
    ap.add_argument('--replace', action='store_true', help='replace data that is already in PostgreSQL')
    a = ap.parse_args()
    src = os.path.abspath(a.sqlite)
    if not os.path.isfile(src): print(f'SQLite file not found: {src}'); return 1
    try: core.db_url()
    except RuntimeError as e: print(e); return 1
    print(f'Source : {src}  ({os.path.getsize(src) / 1e6:.2f} MB) - read-only copy, the file itself is not touched')
    print(f'Target : {core.db_label()}')

    tmpdir = tempfile.mkdtemp(prefix='hic_migrate_')
    try:
        snap = os.path.join(tmpdir, 'hic.sqlite')
        for ext in ('', '-wal', '-shm'):                      # the copy includes any not-yet-checkpointed WAL data
            if os.path.exists(src + ext): shutil.copy2(src + ext, snap + ext)
        s = sqlite3.connect(snap)                             # (the copy, never the original)
        try:
            if s.execute('PRAGMA integrity_check').fetchone()[0] != 'ok': print('The SQLite copy failed its integrity check - nothing was imported.'); return 1
            s.execute('PRAGMA wal_checkpoint(TRUNCATE)')      # fold the WAL into the copy so the read-only import sees everything
            src_counts = {t: s.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for (t,) in s.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()}
        finally: s.close()
        if 'sdocs' not in src_counts: print('This SQLite file is from before the accounting rebuild. Start the SQLite version of the system on it once (it upgrades itself), then import it.'); return 1

        app = Flask('migrate'); c = core.pool().getconn()
        try:
            with app.app_context():
                g.db = c
                core.q('BEGIN')
                try:
                    core.setup(fresh_seed=False)                      # create the tables if they do not exist yet
                    have = {t: int(core.val(f'SELECT COUNT(*) FROM {t}')) for t in core.TABLES}
                    in_use = {t: n for t, n in have.items() if n and (t not in SEED_ONLY or (t == 'users' and n > 1))}
                    if in_use and not a.replace:
                        core.q('ROLLBACK')
                        print('\nPostgreSQL already contains business data: ' + ', '.join(f'{t} ({n})' for t, n in in_use.items()))
                        print('Nothing was changed. Run again with --replace to overwrite it with the SQLite data.'); return 1
                    t0 = time.time(); print('\nCopying tables:')
                    copied = pgsync.sqlite_to_pg(snap, c, log=print)
                    mismatch, skipped = [], []
                    for t, n in src_counts.items():
                        if t in copied:
                            pg_n = int(core.val(f'SELECT COUNT(*) FROM {t}'))
                            if pg_n != n: mismatch.append(f'{t}: SQLite {n} / PostgreSQL {pg_n}')
                        elif n: skipped.append(f'{t}: {n} row(s) — table is not used by the current system, not copied')
                    if mismatch:
                        core.q('ROLLBACK'); print('\nRow counts do not match - nothing was committed:\n  ' + '\n  '.join(mismatch)); return 1
                    core.migrate()                                    # after the check: upgrades the copied data to this version (e.g. chat files into the database)
                    core.q('COMMIT')
                except BaseException:
                    if core.in_tx(): core.q('ROLLBACK')
                    raise
        finally: core.release(c)
        for x in skipped: print('  note: ' + x)
        print(f'\nDone in {time.time() - t0:.1f} s - {sum(copied.values())} rows in {len(copied)} tables, all row counts verified.')
        print(f'Your SQLite file was not modified: {src}')
        return 0
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
