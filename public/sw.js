/* HARGEISA IPHONE CENTER — service worker
   Makes the app installable and faster on phones. Live data (the API) is NEVER cached: it always goes to the server,
   so nobody can ever see stale or another user's information. Only the static app files are cached. */
const CACHE = 'hic-shell-v1';
const SHELL = ['/assets/app.css', '/assets/glass.css', '/assets/core.js', '/assets/icons/icon-192.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => { })).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/api.php') || u.pathname.startsWith('/backup_download')) return;        // live data: straight to the network
  if (r.mode === 'navigate') {                                                                      // pages: network first, friendly offline notice
    e.respondWith(fetch(r).catch(() => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;background:#0b1220;color:#e8eefc;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h2>You are offline</h2><p>Reconnect to the shop network and try again.</p></div>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
    return;
  }
  if (u.pathname.startsWith('/assets/')) {                                                          // static files: cached copy first, refreshed in the background
    e.respondWith(caches.open(CACHE).then(async c => { const hit = await c.match(r); const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit); return hit || net; }));
  }
});
