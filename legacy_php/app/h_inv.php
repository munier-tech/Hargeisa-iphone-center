<?php
declare(strict_types=1);

const EXPENSE_CATS = ['Rent', 'Utilities', 'Daily expenses', 'Transport', 'Maintenance', 'Other expenses'];
const LOT_TYPES = ['consignment', 'credit', 'cash'];

function store_stats(): array {
    $o = [];
    foreach (rows('SELECT * FROM lots') as $l) {
        $s = &$o[$l['store_id']];
        $s ??= ['received' => 0, 'sold' => 0, 'returned' => 0, 'remaining' => 0, 'payable' => 0.0, 'paid' => 0.0];
        $s['received'] += $l['qty_received']; $s['sold'] += $l['qty_sold'] + $l['qty_used']; $s['returned'] += $l['qty_returned'];
        $s['remaining'] += lot_remaining($l); $s['payable'] += lot_payable($l);
        unset($s);
    }
    foreach (rows('SELECT store_id,SUM(amount) a FROM store_payments GROUP BY store_id') as $p) {
        $o[$p['store_id']] ??= ['received' => 0, 'sold' => 0, 'returned' => 0, 'remaining' => 0, 'payable' => 0.0, 'paid' => 0.0];
        $o[$p['store_id']]['paid'] = (float)$p['a'];
    }
    foreach ($o as &$s) { $s['payable'] = round($s['payable'], 2); $s['balance'] = round($s['payable'] - $s['paid'], 2); }
    return $o;
}

/* ------------------------------------------------------------ stores */
function act_stores_list(array $in): array {
    need_any([['stores', 'view'], ['inventory', 'view'], ['inventory', 'add']]);
    $stats = store_stats(); $adm = is_admin(); $out = [];
    foreach (rows('SELECT * FROM stores ORDER BY name') as $s) {
        $st = $stats[$s['id']] ?? ['received' => 0, 'sold' => 0, 'returned' => 0, 'remaining' => 0, 'payable' => 0, 'paid' => 0, 'balance' => 0];
        if (!$adm) unset($st['payable'], $st['paid'], $st['balance']);
        $out[] = $s + $st;
    }
    return $out;
}
function act_store_save(array $in): array {
    admin(); $id = (int)($in['id'] ?? 0);
    $f = ['name' => s($in['name'] ?? '', 100), 'contact' => s($in['contact'] ?? '', 100), 'phone' => s($in['phone'] ?? '', 30), 'address' => s($in['address'] ?? '', 200), 'notes' => s($in['notes'] ?? '', 500)];
    if (!$f['name']) throw new ApiError('Store name is required.');
    if ($id) upd('stores', $id, $f); else $id = ins('stores', $f + ['created_at' => time()]);
    audit($in['id'] ?? 0 ? 'update' : 'create', 'store', $id, $f['name']);
    return ['id' => $id];
}
function act_store_delete(array $in): array {
    admin(); $id = (int)($in['id'] ?? 0);
    if (val('SELECT 1 FROM lots WHERE store_id=?', [$id])) throw new ApiError('This store has stock records and cannot be deleted.');
    q('DELETE FROM store_payments WHERE store_id=?', [$id]); q('DELETE FROM stores WHERE id=?', [$id]);
    audit('delete', 'store', $id);
    return [];
}

/* ------------------------------------------------------------ products / lots */
function act_products_list(array $in): array {
    need_any([['inventory', 'view'], ['sales', 'add'], ['repairs', 'edit'], ['software', 'edit']]);
    $adm = is_admin(); $out = []; $by = []; $bt = [];
    foreach (rows('SELECT l.id,l.product_id,l.store_id,s.name store,l.date,l.cost,l.qty_remaining rem FROM lots l JOIN stores s ON s.id=l.store_id WHERE l.qty_remaining>0 ORDER BY l.date,l.id') as $r) {
        $by[$r['product_id']][$r['store_id']] = ['store_id' => (int)$r['store_id'], 'store' => $r['store'], 'remaining' => ($by[$r['product_id']][$r['store_id']]['remaining'] ?? 0) + (int)$r['rem']];
        $bt[$r['product_id']][] = ['lot_id' => (int)$r['id'], 'store_id' => (int)$r['store_id'], 'store' => $r['store'], 'date' => $r['date'], 'remaining' => (int)$r['rem']] + ($adm ? ['cost' => (float)$r['cost']] : []);
    }
    foreach (rows('SELECT * FROM products ORDER BY name') as $p) {
        $stores = array_values($by[$p['id']] ?? []);
        $p['stock'] = array_sum(array_column($stores, 'remaining')); $p['stores'] = $stores; $p['batches'] = $bt[$p['id']] ?? [];
        $out[] = $p;
    }
    return $out;
}function act_product_save(array $in): array {
    $id = (int)($in['id'] ?? 0); need('inventory', $id ? 'edit' : 'add');
    $f = ['name' => s($in['name'] ?? '', 120), 'category' => s($in['category'] ?? '', 60), 'sale_price' => max(0, n($in['sale_price'] ?? 0)), 'min_stock' => max(0, (int)($in['min_stock'] ?? 3))];
    if (!$f['name']) throw new ApiError('Product name is required.');
    if (val('SELECT 1 FROM products WHERE name=? AND id<>?', [$f['name'], $id])) throw new ApiError('A product with this name already exists.');
    if ($id) upd('products', $id, $f); else $id = ins('products', $f + ['created_at' => time()]);
    audit($in['id'] ?? 0 ? 'update' : 'create', 'product', $id, $f['name']);
    return ['id' => $id];
}
function act_product_delete(array $in): array {
    need('inventory', 'delete'); $id = (int)($in['id'] ?? 0);
    if (val('SELECT 1 FROM lots WHERE product_id=?', [$id])) throw new ApiError('This product has stock history and cannot be deleted.');
    q('DELETE FROM products WHERE id=?', [$id]); audit('delete', 'product', $id);
    return [];
}
/* ------------------------------------------------------------ sales */
const SALE_ITEMS_SQL = "(SELECT GROUP_CONCAT(x.n||' ×'||x.q, ', ') FROM (SELECT COALESCE(p.name, si.service_name) n, SUM(si.qty) q FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id=s.id GROUP BY COALESCE(p.name, si.service_name)) x)";

function act_sales_list(array $in): array {
    need('sales', 'view'); $adm = is_admin();
    $out = [];
    foreach (rows('SELECT s.*,u.name by_name,' . SALE_ITEMS_SQL . " items,
        (SELECT GROUP_CONCAT(DISTINCT st.name) FROM sale_items si JOIN stores st ON st.id=si.store_id WHERE si.sale_id=s.id) stores
        FROM sales s LEFT JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 1000") as $r) {
        if ($adm) $r['profit'] = round($r['total'] - $r['cost'], 2); else unset($r['cost']);
        $out[] = $r;
    }
    return $out;
}
/** A sale/invoice can mix physical products (deduct store stock) and services (never touch inventory). */
function act_sale_save(array $in): array {
    $u = need('sales', 'add');
    $items = is_array($in['items'] ?? null) ? $in['items'] : [];
    if (!$items) throw new ApiError('Add at least one product or service.');
    $cid = null; $cname = s($in['customer_name'] ?? '', 80) ?: 'Walk-in customer';
    if (!empty($in['customer_id']) || (!empty($in['customer_phone']) && !empty($in['customer_name']))) { [$cid] = resolve_customer($in); $cname = (string)val('SELECT name FROM customers WHERE id=?', [$cid]); }
    $sdate = d($in['date'] ?? null) ?? today();
    $sid = ins('sales', ['customer_id' => $cid, 'customer_name' => $cname, 'date' => $sdate, 'user_id' => $u['id'], 'note' => s($in['note'] ?? '', 300), 'method' => s($in['method'] ?? 'Cash', 30), 'ts' => time()]);
    $prod = 0.0; $svc = 0.0; $cost = 0.0;
    foreach ($items as $it) {
        $price = max(0, n($it['unit_price'] ?? 0)); $qty = (int)($it['qty'] ?? 1);
        if (($it['type'] ?? 'product') === 'service') {
            $name = s($it['service_name'] ?? '', 120);
            if ($name === '') throw new ApiError('Enter the service name.');
            $qty = max(1, $qty);
            ins('sale_items', ['sale_id' => $sid, 'product_id' => null, 'lot_id' => null, 'store_id' => null, 'qty' => $qty, 'unit_price' => $price, 'unit_cost' => 0, 'kind' => 'service', 'service_name' => $name]);
            $svc += $qty * $price;
            continue;
        }
        $pid = (int)($it['product_id'] ?? 0);
        if (!val('SELECT 1 FROM products WHERE id=?', [$pid]) || $qty < 1) throw new ApiError('Invalid product line.');
        foreach (allocate($pid, $qty, ((int)($it['store_id'] ?? 0)) ?: null, ((int)($it['lot_id'] ?? 0)) ?: null, 'SALE', ['customer_id' => $cid, 'ref_kind' => 'sale', 'ref_id' => $sid, 'price' => $price, 'date' => $sdate]) as $a) {
            ins('sale_items', ['sale_id' => $sid, 'product_id' => $pid, 'lot_id' => $a['lot_id'], 'store_id' => $a['store_id'], 'qty' => $a['qty'], 'unit_price' => $price, 'unit_cost' => $a['cost'], 'kind' => 'product']);
            $prod += $a['qty'] * $price; $cost += $a['qty'] * $a['cost'];
        }
    }
    $gross = $prod + $svc;
    $disc = min($gross, max(0, n($in['discount'] ?? 0)));
    $total = round($gross - $disc, 2);
    $paid = isset($in['paid']) && $in['paid'] !== '' ? min($total, max(0, n($in['paid']))) : $total;
    upd('sales', $sid, ['discount' => $disc, 'total' => $total, 'cost' => round($cost, 2), 'paid' => $paid, 'product_rev' => round($prod, 2), 'service_rev' => round($svc, 2)]);
    audit('create', 'sale', $sid, (string)$total);
    return ['id' => $sid, 'total' => $total, 'product_revenue' => round($prod, 2), 'service_revenue' => round($svc, 2)];
}
function act_sale_delete(array $in): array {
    need('sales', 'delete'); $id = (int)($in['id'] ?? 0);
    tx_void_ref('sale', $id);
    q('DELETE FROM sale_items WHERE sale_id=?', [$id]); q('DELETE FROM sales WHERE id=?', [$id]);
    audit('delete', 'sale', $id);
    return [];
}

/* ------------------------------------------------------------ expenses */
function act_expenses_list(array $in): array {
    need('expenses', 'view');
    return rows('SELECT e.*,u.name by_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.date DESC,e.id DESC LIMIT 1500');
}
function act_expense_save(array $in): array {
    $u = me(); $id = (int)($in['id'] ?? 0); need('expenses', $id ? 'edit' : 'add');
    $cat = in_array($in['category'] ?? '', EXPENSE_CATS, true) ? $in['category'] : 'Other expenses';
    $amt = round(n($in['amount'] ?? 0), 2);
    if ($amt <= 0) throw new ApiError('Enter an amount.');
    $f = ['category' => $cat, 'amount' => $amt, 'description' => s($in['description'] ?? '', 300), 'date' => d($in['date'] ?? null) ?? today()];
    if ($id) upd('expenses', $id, $f); else $id = ins('expenses', $f + ['user_id' => $u['id'], 'ts' => time()]);
    audit($in['id'] ?? 0 ? 'update' : 'create', 'expense', $id, "$cat $amt");
    return ['id' => $id];
}
function act_expense_delete(array $in): array {
    need('expenses', 'delete'); $id = (int)($in['id'] ?? 0);
    q('DELETE FROM expenses WHERE id=?', [$id]); audit('delete', 'expense', $id);
    return [];
}

/* ------------------------------------------------------------ finance */
/** Revenue / cost breakdown for a date range: products and services are tracked separately. */
function finance_breakdown(string $from, string $to): array {
    $sv = fn(string $sql, array $p = []) => round((float)val($sql, $p), 2);
    $b = [
        'product_sales'   => $sv('SELECT COALESCE(SUM(product_rev),0) FROM sales WHERE date BETWEEN ? AND ?', [$from, $to]),
        'service_sales'   => $sv('SELECT COALESCE(SUM(service_rev),0) FROM sales WHERE date BETWEEN ? AND ?', [$from, $to]),
        'service_charges' => $sv('SELECT (SELECT COALESCE(SUM(amount),0) FROM repair_payments WHERE date BETWEEN ? AND ?)+(SELECT COALESCE(SUM(amount),0) FROM soft_payments WHERE date BETWEEN ? AND ?)', [$from, $to, $from, $to]),
        'hardware_charges' => $sv('SELECT COALESCE(SUM(amount),0) FROM repair_payments WHERE date BETWEEN ? AND ?', [$from, $to]),
        'software_charges' => $sv('SELECT COALESCE(SUM(amount),0) FROM soft_payments WHERE date BETWEEN ? AND ?', [$from, $to]),
        'discounts'       => $sv('SELECT COALESCE(SUM(discount),0) FROM sales WHERE date BETWEEN ? AND ?', [$from, $to]),
        'product_costs'   => $sv('SELECT COALESCE(SUM(cost),0) FROM sales WHERE date BETWEEN ? AND ?', [$from, $to]),
        'parts_costs'     => $sv("SELECT (SELECT COALESCE(SUM(qty*unit_cost),0) FROM repair_parts WHERE date(ts,'unixepoch','localtime') BETWEEN ? AND ?)+(SELECT COALESCE(SUM(qty*unit_cost),0) FROM soft_parts WHERE date(ts,'unixepoch','localtime') BETWEEN ? AND ?)", [$from, $to, $from, $to]),
        'expenses'        => $sv('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date BETWEEN ? AND ?', [$from, $to]),
    ];
    $b['total_revenue'] = round($b['product_sales'] + $b['service_sales'] - $b['discounts'] + $b['service_charges'], 2);
    $b['net_profit'] = round($b['total_revenue'] - $b['product_costs'] - $b['parts_costs'] - $b['expenses'], 2);
    return $b;
}
function act_finance(array $in): array {
    admin();
    $today = today(); $map = money_by_day('2000-01-01', $today);
    $agg = function (string $from, string $to) use ($map) {
        $a = ['income' => 0.0, 'cost' => 0.0, 'expense' => 0.0];
        foreach ($map as $dd => $m) if ($dd >= $from && $dd <= $to) foreach ($a as $f => $_) $a[$f] += $m[$f];
        $a['profit'] = $a['income'] - $a['cost'] - $a['expense'];
        return array_map(fn($x) => round($x, 2), $a);
    };
    $sales = (float)val('SELECT COALESCE(SUM(total),0) FROM sales'); $repairInc = (float)val('SELECT COALESCE(SUM(amount),0) FROM repair_payments');
    $tot = $agg('2000-01-01', $today);
    $wk = $agg(date('Y-m-d', strtotime('monday this week')), $today);
    $mo = $agg(date('Y-m-01'), $today);
    $lastMo = $agg(date('Y-m-01', strtotime('first day of last month')), date('Y-m-t', strtotime('first day of last month')));
    $daily = [];
    for ($i = 29; $i >= 0; $i--) { $dd = date('Y-m-d', strtotime("-$i days")); $m = $map[$dd] ?? ['income' => 0, 'cost' => 0, 'expense' => 0]; $daily[] = ['label' => substr($dd, 5), 'income' => round($m['income'], 2), 'expense' => round($m['expense'] + $m['cost'], 2), 'v' => round($m['income'] - $m['cost'] - $m['expense'], 2)]; }
    $monthly = [];
    for ($i = 11; $i >= 0; $i--) { $key = date('Y-m', strtotime(date('Y-m-01') . " -$i months")); $monthly[$key] = ['income' => 0.0, 'cost' => 0.0, 'expense' => 0.0]; }
    foreach ($map as $dd => $m) { $key = substr($dd, 0, 7); if (isset($monthly[$key])) foreach ($m as $f => $v) $monthly[$key][$f] += $v; }
    $mrows = [];
    foreach ($monthly as $key => $m) $mrows[] = ['month' => $key, 'label' => date('M y', strtotime("$key-01")), 'income' => round($m['income'], 2), 'cost' => round($m['cost'], 2), 'expense' => round($m['expense'], 2), 'v' => round($m['income'] - $m['cost'] - $m['expense'], 2)];
    $stats = store_stats(); $stores = [];
    foreach (rows('SELECT id,name,phone FROM stores ORDER BY name') as $s) $stores[] = $s + ($stats[$s['id']] ?? ['received' => 0, 'sold' => 0, 'returned' => 0, 'remaining' => 0, 'payable' => 0, 'paid' => 0, 'balance' => 0]);
    return ['breakdown' => finance_breakdown('2000-01-01', $today), 'breakdown_month' => finance_breakdown(date('Y-m-01'), $today), 'totals' => $tot + ['sales' => round($sales, 2), 'repair_income' => round($repairInc, 2)], 'week' => $wk, 'month' => $mo, 'last_month' => $lastMo, 'today' => $agg($today, $today),
        'daily' => $daily, 'monthly' => $mrows, 'expense_cats' => rows('SELECT category label, ROUND(SUM(amount),2) v FROM expenses GROUP BY category ORDER BY v DESC'),
        'stores' => $stores, 'consignment_balance' => round(array_sum(array_column($stores, 'balance')), 2),
        'payments' => rows('SELECT p.id,p.amount,p.date,p.note,s.name store,u.name by_name FROM store_payments p JOIN stores s ON s.id=p.store_id LEFT JOIN users u ON u.id=p.user_id ORDER BY p.date DESC,p.id DESC LIMIT 200')];
}
function act_store_payment_add(array $in): array {
    $u = admin(); $sid = (int)($in['store_id'] ?? 0); $amt = round(n($in['amount'] ?? 0), 2);
    if (!val('SELECT 1 FROM stores WHERE id=?', [$sid])) throw new ApiError('Select a store.');
    if ($amt <= 0) throw new ApiError('Enter the amount paid.');
    $id = ins('store_payments', ['store_id' => $sid, 'amount' => $amt, 'date' => d($in['date'] ?? null) ?? today(), 'user_id' => $u['id'], 'note' => s($in['note'] ?? '', 200)]);
    audit('payment', 'store', $sid, (string)$amt);
    return ['id' => $id];
}
function act_store_payment_delete(array $in): array {
    admin(); q('DELETE FROM store_payments WHERE id=?', [(int)($in['id'] ?? 0)]); audit('delete', 'store_payment', (int)($in['id'] ?? 0));
    return [];
}

/* ------------------------------------------------------------ reports */
function act_report(array $in): array {
    $u = need('reports', 'view'); $adm = (bool)$u['is_admin'];
    $type = (string)($in['type'] ?? 'inventory');
    $from = d($in['from'] ?? null) ?? date('Y-m-01'); $to = d($in['to'] ?? null) ?? today();
    $cur = setting('currency', '$');
    if (str_starts_with($type, 'inv_')) return inv_report($type, $from, $to, $adm, $cur);
    if ($type === 'stores') {
        admin();
        $out = [];
        $stats = store_stats();
        foreach (rows('SELECT id,name FROM stores ORDER BY name') as $s) { $x = $stats[$s['id']] ?? ['received' => 0, 'sold' => 0, 'returned' => 0, 'remaining' => 0, 'payable' => 0, 'paid' => 0, 'balance' => 0]; $out[] = ['store' => $s['name']] + $x; }
        return ['title' => 'Store balances (credit / consignment)', 'columns' => [['k' => 'store', 'l' => 'Store / supplier'], ['k' => 'received', 'l' => 'Received', 'n' => 1], ['k' => 'sold', 'l' => 'Sold', 'n' => 1], ['k' => 'returned', 'l' => 'Returned', 'n' => 1], ['k' => 'remaining', 'l' => 'Remaining', 'n' => 1], ['k' => 'payable', 'l' => "Amount payable ($cur)", 'n' => 1], ['k' => 'paid', 'l' => "Amount paid ($cur)", 'n' => 1], ['k' => 'balance', 'l' => "Amount remaining ($cur)", 'n' => 1]], 'rows' => $out];
    }
    if ($type === 'sales') {
        need('sales', 'view');
        $out = [];
        foreach (rows('SELECT s.id,s.date,s.customer_name,s.discount,s.total,s.cost,s.paid,s.product_rev,s.service_rev,u.name by_name,' . SALE_ITEMS_SQL . ' items FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.date BETWEEN ? AND ? ORDER BY s.date DESC,s.id DESC', [$from, $to]) as $r) {
            $out[] = ['date' => $r['date'], 'customer' => $r['customer_name'], 'items' => $r['items'], 'product_rev' => (float)$r['product_rev'], 'service_rev' => (float)$r['service_rev'], 'discount' => (float)$r['discount'], 'total' => (float)$r['total'], 'paid' => (float)$r['paid'], 'by' => $r['by_name']] + ($adm ? ['profit' => round($r['total'] - $r['cost'], 2)] : []);
        }
        $cols = [['k' => 'date', 'l' => 'Date'], ['k' => 'customer', 'l' => 'Customer'], ['k' => 'items', 'l' => 'Items / services'], ['k' => 'product_rev', 'l' => "Product revenue ($cur)", 'n' => 1], ['k' => 'service_rev', 'l' => "Service revenue ($cur)", 'n' => 1], ['k' => 'discount', 'l' => "Discount ($cur)", 'n' => 1], ['k' => 'total', 'l' => "Total ($cur)", 'n' => 1], ['k' => 'paid', 'l' => "Paid ($cur)", 'n' => 1], ['k' => 'by', 'l' => 'Sold by']];
        if ($adm) $cols[] = ['k' => 'profit', 'l' => "Profit ($cur)", 'n' => 1];
        return ['title' => 'Sales report', 'columns' => $cols, 'rows' => $out];
    }
    if ($type === 'repairs') {
        need('repairs', 'view');
        $out = [];
        foreach (rows("SELECT r.id,date(r.received_at,'unixepoch','localtime') d,c.name cn,c.phone,r.device,r.problem,r.status,r.price,r.discount,u.name tech,COALESCE((SELECT SUM(amount) FROM repair_payments WHERE repair_id=r.id),0) paid FROM repairs r JOIN customers c ON c.id=r.customer_id LEFT JOIN users u ON u.id=r.technician_id WHERE d BETWEEN ? AND ? ORDER BY r.id DESC", [$from, $to]) as $r)
            $out[] = ['date' => $r['d'], 'customer' => $r['cn'], 'phone' => $r['phone'], 'device' => $r['device'], 'problem' => $r['problem'], 'status' => $r['status'], 'technician' => $r['tech'], 'price' => (float)$r['price'] - (float)$r['discount'], 'paid' => (float)$r['paid'], 'balance' => (float)$r['price'] - (float)$r['discount'] - (float)$r['paid']];
        return ['title' => 'Hardware repair report', 'columns' => [['k' => 'date', 'l' => 'Received'], ['k' => 'customer', 'l' => 'Customer'], ['k' => 'phone', 'l' => 'Phone'], ['k' => 'device', 'l' => 'Device'], ['k' => 'problem', 'l' => 'Problem'], ['k' => 'status', 'l' => 'Status'], ['k' => 'technician', 'l' => 'Technician'], ['k' => 'price', 'l' => "Charge ($cur)", 'n' => 1], ['k' => 'paid', 'l' => "Paid ($cur)", 'n' => 1], ['k' => 'balance', 'l' => "Balance ($cur)", 'n' => 1]], 'rows' => $out];
    }
    if ($type === 'software') {
        need('software', 'view');
        $out = [];
        foreach (rows("SELECT j.kind,j.device,j.status,j.price,j.discount,date(j.received_at,'unixepoch','localtime') d,c.name cn,c.phone,u.name tech,COALESCE((SELECT SUM(amount) FROM soft_payments WHERE job_id=j.id),0) paid FROM soft_jobs j JOIN customers c ON c.id=j.customer_id LEFT JOIN users u ON u.id=j.technician_id WHERE d BETWEEN ? AND ? ORDER BY j.id DESC", [$from, $to]) as $r)
            $out[] = ['date' => $r['d'], 'service' => ['repair' => 'Software repair', 'unlock' => 'Apple Unlock', 'newid' => 'New Apple ID'][$r['kind']] ?? $r['kind'], 'customer' => $r['cn'], 'phone' => $r['phone'], 'device' => $r['device'], 'status' => $r['status'], 'user' => $r['tech'], 'price' => (float)$r['price'] - (float)$r['discount'], 'paid' => (float)$r['paid'], 'balance' => (float)$r['price'] - (float)$r['discount'] - (float)$r['paid']];
        return ['title' => 'Software department report', 'columns' => [['k' => 'date', 'l' => 'Received'], ['k' => 'service', 'l' => 'Service'], ['k' => 'customer', 'l' => 'Customer'], ['k' => 'phone', 'l' => 'Phone'], ['k' => 'device', 'l' => 'Device'], ['k' => 'status', 'l' => 'Status'], ['k' => 'user', 'l' => 'Software user'], ['k' => 'price', 'l' => "Charge ($cur)", 'n' => 1], ['k' => 'paid', 'l' => "Paid ($cur)", 'n' => 1], ['k' => 'balance', 'l' => "Balance ($cur)", 'n' => 1]], 'rows' => $out];
    }
    if ($type === 'followups') {
        need('customers', 'view');
        $out = [];
        foreach (rows('SELECT f.*,c.name cn,c.phone FROM followups f JOIN customers c ON c.id=f.customer_id WHERE f.done=0 ORDER BY f.due_date') as $f)
            $out[] = ['customer' => $f['cn'], 'phone' => $f['phone'], 'type' => ucfirst(str_replace('_', ' ', (string)$f['type'])), 'note' => $f['note'], 'due' => $f['due_date']];
        return ['title' => 'Customer follow-ups pending', 'columns' => [['k' => 'customer', 'l' => 'Customer'], ['k' => 'phone', 'l' => 'Phone'], ['k' => 'type', 'l' => 'Follow-up'], ['k' => 'note', 'l' => 'Note'], ['k' => 'due', 'l' => 'Due']], 'rows' => $out];
    }
    if ($type === 'expenses') {
        admin();
        $out = rows('SELECT e.date,e.category,e.description,e.amount,u.name by_name FROM expenses e LEFT JOIN users u ON u.id=e.user_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC', [$from, $to]);
        return ['title' => 'Expense report', 'columns' => [['k' => 'date', 'l' => 'Date'], ['k' => 'category', 'l' => 'Category'], ['k' => 'description', 'l' => 'Description'], ['k' => 'amount', 'l' => "Amount ($cur)", 'n' => 1], ['k' => 'by_name', 'l' => 'Entered by']], 'rows' => $out];
    }
    throw new ApiError('Unknown report.');
}

/* ------------------------------------------------------------ customer portal */
function pme(): array {
    boot_session('HICPORTAL');
    $id = $_SESSION['cid'] ?? 0;
    $a = $id ? row('SELECT * FROM portal_accounts WHERE id=?', [$id]) : null;
    if (!$a) throw new ApiError('Please sign in.', 401, ['auth' => true]);
    if ($a['status'] !== 'active') { unset($_SESSION['cid']); throw new ApiError('Your account is not active.', 403, ['auth' => true]); }
    return $a;
}
function act_portal_register(array $in): array {
    $name = s($in['name'] ?? '', 80); $phone = s($in['phone'] ?? '', 30); $email = strtolower(s($in['email'] ?? '', 120)); $pw = (string)($in['password'] ?? '');
    if (!$name || strlen(phone_key($phone)) < 7 || !filter_var($email, FILTER_VALIDATE_EMAIL)) throw new ApiError('Enter your name, a valid mobile number and email.');
    if (strlen($pw) < 6) throw new ApiError('Password must be at least 6 characters.');
    if (val('SELECT 1 FROM portal_accounts WHERE email=? OR phone=?', [$email, $phone])) throw new ApiError('An account with this email or mobile number already exists.');
    $id = ins('portal_accounts', ['name' => $name, 'phone' => $phone, 'email' => $email, 'password' => password_hash($pw, PASSWORD_DEFAULT), 'status' => 'pending', 'created_at' => time()]);
    notify('new_user', "Customer portal registration awaiting approval: $name ($phone)", 'admin', '#/portal');
    return ['id' => $id];
}
function act_portal_login(array $in): array {
    boot_session('HICPORTAL');
    $email = strtolower(s($in['email'] ?? '', 120)); $key = ($_SERVER['REMOTE_ADDR'] ?? '') . '|p|' . $email;
    if ((int)val('SELECT COUNT(*) FROM login_attempts WHERE k=? AND ts>?', [$key, time() - 600]) >= 8) throw new ApiError('Too many attempts. Please try again in a few minutes.', 429);
    $a = row('SELECT * FROM portal_accounts WHERE email=?', [$email]);
    if (!$a || !password_verify((string)($in['password'] ?? ''), $a['password'])) { ins('login_attempts', ['k' => $key, 'ts' => time()]); throw new ApiError('Invalid email or password.', 401); }
    if ($a['status'] === 'pending') throw new ApiError('Your registration is pending approval by HARGEISA IPHONE CENTER. Please check back soon.', 403);
    if ($a['status'] === 'rejected') throw new ApiError('Your registration was not approved. Please contact the shop.', 403);
    if ($a['status'] === 'suspended') throw new ApiError('Your account has been suspended. Please contact the shop.', 403);
    session_regenerate_id(true);
    $_SESSION['cid'] = (int)$a['id'];
    q('UPDATE portal_accounts SET last_login=? WHERE id=?', [time(), $a['id']]);
    return act_portal_me([]);
}
function act_portal_logout(array $in): array { boot_session('HICPORTAL'); $_SESSION = []; session_destroy(); return []; }
function portal_devices(int $cid): array {
    $repairs = [];
    foreach (rows('SELECT id,device,status,outcome,diagnosis,expected_date,received_at,closed_at,progress_notes FROM repairs WHERE customer_id=? ORDER BY id DESC', [$cid]) as $r) {
        $r['events'] = rows('SELECT status,ts FROM repair_events WHERE repair_id=? ORDER BY id', [$r['id']]);
        $r['parts'] = rows('SELECT p.name product,SUM(rp.qty) qty FROM repair_parts rp JOIN products p ON p.id=rp.product_id WHERE rp.repair_id=? GROUP BY rp.product_id', [$r['id']]);
        $r['parts_status'] = $r['parts'] ? 'Parts used/installed' : ($r['status'] === 'waiting_part' ? 'Waiting for part' : 'No parts required yet');
        $r['ready'] = in_array($r['status'], ['ready', 'completed'], true);
        $r['collected'] = in_array($r['status'], ['took_completed', 'took_incomplete'], true);
        unset($r['outcome']);
        $repairs[] = $r;
    }
    return ['repairs' => $repairs,
        'software' => rows("SELECT id,kind,device,status,request_date,expected_date,received_at,CASE WHEN expected_date IS NULL THEN NULL ELSE CAST(julianday(expected_date)-julianday(date('now','localtime')) AS INTEGER) END days_left FROM soft_jobs WHERE customer_id=? ORDER BY id DESC", [$cid]),
        'appleids' => rows("SELECT id,model,status,request_date,expected_date,CASE WHEN expected_date IS NULL THEN NULL ELSE CAST(julianday(expected_date)-julianday(date('now','localtime')) AS INTEGER) END days_left FROM appleids WHERE customer_id=? AND hidden=0 ORDER BY id DESC", [$cid]),
        'regional' => rows('SELECT id,device,status,region,date_sent,expected_return,actual_return FROM regional WHERE customer_id=? ORDER BY id DESC', [$cid])];
}
function act_portal_me(array $in): array {
    $a = pme();
    return ['account' => ['id' => (int)$a['id'], 'name' => $a['name'], 'phone' => $a['phone'], 'email' => $a['email']], 'branding' => all_settings()] + ($a['customer_id'] ? portal_devices((int)$a['customer_id']) : ['repairs' => [], 'software' => [], 'appleids' => [], 'regional' => []]);
}
function act_portal_list(array $in): array {
    admin();
    return rows("SELECT a.id,a.name,a.phone,a.email,a.status,a.created_at,a.last_login,a.customer_id,
        (SELECT COUNT(*) FROM repairs r WHERE r.customer_id=a.customer_id) repairs,
        (SELECT r.device||' — '||r.status FROM repairs r WHERE r.customer_id=a.customer_id AND r.status NOT IN ('completed','took_completed','took_incomplete','failed') ORDER BY r.id DESC LIMIT 1) current
        FROM portal_accounts a ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.id DESC");
}
function act_portal_status(array $in): array {
    $u = admin(); $id = (int)($in['id'] ?? 0); $to = (string)($in['status'] ?? '');
    $a = row('SELECT * FROM portal_accounts WHERE id=?', [$id]);
    if (!$a) throw new ApiError('Account not found.', 404);
    if (!in_array($to, ['active', 'rejected', 'suspended'], true)) throw new ApiError('Invalid status.');
    $d = ['status' => $to, 'approved_by' => $u['id']];
    if ($to === 'active' && !$a['customer_id']) {
        $ex = val('SELECT id FROM customers WHERE phone_key=?', [phone_key($a['phone'])]);
        $d['customer_id'] = $ex ?: ins('customers', ['name' => $a['name'], 'phone' => $a['phone'], 'phone_key' => phone_key($a['phone']), 'email' => $a['email'], 'created_by' => $u['id'], 'created_at' => time()]);
    }
    upd('portal_accounts', $id, $d);
    audit($to === 'active' ? 'approve' : $to, 'portal_account', $id, $a['name']);
    return [];
}
function act_portal_get(array $in): array {
    admin(); $a = row('SELECT id,name,phone,email,status,created_at,last_login,customer_id FROM portal_accounts WHERE id=?', [(int)($in['id'] ?? 0)]);
    if (!$a) throw new ApiError('Account not found.', 404);
    return ['account' => $a] + ($a['customer_id'] ? portal_devices((int)$a['customer_id']) : ['repairs' => [], 'software' => [], 'appleids' => [], 'regional' => []]);
}
