<?php
declare(strict_types=1);

const REPAIR_STATUSES = ['received', 'diagnosis', 'progress', 'waiting_part', 'parts_installed', 'testing', 'working', 'not_working', 'finishing', 'completed', 'ready', 'took_completed', 'took_incomplete', 'in_store', 'failed'];
const REPAIR_OUTCOMES = ['took_completed', 'took_incomplete', 'store_completed', 'store_incomplete'];
const APPLE_STATUSES = ['request', 'received', 'progress', 'finished', 'failed', 'took', 'instore'];
const REGIONAL_STATUSES = ['received', 'sent', 'in_repair', 'returning', 'returned', 'ready', 'collected', 'failed'];
const FOLLOWUP_TYPES = ['collect_phone', 'return_service', 'complete_payment', 'replacement_part', 'continue_repair', 'other_service'];

function need_any(array $pairs): array {
    foreach ($pairs as [$m, $a]) if (can($m, $a)) return me();
    throw new ApiError('You are not authorized to do this.', 403);
}

/** Returns [customer_id, existed]. Reuses the existing customer (matched by phone) instead of creating a duplicate. */
function resolve_customer(array $in): array {
    $cid = (int)($in['customer_id'] ?? 0);
    if ($cid && val('SELECT 1 FROM customers WHERE id=?', [$cid])) return [$cid, true];
    $name = s($in['customer_name'] ?? $in['name'] ?? '', 80); $phone = s($in['customer_phone'] ?? $in['phone'] ?? '', 30);
    $key = phone_key($phone);
    if (!$name || strlen($key) < 5) throw new ApiError('Customer name and a valid phone number are required.');
    $ex = val('SELECT id FROM customers WHERE phone_key=?', [$key]);
    if ($ex) return [(int)$ex, true];
    $id = ins('customers', ['name' => $name, 'phone' => $phone, 'phone_key' => $key, 'email' => s($in['email'] ?? '', 120), 'gender' => in_array($in['gender'] ?? '', ['Male', 'Female', 'Other'], true) ? $in['gender'] : null,
        'address' => s($in['address'] ?? '', 200), 'created_by' => me()['id'], 'created_at' => time()]);
    audit('create', 'customer', $id, $name);
    return [$id, false];
}

/* ------------------------------------------------------------ customers */
function act_customers_list(array $in): array {
    need_any([['customers', 'view'], ['repairs', 'add'], ['appleid', 'add'], ['sales', 'add'], ['regional', 'add']]);
    return rows("SELECT c.id,c.name,c.phone,c.email,c.gender,c.address,c.created_at,
      (SELECT COUNT(*) FROM repairs r WHERE r.customer_id=c.id) repairs,
      (SELECT COUNT(*) FROM appleids a WHERE a.customer_id=c.id) appleids,
      (SELECT COUNT(*) FROM regional g WHERE g.customer_id=c.id) regional,
      (SELECT COUNT(*) FROM sales s WHERE s.customer_id=c.id) sales,
      (SELECT COUNT(*) FROM soft_jobs sj WHERE sj.customer_id=c.id) software,
      (SELECT COUNT(*) FROM followups f WHERE f.customer_id=c.id AND f.done=0) followups,
      COALESCE((SELECT SUM(r.price-r.discount) FROM repairs r WHERE r.customer_id=c.id AND r.status<>'failed'),0) +
      COALESCE((SELECT SUM(sj.price-sj.discount) FROM soft_jobs sj WHERE sj.customer_id=c.id AND sj.status<>'failed'),0) -
      COALESCE((SELECT SUM(p.amount) FROM repair_payments p JOIN repairs r ON r.id=p.repair_id WHERE r.customer_id=c.id),0) -
      COALESCE((SELECT SUM(p.amount) FROM soft_payments p JOIN soft_jobs sj ON sj.id=p.job_id WHERE sj.customer_id=c.id),0) balance,
      MAX(COALESCE((SELECT MAX(received_at) FROM repairs r WHERE r.customer_id=c.id),0),COALESCE((SELECT MAX(received_at) FROM soft_jobs sj WHERE sj.customer_id=c.id),0)) last_visit
      FROM customers c ORDER BY c.id DESC");
}
function act_customer_save(array $in): array {
    $id = (int)($in['id'] ?? 0);
    $name = s($in['name'] ?? '', 80); $phone = s($in['phone'] ?? '', 30); $key = phone_key($phone);
    if (!$name || strlen($key) < 5) throw new ApiError('Customer name and a valid phone number are required.');
    $gender = in_array($in['gender'] ?? '', ['Male', 'Female', 'Other'], true) ? $in['gender'] : null;
    if ($id) {
        need('customers', 'edit');
        if (val('SELECT 1 FROM customers WHERE phone_key=? AND id<>?', [$key, $id])) throw new ApiError('Another customer already uses this phone number.');
        upd('customers', $id, ['name' => $name, 'phone' => $phone, 'phone_key' => $key, 'email' => s($in['email'] ?? '', 120), 'gender' => $gender, 'address' => s($in['address'] ?? '', 200), 'notes' => s($in['notes'] ?? '', 1000)]);
        audit('update', 'customer', $id, $name);
        return ['id' => $id, 'existing' => false];
    }
    need('customers', 'add');
    $ex = val('SELECT id FROM customers WHERE phone_key=?', [$key]);
    if ($ex) return ['id' => (int)$ex, 'existing' => true];
    $id = ins('customers', ['name' => $name, 'phone' => $phone, 'phone_key' => $key, 'email' => s($in['email'] ?? '', 120), 'gender' => $gender, 'address' => s($in['address'] ?? '', 200), 'notes' => s($in['notes'] ?? '', 1000), 'created_by' => me()['id'], 'created_at' => time()]);
    audit('create', 'customer', $id, $name);
    return ['id' => $id, 'existing' => false];
}
function act_customer_find(array $in): array {
    need_any([['customers', 'view'], ['repairs', 'add'], ['appleid', 'add'], ['sales', 'add'], ['regional', 'add']]);
    $t = trim((string)($in['q'] ?? ''));
    if (strlen($t) < 2) return [];
    $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $t) . '%';
    $k = phone_key($t);
    return rows("SELECT id,name,phone,email FROM customers WHERE name LIKE ? ESCAPE '\\' OR " . ($k ? "phone_key LIKE ?" : "phone LIKE ?") . ' ORDER BY name LIMIT 8', [$like, $k ? "%$k%" : $like]);
}
function act_customer_get(array $in): array {
    need('customers', 'view');
    $id = (int)($in['id'] ?? 0);
    $c = row('SELECT * FROM customers WHERE id=?', [$id]);
    if (!$c) throw new ApiError('Customer not found.', 404);
    $adm = is_admin();
    $repairs = rows("SELECT r.id,r.device,r.problem,r.status,r.outcome,r.received_at,r.price,r.discount,r.expected_date,u.name tech,
        COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0) paid,
        (SELECT GROUP_CONCAT(p.name||' ×'||rp.qty, ', ') FROM repair_parts rp JOIN products p ON p.id=rp.product_id WHERE rp.repair_id=r.id) parts
        FROM repairs r LEFT JOIN users u ON u.id=COALESCE(r.technician_id,r.created_by) WHERE r.customer_id=? ORDER BY r.received_at DESC", [$id]);
    $apple = can('appleid', 'view') ? rows('SELECT a.id,a.model,a.apple_id,a.status,a.date,a.expected_date,u.name handled FROM appleids a LEFT JOIN users u ON u.id=a.created_by WHERE a.customer_id=?' . ($adm ? '' : ' AND a.hidden=0') . ' ORDER BY a.id DESC', [$id]) : [];
    $regional = can('regional', 'view') ? rows('SELECT g.id,g.device,g.problem,g.region,g.status,g.date_sent,u.name handled FROM regional g LEFT JOIN users u ON u.id=g.created_by WHERE g.customer_id=? ORDER BY g.id DESC', [$id]) : [];
    $sales = can('sales', 'view') ? rows('SELECT s.id,s.date,s.total,s.discount,s.paid,s.product_rev,s.service_rev,' . SALE_ITEMS_SQL . ' items,u.name handled FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.customer_id=? ORDER BY s.id DESC', [$id]) : [];
    $follow = rows('SELECT f.*,u.name by_name FROM followups f LEFT JOIN users u ON u.id=f.created_by WHERE f.customer_id=? ORDER BY f.done,f.due_date', [$id]);
    $pay = rows("SELECT p.id,p.amount,p.method,p.date,p.note,'Hardware: '||r.device device,u.name by_name FROM repair_payments p JOIN repairs r ON r.id=p.repair_id LEFT JOIN users u ON u.id=p.user_id WHERE r.customer_id=?", [$id]);
    $soft = can('software', 'view') ? rows('SELECT j.id,j.kind,j.device,j.imei,j.apple_id,j.problem,j.status,j.received_at,j.expected_date,j.price,j.discount,u.name tech,
        COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0) paid FROM soft_jobs j LEFT JOIN users u ON u.id=COALESCE(j.technician_id,j.created_by) WHERE j.customer_id=? ORDER BY j.received_at DESC', [$id]) : [];
    if ($soft) $pay = array_merge($pay, rows("SELECT p.id,p.amount,p.method,p.date,p.note,'Software: '||j.device device,u.name by_name FROM soft_payments p JOIN soft_jobs j ON j.id=p.job_id LEFT JOIN users u ON u.id=p.user_id WHERE j.customer_id=?", [$id]));
    usort($pay, fn($a, $b) => strcmp((string)$b['date'], (string)$a['date']));
    $portal = $adm ? row('SELECT id,status,last_login FROM portal_accounts WHERE customer_id=?', [$id]) : null;
    return ['customer' => $c, 'repairs' => $repairs, 'software' => $soft, 'appleids' => $apple, 'regional' => $regional, 'sales' => $sales, 'followups' => $follow, 'payments' => $pay, 'portal' => $portal,
        'devices' => array_values(array_unique(array_filter(array_merge(array_column($repairs, 'device'), array_column($soft, 'device'), array_column($apple, 'model'), array_column($regional, 'device')))))];
}
function act_customer_delete(array $in): array {
    admin(); $id = (int)($in['id'] ?? 0);
    foreach (['repairs', 'soft_jobs', 'appleids', 'regional', 'sales'] as $t) if (val("SELECT 1 FROM $t WHERE customer_id=?", [$id])) throw new ApiError('This customer has service history and cannot be deleted.');
    $c = row('SELECT name FROM customers WHERE id=?', [$id]);
    q('DELETE FROM followups WHERE customer_id=?', [$id]); q('DELETE FROM customers WHERE id=?', [$id]);
    audit('delete', 'customer', $id, (string)($c['name'] ?? ''));
    return [];
}

/* ------------------------------------------------------------ follow-ups */
function act_followups_list(array $in): array {
    need('customers', 'view');
    return rows('SELECT f.*,c.name customer_name,c.phone,u.name by_name FROM followups f JOIN customers c ON c.id=f.customer_id LEFT JOIN users u ON u.id=f.created_by ORDER BY f.done, f.due_date IS NULL, f.due_date, f.id DESC LIMIT 500');
}
function act_followup_save(array $in): array {
    need('customers', 'edit');
    $type = in_array($in['type'] ?? '', FOLLOWUP_TYPES, true) ? $in['type'] : 'other_service';
    $cid = (int)($in['customer_id'] ?? 0);
    if (!val('SELECT 1 FROM customers WHERE id=?', [$cid])) throw new ApiError('Customer not found.', 404);
    $id = ins('followups', ['customer_id' => $cid, 'type' => $type, 'note' => s($in['note'] ?? '', 500), 'due_date' => d($in['due_date'] ?? null), 'created_by' => me()['id'], 'created_at' => time()]);
    audit('create', 'followup', $id, $type);
    return ['id' => $id];
}
function act_followup_done(array $in): array {
    need('customers', 'edit');
    $id = (int)($in['id'] ?? 0); $done = empty($in['undo']) ? 1 : 0;
    q('UPDATE followups SET done=?,done_at=? WHERE id=?', [$done, $done ? time() : null, $id]);
    audit('status', 'followup', $id, $done ? 'done' : 'reopened');
    return [];
}

/* ------------------------------------------------------------ repairs */
function act_repairs_list(array $in): array {
    need('repairs', 'view');
    return rows("SELECT r.id,r.customer_id,c.name customer_name,c.phone,r.device,r.imei,r.problem,r.status,r.outcome,r.received_at,r.expected_date,r.price,r.discount,r.technician_id,u.name tech,r.updated_at,
      COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0) paid,
      (SELECT COUNT(*) FROM repair_parts WHERE repair_id=r.id) parts_count
      FROM repairs r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.technician_id ORDER BY r.id DESC LIMIT 1000");
}
function act_repair_get(array $in): array {
    need('repairs', 'view');
    $id = (int)($in['id'] ?? 0);
    $r = row('SELECT r.*,c.name customer_name,c.phone,c.email,u.name tech,cb.name created_name FROM repairs r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.technician_id LEFT JOIN users cb ON cb.id=r.created_by WHERE r.id=?', [$id]);
    if (!$r) throw new ApiError('Repair not found.', 404);
    $adm = is_admin();
    $parts = rows('SELECT rp.id,rp.qty,rp.unit_cost,rp.unit_price,rp.ts,p.name product,s.name store,u.name by_name FROM repair_parts rp JOIN products p ON p.id=rp.product_id LEFT JOIN stores s ON s.id=rp.store_id LEFT JOIN users u ON u.id=rp.user_id WHERE rp.repair_id=? ORDER BY rp.id', [$id]);
    if (!$adm) foreach ($parts as &$p) unset($p['unit_cost']);
    unset($p);
    return ['repair' => $r, 'events' => rows('SELECT e.status,e.note,e.ts,u.name by_name FROM repair_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.repair_id=? ORDER BY e.id DESC', [$id]),
        'parts' => $parts, 'payments' => rows('SELECT p.id,p.amount,p.method,p.date,p.note,u.name by_name FROM repair_payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.repair_id=? ORDER BY p.id', [$id])];
}
function act_repair_save(array $in): array {
    $u = me(); $id = (int)($in['id'] ?? 0);
    $f = ['device' => s($in['device'] ?? '', 120), 'imei' => s($in['imei'] ?? '', 40), 'problem' => s($in['problem'] ?? '', 1000), 'diagnosis' => s($in['diagnosis'] ?? '', 1000),
        'diagnosis_notes' => s($in['diagnosis_notes'] ?? '', 1500), 'required_parts' => s($in['required_parts'] ?? '', 500), 'progress_notes' => s($in['progress_notes'] ?? '', 1500),
        'test_result' => s($in['test_result'] ?? '', 500), 'expected_date' => d($in['expected_date'] ?? null), 'price' => max(0, n($in['price'] ?? 0)), 'discount' => max(0, n($in['discount'] ?? 0)),
        'technician_id' => ((int)($in['technician_id'] ?? 0)) ?: null, 'updated_at' => time()];
    if (!$f['device']) throw new ApiError('Device model is required.');
    if ($f['discount'] > $f['price']) throw new ApiError('Discount cannot exceed the price.');
    if ($f['technician_id'] && !val("SELECT 1 FROM users WHERE id=? AND status='active'", [$f['technician_id']])) $f['technician_id'] = null;
    if ($id) {
        need('repairs', 'edit');
        if (!val('SELECT 1 FROM repairs WHERE id=?', [$id])) throw new ApiError('Repair not found.', 404);
        upd('repairs', $id, $f);
        audit('update', 'repair', $id, $f['device']);
        return ['id' => $id];
    }
    need('repairs', 'add');
    [$cid, $existed] = resolve_customer($in);
    $f += ['customer_id' => $cid, 'status' => 'received', 'received_at' => time(), 'created_by' => $u['id']];
    if (!$f['technician_id']) $f['technician_id'] = $u['position'] === 'Technician' ? $u['id'] : null;
    $id = ins('repairs', $f);
    ins('repair_events', ['repair_id' => $id, 'status' => 'received', 'note' => 'Device received', 'user_id' => $u['id'], 'ts' => time()]);
    audit('create', 'repair', $id, $f['device']);
    return ['id' => $id, 'customer_id' => $cid, 'existing_customer' => $existed];
}
function act_repair_status(array $in): array {
    $u = need('repairs', 'status');
    $id = (int)($in['id'] ?? 0); $st = (string)($in['status'] ?? '');
    $r = row('SELECT r.*,c.name cname FROM repairs r JOIN customers c ON c.id=r.customer_id WHERE r.id=?', [$id]);
    if (!$r) throw new ApiError('Repair not found.', 404);
    if (!in_array($st, REPAIR_STATUSES, true)) throw new ApiError('Invalid status.');
    $outcome = in_array($in['outcome'] ?? '', REPAIR_OUTCOMES, true) ? $in['outcome'] : $r['outcome'];
    if ($st === 'took_completed') $outcome = 'took_completed';
    if ($st === 'took_incomplete') $outcome = 'took_incomplete';
    $closed = in_array($st, ['completed', 'took_completed', 'took_incomplete', 'failed'], true) ? time() : null;
    $d = ['status' => $st, 'outcome' => $outcome, 'updated_at' => time(), 'closed_at' => $closed];
    if (!empty($in['test_result'])) $d['test_result'] = s($in['test_result'], 500);
    upd('repairs', $id, $d);
    ins('repair_events', ['repair_id' => $id, 'status' => $st, 'note' => s($in['note'] ?? '', 500), 'user_id' => $u['id'], 'ts' => time()]);
    audit('status', 'repair', $id, $st);
    // linked follow-ups
    $open = fn(string $t) => val("SELECT 1 FROM followups WHERE ref_kind='repair' AND ref_id=? AND type=? AND done=0", [$id, $t]);
    $mk = function (string $t, string $note) use ($r, $id, $u, $open) { if (!$open($t)) ins('followups', ['customer_id' => $r['customer_id'], 'type' => $t, 'note' => $note, 'due_date' => today(), 'ref_kind' => 'repair', 'ref_id' => $id, 'created_by' => $u['id'], 'created_at' => time()]); };
    if ($st === 'ready') { $mk('collect_phone', "{$r['device']} is ready for collection"); notify('followup', "Ready for customer: {$r['device']} — {$r['cname']}", 'perm:repairs', '#/repairs'); }
    if ($st === 'waiting_part') $mk('replacement_part', "{$r['device']} waiting for a part");
    if (in_array($st, ['took_completed', 'took_incomplete'], true)) q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='repair' AND ref_id=? AND type='collect_phone' AND done=0", [time(), $id]);
    if ($st === 'took_incomplete') $mk('continue_repair', "{$r['device']} left incomplete — customer must return");
    return [];
}
function act_repair_part_add(array $in): array {
    $u = need('repairs', 'edit');
    $rid = (int)($in['repair_id'] ?? 0); $pid = (int)($in['product_id'] ?? 0); $qty = (int)($in['qty'] ?? 0);
    $store = ((int)($in['store_id'] ?? 0)) ?: null;
    $r = row('SELECT id,device FROM repairs WHERE id=?', [$rid]); $p = row('SELECT * FROM products WHERE id=?', [$pid]);
    if (!$r || !$p) throw new ApiError('Repair or product not found.', 404);
    if ($qty < 1 || $qty > 1000) throw new ApiError('Quantity must be at least 1.');
    foreach (allocate($pid, $qty, $store, ((int)($in['lot_id'] ?? 0)) ?: null, 'REPAIR_USAGE', ['ref_kind' => 'repair_part', 'ref_id' => 0, 'note' => 'Hardware repair #' . $rid]) as $a) {
        tx_ref([$a['tx_id']], 'repair_part', ins('repair_parts', ['repair_id' => $rid, 'product_id' => $pid, 'lot_id' => $a['lot_id'], 'store_id' => $a['store_id'], 'qty' => $a['qty'], 'unit_cost' => $a['cost'], 'unit_price' => (float)$p['sale_price'], 'user_id' => $u['id'], 'ts' => time()]));
    }
    ins('repair_events', ['repair_id' => $rid, 'status' => val('SELECT status FROM repairs WHERE id=?', [$rid]), 'note' => "Part used: {$p['name']} × {$qty}", 'user_id' => $u['id'], 'ts' => time()]);
    audit('part_add', 'repair', $rid, "{$p['name']} x{$qty}");
    return [];
}
function act_repair_part_remove(array $in): array {
    need('repairs', 'edit');
    $rp = row('SELECT * FROM repair_parts WHERE id=?', [(int)($in['id'] ?? 0)]);
    if (!$rp) throw new ApiError('Part record not found.', 404);
    tx_void_ref('repair_part', (int)$rp['id']);
    q('DELETE FROM repair_parts WHERE id=?', [$rp['id']]);
    audit('part_remove', 'repair', (int)$rp['repair_id']);
    return [];
}
function act_repair_payment_add(array $in): array {
    $u = need('repairs', 'edit');
    $rid = (int)($in['repair_id'] ?? 0); $amt = round(n($in['amount'] ?? 0), 2);
    if (!val('SELECT 1 FROM repairs WHERE id=?', [$rid])) throw new ApiError('Repair not found.', 404);
    if ($amt <= 0) throw new ApiError('Enter a payment amount.');
    $id = ins('repair_payments', ['repair_id' => $rid, 'amount' => $amt, 'method' => s($in['method'] ?? 'Cash', 30), 'date' => d($in['date'] ?? null) ?? today(), 'user_id' => $u['id'], 'note' => s($in['note'] ?? '', 200)]);
    q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='repair' AND ref_id=? AND type='complete_payment' AND done=0 AND (SELECT price-discount-COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=?),0) FROM repairs WHERE id=?)<=0", [time(), $rid, $rid, $rid]);
    audit('payment', 'repair', $rid, (string)$amt);
    return ['id' => $id];
}
function act_repair_delete(array $in): array {
    need('repairs', 'delete'); $id = (int)($in['id'] ?? 0);
    foreach (rows('SELECT id FROM repair_parts WHERE repair_id=?', [$id]) as $rp) tx_void_ref('repair_part', (int)$rp['id']);
    foreach (['repair_parts', 'repair_events', 'repair_payments'] as $t) q("DELETE FROM $t WHERE repair_id=?", [$id]);
    q("DELETE FROM followups WHERE ref_kind='repair' AND ref_id=?", [$id]);
    q('DELETE FROM repairs WHERE id=?', [$id]);
    audit('delete', 'repair', $id);
    return [];
}

/* ------------------------------------------------------------ Apple ID */
function apple_vis(): string { return is_admin() ? '' : ' AND a.hidden=0'; }
const APPLE_COLS = "a.id,a.customer_id,a.customer_name,a.phone,a.model,a.apple_id,a.description,a.date,a.hidden,a.status,a.request_date,a.expected_date,a.assigned_to,a.notes,a.ts,
  u.name created_name, s.name assigned_name,
  CASE WHEN a.expected_date IS NULL THEN NULL ELSE CAST(julianday(a.expected_date)-julianday(date('now','localtime')) AS INTEGER) END days_left";
function act_appleid_list(array $in): array {
    need('appleid', 'view');
    return rows('SELECT ' . APPLE_COLS . ' FROM appleids a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users s ON s.id=a.assigned_to WHERE 1=1' . apple_vis() . ' ORDER BY a.id DESC LIMIT 1000');
}
function apple_get(int $id): array {
    $r = row('SELECT a.*,u.name created_name FROM appleids a LEFT JOIN users u ON u.id=a.created_by WHERE a.id=?' . apple_vis(), [$id]);
    if (!$r) throw new ApiError('Record not found.', 404);
    return $r;
}
function act_appleid_reveal(array $in): array {
    need('appleid', 'view');
    $r = apple_get((int)($in['id'] ?? 0));
    audit('reveal', 'appleid', (int)$r['id'], (string)$r['customer_name']);
    return ['password' => dec($r['pw_enc'])];
}
function act_appleid_full(array $in): array {
    need('appleid', 'view');
    $ids = array_map('intval', (array)($in['ids'] ?? []));
    $out = [];
    foreach (rows('SELECT ' . APPLE_COLS . ',a.pw_enc FROM appleids a LEFT JOIN users u ON u.id=a.created_by LEFT JOIN users s ON s.id=a.assigned_to WHERE 1=1' . apple_vis() . ' ORDER BY a.id DESC') as $r) {
        if ($ids && !in_array((int)$r['id'], $ids, true)) continue;
        $r['password'] = dec($r['pw_enc']); unset($r['pw_enc']); $out[] = $r;
    }
    audit('export', 'appleid', null, count($out) . ' record(s) printed/exported');
    return $out;
}
function act_appleid_save(array $in): array {
    $u = me(); $id = (int)($in['id'] ?? 0);
    $f = ['model' => s($in['model'] ?? '', 100), 'apple_id' => s($in['apple_id'] ?? '', 150), 'description' => s($in['description'] ?? '', 1000),
        'date' => d($in['date'] ?? null) ?? today(), 'request_date' => d($in['request_date'] ?? null) ?? today(), 'expected_date' => d($in['expected_date'] ?? null),
        'assigned_to' => ((int)($in['assigned_to'] ?? 0)) ?: null, 'notes' => s($in['notes'] ?? '', 1000), 'updated_at' => time()];
    if (!$f['model'] || !$f['apple_id']) throw new ApiError('iPhone model and Apple ID are required.');
    $pw = (string)($in['password'] ?? '');
    if ($id) {
        need('appleid', 'edit'); apple_get($id);
        if ($pw !== '') $f['pw_enc'] = enc($pw);
        upd('appleids', $id, $f);
        audit('update', 'appleid', $id, $f['model']);
        return ['id' => $id];
    }
    need('appleid', 'add');
    if ($pw === '') throw new ApiError('Apple ID password is required.');
    [$cid] = resolve_customer($in);
    $cname = (string)val('SELECT name FROM customers WHERE id=?', [$cid]); $cphone = (string)val('SELECT phone FROM customers WHERE id=?', [$cid]);
    $st = in_array($in['status'] ?? '', APPLE_STATUSES, true) ? $in['status'] : 'request';
    $id = ins('appleids', $f + ['customer_id' => $cid, 'customer_name' => $cname, 'phone' => $cphone, 'pw_enc' => enc($pw), 'created_by' => $u['id'], 'status' => $st, 'ts' => time()]);
    audit('create', 'appleid', $id, $f['model']);
    return ['id' => $id];
}
function act_appleid_status(array $in): array {
    need('appleid', 'status');
    $id = (int)($in['id'] ?? 0); $st = (string)($in['status'] ?? '');
    $r = apple_get($id);
    if (!in_array($st, APPLE_STATUSES, true)) throw new ApiError('Invalid status.');
    $notes = trim((string)$r['notes']);
    if (!empty($in['note'])) $notes = trim($notes . "\n[" . date('d M H:i') . '] ' . s($in['note'], 300));
    $d = ['status' => $st, 'notes' => $notes, 'updated_at' => time()];
    if (!empty($in['expected_date']) && d($in['expected_date'])) { $d['expected_date'] = d($in['expected_date']); $d['last_notified'] = null; }
    upd('appleids', $id, $d);
    audit('status', 'appleid', $id, $st === 'finished' ? 'finished' : $st);
    if ($st === 'finished' && $r['customer_id'] && !val("SELECT 1 FROM followups WHERE ref_kind='appleid' AND ref_id=? AND done=0", [$id]))
        ins('followups', ['customer_id' => $r['customer_id'], 'type' => 'collect_phone', 'note' => "Apple ID finished for {$r['model']}", 'due_date' => today(), 'ref_kind' => 'appleid', 'ref_id' => $id, 'created_by' => me()['id'], 'created_at' => time()]);
    if (in_array($st, ['took'], true)) q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='appleid' AND ref_id=? AND done=0", [time(), $id]);
    return [];
}
function act_appleid_hide(array $in): array {
    admin(); $id = (int)($in['id'] ?? 0); $h = empty($in['hidden']) ? 0 : 1;
    upd('appleids', $id, ['hidden' => $h]);
    audit($h ? 'hide' : 'unhide', 'appleid', $id);
    return [];
}
function act_appleid_delete(array $in): array {
    need('appleid', 'delete'); $id = (int)($in['id'] ?? 0); apple_get($id);
    q('DELETE FROM appleids WHERE id=?', [$id]); audit('delete', 'appleid', $id);
    return [];
}

/* ------------------------------------------------------------ regional */
function act_regional_list(array $in): array {
    need('regional', 'view');
    return rows('SELECT g.*,u.name created_name FROM regional g LEFT JOIN users u ON u.id=g.created_by ORDER BY g.id DESC LIMIT 1000');
}
function act_regional_save(array $in): array {
    $u = me(); $id = (int)($in['id'] ?? 0);
    $f = ['device' => s($in['device'] ?? '', 120), 'problem' => s($in['problem'] ?? '', 800), 'region' => s($in['region'] ?? '', 100), 'sent_to' => s($in['sent_to'] ?? '', 150),
        'date_sent' => d($in['date_sent'] ?? null), 'technician' => s($in['technician'] ?? '', 100), 'parts' => s($in['parts'] ?? '', 300), 'cost' => max(0, n($in['cost'] ?? 0)),
        'expected_return' => d($in['expected_return'] ?? null), 'actual_return' => d($in['actual_return'] ?? null), 'notes' => s($in['notes'] ?? '', 1000)];
    if (!$f['device'] || !$f['region']) throw new ApiError('Device and region are required.');
    if ($id) {
        need('regional', 'edit'); upd('regional', $id, $f); audit('update', 'regional', $id, $f['device']); return ['id' => $id];
    }
    need('regional', 'add');
    [$cid] = resolve_customer($in);
    $st = in_array($in['status'] ?? '', REGIONAL_STATUSES, true) ? $in['status'] : 'received';
    $id = ins('regional', $f + ['customer_id' => $cid, 'customer_name' => (string)val('SELECT name FROM customers WHERE id=?', [$cid]), 'phone' => (string)val('SELECT phone FROM customers WHERE id=?', [$cid]), 'status' => $st, 'created_by' => $u['id'], 'ts' => time()]);
    audit('create', 'regional', $id, $f['device']);
    return ['id' => $id];
}
function act_regional_status(array $in): array {
    need('regional', 'status'); $id = (int)($in['id'] ?? 0); $st = (string)($in['status'] ?? '');
    if (!in_array($st, REGIONAL_STATUSES, true)) throw new ApiError('Invalid status.');
    $r = row('SELECT * FROM regional WHERE id=?', [$id]); if (!$r) throw new ApiError('Not found.', 404);
    $d = ['status' => $st];
    if ($st === 'returned' && !$r['actual_return']) $d['actual_return'] = today();
    if (!empty($in['note'])) $d['notes'] = trim($r['notes'] . "\n[" . date('d M H:i') . '] ' . s($in['note'], 300));
    upd('regional', $id, $d);
    audit('status', 'regional', $id, $st);
    if ($st === 'ready') notify('followup', "Regional repair ready: {$r['device']} — {$r['customer_name']}", 'perm:regional', '#/regional');
    return [];
}
function act_regional_delete(array $in): array {
    need('regional', 'delete'); $id = (int)($in['id'] ?? 0);
    q('DELETE FROM regional WHERE id=?', [$id]); audit('delete', 'regional', $id);
    return [];
}
