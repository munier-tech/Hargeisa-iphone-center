<?php
declare(strict_types=1);

const MODULES = ['customers', 'repairs', 'software', 'appleid', 'inventory', 'stores', 'regional', 'sales', 'expenses', 'reports'];
const ACTIONS = ['view', 'add', 'edit', 'status', 'delete', 'full'];

function all_settings(): array {
    $o = [];
    foreach (rows('SELECT k,v FROM settings') as $r) if ($r['k'] !== 'last_check') $o[$r['k']] = $r['v'];
    return $o;
}
function act_branding(array $in): array { return all_settings(); }

function unread_count(int $uid): int { return (int)val('SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0', [$uid]); }

function act_login(array $in): array {
    boot_session();
    $email = s($in['email'] ?? '', 120); $pw = (string)($in['password'] ?? '');
    $key = ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . strtolower($email);
    q('DELETE FROM login_attempts WHERE ts<?', [time() - 900]);
    if ((int)val('SELECT COUNT(*) FROM login_attempts WHERE k=? AND ts>?', [$key, time() - 600]) >= 8) throw new ApiError('Too many attempts. Please try again in a few minutes.', 429);
    $u = row('SELECT * FROM users WHERE email=?', [$email]);
    if (!$u || !password_verify($pw, $u['password'])) {
        ins('login_attempts', ['k' => $key, 'ts' => time()]);
        throw new ApiError('Invalid email or password.', 401);
    }
    if ($u['status'] === 'pending') throw new ApiError('Your account is awaiting Super Admin approval.', 403);
    if ($u['status'] !== 'active') throw new ApiError('Your access has been restricted; this user account has been deactivated. Please contact your owner, as you are not authorized.', 403, ['restricted' => true]);
    session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    $_SESSION['remember'] = empty($in['remember']) ? 0 : 1;
    if ($_SESSION['remember']) setcookie(session_name(), session_id(), ['expires' => time() + 30 * 86400, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
    q('UPDATE users SET logged_in=1,last_seen=?,session_start=? WHERE id=?', [time(), time(), $u['id']]);
    q('DELETE FROM login_attempts WHERE k=?', [$key]);
    audit('login', 'user', (int)$u['id']);
    return act_me([]);
}
function act_logout(array $in): array {
    $u = me(false);
    if ($u) { q('UPDATE users SET logged_in=0,last_seen=? WHERE id=?', [time(), $u['id']]); audit('logout', 'user', (int)$u['id']); }
    $_SESSION = []; session_destroy();
    return [];
}
function act_me(array $in): array {
    $u = me(); touch_user($u); run_checks();
    $fresh = row('SELECT * FROM users WHERE id=?', [$u['id']]);
    return ['user' => public_user($fresh), 'unread' => unread_count((int)$u['id']), 'branding' => all_settings(),
        'default_password' => (bool)$u['is_admin'] && password_verify('Admin@123', $u['password'])];
}
function act_ping(array $in): array {
    $u = me(); touch_user($u); run_checks();
    return ['unread' => unread_count((int)$u['id'])];
}
function act_staff_register(array $in): array {
    $name = s($in['name'] ?? '', 80); $email = strtolower(s($in['email'] ?? '', 120)); $pw = (string)($in['password'] ?? '');
    $pos = ($in['position'] ?? '') === 'Software' ? 'Software' : 'Technician';
    if (!$name || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ApiError('Enter a valid name and email.');
    if (strlen($pw) < 6) throw new ApiError('Password must be at least 6 characters.');
    if (val('SELECT 1 FROM users WHERE email=?', [$email])) throw new ApiError('That email is already registered.');
    $id = ins('users', ['name' => $name, 'email' => $email, 'password' => password_hash($pw, PASSWORD_DEFAULT), 'position' => $pos, 'status' => 'pending', 'perms' => json_encode(default_perms($pos)), 'created_at' => time()]);
    notify('new_user', "New user registration: {$name} ({$pos}) is awaiting approval.", 'admin', '#/users');
    return ['id' => $id];
}

/* ---------------------------------------------------------- users */
function act_users_list(array $in): array {
    admin();
    $tasks = array_column(rows("SELECT user_id,COUNT(*) n FROM activity WHERE action NOT IN ('login','logout') GROUP BY user_id"), 'n', 'user_id');
    $tasks30 = array_column(rows("SELECT user_id,COUNT(*) n FROM activity WHERE action NOT IN ('login','logout') AND ts>=? GROUP BY user_id", [time() - 30 * 86400]), 'n', 'user_id');
    $out = [];
    foreach (rows('SELECT * FROM users ORDER BY is_admin DESC, name') as $u) {
        $p = public_user($u);
        $p['tasks'] = (int)($tasks[$u['id']] ?? 0); $p['tasks30'] = (int)($tasks30[$u['id']] ?? 0);
        $out[] = $p;
    }
    return $out;
}
function act_staff_lookup(array $in): array {
    me();
    return rows("SELECT id,name,position FROM users WHERE status='active' ORDER BY name");
}
function clean_perms(mixed $p): array {
    $o = [];
    foreach (is_array($p) ? $p : [] as $m => $acts) {
        if (!in_array($m, MODULES, true) || !is_array($acts)) continue;
        $a = array_values(array_intersect($acts, ACTIONS));
        if ($a) $o[$m] = $a;
    }
    return $o;
}
function act_user_save(array $in): array {
    $me = admin();
    $id = (int)($in['id'] ?? 0);
    $name = s($in['name'] ?? '', 80); $email = strtolower(s($in['email'] ?? '', 120));
    $pos = ($in['position'] ?? '') === 'Software' ? 'Software' : 'Technician';
    if (!$name || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ApiError('Enter a valid name and email.');
    $dup = val('SELECT id FROM users WHERE email=? AND id<>?', [$email, $id]);
    if ($dup) throw new ApiError('That email is already used by another user.');
    $pw = (string)($in['password'] ?? '');
    if ($id) {
        $u = row('SELECT * FROM users WHERE id=?', [$id]);
        if (!$u) throw new ApiError('User not found.', 404);
        $d = ['name' => $name, 'email' => $email];
        if (!$u['is_admin']) { $d['position'] = $pos; $d['perms'] = json_encode(clean_perms($in['perms'] ?? [])); }
        if ($pw !== '') { if (strlen($pw) < 6) throw new ApiError('Password must be at least 6 characters.'); $d['password'] = password_hash($pw, PASSWORD_DEFAULT); }
        upd('users', $id, $d);
        audit('update', 'user', $id, $name);
    } else {
        if (strlen($pw) < 6) throw new ApiError('Password must be at least 6 characters.');
        $perms = isset($in['perms']) ? clean_perms($in['perms']) : default_perms($pos);
        $id = ins('users', ['name' => $name, 'email' => $email, 'password' => password_hash($pw, PASSWORD_DEFAULT), 'position' => $pos, 'status' => 'active', 'perms' => json_encode($perms), 'created_at' => time(), 'approved_by' => $me['id']]);
        audit('create', 'user', $id, $name);
    }
    return ['id' => $id];
}
function act_user_status(array $in): array {
    $me = admin();
    $id = (int)($in['id'] ?? 0); $to = $in['status'] ?? '';
    $u = row('SELECT * FROM users WHERE id=?', [$id]);
    if (!$u) throw new ApiError('User not found.', 404);
    if ($u['is_admin'] || $id === (int)$me['id']) throw new ApiError('The Super Admin account cannot be changed here.');
    if (!in_array($to, ['active', 'inactive'], true)) throw new ApiError('Invalid status.');
    $d = ['status' => $to];
    if ($to === 'inactive') { $d['logged_in'] = 0; $d['last_seen'] = time(); } else $d['approved_by'] = $me['id'];
    upd('users', $id, $d);
    if ($to === 'active') {
        $type = $u['status'] === 'pending' ? 'user_approved' : 'user_activated';
        notify($type, ($type === 'user_approved' ? 'User approved: ' : 'User activated: ') . $u['name'], 'admin', '#/users');
        audit($type === 'user_approved' ? 'approve' : 'activate', 'user', $id, $u['name']);
    } else {
        notify('user_deactivated', 'User deactivated: ' . $u['name'], 'admin', '#/users');
        audit('deactivate', 'user', $id, $u['name']);
    }
    return [];
}
function act_user_delete(array $in): array {
    $me = admin(); $id = (int)($in['id'] ?? 0);
    $u = row('SELECT * FROM users WHERE id=?', [$id]);
    if (!$u || $u['is_admin'] || $id === (int)$me['id']) throw new ApiError('This user cannot be deleted.');
    q('DELETE FROM users WHERE id=?', [$id]); q('DELETE FROM notifications WHERE user_id=?', [$id]);
    audit('delete', 'user', $id, $u['name']);
    return [];
}
function act_profile_update(array $in): array {
    $u = me();
    $d = [];
    if (isset($in['name'])) { $d['name'] = s($in['name'], 80); if (!$d['name']) throw new ApiError('Name is required.'); }
    if (isset($in['email'])) {
        $e = strtolower(s($in['email'], 120));
        if (!filter_var($e, FILTER_VALIDATE_EMAIL)) throw new ApiError('Enter a valid email.');
        if (val('SELECT 1 FROM users WHERE email=? AND id<>?', [$e, $u['id']])) throw new ApiError('That email is already used.');
        $d['email'] = $e;
    }
    if (!empty($in['new_password'])) {
        if (!password_verify((string)($in['current_password'] ?? ''), $u['password'])) throw new ApiError('Current password is incorrect.');
        if (strlen((string)$in['new_password']) < 6) throw new ApiError('New password must be at least 6 characters.');
        $d['password'] = password_hash((string)$in['new_password'], PASSWORD_DEFAULT);
    }
    if (array_key_exists('avatar', $in)) {
        $a = (string)$in['avatar'];
        if ($a !== '' && (!preg_match('#^data:image/(png|jpeg|webp);base64,#', $a) || strlen($a) > 400000)) throw new ApiError('Invalid or too large picture.');
        $d['avatar'] = $a ?: null;
    }
    upd('users', (int)$u['id'], $d);
    audit('update', 'profile', (int)$u['id']);
    return act_me([]);
}
function act_settings_save(array $in): array {
    admin();
    foreach (['company_name', 'slogan', 'phone', 'email', 'address', 'website', 'social', 'footer', 'currency'] as $k) if (isset($in[$k])) set_setting($k, s($in[$k], 300));
    if (array_key_exists('logo', $in)) {
        $l = (string)$in['logo'];
        if ($l !== '' && (!preg_match('#^data:image/(png|jpeg|webp|svg\+xml);base64,#', $l) || strlen($l) > 600000)) throw new ApiError('Invalid or too large logo.');
        set_setting('logo', $l);
    }
    audit('update', 'settings');
    return all_settings();
}

/* ---------------------------------------------------- notifications */
function act_notifs_list(array $in): array {
    $u = me();
    return ['items' => rows('SELECT id,type,message,link,is_read,ts FROM notifications WHERE user_id=? ORDER BY ts DESC,id DESC LIMIT 200', [$u['id']]), 'unread' => unread_count((int)$u['id'])];
}
function act_notif_read(array $in): array {
    $u = me();
    if (($in['id'] ?? '') === 'all') q('UPDATE notifications SET is_read=1 WHERE user_id=?', [$u['id']]);
    else q('UPDATE notifications SET is_read=1 WHERE user_id=? AND id=?', [$u['id'], (int)($in['id'] ?? 0)]);
    return ['unread' => unread_count((int)$u['id'])];
}

/* ---------------------------------------------------------- audit */
function act_audit_list(array $in): array {
    admin();
    return rows('SELECT a.id,a.action,a.entity,a.entity_id,a.detail,a.ts,u.name user FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500');
}

/* ------------------------------------------------------- dashboard */
function act_dashboard(array $in): array {
    $u = me(); $adm = (bool)$u['is_admin']; $now = time(); $today = today();
    $users = rows('SELECT * FROM users');
    $st = ['total_users' => count($users), 'technicians' => 0, 'software' => 0, 'online' => 0, 'offline' => 0, 'active' => 0, 'inactive' => 0];
    foreach ($users as $x) {
        if ($x['position'] === 'Technician') $st['technicians']++;
        if ($x['position'] === 'Software') $st['software']++;
        if ($x['status'] === 'active') { $st['active']++; ago_json($x)['online'] ? $st['online']++ : $st['offline']++; }
        if ($x['status'] === 'inactive') $st['inactive']++;
    }
    $st['customers'] = (int)val('SELECT COUNT(*) FROM customers');
    $st['inventory'] = (int)val('SELECT COALESCE(SUM(qty_remaining),0) FROM lots');
    $st['open_repairs'] = (int)val("SELECT COUNT(*) FROM repairs WHERE status NOT IN ('completed','took_completed','took_incomplete','failed')");
    $st['followups'] = (int)val('SELECT COUNT(*) FROM followups WHERE done=0');
    $st['appleid_open'] = (int)val("SELECT COUNT(*) FROM appleids WHERE status IN ('request','received','progress')" . ($adm ? '' : ' AND hidden=0'));
    $st['regional_open'] = (int)val("SELECT COUNT(*) FROM regional WHERE status NOT IN ('collected','failed','ready')");

    $gender = rows("SELECT COALESCE(NULLIF(gender,''),'Unknown') label, COUNT(*) v FROM customers GROUP BY 1");
    $repairsBy = rows('SELECT status label, COUNT(*) v FROM repairs GROUP BY status');

    // activity wave: 24 hourly buckets
    $start = $now - 24 * 3600; $wave = array_fill(0, 24, 0);
    foreach (rows("SELECT ts FROM activity WHERE ts>=? AND action NOT IN ('login','logout')", [$start]) as $r) $wave[min(23, (int)floor(($r['ts'] - $start) / 3600))]++;
    $waveLabels = [];
    for ($i = 0; $i < 24; $i++) $waveLabels[] = date('H:i', $start + $i * 3600 + 3600);

    $active = rows("SELECT u.name,COUNT(a.id) v FROM activity a JOIN users u ON u.id=a.user_id WHERE a.ts>=? AND a.action NOT IN ('login','logout') GROUP BY u.id ORDER BY v DESC LIMIT 6", [$now - 30 * 86400]);
    $prod = rows("SELECT u.name,COUNT(a.id) v FROM activity a JOIN users u ON u.id=a.user_id WHERE a.ts>=? AND a.action='status' AND a.detail IN ('completed','ready','working','finished','took_completed','returned','collected','parts_installed') GROUP BY u.id ORDER BY v DESC LIMIT 6", [$now - 30 * 86400]);

    $fin = null;
    if ($adm) {
        $from30 = date('Y-m-d', strtotime('-29 days'));
        $from12 = date('Y-m-01', strtotime('-11 months'));
        $map = money_by_day($from12, $today);
        $daily = [];
        for ($i = 29; $i >= 0; $i--) { $dd = date('Y-m-d', strtotime("-$i days")); $m = $map[$dd] ?? ['income' => 0, 'cost' => 0, 'expense' => 0]; $daily[] = ['label' => substr($dd, 5), 'v' => round($m['income'] - $m['cost'] - $m['expense'], 2)]; }
        $monthly = [];
        for ($i = 11; $i >= 0; $i--) { $monthly[date('Y-m', strtotime(date('Y-m-01') . " -$i months"))] = ['income' => 0, 'cost' => 0, 'expense' => 0]; }
        foreach ($map as $dd => $m) { $k = substr($dd, 0, 7); if (isset($monthly[$k])) foreach ($m as $f => $v) $monthly[$k][$f] += $v; }
        $mp = [];
        foreach ($monthly as $k => $m) $mp[] = ['label' => date('M', strtotime($k . '-01')), 'v' => round($m['income'] - $m['cost'] - $m['expense'], 2), 'income' => round($m['income'], 2), 'expense' => round($m['expense'], 2)];
        $tot = money_by_day('2000-01-01', $today);
        $inc = $cost = $exp = 0;
        foreach ($tot as $m) { $inc += $m['income']; $cost += $m['cost']; $exp += $m['expense']; }
        $fin = ['sales' => round($inc, 2), 'expenses' => round($exp, 2), 'profit' => round($inc - $cost - $exp, 2), 'daily' => $daily, 'monthly' => $mp,
            'expense_cats' => rows('SELECT category label, ROUND(SUM(amount),2) v FROM expenses GROUP BY category ORDER BY v DESC')];
        $st['sales'] = $fin['sales']; $st['expenses'] = $fin['expenses']; $st['profit'] = $fin['profit'];
    }
    $recent = ['repairs' => [], 'software' => [], 'customers' => [], 'sales' => [], 'due' => [], 'low_stock' => [], 'activity' => []];
    if (can('repairs', 'view')) $recent['repairs'] = rows('SELECT r.id,r.device,r.status,r.received_at,c.name customer FROM repairs r JOIN customers c ON c.id=r.customer_id ORDER BY r.id DESC LIMIT 5');
    if (can('software', 'view')) $recent['software'] = rows('SELECT j.id,j.kind,j.device,j.status,j.received_at,c.name customer FROM soft_jobs j JOIN customers c ON c.id=j.customer_id ORDER BY j.id DESC LIMIT 5');
    if (can('customers', 'view')) $recent['customers'] = rows('SELECT id,name,phone,created_at FROM customers ORDER BY id DESC LIMIT 5');
    if (can('sales', 'view')) $recent['sales'] = rows('SELECT s.id,s.date,s.customer_name,s.total,s.product_rev,s.service_rev FROM sales s ORDER BY s.id DESC LIMIT 5');
    if (can('inventory', 'view')) $recent['low_stock'] = rows('SELECT p.name,p.min_stock,COALESCE(SUM(l.qty_remaining),0) rem FROM products p JOIN lots l ON l.product_id=p.id GROUP BY p.id HAVING rem<=p.min_stock ORDER BY rem LIMIT 6');
    $dl = "CASE WHEN expected_date IS NULL THEN NULL ELSE CAST(julianday(expected_date)-julianday(date('now','localtime')) AS INTEGER) END";
    if (can('appleid', 'view')) foreach (rows("SELECT 'Apple ID' k,customer_name c,model d,status,expected_date,$dl days FROM appleids WHERE status IN ('request','received','progress') AND expected_date IS NOT NULL" . ($adm ? '' : ' AND hidden=0') . ' ORDER BY expected_date LIMIT 6') as $r) $recent['due'][] = $r;
    if (can('software', 'view')) foreach (rows("SELECT 'Apple Unlock' k,c.name c,j.device d,j.status,j.expected_date,CASE WHEN j.expected_date IS NULL THEN NULL ELSE CAST(julianday(j.expected_date)-julianday(date('now','localtime')) AS INTEGER) END days FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.kind='unlock' AND j.status IN ('request','received','in_progress','waiting') AND j.expected_date IS NOT NULL ORDER BY j.expected_date LIMIT 6") as $r) $recent['due'][] = $r;
    usort($recent['due'], fn($a, $b) => ($a['days'] ?? 999) <=> ($b['days'] ?? 999)); $recent['due'] = array_slice($recent['due'], 0, 6);
    $recent['activity'] = rows("SELECT a.action,a.entity,a.entity_id,a.detail,a.ts,u.name user FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE a.action NOT IN ('login','logout')" . ($adm ? '' : ' AND a.user_id=' . (int)$u['id']) . ' ORDER BY a.id DESC LIMIT 8');
    return ['recent' => $recent, 'stats' => $st, 'gender' => $gender, 'repairs_by' => $repairsBy, 'wave' => ['values' => $wave, 'labels' => $waveLabels, 'online' => $st['online']],
        'most_active' => $active, 'most_productive' => $prod, 'finance' => $fin];
}


/* ------------------------------------------------------------ global search (respects permissions; never returns secrets) */
function act_search(array $in): array {
    me();
    $t = trim((string)($in['q'] ?? ''));
    if (mb_strlen($t) < 2) return [];
    $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $t) . '%'; $k = phone_key($t); $out = [];
    $L = " LIKE ? ESCAPE '\\'";
    if (can('customers', 'view')) foreach (rows("SELECT id,name,phone FROM customers WHERE name$L OR phone$L" . ($k ? ' OR phone_key LIKE ?' : '') . ' LIMIT 5', $k ? [$like, $like, "%$k%"] : [$like, $like]) as $r) $out[] = ['g' => 'Customers', 'ic' => 'user', 't' => $r['name'], 's' => $r['phone'], 'l' => '#/customers/' . $r['id']];
    if (can('repairs', 'view')) foreach (rows("SELECT r.id,r.device,r.status,c.name FROM repairs r JOIN customers c ON c.id=r.customer_id WHERE r.device$L OR c.name$L OR r.imei$L ORDER BY r.id DESC LIMIT 5", [$like, $like, $like]) as $r) $out[] = ['g' => 'Hardware repairs', 'ic' => 'tool', 't' => $r['device'] . ' — ' . $r['name'], 's' => $r['status'], 'l' => '#/repairs', 'st' => $r['status']];
    if (can('software', 'view')) foreach (rows("SELECT j.id,j.kind,j.device,j.status,c.name FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.device$L OR c.name$L OR j.imei$L OR j.serial$L ORDER BY j.id DESC LIMIT 6", [$like, $like, $like, $like]) as $r) $out[] = ['g' => 'Software', 'ic' => 'zap', 't' => $r['device'] . ' — ' . $r['name'], 's' => $r['kind'], 'l' => '#/' . ($r['kind'] === 'repair' ? 'software' : $r['kind']), 'st' => $r['status']];
    if (can('appleid', 'view')) foreach (rows("SELECT a.id,a.customer_name,a.model,a.status FROM appleids a WHERE (a.customer_name$L OR a.model$L OR a.apple_id$L)" . (is_admin() ? '' : ' AND a.hidden=0') . ' LIMIT 4', [$like, $like, $like]) as $r) $out[] = ['g' => 'Apple ID', 'ic' => 'key', 't' => $r['customer_name'] . ' — ' . $r['model'], 's' => $r['status'], 'l' => '#/appleid', 'st' => $r['status']];
    if (can('inventory', 'view')) foreach (rows("SELECT id,name FROM products WHERE name$L LIMIT 4", [$like]) as $r) $out[] = ['g' => 'Inventory', 'ic' => 'package', 't' => $r['name'], 's' => 'stock', 'l' => '#/inventory'];
    return $out;
}
function act_my_activity(array $in): array {
    $u = me();
    return rows("SELECT action,entity,entity_id,detail,ts FROM activity WHERE user_id=? AND action NOT IN ('login','logout') ORDER BY id DESC LIMIT 15", [$u['id']]);
}
/** Public: a user who forgot their password asks the Super Admin (notification) to set a new one. Always answers the same, so it cannot be used to discover accounts. */
function act_password_request(array $in): array {
    $email = strtolower(s($in['email'] ?? '', 120)); $key = ($_SERVER['REMOTE_ADDR'] ?? '') . '|pr';
    if ((int)val('SELECT COUNT(*) FROM login_attempts WHERE k=? AND ts>?', [$key, time() - 600]) >= 5) throw new ApiError('Too many requests. Please try again later.', 429);
    ins('login_attempts', ['k' => $key, 'ts' => time()]);
    $u = row("SELECT id,name FROM users WHERE email=? AND status='active'", [$email]);
    if ($u) notify('system', "Password reset requested by {$u['name']} ({$email}). Open Users → Edit to set a new password.", 'admin', '#/users', "pr:{$u['id']}:" . date('YmdH'));
    return [];
}