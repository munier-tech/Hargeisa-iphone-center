<?php
declare(strict_types=1);
date_default_timezone_set('Africa/Mogadishu');

define('ROOT', dirname(__DIR__));
define('DATA', ROOT . '/data');
if (!is_dir(DATA)) mkdir(DATA, 0775, true);

class ApiError extends Exception {
    public array $extra;
    public function __construct(string $m, int $code = 400, array $extra = []) { parent::__construct($m, $code); $this->extra = $extra; }
}

/* ------------------------------------------------------------ database */
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $new = !file_exists(DATA . '/hic.sqlite');
    $pdo = new PDO('sqlite:' . DATA . '/hic.sqlite');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    schema($pdo);
    if ($new) seed($pdo);
    migrate($pdo);
    return $pdo;
}
function q(string $sql, array $p = []): PDOStatement { $s = db()->prepare($sql); $s->execute($p); return $s; }
function rows(string $sql, array $p = []): array { return q($sql, $p)->fetchAll(); }
function row(string $sql, array $p = []): ?array { $r = q($sql, $p)->fetch(); return $r ?: null; }
function val(string $sql, array $p = []) { $r = q($sql, $p)->fetch(PDO::FETCH_NUM); return $r ? $r[0] : null; }
function ins(string $table, array $d): int {
    $c = array_keys($d);
    q("INSERT INTO $table(" . implode(',', $c) . ') VALUES(' . implode(',', array_fill(0, count($c), '?')) . ')', array_values($d));
    return (int)db()->lastInsertId();
}
function upd(string $table, int $id, array $d): void {
    if (!$d) return;
    q("UPDATE $table SET " . implode(',', array_map(fn($c) => "$c=?", array_keys($d))) . ' WHERE id=?', [...array_values($d), $id]);
}

function schema(PDO $pdo): void {
    $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS settings(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL, position TEXT NOT NULL DEFAULT 'Technician', is_admin INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', avatar TEXT, perms TEXT DEFAULT '{}',
  logged_in INTEGER DEFAULT 0, last_seen INTEGER DEFAULT 0, session_start INTEGER DEFAULT 0,
  created_at INTEGER, approved_by INTEGER);
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
CREATE TABLE IF NOT EXISTS stores(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, contact TEXT, phone TEXT, address TEXT, notes TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, category TEXT, sale_price REAL DEFAULT 0, min_stock INTEGER DEFAULT 3, created_at INTEGER);
CREATE TABLE IF NOT EXISTS lots(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, product_id INTEGER NOT NULL, type TEXT DEFAULT 'consignment', qty_received INTEGER, qty_sold INTEGER DEFAULT 0, qty_returned INTEGER DEFAULT 0, cost REAL DEFAULT 0, date TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS returns(id INTEGER PRIMARY KEY AUTOINCREMENT, lot_id INTEGER, qty INTEGER, date TEXT, user_id INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS store_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER, amount REAL, date TEXT, user_id INTEGER, note TEXT);
CREATE TABLE IF NOT EXISTS settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT, received INTEGER, sold INTEGER, returned INTEGER, payable REAL, paid REAL, profit REAL, user_id INTEGER, ts INTEGER, detail TEXT);
CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT, date TEXT, discount REAL DEFAULT 0, total REAL DEFAULT 0, cost REAL DEFAULT 0, paid REAL DEFAULT 0, user_id INTEGER, note TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS sale_items(id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, product_id INTEGER, lot_id INTEGER, store_id INTEGER, qty INTEGER, unit_price REAL, unit_cost REAL);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT, amount REAL, description TEXT, date TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS appleids(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT, phone TEXT, model TEXT, apple_id TEXT, pw_enc TEXT, description TEXT, date TEXT, created_by INTEGER, hidden INTEGER DEFAULT 0, status TEXT DEFAULT 'request', request_date TEXT, expected_date TEXT, assigned_to INTEGER, notes TEXT, last_notified TEXT, updated_at INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS regional(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, customer_name TEXT, phone TEXT, device TEXT, problem TEXT, region TEXT, sent_to TEXT, date_sent TEXT, technician TEXT, parts TEXT, cost REAL DEFAULT 0, status TEXT DEFAULT 'received', expected_return TEXT, actual_return TEXT, notes TEXT, created_by INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS portal_accounts(id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, name TEXT, phone TEXT, email TEXT UNIQUE COLLATE NOCASE, password TEXT, status TEXT DEFAULT 'pending', created_at INTEGER, last_login INTEGER, approved_by INTEGER);
CREATE TABLE IF NOT EXISTS login_attempts(id INTEGER PRIMARY KEY AUTOINCREMENT, k TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS soft_jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, customer_id INTEGER NOT NULL, device TEXT, imei TEXT, problem TEXT, diagnosis TEXT, apple_id TEXT, lock_info TEXT, technician_id INTEGER, status TEXT, progress_notes TEXT, test_result TEXT, notes TEXT, tools TEXT, request_date TEXT, expected_date TEXT, account_date TEXT, price REAL DEFAULT 0, discount REAL DEFAULT 0, created_by INTEGER, received_at INTEGER, updated_at INTEGER, closed_at INTEGER, last_notified TEXT);
CREATE INDEX IF NOT EXISTS ix_soft_cust ON soft_jobs(customer_id);
CREATE TABLE IF NOT EXISTS inv_tx(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, product_id INTEGER, store_id INTEGER, lot_id INTEGER, qty INTEGER NOT NULL, unit_cost REAL, unit_price REAL, customer_id INTEGER, user_id INTEGER, ts INTEGER, date TEXT, ref_kind TEXT, ref_id INTEGER, reason TEXT, note TEXT, voided INTEGER DEFAULT 0, voided_by INTEGER, voided_ts INTEGER);
CREATE INDEX IF NOT EXISTS ix_tx_lot ON inv_tx(lot_id, voided);
CREATE INDEX IF NOT EXISTS ix_tx_ref ON inv_tx(ref_kind, ref_id);
CREATE INDEX IF NOT EXISTS ix_tx_store_date ON inv_tx(store_id, date);
CREATE TABLE IF NOT EXISTS inv_settlements(id INTEGER PRIMARY KEY AUTOINCREMENT, store_id INTEGER NOT NULL, date TEXT NOT NULL, status TEXT DEFAULT 'open', received INTEGER DEFAULT 0, sold INTEGER DEFAULT 0, returned INTEGER DEFAULT 0, used INTEGER DEFAULT 0, transferred INTEGER DEFAULT 0, in_store INTEGER DEFAULT 0, day_sales REAL DEFAULT 0, day_profit REAL DEFAULT 0, payable REAL DEFAULT 0, discrepancy INTEGER DEFAULT 0, override INTEGER DEFAULT 0, override_reason TEXT, note TEXT, detail TEXT, closed_by INTEGER, finished_at INTEGER, reopened_by INTEGER, reopened_at INTEGER, reopen_reason TEXT, ts INTEGER, UNIQUE(store_id,date));CREATE TABLE IF NOT EXISTS services(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, price REAL DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS soft_events(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, status TEXT, note TEXT, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS soft_parts(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, product_id INTEGER, lot_id INTEGER, store_id INTEGER, qty INTEGER, unit_cost REAL, unit_price REAL, user_id INTEGER, ts INTEGER);
CREATE TABLE IF NOT EXISTS soft_payments(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER, amount REAL, method TEXT, date TEXT, user_id INTEGER, note TEXT);
SQL);
}

/** one-time upgrades for databases created before a feature existed */
function migrate(PDO $pdo): void {
    if (!$pdo->query("SELECT 1 FROM settings WHERE k='mig_inv'")->fetch()) {
        foreach (['ALTER TABLE lots ADD COLUMN qty_used INTEGER DEFAULT 0', 'ALTER TABLE lots ADD COLUMN qty_transferred INTEGER DEFAULT 0', 'ALTER TABLE lots ADD COLUMN paid_amount REAL DEFAULT 0', 'ALTER TABLE lots ADD COLUMN notes TEXT',
                  "ALTER TABLE lots ADD COLUMN source TEXT DEFAULT 'supplier'", 'ALTER TABLE lots ADD COLUMN origin_lot_id INTEGER',
                  'ALTER TABLE lots ADD COLUMN qty_remaining INTEGER GENERATED ALWAYS AS (qty_received-qty_sold-qty_used-qty_returned-qty_transferred) VIRTUAL',
                  'ALTER TABLE returns ADD COLUMN reason TEXT', "ALTER TABLE returns ADD COLUMN status TEXT DEFAULT 'returned'"] as $sql) {
            try { $pdo->exec($sql); } catch (Throwable $e) { /* already there */ }
        }
        if (!$pdo->query('SELECT 1 FROM inv_tx LIMIT 1')->fetch()) {   // rebuild the ledger from the existing history (nothing is lost)
            $pdo->exec("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id) SELECT 'RECEIVE',product_id,store_id,id,qty_received,cost,user_id,COALESCE(ts,strftime('%s','now')),date,'receiving',id FROM lots");
            $pdo->exec("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,unit_price,customer_id,user_id,ts,date,ref_kind,ref_id) SELECT 'SALE',si.product_id,si.store_id,si.lot_id,si.qty,si.unit_cost,si.unit_price,s.customer_id,s.user_id,COALESCE(s.ts,strftime('%s','now')),s.date,'sale',s.id FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.lot_id IS NOT NULL");
            $pdo->exec("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id,note) SELECT 'REPAIR_USAGE',rp.product_id,rp.store_id,rp.lot_id,rp.qty,rp.unit_cost,rp.user_id,rp.ts,date(rp.ts,'unixepoch','localtime'),'repair_part',rp.id,'Hardware repair #'||rp.repair_id FROM repair_parts rp WHERE rp.lot_id IS NOT NULL");
            $pdo->exec("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id,note) SELECT 'REPAIR_USAGE',sp.product_id,sp.store_id,sp.lot_id,sp.qty,sp.unit_cost,sp.user_id,sp.ts,date(sp.ts,'unixepoch','localtime'),'soft_part',sp.id,'Software service #'||sp.job_id FROM soft_parts sp WHERE sp.lot_id IS NOT NULL");
            $pdo->exec("INSERT INTO inv_tx(type,product_id,store_id,lot_id,qty,unit_cost,user_id,ts,date,ref_kind,ref_id,reason) SELECT 'RETURN',l.product_id,l.store_id,r.lot_id,r.qty,l.cost,r.user_id,COALESCE(strftime('%s',r.date),strftime('%s','now')),r.date,'return',r.id,'Unsold â€” returned to supplier' FROM returns r JOIN lots l ON l.id=r.lot_id");
            $pdo->exec("UPDATE lots SET qty_sold=(SELECT COALESCE(SUM(qty),0) FROM inv_tx WHERE lot_id=lots.id AND type='SALE' AND voided=0), qty_used=(SELECT COALESCE(SUM(qty),0) FROM inv_tx WHERE lot_id=lots.id AND type='REPAIR_USAGE' AND voided=0), qty_returned=(SELECT COALESCE(SUM(qty),0) FROM inv_tx WHERE lot_id=lots.id AND type='RETURN' AND voided=0), qty_transferred=0");
            $pdo->exec("UPDATE lots SET paid_amount=qty_received*cost WHERE type='cash'");
            $pdo->exec("INSERT OR IGNORE INTO inv_settlements(store_id,date,status,received,sold,returned,day_profit,payable,discrepancy,closed_by,finished_at,ts,detail) SELECT 0,date,'finished',received,sold,returned,profit,MAX(0,payable-paid),0,user_id,ts,ts,detail FROM settlements");
        }
        $pdo->exec("INSERT INTO settings(k,v) VALUES('mig_inv','1')");
    }    if (!$pdo->query("SELECT 1 FROM settings WHERE k='mig_v3'")->fetch()) {
        foreach (['ALTER TABLE soft_jobs ADD COLUMN serial TEXT', 'ALTER TABLE soft_jobs ADD COLUMN gmail_pw TEXT', 'ALTER TABLE soft_jobs ADD COLUMN apple_pw TEXT',
                  "ALTER TABLE sale_items ADD COLUMN kind TEXT DEFAULT 'product'", 'ALTER TABLE sale_items ADD COLUMN service_name TEXT',
                  'ALTER TABLE sales ADD COLUMN product_rev REAL DEFAULT 0', 'ALTER TABLE sales ADD COLUMN service_rev REAL DEFAULT 0', 'ALTER TABLE sales ADD COLUMN method TEXT'] as $sql) {
            try { $pdo->exec($sql); } catch (Throwable $e) { /* column already exists */ }
        }
        $pdo->exec("UPDATE soft_jobs SET status='in_progress' WHERE kind='repair' AND status='progress'");
        $pdo->exec('UPDATE sales SET product_rev=total+discount WHERE COALESCE(product_rev,0)=0 AND COALESCE(service_rev,0)=0');
        if (!$pdo->query('SELECT 1 FROM services LIMIT 1')->fetch()) {
            $sv = $pdo->prepare('INSERT INTO services(name,price) VALUES(?,?)');
            foreach ([['Apple Unlock', 30], ['New Apple ID', 10], ['Software Repair', 20], ['iOS Restore', 10], ['Account Service', 15], ['Other Software Service', 0]] as $r) $sv->execute($r);
        }
        $pdo->exec("INSERT INTO settings(k,v) VALUES('mig_v3','1')");
    }    if (!$pdo->query("SELECT 1 FROM settings WHERE k='mig_phonekey'")->fetch()) {
        $up = $pdo->prepare('UPDATE customers SET phone_key=? WHERE id=?');
        foreach ($pdo->query('SELECT id,phone FROM customers')->fetchAll() as $c) {
            try { $up->execute([phone_key((string)$c['phone']), $c['id']]); } catch (Throwable $e) { /* collision: keep the old key */ }
        }
        $pdo->exec("INSERT INTO settings(k,v) VALUES('mig_phonekey','1')");
    }    if ($pdo->query("SELECT 1 FROM settings WHERE k='mig_software'")->fetch()) return;
    $st = $pdo->prepare('UPDATE users SET perms=? WHERE id=?');
    foreach ($pdo->query("SELECT id,perms FROM users WHERE is_admin=0 AND position='Software'")->fetchAll() as $u) {
        $p = json_decode($u['perms'] ?: '{}', true) ?: [];
        if (!isset($p['software'])) { $p['software'] = ['view', 'add', 'edit', 'status']; $st->execute([json_encode($p), $u['id']]); }
    }
    $pdo->exec("INSERT INTO settings(k,v) VALUES('mig_software','1')");
}

function default_perms(string $position): array {
    $all = ['view', 'add', 'edit', 'status', 'delete'];
    if ($position === 'Software') return [
        'customers' => ['view', 'add', 'edit'], 'appleid' => ['view', 'add', 'edit', 'status'],
        'regional' => ['view', 'add', 'edit', 'status'], 'sales' => ['view', 'add'], 'inventory' => ['view'], 'software' => ['view', 'add', 'edit', 'status'],
    ];
    return [
        'customers' => ['view', 'add', 'edit'], 'repairs' => ['view', 'add', 'edit', 'status'],
        'appleid' => ['view', 'add', 'edit', 'status'], 'inventory' => ['view'], 'regional' => ['view', 'add', 'status'],
        'sales' => ['view', 'add'],
    ];
}

function seed(PDO $pdo): void {
    $now = time();
    $st = $pdo->prepare('INSERT INTO users(name,email,password,position,is_admin,status,perms,created_at) VALUES(?,?,?,?,1,?,?,?)');
    $st->execute(['Super Admin', 'admin@hic.so', password_hash('Admin@123', PASSWORD_DEFAULT), 'Super Admin', 'active', '{}', $now]);
    $defaults = [
        'company_name' => 'HARGEISA IPHONE CENTER', 'slogan' => 'Hubsiimo iyo Degdegsiimo',
        'phone' => '+252 63 0000000', 'email' => 'info@hargeisaiphonecenter.com', 'address' => 'Hargeisa, Somaliland',
        'website' => 'www.hargeisaiphonecenter.com', 'social' => 'Facebook / Instagram / TikTok: @hargeisaiphonecenter',
        'footer' => '© HARGEISA IPHONE CENTER — Hubsiimo iyo Degdegsiimo', 'logo' => '', 'currency' => '$',
    ];
    $s = $pdo->prepare('INSERT INTO settings(k,v) VALUES(?,?)');
    foreach ($defaults as $k => $v) $s->execute([$k, $v]);
}

/* ------------------------------------------------------------ helpers */
function setting(string $k, string $d = ''): string { $v = val('SELECT v FROM settings WHERE k=?', [$k]); return $v === null ? $d : (string)$v; }
function set_setting(string $k, string $v): void { q('INSERT INTO settings(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', [$k, $v]); }
function today(): string { return date('Y-m-d'); }
/** Canonical phone identity: digits only, last 9 digits — so +252 63 4444444, 0063 4444444 and 63 4444444 are the same customer. */
function phone_key(string $p): string { $d = preg_replace('/\D+/', '', $p) ?? ''; return strlen($d) > 9 ? substr($d, -9) : $d; }
function s(mixed $v, int $max = 500): string { return mb_substr(trim((string)($v ?? '')), 0, $max); }
function n(mixed $v): float { return is_numeric($v) ? (float)$v : 0.0; }
function d(mixed $v): ?string { $v = trim((string)($v ?? '')); return preg_match('/^\d{4}-\d{2}-\d{2}$/', $v) ? $v : null; }

function appkey(): string {
    $f = DATA . '/app.key';
    if (!file_exists($f)) { file_put_contents($f, bin2hex(random_bytes(32))); }
    return hex2bin(trim(file_get_contents($f)));
}
function enc(string $t): string {
    $iv = random_bytes(12);
    $c = openssl_encrypt($t, 'aes-256-gcm', appkey(), OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $c);
}
function dec(?string $b): string {
    if (!$b) return '';
    $r = base64_decode($b, true);
    if ($r === false || strlen($r) < 29) return '';
    $p = openssl_decrypt(substr($r, 28), 'aes-256-gcm', appkey(), OPENSSL_RAW_DATA, substr($r, 0, 12), substr($r, 12, 16));
    return $p === false ? '' : $p;
}

/* ------------------------------------------------------------ auth */
function boot_session(string $name = 'HICSESS'): void {
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name($name);
    ini_set('session.gc_maxlifetime', '2592000');
    session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
    session_start();
}
function me(bool $require = true): ?array {
    static $u = false;
    if ($u === false || !$require) {
        boot_session();
        $id = $_SESSION['uid'] ?? 0;
        $u = $id ? row('SELECT * FROM users WHERE id=?', [$id]) : null;
    }
    if (!$u) { if ($require) throw new ApiError('Please sign in.', 401, ['auth' => true]); return null; }
    $limit = !empty($_SESSION['remember']) ? 30 * 86400 : 12 * 3600;
    if ($u['logged_in'] && $u['last_seen'] && time() - (int)$u['last_seen'] > $limit) {
        q('UPDATE users SET logged_in=0 WHERE id=?', [$u['id']]); unset($_SESSION['uid']);
        throw new ApiError('Your session expired. Please sign in again.', 401, ['auth' => true]);
    }
    if ($u['status'] !== 'active') {
        q('UPDATE users SET logged_in=0 WHERE id=?', [$u['id']]);
        unset($_SESSION['uid']);
        throw new ApiError('Your access has been restricted; this user account has been deactivated. Please contact your owner, as you are not authorized.', 403, ['restricted' => true]);
    }
    $u['perms_arr'] = json_decode($u['perms'] ?: '{}', true) ?: [];
    return $u;
}
function can(string $module, string $action): bool {
    $u = me();
    if ($u['is_admin']) return true;
    $p = $u['perms_arr'][$module] ?? [];
    return in_array($action, $p, true) || in_array('full', $p, true);
}
function need(string $module, string $action = 'view'): array {
    if (!can($module, $action)) throw new ApiError('You are not authorized to do this.', 403);
    return me();
}
function admin(): array { $u = me(); if (!$u['is_admin']) throw new ApiError('Super Admin only.', 403); return $u; }
function is_admin(): bool { return (bool)me()['is_admin']; }

function touch_user(array $u): void {
    $now = time();
    $start = ($u['logged_in'] && $now - (int)$u['last_seen'] < 300 && $u['session_start']) ? (int)$u['session_start'] : $now;
    q('UPDATE users SET last_seen=?, logged_in=1, session_start=? WHERE id=?', [$now, $start, $u['id']]);
}

function audit(string $action, string $entity, ?int $id = null, string $detail = ''): void {
    $u = me(false);
    q('INSERT INTO activity(user_id,action,entity,entity_id,detail,ts) VALUES(?,?,?,?,?,?)', [$u['id'] ?? null, $action, $entity, $id, $detail, time()]);
}

function notify(string $type, string $msg, string|int|array $aud = 'admin', ?string $link = null, ?string $ref = null): void {
    if ($ref && val('SELECT 1 FROM notifications WHERE ref=?', [$ref])) return;
    if (is_int($aud)) $ids = [$aud];
    elseif (is_array($aud)) $ids = $aud;
    elseif ($aud === 'all') $ids = array_column(rows("SELECT id FROM users WHERE status='active'"), 'id');
    elseif (str_starts_with($aud, 'perm:')) {
        $mod = substr($aud, 5); $ids = [];
        foreach (rows("SELECT id,is_admin,perms FROM users WHERE status='active'") as $r) {
            $p = json_decode($r['perms'] ?: '{}', true) ?: [];
            if ($r['is_admin'] || isset($p[$mod])) $ids[] = $r['id'];
        }
    } else $ids = array_column(rows("SELECT id FROM users WHERE status='active' AND is_admin=1"), 'id');
    $st = db()->prepare('INSERT INTO notifications(user_id,type,message,link,ts,ref) VALUES(?,?,?,?,?,?)');
    foreach (array_unique($ids) as $i) $st->execute([$i, $type, $msg, $link, time(), $ref]);
}

/* inventory engine: see h_stock.php */

/* ---------------------------------------------- finance helpers */
function money_by_day(string $from, string $to): array {
    $m = [];
    $add = function (array $rows, string $key) use (&$m) {
        foreach ($rows as $r) { $m[$r['d']] ??= ['income' => 0, 'cost' => 0, 'expense' => 0]; $m[$r['d']][$key] += (float)$r['v']; }
    };
    $add(rows('SELECT date d, SUM(total) v FROM sales WHERE date BETWEEN ? AND ? GROUP BY date', [$from, $to]), 'income');
    $add(rows('SELECT date d, SUM(amount) v FROM repair_payments WHERE date BETWEEN ? AND ? GROUP BY date', [$from, $to]), 'income');
    $add(rows('SELECT date d, SUM(amount) v FROM soft_payments WHERE date BETWEEN ? AND ? GROUP BY date', [$from, $to]), 'income');
    $add(rows("SELECT date(ts,'unixepoch','localtime') d, SUM(qty*unit_cost) v FROM soft_parts WHERE date(ts,'unixepoch','localtime') BETWEEN ? AND ? GROUP BY d", [$from, $to]), 'cost');
    $add(rows('SELECT date d, SUM(cost) v FROM sales WHERE date BETWEEN ? AND ? GROUP BY date', [$from, $to]), 'cost');
    $add(rows("SELECT date(ts,'unixepoch','localtime') d, SUM(qty*unit_cost) v FROM repair_parts WHERE date(ts,'unixepoch','localtime') BETWEEN ? AND ? GROUP BY d", [$from, $to]), 'cost');
    $add(rows('SELECT date d, SUM(amount) v FROM expenses WHERE date BETWEEN ? AND ? GROUP BY date', [$from, $to]), 'expense');
    return $m;
}

/* ---------------------------------------------- scheduled checks */
function run_checks(): void {
    $now = time();
    if ($now - (int)setting('last_check', '0') < 50) return;
    set_setting('last_check', (string)$now);
    $today = today();
    // Apple ID deadlines
    foreach (rows("SELECT * FROM appleids WHERE status IN ('request','received','progress') AND expected_date IS NOT NULL AND expected_date<=? AND COALESCE(last_notified,'')<>?", [date('Y-m-d', strtotime('+1 day')), $today]) as $a) {
        $diff = (int)round((strtotime($a['expected_date']) - strtotime($today)) / 86400);
        $when = $diff === 0 ? 'Today' : ($diff === 1 ? 'Tomorrow' : abs($diff) . ' day(s) overdue');
        $aud = ['admin'];
        $ids = array_column(rows("SELECT id FROM users WHERE status='active' AND is_admin=1"), 'id');
        if ($a['assigned_to']) $ids[] = (int)$a['assigned_to'];
        notify('appleid_deadline', "Apple ID Check Required — Customer: {$a['customer_name']}, Device: {$a['model']}, Expected: {$when}, Status: " . ucfirst($a['status']), $ids, '#/appleid');
        q('UPDATE appleids SET last_notified=? WHERE id=?', [$today, $a['id']]);
    }
    // Apple Unlock deadlines
    foreach (rows("SELECT j.*,c.name cname FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.kind='unlock' AND j.status IN ('request','received','in_progress','waiting') AND j.expected_date IS NOT NULL AND j.expected_date<=? AND COALESCE(j.last_notified,'')<>?", [date('Y-m-d', strtotime('+1 day')), $today]) as $j) {
        $diff = (int)round((strtotime($j['expected_date']) - strtotime($today)) / 86400);
        $when = $diff === 0 ? 'Today' : ($diff === 1 ? 'Tomorrow' : abs($diff) . ' day(s) overdue');
        $ids = array_column(rows("SELECT id FROM users WHERE status='active' AND is_admin=1"), 'id');
        if ($j['technician_id']) $ids[] = (int)$j['technician_id'];
        notify('appleid_deadline', "Apple Unlock Check Required — Customer: {$j['cname']}, Device: {$j['device']}, Expected: {$when}, Status: " . ucfirst(str_replace('_', ' ', $j['status'])), $ids, '#/unlock');
        q('UPDATE soft_jobs SET last_notified=? WHERE id=?', [$today, $j['id']]);
    }
    // Low stock
    foreach (rows('SELECT p.id,p.name,p.min_stock,COALESCE(SUM(l.qty_remaining),0) rem FROM products p JOIN lots l ON l.product_id=p.id GROUP BY p.id HAVING rem<=p.min_stock') as $p) {
        notify('stock', ($p['rem'] <= 0 ? 'Out of stock: ' : 'Low stock: ') . "{$p['name']} ({$p['rem']} left)", 'perm:inventory', '#/inventory', "stock:{$p['id']}:$today");
    }
    // Follow-ups due
    foreach (rows('SELECT f.*,c.name cname FROM followups f JOIN customers c ON c.id=f.customer_id WHERE f.done=0 AND f.due_date IS NOT NULL AND f.due_date<=?', [$today]) as $f) {
        notify('followup', "Customer follow-up: {$f['cname']} — " . str_replace('_', ' ', (string)$f['type']), 'perm:customers', '#/customers/' . $f['customer_id'], "fu:{$f['id']}:$today");
    }
    // Settlement reminder
    if ((int)date('G') >= 18 && !val("SELECT 1 FROM inv_settlements WHERE status='finished' AND date=?", [$today]) && val('SELECT 1 FROM inv_tx WHERE date=? AND voided=0 LIMIT 1', [$today])) {
        notify('settlement', 'Daily inventory settlement is pending for today.', 'admin', '#/inventory', "settle:$today");
    }
}

function ago_json(array $u): array {
    $now = time();
    $online = $u['logged_in'] && $now - (int)$u['last_seen'] <= 75;
    return [
        'online' => $online,
        'active_for' => $online ? max(0, $now - (int)$u['session_start']) : 0,
        'last_seen' => (int)$u['last_seen'],
    ];
}
function public_user(array $u): array {
    return ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'position' => $u['position'], 'is_admin' => (bool)$u['is_admin'],
        'status' => $u['status'], 'avatar' => $u['avatar'], 'perms' => json_decode($u['perms'] ?: '{}', true) ?: new stdClass(), 'created_at' => (int)$u['created_at']] + ago_json($u);
}
