<?php
declare(strict_types=1);

/*
 * INVENTORY ENGINE
 * ----------------
 * Received → Sold / Returned / Used in repair / Transferred → In store → Daily settlement → Finished.
 *
 * `lots` = receiving batches. The original `qty_received` is NEVER overwritten.
 * `inv_tx` = the transaction ledger (RECEIVE, SALE, RETURN, REPAIR_USAGE, TRANSFER). Every movement is a row; undoing a
 * movement VOIDS it (history is kept). The counters on `lots` are a cache re-derived from the ledger by lot_recalc().
 * In store (`qty_remaining`, a computed column) = received − sold − returned − used − transferred.
 */
const TX_TYPES = ['RECEIVE', 'SALE', 'RETURN', 'REPAIR_USAGE', 'TRANSFER'];

function lot_remaining(array $l): int {
    return (int)$l['qty_received'] - (int)$l['qty_sold'] - (int)($l['qty_used'] ?? 0) - (int)$l['qty_returned'] - (int)($l['qty_transferred'] ?? 0);
}
/** Amount owed to the supplier/store for this batch. Consignment: only what was sold or used. Credit: everything kept. Cash: already paid. */
function lot_payable(array $l): float {
    $c = (float)$l['cost']; $used = (int)$l['qty_sold'] + (int)($l['qty_used'] ?? 0);
    if (($l['source'] ?? 'supplier') === 'transfer') return $l['type'] === 'consignment' ? $c * $used : 0.0;
    return match ($l['type']) { 'consignment' => $c * $used, 'credit' => $c * ((int)$l['qty_received'] - (int)$l['qty_returned']), default => 0.0 };
}
function lot_status(array $l): string { return lot_remaining($l) > 0 ? 'IN STORE' : 'FINISHED'; }

/* ------------------------------------------------ ledger */
function tx_add(string $type, int $lot, int $qty, array $x = []): int {
    $l = row('SELECT * FROM lots WHERE id=?', [$lot]);
    if (!$l) throw new ApiError('Batch not found.', 404);
    $id = ins('inv_tx', ['type' => $type, 'product_id' => $l['product_id'], 'store_id' => $l['store_id'], 'lot_id' => $lot, 'qty' => $qty, 'unit_cost' => $x['cost'] ?? $l['cost'], 'unit_price' => $x['price'] ?? null,
        'customer_id' => $x['customer_id'] ?? null, 'user_id' => me(false)['id'] ?? ($x['user_id'] ?? null), 'ts' => $x['ts'] ?? time(), 'date' => $x['date'] ?? today(), 'ref_kind' => $x['ref_kind'] ?? null, 'ref_id' => $x['ref_id'] ?? null,
        'reason' => $x['reason'] ?? null, 'note' => $x['note'] ?? null]);
    lot_recalc($lot);
    return $id;
}
function lot_recalc(int $lot): void {
    $s = row("SELECT COALESCE(SUM(CASE WHEN type='SALE' THEN qty END),0) sold, COALESCE(SUM(CASE WHEN type='REPAIR_USAGE' THEN qty END),0) used,
        COALESCE(SUM(CASE WHEN type='RETURN' THEN qty END),0) ret, COALESCE(SUM(CASE WHEN type='TRANSFER' THEN qty END),0) trf FROM inv_tx WHERE lot_id=? AND voided=0", [$lot]);
    q('UPDATE lots SET qty_sold=?,qty_used=?,qty_returned=?,qty_transferred=? WHERE id=?', [$s['sold'], $s['used'], $s['ret'], $s['trf'], $lot]);
}
function tx_ref(array $txIds, string $kind, int $id): void { foreach ($txIds as $t) q('UPDATE inv_tx SET ref_kind=?,ref_id=? WHERE id=?', [$kind, $id, $t]); }
/** Undo movements by voiding them (kept in history, ignored by balances). */
function tx_void_ref(string $kind, int $id): void {
    foreach (rows('SELECT * FROM inv_tx WHERE ref_kind=? AND ref_id=? AND voided=0', [$kind, $id]) as $t) {
        lock_check((int)$t['store_id'], (string)$t['date']);
        q('UPDATE inv_tx SET voided=1,voided_by=?,voided_ts=? WHERE id=?', [me(false)['id'] ?? null, time(), $t['id']]);
        lot_recalc((int)$t['lot_id']);
    }
}
/** A FINISHED settlement locks that store's movements up to its date. Only the Super Admin can work inside a locked period (after reopening or as a correction). */
function lock_check(int $store, string $date): void {
    $u = me(false); if ($u && $u['is_admin']) return;
    $f = val("SELECT date FROM inv_settlements WHERE store_id=? AND status='finished' AND date>=? ORDER BY date LIMIT 1", [$store, $date]);
    if ($f) throw new ApiError("This store's settlement for " . $f . ' is FINISHED and locked. Ask the Super Admin to reopen it before changing stock for that date.', 423);
}

/** Take stock from a batch. Same product in several stores → the caller MUST choose the store or batch. */
function allocate(int $pid, int $qty, ?int $store = null, ?int $lot = null, string $type = 'SALE', array $x = []): array {
    $name = (string)val('SELECT name FROM products WHERE id=?', [$pid]);
    $sql = 'SELECT id,store_id,cost,qty_remaining rem FROM lots WHERE product_id=? AND qty_remaining>0'; $p = [$pid];
    if ($lot) { $sql .= ' AND id=?'; $p[] = $lot; }
    elseif ($store) { $sql .= ' AND store_id=?'; $p[] = $store; }
    elseif ((int)val('SELECT COUNT(DISTINCT store_id) FROM lots WHERE product_id=? AND qty_remaining>0', [$pid]) > 1)
        throw new ApiError("{$name} is in stock at more than one store — choose the source store / batch.");
    $out = []; $need = $qty;
    foreach (rows($sql . ' ORDER BY date,id', $p) as $l) {
        if ($need <= 0) break;
        $take = min($need, (int)$l['rem']);
        lock_check((int)$l['store_id'], (string)($x['date'] ?? today()));
        $tx = tx_add($type, (int)$l['id'], $take, $x);
        $out[] = ['lot_id' => (int)$l['id'], 'store_id' => (int)$l['store_id'], 'qty' => $take, 'cost' => (float)$l['cost'], 'tx_id' => $tx];
        $need -= $take;
    }
    if ($need > 0) throw new ApiError("Not enough stock for {$name}: requested {$qty}, available " . ($qty - $need) . ($lot || $store ? ' in the selected store/batch.' : '.'));
    return $out;
}

/* ------------------------------------------------ batches */
function act_lots_list(array $in): array {
    need('inventory', 'view'); $adm = is_admin(); $out = [];
    $finMap = array_column(rows("SELECT store_id,MAX(date) d FROM inv_settlements WHERE status='finished' GROUP BY store_id"), 'd', 'store_id');
    foreach (rows('SELECT l.*,s.name store,p.name product,u.name by_name FROM lots l JOIN stores s ON s.id=l.store_id JOIN products p ON p.id=l.product_id LEFT JOIN users u ON u.id=l.user_id ORDER BY l.date DESC,l.id DESC LIMIT 1500') as $l) {
        $l['remaining'] = lot_remaining($l); $l['status'] = lot_status($l);
        $l['locked'] = isset($finMap[$l['store_id']]) && $finMap[$l['store_id']] >= $l['date'];
        if ($adm) { $pay = round(lot_payable($l), 2); $l['total_cost'] = round($l['cost'] * $l['qty_received'], 2); $l['payable'] = $pay; $l['remaining_amount'] = $l['type'] === 'cash' ? 0 : max(0, round($pay - (float)$l['paid_amount'], 2)); }
        else unset($l['cost'], $l['paid_amount']);
        $out[] = $l;
    }
    return $out;
}
function act_lot_ledger(array $in): array {
    need('inventory', 'view'); $adm = is_admin();
    $out = rows('SELECT t.*,u.name by_name,c.name customer FROM inv_tx t LEFT JOIN users u ON u.id=t.user_id LEFT JOIN customers c ON c.id=t.customer_id WHERE t.lot_id=? ORDER BY t.id', [(int)($in['id'] ?? 0)]);
    if (!$adm) foreach ($out as &$r) unset($r['unit_cost']);
    return $out;
}
function act_stock_receive(array $in): array {
    $u = need('inventory', 'add');
    $store = (int)($in['store_id'] ?? 0); $pid = (int)($in['product_id'] ?? 0); $qty = (int)($in['qty'] ?? 0);
    if (!val('SELECT 1 FROM stores WHERE id=?', [$store])) throw new ApiError('Select the store / supplier the stock came from.');
    if (!$pid && !empty($in['new_product'])) {
        $name = s($in['new_product'], 120);
        $pid = (int)val('SELECT id FROM products WHERE name=?', [$name]) ?: ins('products', ['name' => $name, 'category' => s($in['category'] ?? '', 60), 'sale_price' => max(0, n($in['sale_price'] ?? 0)), 'min_stock' => 3, 'created_at' => time()]);
    }
    if (!val('SELECT 1 FROM products WHERE id=?', [$pid])) throw new ApiError('Select a product.');
    if ($qty < 1 || $qty > 100000) throw new ApiError('Quantity received must be at least 1.');
    $type = in_array($in['type'] ?? '', LOT_TYPES, true) ? $in['type'] : 'consignment';
    $cost = max(0, n($in['cost'] ?? 0)); $total = round($cost * $qty, 2); $date = d($in['date'] ?? null) ?? today();
    lock_check($store, $date);
    $paid = isset($in['paid']) && $in['paid'] !== '' ? max(0, n($in['paid'])) : ($type === 'cash' ? $total : 0.0);
    if ($type !== 'consignment' && $paid > $total + 0.005) throw new ApiError('Paid amount cannot be more than the total cost (' . number_format($total, 2) . ').');
    $id = ins('lots', ['store_id' => $store, 'product_id' => $pid, 'type' => $type, 'qty_received' => $qty, 'cost' => $cost, 'date' => $date, 'user_id' => $u['id'], 'ts' => time(), 'paid_amount' => $paid, 'notes' => s($in['notes'] ?? '', 300), 'source' => 'supplier']);
    tx_add('RECEIVE', $id, $qty, ['date' => $date, 'ref_kind' => 'receiving', 'ref_id' => $id, 'note' => s($in['notes'] ?? '', 300)]);
    if ($paid > 0 && $type !== 'cash') ins('store_payments', ['store_id' => $store, 'amount' => $paid, 'date' => $date, 'user_id' => $u['id'], 'note' => "Paid at receiving — batch #$id"]);
    audit('receive', 'stock', $id, val('SELECT name FROM products WHERE id=?', [$pid]) . " x{$qty}");
    return ['id' => $id, 'total_cost' => $total, 'remaining_amount' => max(0, round($total - $paid, 2))];
}
function act_stock_return(array $in): array {
    $u = need('inventory', 'edit');
    $lot = row('SELECT * FROM lots WHERE id=?', [(int)($in['lot_id'] ?? 0)]);
    if (!$lot) throw new ApiError('Batch not found.', 404);
    $qty = (int)($in['qty'] ?? 0); $rem = lot_remaining($lot);
    if ($qty < 1 || $qty > $rem) throw new ApiError("Return quantity must be between 1 and the quantity In Store ($rem).");
    $date = d($in['date'] ?? null) ?? today(); lock_check((int)$lot['store_id'], $date);
    $reason = s($in['reason'] ?? '', 200) ?: 'Unsold — returned to supplier';
    $rid = ins('returns', ['lot_id' => $lot['id'], 'qty' => $qty, 'date' => $date, 'user_id' => $u['id'], 'note' => s($in['note'] ?? '', 200), 'reason' => $reason, 'status' => 'returned']);
    tx_add('RETURN', (int)$lot['id'], $qty, ['date' => $date, 'ref_kind' => 'return', 'ref_id' => $rid, 'reason' => $reason, 'note' => s($in['note'] ?? '', 200)]);
    audit('return', 'stock', (int)$lot['id'], "x{$qty} — $reason");
    return ['id' => $rid];
}
function act_stock_transfer(array $in): array {
    $u = need('inventory', 'edit');
    $lot = row('SELECT * FROM lots WHERE id=?', [(int)($in['lot_id'] ?? 0)]); $to = (int)($in['to_store_id'] ?? 0);
    if (!$lot) throw new ApiError('Batch not found.', 404);
    if (!val('SELECT 1 FROM stores WHERE id=?', [$to])) throw new ApiError('Select the destination store.');
    if ($to === (int)$lot['store_id']) throw new ApiError('Choose a different store.');
    $qty = (int)($in['qty'] ?? 0); $rem = lot_remaining($lot);
    if ($qty < 1 || $qty > $rem) throw new ApiError("Transfer quantity must be between 1 and the quantity In Store ($rem).");
    $date = d($in['date'] ?? null) ?? today(); lock_check((int)$lot['store_id'], $date); lock_check($to, $date);
    $dest = ins('lots', ['store_id' => $to, 'product_id' => $lot['product_id'], 'type' => $lot['type'], 'qty_received' => $qty, 'cost' => $lot['cost'], 'date' => $date, 'user_id' => $u['id'], 'ts' => time(), 'paid_amount' => 0, 'notes' => 'Transferred from batch #' . $lot['id'], 'source' => 'transfer', 'origin_lot_id' => $lot['id']]);
    $from = (string)val('SELECT name FROM stores WHERE id=?', [$lot['store_id']]); $toName = (string)val('SELECT name FROM stores WHERE id=?', [$to]);
    tx_add('TRANSFER', (int)$lot['id'], $qty, ['date' => $date, 'ref_kind' => 'transfer', 'ref_id' => $dest, 'note' => "To $toName", 'reason' => s($in['note'] ?? '', 200)]);
    tx_add('RECEIVE', $dest, $qty, ['date' => $date, 'ref_kind' => 'transfer', 'ref_id' => (int)$lot['id'], 'note' => "Transferred in from $from"]);
    audit('transfer', 'stock', (int)$lot['id'], "x{$qty} $from → $toName");
    return ['id' => $dest];
}
function act_lot_delete(array $in): array {
    admin(); $lot = row('SELECT * FROM lots WHERE id=?', [(int)($in['id'] ?? 0)]);
    if (!$lot) throw new ApiError('Not found.', 404);
    if (val("SELECT 1 FROM inv_tx WHERE lot_id=? AND type<>'RECEIVE' AND voided=0", [$lot['id']])) throw new ApiError('This batch already has sales, returns, repair usage or transfers and cannot be deleted.');
    q('UPDATE inv_tx SET voided=1,voided_by=?,voided_ts=? WHERE lot_id=?', [me()['id'], time(), $lot['id']]);
    q('DELETE FROM lots WHERE id=?', [$lot['id']]); audit('delete', 'stock', (int)$lot['id']);
    return [];
}
function act_inv_tx_list(array $in): array {
    need('inventory', 'view'); $adm = is_admin();
    $w = ['1=1']; $p = [];
    if (in_array($in['type'] ?? '', TX_TYPES, true)) { $w[] = 't.type=?'; $p[] = $in['type']; }
    if (!empty($in['store_id'])) { $w[] = 't.store_id=?'; $p[] = (int)$in['store_id']; }
    $out = rows('SELECT t.id,t.type,t.date,t.ts,t.qty,t.unit_cost,t.unit_price,t.lot_id,t.ref_kind,t.ref_id,t.reason,t.note,t.voided,s.name store,p.name product,c.name customer,u.name by_name FROM inv_tx t JOIN stores s ON s.id=t.store_id JOIN products p ON p.id=t.product_id LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN users u ON u.id=t.user_id WHERE ' . implode(' AND ', $w) . ' ORDER BY t.id DESC LIMIT 1500', $p);
    if (!$adm) foreach ($out as &$r) unset($r['unit_cost']);
    return $out;
}

/* ------------------------------------------------ validation (Received = Sold + Returned + Used + Transferred + In Store) */
function inv_validate(): array {
    $bad = [];
    $names = array_column(rows('SELECT id,name FROM users'), 'name', 'id');
    foreach (rows("SELECT l.*,s.name store,p.name product,
        COALESCE((SELECT SUM(qty) FROM inv_tx WHERE lot_id=l.id AND type='RECEIVE' AND voided=0),0) t_recv,
        COALESCE((SELECT SUM(qty) FROM inv_tx WHERE lot_id=l.id AND type='SALE' AND voided=0),0) t_sold,
        COALESCE((SELECT SUM(qty) FROM inv_tx WHERE lot_id=l.id AND type='RETURN' AND voided=0),0) t_ret,
        COALESCE((SELECT SUM(qty) FROM inv_tx WHERE lot_id=l.id AND type='REPAIR_USAGE' AND voided=0),0) t_used,
        COALESCE((SELECT SUM(qty) FROM inv_tx WHERE lot_id=l.id AND type='TRANSFER' AND voided=0),0) t_trf,
        (SELECT user_id FROM inv_tx WHERE lot_id=l.id ORDER BY id DESC LIMIT 1) last_user
        FROM lots l JOIN stores s ON s.id=l.store_id JOIN products p ON p.id=l.product_id") as $l) {
        $ledgerRem = (int)$l['t_recv'] - (int)$l['t_sold'] - (int)$l['t_ret'] - (int)$l['t_used'] - (int)$l['t_trf'];
        $actual = (int)$l['t_sold'] + (int)$l['t_ret'] + (int)$l['t_used'] + (int)$l['t_trf'] + (int)$l['qty_remaining'];
        $cacheOk = (int)$l['qty_sold'] === (int)$l['t_sold'] && (int)$l['qty_returned'] === (int)$l['t_ret'] && (int)$l['qty_used'] === (int)$l['t_used'] && (int)$l['qty_transferred'] === (int)$l['t_trf'];
        if ((int)$l['qty_received'] !== $actual || (int)$l['t_recv'] !== (int)$l['qty_received'] || $ledgerRem < 0 || !$cacheOk || $ledgerRem !== (int)$l['qty_remaining'])
            $bad[] = ['lot_id' => (int)$l['id'], 'store_id' => (int)$l['store_id'], 'store' => $l['store'], 'product' => $l['product'], 'batch' => '#' . $l['id'] . ' (' . $l['date'] . ')', 'expected' => (int)$l['qty_received'], 'actual' => $actual, 'difference' => $actual - (int)$l['qty_received'],
                'ledger_in_store' => $ledgerRem, 'user' => $names[$l['last_user'] ?? 0] ?? ($names[$l['user_id']] ?? '—')];
    }
    return $bad;
}
function act_inv_validate(array $in): array { need('inventory', 'view'); return inv_validate(); }

/* ------------------------------------------------ dashboard */
function act_inv_dashboard(array $in): array {
    need('inventory', 'view'); $adm = is_admin();
    $o = ['received' => (int)val("SELECT COALESCE(SUM(qty_received),0) FROM lots WHERE COALESCE(source,'supplier')='supplier'"), 'sold' => (int)val('SELECT COALESCE(SUM(qty_sold),0) FROM lots'), 'returned' => (int)val('SELECT COALESCE(SUM(qty_returned),0) FROM lots'),
        'in_store' => (int)val('SELECT COALESCE(SUM(qty_remaining),0) FROM lots'), 'used' => (int)val('SELECT COALESCE(SUM(qty_used),0) FROM lots'), 'transferred' => (int)val('SELECT COALESCE(SUM(qty_transferred),0) FROM lots')];
    $o['finished'] = (int)val("SELECT COUNT(*) FROM inv_settlements WHERE status='finished'");
    $o['open'] = (int)val("SELECT COUNT(*) FROM (SELECT DISTINCT t.store_id,t.date FROM inv_tx t WHERE t.voided=0 AND t.date>=date('now','localtime','-30 day') AND NOT EXISTS (SELECT 1 FROM inv_settlements s WHERE s.store_id=t.store_id AND s.status='finished' AND s.date>=t.date))");
    if ($adm) {
        $sv = row("SELECT COALESCE(SUM(qty*unit_price),0) rev, COALESCE(SUM(qty*(unit_price-unit_cost)),0) prof FROM inv_tx WHERE type='SALE' AND voided=0");
        $o['revenue'] = round((float)$sv['rev'], 2); $o['profit'] = round((float)$sv['prof'], 2);
        $o['payable'] = round(array_sum(array_map(fn($s) => (float)$s['balance'], store_stats())), 2);
        $o['stock_value'] = round((float)val('SELECT COALESCE(SUM(qty_remaining*cost),0) FROM lots'), 2);
    }
    $o['discrepancies'] = count(inv_validate());
    return $o;
}

/* ------------------------------------------------ daily store settlement */
/** Position of every batch of a store as of a date + that day's movement. */
function settle_position(int $store, string $date, array $counts = []): array {
    $adm = is_admin(); $rows = []; $tot = ['received' => 0, 'sold' => 0, 'returned' => 0, 'used' => 0, 'transferred' => 0, 'in_store' => 0, 'day_received' => 0, 'day_sold' => 0, 'day_returned' => 0, 'day_used' => 0, 'counted' => 0, 'count_diff' => 0];
    foreach (rows('SELECT l.*,p.name product FROM lots l JOIN products p ON p.id=l.product_id WHERE l.store_id=? AND l.date<=? ORDER BY p.name,l.id', [$store, $date]) as $l) {
        $s = row("SELECT COALESCE(SUM(CASE WHEN type='SALE' THEN qty END),0) sold, COALESCE(SUM(CASE WHEN type='RETURN' THEN qty END),0) ret, COALESCE(SUM(CASE WHEN type='REPAIR_USAGE' THEN qty END),0) used, COALESCE(SUM(CASE WHEN type='TRANSFER' THEN qty END),0) trf,
            COALESCE(SUM(CASE WHEN type='SALE' AND date=? THEN qty END),0) d_sold, COALESCE(SUM(CASE WHEN type='RETURN' AND date=? THEN qty END),0) d_ret, COALESCE(SUM(CASE WHEN type='REPAIR_USAGE' AND date=? THEN qty END),0) d_used
            FROM inv_tx WHERE lot_id=? AND voided=0 AND date<=?", [$date, $date, $date, $l['id'], $date]);
        $in = (int)$l['qty_received'] - (int)$s['sold'] - (int)$s['ret'] - (int)$s['used'] - (int)$s['trf'];
        $r = ['lot_id' => (int)$l['id'], 'product' => $l['product'], 'date' => $l['date'], 'source' => $l['source'], 'received' => (int)$l['qty_received'], 'sold' => (int)$s['sold'], 'returned' => (int)$s['ret'], 'used' => (int)$s['used'], 'transferred' => (int)$s['trf'], 'in_store' => $in,
            'day_received' => $l['date'] === $date ? (int)$l['qty_received'] : 0, 'day_sold' => (int)$s['d_sold'], 'day_returned' => (int)$s['d_ret'], 'day_used' => (int)$s['d_used'], 'counted' => null, 'count_diff' => 0, 'cost' => $adm ? (float)$l['cost'] : null];
        if (array_key_exists($l['id'], $counts) && $counts[$l['id']] !== '' && $counts[$l['id']] !== null) { $r['counted'] = (int)$counts[$l['id']]; $r['count_diff'] = $r['counted'] - $in; $tot['counted'] += $r['counted']; }
        foreach (['received', 'sold', 'returned', 'used', 'transferred', 'in_store', 'day_received', 'day_sold', 'day_returned', 'day_used'] as $k) $tot[$k] += $r[$k];
        $tot['count_diff'] += abs($r['count_diff']);
        $rows[] = $r;
    }
    $money = row("SELECT COALESCE(SUM(qty*unit_price),0) amt, COALESCE(SUM(qty*(unit_price-unit_cost)),0) prof FROM inv_tx WHERE store_id=? AND type='SALE' AND voided=0 AND date=?", [$store, $date]);
    $integrity = array_values(array_filter(inv_validate(), fn($b) => $b['store_id'] === $store));
    $check = $tot['received'] - ($tot['sold'] + $tot['returned'] + $tot['used'] + $tot['transferred'] + $tot['in_store']);
    $discrepancy = $tot['count_diff'] + abs($check) + count($integrity);
    $stats = store_stats()[$store] ?? null;
    return ['store_id' => $store, 'date' => $date, 'rows' => $rows, 'totals' => $tot, 'check' => $check, 'integrity' => $integrity, 'discrepancy' => $discrepancy,
        'day_sales_amount' => $adm ? round((float)$money['amt'], 2) : null, 'day_profit' => $adm ? round((float)$money['prof'], 2) : null, 'payable' => $adm && $stats ? $stats['balance'] : null];
}
function act_settlement_view(array $in): array {
    need('inventory', 'view');
    $store = (int)($in['store_id'] ?? 0); $date = d($in['date'] ?? null) ?? today();
    if (!val('SELECT 1 FROM stores WHERE id=?', [$store])) throw new ApiError('Select a store.');
    $counts = is_array($in['counts'] ?? null) ? $in['counts'] : [];
    $r = settle_position($store, $date, $counts);
    $r['saved'] = row('SELECT s.id,s.status,s.finished_at,s.override,s.override_reason,s.discrepancy,s.reopened_at,u.name closed_name FROM inv_settlements s LEFT JOIN users u ON u.id=s.closed_by WHERE s.store_id=? AND s.date=?', [$store, $date]);
    $r['store'] = (string)val('SELECT name FROM stores WHERE id=?', [$store]);
    return $r;
}
function act_settlement_finish(array $in): array {
    $u = need('inventory', 'edit');
    $store = (int)($in['store_id'] ?? 0); $date = d($in['date'] ?? null) ?? today();
    if (!val('SELECT 1 FROM stores WHERE id=?', [$store])) throw new ApiError('Select a store.');
    $ex = row('SELECT * FROM inv_settlements WHERE store_id=? AND date=?', [$store, $date]);
    if ($ex && $ex['status'] === 'finished') throw new ApiError('This settlement is already FINISHED. Only the Super Admin can reopen it.', 423);
    $counts = is_array($in['counts'] ?? null) ? $in['counts'] : [];
    $r = settle_position($store, $date, $counts); $t = $r['totals'];
    $override = false; $reason = s($in['override_reason'] ?? '', 300);
    if ($r['discrepancy'] > 0) {
        if (!$u['is_admin'] || empty($in['override'])) throw new ApiError('INVENTORY DISCREPANCY DETECTED — this settlement cannot be finished until it is resolved (or the Super Admin explicitly overrides it).', 409, ['discrepancy' => $r['discrepancy']]);
        if ($reason === '') throw new ApiError('Enter the reason for overriding the discrepancy.');
        $override = true;
    }
    $f = ['store_id' => $store, 'date' => $date, 'status' => 'finished', 'received' => $t['received'], 'sold' => $t['sold'], 'returned' => $t['returned'], 'used' => $t['used'], 'transferred' => $t['transferred'], 'in_store' => $t['in_store'],
        'day_sales' => (float)($r['day_sales_amount'] ?? 0), 'day_profit' => (float)($r['day_profit'] ?? 0), 'payable' => (float)($r['payable'] ?? 0), 'discrepancy' => $r['discrepancy'], 'override' => $override ? 1 : 0, 'override_reason' => $override ? $reason : null,
        'note' => s($in['note'] ?? '', 300), 'detail' => json_encode($r['rows']), 'closed_by' => $u['id'], 'finished_at' => time(), 'ts' => time()];
    if ($ex) { upd('inv_settlements', (int)$ex['id'], $f); $id = (int)$ex['id']; } else $id = ins('inv_settlements', $f);
    audit('settle', 'settlement', $id, "$date store #$store" . ($override ? ' (override)' : ''));
    notify('settlement', 'Settlement FINISHED for ' . val('SELECT name FROM stores WHERE id=?', [$store]) . " — $date" . ($override ? ' (discrepancy overridden)' : ''), 'admin', '#/inventory');
    return ['id' => $id, 'discrepancy' => $r['discrepancy']];
}
function act_settlement_reopen(array $in): array {
    $u = admin(); $id = (int)($in['id'] ?? 0); $reason = s($in['reason'] ?? '', 300);
    $r = row('SELECT * FROM inv_settlements WHERE id=?', [$id]);
    if (!$r) throw new ApiError('Settlement not found.', 404);
    if ($reason === '') throw new ApiError('Enter the reason for reopening.');
    upd('inv_settlements', $id, ['status' => 'open', 'reopened_by' => $u['id'], 'reopened_at' => time(), 'reopen_reason' => $reason]);
    audit('reopen', 'settlement', $id, $reason);
    return [];
}
function act_settlements_list(array $in): array {
    need('inventory', 'view'); $adm = is_admin(); $out = [];
    foreach (rows("SELECT s.*,COALESCE(st.name,'All stores (before rebuild)') store,u.name closed_name FROM inv_settlements s LEFT JOIN stores st ON st.id=s.store_id LEFT JOIN users u ON u.id=s.closed_by ORDER BY s.date DESC,s.id DESC LIMIT 400") as $r) {
        $r['detail'] = json_decode($r['detail'] ?: '[]', true);
        if (!$adm) unset($r['day_sales'], $r['day_profit'], $r['payable']);
        $out[] = $r;
    }
    return $out;
}

/* ------------------------------------------------ inventory reports (each category has its own report) */
function inv_report(string $type, string $from, string $to, bool $adm, string $cur): array {
    $fin = fn(int $store, string $date) => (bool)val("SELECT 1 FROM inv_settlements WHERE store_id=? AND status='finished' AND date>=?", [$store, $date]);
    if ($type === 'inv_received') {
        $out = [];
        foreach (rows('SELECT l.*,s.name store,p.name product,u.name by_name FROM lots l JOIN stores s ON s.id=l.store_id JOIN products p ON p.id=l.product_id LEFT JOIN users u ON u.id=l.user_id WHERE l.date BETWEEN ? AND ? ORDER BY l.date DESC,l.id DESC', [$from, $to]) as $l) {
            $tc = (float)$l['cost'] * (int)$l['qty_received']; $pay = lot_payable($l);
            $out[] = ['date' => $l['date'], 'batch' => '#' . $l['id'], 'store' => $l['store'], 'product' => $l['product'], 'source' => $l['source'] === 'transfer' ? 'Transfer in' : 'Supplier', 'qty' => (int)$l['qty_received'], 'in_store' => lot_remaining($l), 'by' => $l['by_name'], 'settlement' => $fin((int)$l['store_id'], (string)$l['date']) ? 'FINISHED' : 'OPEN']
                + ($adm ? ['cost' => (float)$l['cost'], 'total_cost' => round($tc, 2), 'paid' => (float)$l['paid_amount'], 'payable_left' => $l['type'] === 'cash' ? 0.0 : max(0, round($pay - (float)$l['paid_amount'], 2))] : []);
        }
        $cols = [['k' => 'date', 'l' => 'Date'], ['k' => 'batch', 'l' => 'Batch'], ['k' => 'store', 'l' => 'Store / supplier'], ['k' => 'product', 'l' => 'Product'], ['k' => 'source', 'l' => 'Source'], ['k' => 'qty', 'l' => 'Quantity received', 'n' => 1], ['k' => 'in_store', 'l' => 'Now in store', 'n' => 1]];
        if ($adm) array_push($cols, ['k' => 'cost', 'l' => "Unit cost ($cur)", 'n' => 1], ['k' => 'total_cost', 'l' => "Total cost ($cur)", 'n' => 1], ['k' => 'paid', 'l' => "Paid ($cur)", 'n' => 1], ['k' => 'payable_left', 'l' => "Remaining payable ($cur)", 'n' => 1]);
        array_push($cols, ['k' => 'by', 'l' => 'Received by'], ['k' => 'settlement', 'l' => 'Settlement status']);
        return ['title' => 'Received report', 'columns' => $cols, 'rows' => $out];
    }
    if ($type === 'inv_sales') {
        $out = [];
        foreach (rows("SELECT t.date,t.qty,t.unit_cost,t.unit_price,t.lot_id,t.ref_id,s.name store,p.name product,COALESCE(c.name,sa.customer_name,'Walk-in customer') customer,sa.total,sa.paid,u.name by_name FROM inv_tx t JOIN stores s ON s.id=t.store_id JOIN products p ON p.id=t.product_id LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN sales sa ON sa.id=t.ref_id AND t.ref_kind='sale' LEFT JOIN users u ON u.id=t.user_id WHERE t.type='SALE' AND t.voided=0 AND t.date BETWEEN ? AND ? ORDER BY t.date DESC,t.id DESC", [$from, $to]) as $r) {
            $pay = $r['total'] === null ? '—' : ($r['paid'] + .005 >= $r['total'] ? 'Paid' : ($r['paid'] > 0 ? 'Partial' : 'Unpaid'));
            $out[] = ['date' => $r['date'], 'customer' => $r['customer'], 'product' => $r['product'], 'store' => $r['store'] . ' · batch #' . $r['lot_id'], 'qty' => (int)$r['qty'], 'price' => (float)$r['unit_price'], 'total' => round($r['qty'] * $r['unit_price'], 2), 'pay' => $pay, 'by' => $r['by_name']]
                + ($adm ? ['cost' => (float)$r['unit_cost'], 'profit' => round($r['qty'] * ($r['unit_price'] - $r['unit_cost']), 2)] : []);
        }
        $cols = [['k' => 'date', 'l' => 'Date'], ['k' => 'customer', 'l' => 'Customer'], ['k' => 'product', 'l' => 'Product'], ['k' => 'store', 'l' => 'Store / batch'], ['k' => 'qty', 'l' => 'Quantity sold', 'n' => 1]];
        if ($adm) $cols[] = ['k' => 'cost', 'l' => "Cost price ($cur)", 'n' => 1];
        array_push($cols, ['k' => 'price', 'l' => "Selling price ($cur)", 'n' => 1], ['k' => 'total', 'l' => "Total sales ($cur)", 'n' => 1]);
        if ($adm) $cols[] = ['k' => 'profit', 'l' => "Profit ($cur)", 'n' => 1];
        array_push($cols, ['k' => 'pay', 'l' => 'Payment status'], ['k' => 'by', 'l' => 'Sold by']);
        return ['title' => 'Sales report (products actually sold)', 'columns' => $cols, 'rows' => $out];
    }
    if ($type === 'inv_returns') {
        $out = [];
        foreach (rows("SELECT t.date,t.qty,t.reason,t.lot_id,t.voided,s.name store,p.name product,l.date lot_date,u.name by_name FROM inv_tx t JOIN stores s ON s.id=t.store_id JOIN products p ON p.id=t.product_id JOIN lots l ON l.id=t.lot_id LEFT JOIN users u ON u.id=t.user_id WHERE t.type='RETURN' AND t.date BETWEEN ? AND ? ORDER BY t.date DESC,t.id DESC", [$from, $to]) as $r)
            $out[] = ['date' => $r['date'], 'store' => $r['store'], 'product' => $r['product'], 'qty' => (int)$r['qty'], 'original' => 'Batch #' . $r['lot_id'] . ' received ' . $r['lot_date'], 'reason' => $r['reason'], 'by' => $r['by_name'], 'status' => $r['voided'] ? 'CANCELLED' : 'RETURNED'];
        return ['title' => 'Return report', 'columns' => [['k' => 'date', 'l' => 'Date'], ['k' => 'store', 'l' => 'Store / supplier'], ['k' => 'product', 'l' => 'Product'], ['k' => 'qty', 'l' => 'Quantity returned', 'n' => 1], ['k' => 'original', 'l' => 'Original receiving transaction'], ['k' => 'reason', 'l' => 'Reason'], ['k' => 'by', 'l' => 'Returned by'], ['k' => 'status', 'l' => 'Status']], 'rows' => $out];
    }
    if ($type === 'inv_instore') {
        $out = [];
        foreach (rows('SELECT l.*,s.name store,p.name product FROM lots l JOIN stores s ON s.id=l.store_id JOIN products p ON p.id=l.product_id WHERE l.qty_remaining>0 ORDER BY s.name,p.name,l.id') as $l)
            $out[] = ['store' => $l['store'], 'product' => $l['product'], 'batch' => '#' . $l['id'] . ' (' . $l['date'] . ')', 'received' => (int)$l['qty_received'], 'sold' => (int)$l['qty_sold'], 'returned' => (int)$l['qty_returned'], 'used' => (int)$l['qty_used'], 'transferred' => (int)$l['qty_transferred'], 'in_store' => lot_remaining($l)]
                + ($adm ? ['cost' => (float)$l['cost'], 'value' => round(lot_remaining($l) * (float)$l['cost'], 2)] : []);
        $cols = [['k' => 'store', 'l' => 'Store'], ['k' => 'product', 'l' => 'Product'], ['k' => 'batch', 'l' => 'Batch'], ['k' => 'received', 'l' => 'Original quantity received', 'n' => 1], ['k' => 'sold', 'l' => 'Quantity sold', 'n' => 1], ['k' => 'returned', 'l' => 'Quantity returned', 'n' => 1], ['k' => 'used', 'l' => 'Used in repair', 'n' => 1], ['k' => 'transferred', 'l' => 'Transferred', 'n' => 1], ['k' => 'in_store', 'l' => 'Current quantity in store', 'n' => 1]];
        if ($adm) array_push($cols, ['k' => 'cost', 'l' => "Unit cost ($cur)", 'n' => 1], ['k' => 'value', 'l' => "Current stock value ($cur)", 'n' => 1]);
        return ['title' => 'In store report', 'columns' => $cols, 'rows' => $out];
    }
    if ($type === 'inv_settlements') {
        $out = [];
        foreach (rows("SELECT s.*,COALESCE(st.name,'All stores (before rebuild)') store,u.name closed_name FROM inv_settlements s LEFT JOIN stores st ON st.id=s.store_id LEFT JOIN users u ON u.id=s.closed_by WHERE s.date BETWEEN ? AND ? ORDER BY s.date DESC,s.id DESC", [$from, $to]) as $r)
            $out[] = ['date' => $r['date'], 'store' => $r['store'], 'received' => (int)$r['received'], 'sold' => (int)$r['sold'], 'returned' => (int)$r['returned'], 'in_store' => (int)$r['in_store'], 'disc' => (int)$r['discrepancy'] . ($r['override'] ? ' (overridden)' : ''), 'by' => $r['closed_name'], 'finished' => $r['finished_at'] ? date('Y-m-d H:i', (int)$r['finished_at']) : '—', 'status' => strtoupper($r['status'])]
                + ($adm ? ['sales' => (float)$r['day_sales'], 'profit' => (float)$r['day_profit'], 'payable' => (float)$r['payable']] : []);
        $cols = [['k' => 'date', 'l' => 'Settlement date'], ['k' => 'store', 'l' => 'Store'], ['k' => 'received', 'l' => 'Total received', 'n' => 1], ['k' => 'sold', 'l' => 'Total sold', 'n' => 1], ['k' => 'returned', 'l' => 'Total returned', 'n' => 1], ['k' => 'in_store', 'l' => 'Total in store', 'n' => 1]];
        if ($adm) array_push($cols, ['k' => 'sales', 'l' => "Sales amount ($cur)", 'n' => 1], ['k' => 'profit', 'l' => "Profit ($cur)", 'n' => 1], ['k' => 'payable', 'l' => "Amount payable ($cur)", 'n' => 1]);
        array_push($cols, ['k' => 'disc', 'l' => 'Discrepancy'], ['k' => 'by', 'l' => 'Closed by'], ['k' => 'finished', 'l' => 'Finished date'], ['k' => 'status', 'l' => 'Status']);
        return ['title' => 'Settlement report', 'columns' => $cols, 'rows' => $out];
    }
    throw new ApiError('Unknown report.');
}
