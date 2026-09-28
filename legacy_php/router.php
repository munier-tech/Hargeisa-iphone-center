<?php
// Router for PHP's built-in server:  php -S 0.0.0.0:8080 -t public router.php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/';
$file = realpath(__DIR__ . '/public' . $path);
$root = realpath(__DIR__ . '/public');

if ($path === '/' || $path === '/index.php') { readfile($root . '/index.html'); return true; }
if ($path === '/portal' || $path === '/portal/') { readfile($root . '/portal.html'); return true; }
if ($file && str_starts_with($file, $root) && is_file($file)) {
    if (str_ends_with($file, '.php') && basename($file) !== 'api.php') { http_response_code(404); readfile($root . '/restricted.html'); return true; }
    return false; // let the server serve the static file / run api.php
}
http_response_code(404);
readfile($root . '/restricted.html');
return true;
