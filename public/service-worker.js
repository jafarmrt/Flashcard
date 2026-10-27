// Offline support for Lingua Cards.
//  - Pages: the network first, but after a few seconds (a slow or filtered
//    connection) the saved copy of the app opens instead.
//  - Built files under /assets/ have a hash in their name and never change,
//    so they come from the cache once saved.
//  - The API and other sites are never cached.
// Change VERSION when this file changes so old caches are removed.

const VERSION = 'v3'; // the caches' contents did not change in v7.7, so they are kept
const SHELL_CACHE = `lc-shell-${VERSION}`;
const ASSET_CACHE = `lc-assets-${VERSION}`;
const SHELL_URLS = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg'];
const NAVIGATION_TIMEOUT_MS = 3500;
const MAX_ASSETS = 80;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== SHELL_CACHE && n !== ASSET_CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Only complete, same-origin answers are worth keeping.
const cacheable = response => response && response.ok && response.type === 'basic';

// The built files the saved page loads at start: its script, styles and
// preloads. Without them the app cannot open offline.
const shellAssets = async () => {
  const saved = await caches.match('/index.html');
  if (!saved) return new Set();
  const html = await saved.text();
  return new Set(Array.from(html.matchAll(/["'](\/assets\/[^"'?#]+)/g), m => new URL(m[1], self.location.origin).href));
};

// Removes the least recently used files over the limit. It used to remove
// the oldest saved ones, and the main bundle is saved first: after enough
// fonts and chunks it was dropped and the app no longer opened offline. Now
// the start files are never removed, and a file used again moves to the
// end (touch below), so what is in use stays.
const trim = async cache => {
  const keys = await cache.keys();
  const extra = keys.length - MAX_ASSETS;
  if (extra <= 0) return;
  const keep = await shellAssets();
  const removable = keys.filter(key => !keep.has(key.url));
  for (const key of removable.slice(0, extra)) await cache.delete(key);
};

// Putting an entry again places it last in the cache's order.
const touch = (request, response) => caches.open(ASSET_CACHE).then(cache => cache.put(request, response)).catch(() => {});

const saveCopy = (cacheName, key, response) =>
  caches.open(cacheName).then(async cache => {
    await cache.put(key, response);
    if (cacheName === ASSET_CACHE) await trim(cache);
  });

// Starts a network request and, in the background, saves a good answer.
// waitUntil is called at once, while the fetch event is still being handled.
const fetchAndSave = (event, cacheName, key) => {
  const network = fetch(event.request);
  event.waitUntil(network.then(response => (cacheable(response) ? saveCopy(cacheName, key, response.clone()) : null)).catch(() => {}));
  return network;
};

const page = async event => {
  const network = fetchAndSave(event, SHELL_CACHE, '/index.html');
  const timeout = new Promise(resolve => setTimeout(resolve, NAVIGATION_TIMEOUT_MS));
  const first = await Promise.race([network.catch(() => null), timeout]);
  if (first) return first;
  return (await caches.match('/index.html')) || network;
};

const asset = async event => {
  const { request } = event;
  const saved = await caches.match(request, { cacheName: ASSET_CACHE });
  if (saved) {
    event.waitUntil(touch(request, saved.clone()));
    return saved;
  }
  const response = await fetch(request);
  if (cacheable(response)) await saveCopy(ASSET_CACHE, request, response.clone());
  return response;
};

// Icons and the manifest: answer from the cache, refresh it in the background.
const staleWhileRevalidate = async event => {
  const network = fetchAndSave(event, SHELL_CACHE, event.request);
  return (await caches.match(event.request)) || network;
};

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(page(event));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(event));
  } else if (SHELL_URLS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
