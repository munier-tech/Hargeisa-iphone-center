<?php
declare(strict_types=1);
require __DIR__ . '/../app/core.php';
require __DIR__ . '/../app/h_auth.php';
require __DIR__ . '/../app/h_ops.php';
require __DIR__ . '/../app/h_inv.php';
require __DIR__ . '/../app/h_soft.php';
require __DIR__ . '/../app/h_stock.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

$json = fn(array $a) => json_encode($a, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
$open = false;
try {
    $pdo = db();
    $a = preg_replace('/[^a-z_]/', '', (string)($_GET['a'] ?? ''));
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'GET') throw new ApiError('Bad request.');
    // CSRF defence: every action except the public branding read needs our custom header (cross-site pages cannot send it)
    if ($a !== 'branding' && ($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'HIC') throw new ApiError('Bad request.', 400);
    $in = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($in)) $in = [];
    $fn = 'act_' . $a;
    if ($a === '' || !function_exists($fn)) throw new ApiError('Unknown action.', 404);
    $pdo->beginTransaction(); $open = true;
    $res = $fn($in);
    $pdo->commit(); $open = false;
    echo $json(['ok' => true, 'data' => $res, 'now' => time()]);
} catch (ApiError $e) {
    if ($open) db()->rollBack();
    // deactivation state must persist even though the request failed
    http_response_code($e->getCode() >= 400 && $e->getCode() < 600 ? $e->getCode() : 400);
    echo $json(['ok' => false, 'error' => $e->getMessage(), 'now' => time()] + $e->extra);
} catch (Throwable $e) {
    if ($open && db()->inTransaction()) db()->rollBack();
    error_log($e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo $json(['ok' => false, 'error' => 'Server error. Please try again.', 'now' => time()]);
}
