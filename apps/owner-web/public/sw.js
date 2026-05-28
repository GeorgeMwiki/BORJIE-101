/**
 * Borjie Owner Cockpit — service worker.
 *
 * Strategy:
 *   - Cache-first for static assets (script / style / image / font), with
 *     a stale-while-revalidate refresh in the background.
 *   - Network-first for API calls under /api/ — falls back to the
 *     offline shell only when the request is for an HTML navigation.
 *   - HTML navigations are served network-first with the offline shell
 *     as a fallback when the network is unreachable.
 *
 * Caches are versioned by CACHE_VERSION + bucket. Bumping the version
 * invalidates every old cache during the `activate` lifecycle.
 *
 * Caps:
 *   - STATIC_CACHE  : 60 entries
 *   - HTML_CACHE    : 20 entries
 *   - API_CACHE     : 40 entries
 *
 * No `console.log` in production paths — this file runs in the SW
 * thread which lacks a Pino instance; we keep the surface silent.
 */

/* eslint-disable no-restricted-globals */

const CACHE_VERSION = 'v1';
const APP_SCOPE = 'owner-web';
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
    // SWR refresh in the background.
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

  // HTML navigations — network-first with offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  // API — network-first with cache fallback.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  // Static assets — cache-first with SWR refresh.
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
