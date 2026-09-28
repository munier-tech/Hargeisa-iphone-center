# HARGEISA IPHONE CENTER — Hubsiimo iyo Degdegsiimo

Repair management + customers + software services + Apple ID + inventory/stores + sales & services + expenses + finance +
users + notifications + regional repairs + customer portal.

**Backend: Python 3 (Flask + waitress + SQLite).** The front end, the database and every saved record are unchanged from the earlier PHP version.

## Run it
1. Double-click **START-SYSTEM.bat** (it installs the few required packages the first time).
2. Staff system: <http://localhost:8080> — Customer portal: <http://localhost:8080/portal>
3. From phones/tablets on the same Wi-Fi use the PC's IP: `http://192.168.x.x:8080`
4. Default login: `admin@hic.so` / `Admin@123` → change it in **My Profile** straight away.

First-time setup on a new PC: `winget install -e --id Python.Python.3.12`, then run START-SYSTEM.bat.
Optional environment variables: `HIC_HOST` (default `0.0.0.0`; use `127.0.0.1` for this-PC-only), `HIC_PORT` (default `8080`), `HIC_DB` (database path).

## Layout
- `server/` — Python backend: `app.py` (web server + API dispatcher), `core.py` (database, sessions, security, finance totals),
  `acc.py` (items & stock, stores & bills, quotations & invoices, payments, expenses), `h_reports.py` (all reports),
  `h_auth.py`, `h_ops.py`, `h_inv.py` (finance + customer portal), `h_soft.py`, `h_center.py`, `h_chat.py`, `h_owner.py` (API handlers)
- `public/` — the browser apps (`index.html` staff, `portal.html` customers, `assets/`)
- `data/` — `hic.sqlite` (database) and `app.key` (encryption key) — **back up both files together**
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
Close the server, run **RESET-DATABASE.bat** and type YES.

## Roll back to PHP (only if ever needed)
Move `legacy_php/app` back to `app/`, `legacy_php/router.php` to the project root and `legacy_php/api.php` to `public/`, then run
`C:\xampp\php\php.exe -S 0.0.0.0:8080 -t public router.php`. Note: since the accounting rebuild (25 Sep 2026) the PHP version no longer
understands the database — it only works with a backup made before that date.

## System Center (Super Admin)
Sidebar → **System Center**: Management Analytics, Employee Activity, Advanced Audit Log, Security & Permissions, Backup & Restore, Data Recovery, System Health.
- **Backups** are saved in `data\backups\` (automatic daily + manual). Copy that folder — and `data\app.key` — to a USB drive regularly.
  Restore from the app (Backup & Restore → Restore) or manually: copy a backup over `data\hic.sqlite` with the server stopped.
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
