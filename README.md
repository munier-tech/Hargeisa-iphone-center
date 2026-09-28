# HARGEISA IPHONE CENTER — Hubsiimo iyo Degdegsiimo

Repair management + customers + software services + Apple ID + inventory/stores + sales & services + expenses + finance +
users + notifications + regional repairs + customer portal.

**Backend: Python 3 (Flask + waitress + PostgreSQL on Neon).** The front end, the API and every saved record are unchanged; the data moved
from `data\hic.sqlite` to PostgreSQL (the SQLite file is kept untouched as an archive).

## Run it
1. Set `DATABASE_URL` once (see *Database* below).
2. Double-click **START-SYSTEM.bat** (it installs the few required packages the first time).
3. Staff system: <http://localhost:8080> — Customer portal: <http://localhost:8080/portal>
4. From phones/tablets on the same Wi-Fi use the PC's IP: `http://192.168.x.x:8080`
5. Default login on a brand-new, empty database: `admin@hic.so` / `Admin@123` → change it in **My Profile** straight away.

First-time setup on a new PC: `winget install -e --id Python.Python.3.12`, then run START-SYSTEM.bat.
Environment variables: `DATABASE_URL` (**required** — the PostgreSQL / Neon connection string), `HIC_HOST` (default `0.0.0.0`; use `127.0.0.1`
for this-PC-only), `HIC_PORT` (default `8080`), `HIC_DATA_DIR` (folder for `app.key`, backups and chat files; default `data`), `HIC_DB_POOL`
(database connections kept open, default 12).

## Database: PostgreSQL (Neon)
The connection string is **never** stored in the source code. The server reads it from the `DATABASE_URL` environment variable, or —
if that is not set — from a file named `.env` in the project folder (git-ignored; see `.env.example`):

    DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require&channel_binding=require

Python packages (in `requirements.txt`, installed by START-SYSTEM.bat): `psycopg[binary]` (PostgreSQL driver, includes its own libpq —
nothing else to install on Windows) and `psycopg-pool` (keeps connections to Neon open between requests).

**Moving the old SQLite data into PostgreSQL (one time):**
1. Stop the server (close its window) so nothing new is written to SQLite.
2. `python -m pip install -r requirements.txt`
3. Set `DATABASE_URL` (or create `.env`).
4. `python server\migrate_sqlite_to_pg.py`
   It copies `data\hic.sqlite` to a temporary folder and reads only the copy (your file is never opened for writing), creates the
   tables, copies every row with the same ids in ONE transaction, compares the row count of every table and only then commits.
   If PostgreSQL already holds business data it stops; add `--replace` to overwrite it. `--sqlite PATH` imports another file.
5. Start the server with START-SYSTEM.bat and sign in with your usual account.

Notes: `data\app.key` still decrypts the Apple ID passwords, and chat attachments stay in `data\chat_files` — keep both.
Dates in SQL use Hargeisa time (UTC+3) everywhere. Neon suspends an idle database after a few minutes; the first request after that takes
a second or two. Host the server close to the Neon region (or choose a Neon region close to the server) — every page makes several queries.


## Layout
- `server/` — Python backend: `app.py` (web server + API dispatcher), `core.py` (database, sessions, security, finance totals),
  `acc.py` (items & stock, stores & bills, quotations & invoices, payments, expenses), `h_reports.py` (all reports),
  `h_auth.py`, `h_ops.py`, `h_inv.py` (finance + customer portal), `h_soft.py`, `h_center.py`, `h_chat.py`, `h_owner.py` (API handlers),
  `pgsync.py` (PostgreSQL ⇄ SQLite copy for backups / restore), `migrate_sqlite_to_pg.py` (one-time move of `hic.sqlite`)
- `public/` — the browser apps (`index.html` staff, `portal.html` customers, `assets/`)
- `data/` — `app.key` (encryption key — **keep it with your backups**), `backups/`, `chat_files/`, and the old `hic.sqlite` (archive, no longer used)
- `legacy_php/` — the previous PHP backend, kept only as a rollback copy

## Security model (enforced in Python, not just hidden in the UI)
- Passwords are bcrypt-hashed (old PHP hashes keep working). Failed logins are counted per email and lock out after 8 tries in 10 minutes.
- Sessions are stored server-side (revocable): logging out or deactivating a user ends the session immediately. Cookies are HttpOnly + SameSite=Lax;
  "Remember me" lasts 30 days, otherwise 12 hours; the browser also signs out after 30 minutes of inactivity.
- Every API call needs a custom header (CSRF defence). Permissions per module (View / Add / Edit / Update status / Delete / Full) are checked on every call.
- Finance, Users, Portal management, store editing, branding and settlement re-opening are Super Admin only.
- Apple ID and New Apple ID passwords are AES-256-GCM encrypted (same key file as before). Hidden records are filtered out of every query for everyone but the Super Admin.
  Reveal/print/export are audited. Customer-portal users only ever receive their own devices, never credentials.
- The audit log (Users → Activity & audit log) records who created / edited / deleted / approved / changed things.

## Sales & Accounting (QuickBooks-style) — sidebar group "Sales & Accounting"
Rebuilt on 25 Sep 2026; the old sales / expenses / stores / inventory tables and their data were removed (the last copy with the old
data is `data\backups\hic_auto_20260925_094238.sqlite`). Restoring any older backup converts it the same way.
- **Inventory** — items are *stock items* (quantity counted, moving-average cost), *services* or *non-stock items*. Opening stock,
  adjustments (count, damaged, lost…) and a full movement history per item. Low-stock alerts use each item's reorder level.
- **Stores / Suppliers** — the shops you buy from. A **bill** (purchase) adds stock at its cost and records what you owe;
  **Pay a store** spreads one payment over open bills. A/P aging shows what is late.
- **Quotations** — offers to customers; never touch stock or money. **Convert to invoice** when accepted.
- **Invoices** — stock leaves inventory at average cost (cost of goods sold); due dates, partial payments, overdue tracking,
  void (keeps the record) or delete. **Receive payment** spreads one payment over a customer's open invoices (oldest first).
- **Expenses** — editable categories, payee or store, payment method (Cash, ZAAD, eDahab, EVC, bank, card…).
- **Reports** — Profit & Loss (and by month), sales by customer / item / staff / period, invoice & quotation lists, payments received,
  A/R aging, customer statement, expenses by category & detail, purchases, A/P aging, store payments, inventory valuation,
  low stock, stock movements, repairs, software, follow-ups. Every report filters by date range, customer, staff, item, store,
  category, status and method, shows totals, and prints / saves as PDF or exports to Excel. Cost and profit are Super Admin only.
- **Sales receipts** (SR-00001) — a sale paid in full on the spot: stock leaves inventory and the money goes straight into the
  chosen account. Edit moves the money to the new amount/account; Void takes the money back out and returns the stock.
- **Accounts & Wallets** — money accounts you create yourself (e.g. "Cash drawer", "ZAAD 063…", "eDahab", a bank) with live balances.
  No accounts are predefined; payments made before any account existed are not in an account. Every payment received
  (invoices, repairs, software jobs) goes *into* an account and every payment made (stores, expenses) comes *out* of one — the form
  picks the account that matches the payment method, and you can change it. **Transfer** moves money between accounts (an optional
  fee is recorded as an expense); **Deposit / withdraw** is for owner capital or drawings (not income or expense). Click an account
  for its register with a running balance. Set each account's **opening balance** once so the balances match reality.
  Permission: "Accounts & wallets" (Users → Edit). Reports: account balances, account transactions, transfers.
- In every list, click a row to open the full record. Invoice and quotation forms start with the customer, like QuickBooks.
- Parts used in hardware and software repairs are taken from the same inventory.
- Settings → Invoices & documents: invoice / quotation prefixes, default tax %, payment terms, quotation validity.

## Reset to a clean database
The data is in PostgreSQL now, so RESET-DATABASE.bat no longer deletes anything. To start clean, create a new empty Neon database
(or branch), point `DATABASE_URL` at it and start the server — the tables and the default admin are created automatically.

## Roll back to PHP (only if ever needed)
Move `legacy_php/app` back to `app/`, `legacy_php/router.php` to the project root and `legacy_php/api.php` to `public/`, then run
`C:\xampp\php\php.exe -S 0.0.0.0:8080 -t public router.php`. Note: since the accounting rebuild (25 Sep 2026) the PHP version no longer
understands the database — it only works with a backup made before that date.

## System Center (Super Admin)
Sidebar → **System Center**: Management Analytics, Employee Activity, Advanced Audit Log, Security & Permissions, Backup & Restore, Data Recovery, System Health.
- **Backups** are saved in `data\backups\` (automatic daily + manual) as complete SQLite snapshots of the PostgreSQL data. Copy that
  folder — and `data\app.key` — to a USB drive regularly. Restore from the app (Backup & Restore → Restore; it runs in one transaction and
  takes a safety copy first) or manually with the server stopped: `python server\migrate_sqlite_to_pg.py --sqlite data\backups\FILE --replace`.
  Neon also keeps its own point-in-time history (Neon console → Restore).
- **Documents** (invoice, receipt, device slip, repair report) open the print dialog — choose *Save as PDF* for a PDF. Settings → Invoices & documents.
- **Phone / PWA**: open the site on the phone → *Add to Home Screen* (install needs `https` or `localhost`; over plain Wi-Fi it still works as a normal site with a bottom menu).
- **Customer portal**: customers enter with their registered number (first time needs approval) and see devices, billing, payment history and messages.

## System Owner (above the Super Admins)
One account is the **System Owner** (the first Super Admin was promoted automatically). Sidebar → **Owner Control**:
- **Sidebar menu** — reorder items, rename items and groups, hide an item from everyone, or choose which roles
  (Technician / Software / Super Admin) and which people see it. Dashboard and My Profile can be renamed but never hidden.
  The owner always sees every item (hidden ones look faded), so the menu can never lock the owner out. Open screens update within seconds.
- **Modules on / off** — switch off Customers, Repairs, Software, Apple ID, Inventory, Stores, Regional, Sales, Expenses, Reports,
  Customer portal, Finance or Chat. An off module is refused **by the server** for everyone except the owner (Super Admins included). No data is deleted.
- **Super Admins** — only the owner can add, edit, reset the password of, deactivate or remove a Super Admin, or turn staff into a
  Super Admin (Users → Edit → Role). Super Admins cannot change, deactivate or sign out the owner.
Menu visibility is a screen setting; what a person may actually *do* is still decided by their permissions and the module switches (both checked on the server).

## Internal Chat
Sidebar -> **Chat** (staff to staff): 1-to-1 and group chats, online/offline + last seen, typing, unread counts, read ticks, replies, delete own message, search, emoji, image/PDF/document attachments and voice notes (voice needs https or localhost).
Super Admin -> System Center -> **Chat Permissions**: who can chat, create groups, add members, attach files, delete messages, voice notes; chat on/off; retention; largest file.
Attachments live in `data\chat_files` - copy that folder with your backups.
