<?php
declare(strict_types=1);

/* Software Department: software repair, Apple Unlock requests, New Apple ID services */
const SOFT_STATUS = [
    'repair' => ['received', 'diagnosis', 'in_progress', 'waiting', 'testing', 'working', 'not_working', 'completed', 'failed', 'took', 'instore'],
    'unlock' => ['request', 'received', 'in_progress', 'waiting', 'completed', 'failed', 'took', 'instore'],
    'newid'  => ['requested', 'creating', 'created', 'verified', 'failed', 'customer_received'],
];
const SOFT_OPEN = [
    'repair' => ['received', 'diagnosis', 'in_progress', 'waiting', 'testing', 'working', 'not_working'],
    'unlock' => ['request', 'received', 'in_progress', 'waiting'],
    'newid'  => ['requested', 'creating', 'created', 'verified'],
];
const SOFT_TERMINAL = ['completed', 'failed', 'took', 'instore', 'customer_received'];

function soft_kind(mixed $k): string {
    if (!isset(SOFT_STATUS[$k])) throw new ApiError('Unknown service type.');
    return $k;
}
const SOFT_COLS = "j.id,j.kind,j.customer_id,c.name customer_name,c.phone,j.device,j.imei,j.serial,cb.name created_name,(j.gmail_pw IS NOT NULL OR j.apple_pw IS NOT NULL) has_secret,j.problem,j.diagnosis,j.apple_id,j.lock_info,j.technician_id,u.name tech,j.status,j.notes,j.request_date,j.expected_date,j.account_date,j.price,j.discount,j.received_at,j.updated_at,
  COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0) paid,
  (SELECT COUNT(*) FROM soft_parts WHERE job_id=j.id) parts_count,
  CASE WHEN j.expected_date IS NULL THEN NULL ELSE CAST(julianday(j.expected_date)-julianday(date('now','localtime')) AS INTEGER) END days_left";

function act_soft_list(array $in): array {
    need('software', 'view');
    $kind = isset($in['kind']) && $in['kind'] !== '' ? soft_kind($in['kind']) : null;
    return rows('SELECT ' . SOFT_COLS . ' FROM soft_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.technician_id LEFT JOIN users cb ON cb.id=j.created_by' . ($kind ? ' WHERE j.kind=?' : '') . ' ORDER BY j.id DESC LIMIT 1500', $kind ? [$kind] : []);
}
function act_soft_get(array $in): array {
    need('software', 'view');
    $id = (int)($in['id'] ?? 0);
    $j = row('SELECT j.*,c.name customer_name,c.phone,c.email,u.name tech,cb.name created_name FROM soft_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.technician_id LEFT JOIN users cb ON cb.id=j.created_by WHERE j.id=?', [$id]);
    if (!$j) throw new ApiError('Service not found.', 404);
    $parts = rows('SELECT sp.id,sp.qty,sp.unit_cost,sp.unit_price,sp.ts,p.name product,s.name store,u.name by_name FROM soft_parts sp JOIN products p ON p.id=sp.product_id LEFT JOIN stores s ON s.id=sp.store_id LEFT JOIN users u ON u.id=sp.user_id WHERE sp.job_id=? ORDER BY sp.id', [$id]);
    if (!is_admin()) foreach ($parts as &$p) unset($p['unit_cost']);
    unset($p);
    $j['has_secret'] = (bool)($j['gmail_pw'] || $j['apple_pw']); unset($j['gmail_pw'], $j['apple_pw']);
    return ['job' => $j, 'parts' => $parts,
        'events' => rows('SELECT e.status,e.note,e.ts,u.name by_name FROM soft_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.job_id=? ORDER BY e.id DESC', [$id]),
        'payments' => rows('SELECT p.id,p.amount,p.method,p.date,p.note,u.name by_name FROM soft_payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.job_id=? ORDER BY p.id', [$id])];
}
function act_soft_save(array $in): array {
    $u = me(); $id = (int)($in['id'] ?? 0);
    $existing = $id ? row('SELECT * FROM soft_jobs WHERE id=?', [$id]) : null;
    if ($id && !$existing) throw new ApiError('Service not found.', 404);
    $kind = $existing ? $existing['kind'] : soft_kind($in['kind'] ?? '');
    need('software', $id ? 'edit' : 'add');
    $f = ['device' => s($in['device'] ?? '', 120), 'imei' => s($in['imei'] ?? '', 40), 'serial' => s($in['serial'] ?? '', 40), 'problem' => s($in['problem'] ?? '', 1000), 'diagnosis' => s($in['diagnosis'] ?? '', 1000),
        'apple_id' => s($in['apple_id'] ?? '', 150), 'lock_info' => s($in['lock_info'] ?? '', 1000), 'notes' => s($in['notes'] ?? '', 1500), 'tools' => s($in['tools'] ?? '', 500),
        'progress_notes' => s($in['progress_notes'] ?? '', 1500), 'test_result' => s($in['test_result'] ?? '', 500),
        'request_date' => d($in['request_date'] ?? null), 'expected_date' => d($in['expected_date'] ?? null), 'account_date' => d($in['account_date'] ?? null),
        'price' => max(0, n($in['price'] ?? 0)), 'discount' => max(0, n($in['discount'] ?? 0)), 'technician_id' => ((int)($in['technician_id'] ?? 0)) ?: null, 'updated_at' => time()];
    if (!$f['device']) throw new ApiError('Device / iPhone model is required.');
    if ($kind === 'newid' && !$f['apple_id']) throw new ApiError('Enter the new Apple ID email.');
    if ($f['discount'] > $f['price']) throw new ApiError('Discount cannot exceed the price.');
    if ($f['technician_id'] && !val("SELECT 1 FROM users WHERE id=? AND status='active'", [$f['technician_id']])) $f['technician_id'] = null;
    if ($kind === 'newid') {
        foreach (['gmail_password' => 'gmail_pw', 'apple_password' => 'apple_pw'] as $in_k => $col) { $pw = (string)($in[$in_k] ?? ''); if ($pw !== '') $f[$col] = enc($pw); }
    }
    if ($existing) {
        upd('soft_jobs', $id, $f);
        audit('update', 'software', $id, $kind . ': ' . $f['device']);
        return ['id' => $id];
    }
    [$cid, $existed] = resolve_customer($in);
    if ($kind === 'unlock' && !$f['request_date']) $f['request_date'] = today();
    if ($kind === 'newid' && !$f['account_date']) $f['account_date'] = today();
    $first = SOFT_STATUS[$kind][0];
    $id = ins('soft_jobs', $f + ['kind' => $kind, 'customer_id' => $cid, 'status' => $first, 'received_at' => time(), 'created_by' => $u['id']]);
    ins('soft_events', ['job_id' => $id, 'status' => $first, 'note' => 'Service registered', 'user_id' => $u['id'], 'ts' => time()]);
    audit('create', 'software', $id, $kind . ': ' . $f['device']);
    return ['id' => $id, 'customer_id' => $cid, 'existing_customer' => $existed];
}
function act_soft_status(array $in): array {
    $u = need('software', 'status');
    $id = (int)($in['id'] ?? 0); $st = (string)($in['status'] ?? '');
    $j = row('SELECT j.*,c.name cname FROM soft_jobs j JOIN customers c ON c.id=j.customer_id WHERE j.id=?', [$id]);
    if (!$j) throw new ApiError('Service not found.', 404);
    if (!in_array($st, SOFT_STATUS[$j['kind']], true)) throw new ApiError('Invalid status for this service.');
    $d = ['status' => $st, 'updated_at' => time(), 'closed_at' => in_array($st, SOFT_TERMINAL, true) ? time() : null];
    if (!empty($in['test_result'])) $d['test_result'] = s($in['test_result'], 500);
    if (!empty($in['expected_date']) && d($in['expected_date'])) { $d['expected_date'] = d($in['expected_date']); $d['last_notified'] = null; }
    upd('soft_jobs', $id, $d);
    ins('soft_events', ['job_id' => $id, 'status' => $st, 'note' => s($in['note'] ?? '', 500), 'user_id' => $u['id'], 'ts' => time()]);
    audit('status', 'software', $id, $st);
    $label = ['repair' => 'Software repair', 'unlock' => 'Apple Unlock', 'newid' => 'New Apple ID'][$j['kind']];
    $mk = function (string $t, string $note) use ($j, $id, $u) {
        if (!val("SELECT 1 FROM followups WHERE ref_kind='software' AND ref_id=? AND type=? AND done=0", [$id, $t]))
            ins('followups', ['customer_id' => $j['customer_id'], 'type' => $t, 'note' => $note, 'due_date' => today(), 'ref_kind' => 'software', 'ref_id' => $id, 'created_by' => $u['id'], 'created_at' => time()]);
    };
    if (in_array($st, ['completed', 'verified'], true)) { $mk('collect_phone', "$label finished — {$j['device']} ready for the customer"); notify('followup', "$label finished: {$j['device']} — {$j['cname']}", 'perm:software', '#/software'); }
    if (in_array($st, ['took', 'instore', 'customer_received'], true)) q("UPDATE followups SET done=1,done_at=? WHERE ref_kind='software' AND ref_id=? AND done=0", [time(), $id]);
    return [];
}
function act_soft_part_add(array $in): array {
    $u = need('software', 'edit');
    $jid = (int)($in['job_id'] ?? 0); $pid = (int)($in['product_id'] ?? 0); $qty = (int)($in['qty'] ?? 0); $store = ((int)($in['store_id'] ?? 0)) ?: null;
    $j = row('SELECT id,status FROM soft_jobs WHERE id=?', [$jid]); $p = row('SELECT * FROM products WHERE id=?', [$pid]);
    if (!$j || !$p) throw new ApiError('Service or product not found.', 404);
    if ($qty < 1 || $qty > 1000) throw new ApiError('Quantity must be at least 1.');
    foreach (allocate($pid, $qty, $store, ((int)($in['lot_id'] ?? 0)) ?: null, 'REPAIR_USAGE', ['ref_kind' => 'soft_part', 'ref_id' => 0, 'note' => 'Software service #' . $jid]) as $a)
        tx_ref([$a['tx_id']], 'soft_part', ins('soft_parts', ['job_id' => $jid, 'product_id' => $pid, 'lot_id' => $a['lot_id'], 'store_id' => $a['store_id'], 'qty' => $a['qty'], 'unit_cost' => $a['cost'], 'unit_price' => (float)$p['sale_price'], 'user_id' => $u['id'], 'ts' => time()]));
    ins('soft_events', ['job_id' => $jid, 'status' => $j['status'], 'note' => "Part / tool used: {$p['name']} × {$qty}", 'user_id' => $u['id'], 'ts' => time()]);
    audit('part_add', 'software', $jid, "{$p['name']} x{$qty}");
    return [];
}
function act_soft_part_remove(array $in): array {
    need('software', 'edit');
    $sp = row('SELECT * FROM soft_parts WHERE id=?', [(int)($in['id'] ?? 0)]);
    if (!$sp) throw new ApiError('Part record not found.', 404);
    tx_void_ref('soft_part', (int)$sp['id']);
    q('DELETE FROM soft_parts WHERE id=?', [$sp['id']]);
    audit('part_remove', 'software', (int)$sp['job_id']);
    return [];
}
function act_soft_payment_add(array $in): array {
    $u = need('software', 'edit');
    $jid = (int)($in['job_id'] ?? 0); $amt = round(n($in['amount'] ?? 0), 2);
    if (!val('SELECT 1 FROM soft_jobs WHERE id=?', [$jid])) throw new ApiError('Service not found.', 404);
    if ($amt <= 0) throw new ApiError('Enter a payment amount.');
    $id = ins('soft_payments', ['job_id' => $jid, 'amount' => $amt, 'method' => s($in['method'] ?? 'Cash', 30), 'date' => d($in['date'] ?? null) ?? today(), 'user_id' => $u['id'], 'note' => s($in['note'] ?? '', 200)]);
    audit('payment', 'software', $jid, (string)$amt);
    return ['id' => $id];
}
function act_soft_delete(array $in): array {
    need('software', 'delete'); $id = (int)($in['id'] ?? 0);
    foreach (rows('SELECT id FROM soft_parts WHERE job_id=?', [$id]) as $sp) tx_void_ref('soft_part', (int)$sp['id']);
    foreach (['soft_parts', 'soft_events', 'soft_payments'] as $t) q("DELETE FROM $t WHERE job_id=?", [$id]);
    q("DELETE FROM followups WHERE ref_kind='software' AND ref_id=?", [$id]);
    q('DELETE FROM soft_jobs WHERE id=?', [$id]);
    audit('delete', 'software', $id);
    return [];
}

/** Gmail / Apple ID passwords of a New Apple ID service — only users who can EDIT the Software Department (or the Super Admin). Every reveal is audited. */
function act_soft_secret(array $in): array {
    need('software', 'edit');
    $j = row("SELECT id,customer_id,gmail_pw,apple_pw FROM soft_jobs WHERE id=? AND kind='newid'", [(int)($in['id'] ?? 0)]);
    if (!$j) throw new ApiError('Service not found.', 404);
    audit('reveal', 'software', (int)$j['id'], 'New Apple ID passwords');
    return ['gmail_password' => dec($j['gmail_pw']), 'apple_password' => dec($j['apple_pw'])];
}
function act_soft_full(array $in): array {
    need('software', 'edit');
    $ids = array_map('intval', (array)($in['ids'] ?? []));
    if (!$ids) return [];
    $ph = implode(',', array_fill(0, count($ids), '?'));
    $out = rows('SELECT ' . SOFT_COLS . ',j.gmail_pw,j.apple_pw FROM soft_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.technician_id LEFT JOIN users cb ON cb.id=j.created_by WHERE j.id IN (' . $ph . ')', $ids);
    foreach ($out as &$r) { $r['gmail_password'] = dec($r['gmail_pw']); $r['apple_password'] = dec($r['apple_pw']); unset($r['gmail_pw'], $r['apple_pw']); }
    audit('export', 'software', null, count($out) . ' service(s) printed with credentials');
    return $out;
}

/* ------------------------------------------------ service catalogue (sellable services) */
function act_services_list(array $in): array {
    need_any([['sales', 'view'], ['sales', 'add'], ['software', 'view']]);
    return rows('SELECT id,name,price,active FROM services ORDER BY id');
}
function act_service_save(array $in): array {
    admin(); $id = (int)($in['id'] ?? 0);
    $name = s($in['name'] ?? '', 80); if (!$name) throw new ApiError('Service name is required.');
    if (val('SELECT 1 FROM services WHERE name=? AND id<>?', [$name, $id])) throw new ApiError('A service with this name already exists.');
    $f = ['name' => $name, 'price' => max(0, n($in['price'] ?? 0)), 'active' => empty($in['inactive']) ? 1 : 0];
    if ($id) upd('services', $id, $f); else $id = ins('services', $f);
    audit($in['id'] ?? 0 ? 'update' : 'create', 'service', $id, $name);
    return ['id' => $id];
}
function act_service_delete(array $in): array {
    admin(); q('DELETE FROM services WHERE id=?', [(int)($in['id'] ?? 0)]); audit('delete', 'service', (int)($in['id'] ?? 0));
    return [];
}