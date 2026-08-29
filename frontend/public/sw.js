// Minimal PWA service worker.
// Strategy:
//   • precache the app shell so participants can load the join screen offline
//   • network-first for /api/* and /ws/* (live data must be fresh)
//   • stale-while-revalidate for static assets (fonts, icons, JS)
//
// Self-destroy in development so HMR + dev iteration don't fight the cache.
const VERSION = 'v1';
const SHELL_CACHE = `judge-os-shell-${VERSION}`;
const STATIC_CACHE = `judge-os-static-${VERSION}`;

const SHELL_URLS = ['/', '/join', '/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(SHELL_URLS).catch(() => {
        // Ignore individual failures (e.g. / not yet cached) — best effort.
      }),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== STATIC_CACHE)
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache API or WebSocket — live data must be fresh.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
    return;
  }

  // Same-origin app shell — try cache first, fall back to network, then to /.
  if (url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          // Cache successful navigations + static responses.
          if (fresh.ok && (req.mode === 'navigate' || url.pathname.match(/\.(js|css|svg|woff2?|png|jpg)$/))) {
            const cache = await caches.open(req.mode === 'navigate' ? SHELL_CACHE : STATIC_CACHE);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          // Offline + not cached → fall back to / (the join screen) so the
          // participant app shell always loads.
          const fallback = await caches.match('/');
          if (fallback) return fallback;
          throw new Error('Offline and no cached shell');
        }
      })(),
    );
  }
});