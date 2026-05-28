/**
 * Borjie marketing site — service worker.
 *
 * Strategy:
 *   - Cache-first for static assets with stale-while-revalidate refresh.
 *   - Network-first for API calls (cache fallback on failure).
 *   - HTML navigations are network-first with offline-shell fallback.
 *
 * Caches are versioned by CACHE_VERSION + bucket. Bumping the version
 * invalidates every old cache during the `activate` lifecycle.
 */

/* eslint-disable no-restricted-globals */

const CACHE_VERSION = 'v1';
const APP_SCOPE = 'marketing';
const STATIC_CACHE = `borjie-${APP_SCOPE}-static-${CACHE_VERSION}`;
const HTML_CACHE = `borjie-${APP_SCOPE}-html-${CACHE_VERSION}`;
const API_CACHE = `borjie-${APP_SCOPE}-api-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline.html';

const STATIC_PRECACHE = [
  OFFLINE_URL,
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/borjie-lockup-horizontal.svg',
];

const STATIC_LIMIT = 60;
const HTML_LIMIT = 20;
const API_LIMIT = 40;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const survivors = new Set([STATIC_CACHE, HTML_CACHE, API_CACHE]);
      await Promise.all(
        keys.map((k) => (survivors.has(k) ? null : caches.delete(k))),
      );
      await self.clients.claim();
    })(),
  );
});

async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  for (const k of keys.slice(0, keys.length - limit)) {
    await cache.delete(k);
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request)
      .then(async (resp) => {
        if (resp && resp.ok) {
          await cache.put(request, resp.clone());
          await trimCache(STATIC_CACHE, STATIC_LIMIT);
        }
      })
      .catch(() => undefined);
    return cached;
  }
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) {
      await cache.put(request, resp.clone());
      await trimCache(STATIC_CACHE, STATIC_LIMIT);
    }
    return resp;
  } catch (err) {
    return cached ?? Response.error();
  }
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const resp = await fetch(request);
    if (resp && resp.ok && request.method === 'GET') {
      await cache.put(request, resp.clone());
      await trimCache(API_CACHE, API_LIMIT);
    }
    return resp;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function networkFirstHtml(request) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const resp = await fetch(request);
    if (resp && resp.ok) {
      await cache.put(request, resp.clone());
      await trimCache(HTML_CACHE, HTML_LIMIT);
    }
    return resp;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  const dest = request.destination;
  if (
    dest === 'script' ||
    dest === 'style' ||
    dest === 'image' ||
    dest === 'font' ||
    dest === 'manifest'
  ) {
    event.respondWith(cacheFirstStatic(request));
    return;
  }
});
