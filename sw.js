// Offline support for the attendance tracker: caches the static files only.
// Entries live in the page's own storage (localStorage), so they are never touched here.
const CACHE = 'attendance-1.0.0';   // change together with the version label to ship an update
const SHELL = ['./', 'index.html', 'style.css', 'script.js', 'manifest.webmanifest',
               'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k.startsWith('attendance-') && k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    // Page loads: network first so updates arrive, the cached copy when offline
    if (req.mode === 'navigate') {
        e.respondWith(fetch(req).catch(() => caches.match('index.html')));
        return;
    }
    // Everything else: cached copy first, refreshed in the background
    e.respondWith(
        caches.match(req).then(hit => {
            const fresh = fetch(req).then(res => {
                if (res.ok || res.type === 'opaque') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy));
                }
                return res;
            }).catch(() => hit || Response.error());
            return hit || fresh;
        })
    );
});
