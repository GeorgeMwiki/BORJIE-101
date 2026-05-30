/**
 * Offline tile cache — iter-50-final.
 *
 * IndexedDB-backed Blob cache for OpenStreetMap raster tiles, used by
 * `<MapView />` so TZ field staff can keep inspecting properties when
 * they wander into a dead zone. Pure helper module, no DOM / leaflet
 * imports — `MapInner` wires this into a custom `L.TileLayer.createTile`
 * override.
 *
 * Storage shape (one IDB record per tile URL):
 *   { url, blob, size, timestamp }
 *
 * Budget: `MAX_CACHE_BYTES` (25 MB). When a write pushes the cache over
 * budget we evict by oldest `timestamp` first (LRU on touch — every
 * cache HIT also bumps `timestamp` so frequently accessed tiles stay
 * resident).
 *
 * SSR-safe: every public method short-circuits to a no-op when
 * `indexedDB` is undefined (Node, SSR, locked-down browsers).
 */

const DB_NAME = "borjie-tile-cache";
const STORE_NAME = "tiles";
const TIMESTAMP_INDEX = "timestamp";
const DB_VERSION = 1;

/** Maximum on-disk size for the cache, in bytes (25 MB). */
export const MAX_CACHE_BYTES = 25 * 1024 * 1024;

interface TileRecord {
  readonly url: string;
  readonly blob: Blob;
  readonly size: number;
  readonly timestamp: number;
}

/**
 * Returns true if the runtime has a usable `indexedDB` global. SSR,
 * Node, and a small slice of privacy-locked browsers will return false.
 */
function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "url" });
        store.createIndex(TIMESTAMP_INDEX, "timestamp", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reads a cached tile by URL. Returns `null` on miss, on any IDB error,
 * or when `indexedDB` is not available. Hits also touch the record's
 * `timestamp` so subsequent `evictOldTiles()` calls treat them as fresh
 * (LRU on read).
 */
export async function getCachedTile(tileUrl: string): Promise<Blob | null> {
  if (!hasIndexedDB()) return null;
  try {
    const db = await openDB();
    const record = await new Promise<TileRecord | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(tileUrl);
        req.onsuccess = () => resolve(req.result as TileRecord | undefined);
        req.onerror = () => reject(req.error);
      },
    );
    if (!record) return null;
    // Touch — best-effort LRU bump. Failure is non-fatal; the caller
    // already has the blob.
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const touched: TileRecord = { ...record, timestamp: Date.now() };
      tx.objectStore(STORE_NAME).put(touched);
    } catch {
      // ignored — see comment above
    }
    return record.blob;
  } catch {
    return null;
  }
}

/**
 * Writes a tile to the cache, then evicts old tiles if the write pushes
 * total size past `MAX_CACHE_BYTES`. Silently no-ops on IDB error so the
 * caller can still serve the tile from the network response it already
 * holds.
 */
export async function setCachedTile(
  tileUrl: string,
  blob: Blob,
): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDB();
    const record: TileRecord = {
      url: tileUrl,
      blob,
      size: blob.size,
      timestamp: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_NAME).put(record);
    });
    await evictOldTiles();
  } catch {
    // swallow — cache is best-effort
  }
}

/**
 * Evicts least-recently-used tiles until the total on-disk size is at
 * or under `MAX_CACHE_BYTES`. Walks the `timestamp` index in ascending
 * order via a read-only cursor pass (to compute total size + collect
 * eviction keys), then deletes the collected keys in a single
 * read-write transaction.
 */
export async function evictOldTiles(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDB();
    // Pass 1: read-only — sum sizes, capture (timestamp, url, size).
    const entries = await new Promise<
      ReadonlyArray<{ url: string; size: number; timestamp: number }>
    >((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const idx = tx.objectStore(STORE_NAME).index(TIMESTAMP_INDEX);
      const collected: Array<{
        url: string;
        size: number;
        timestamp: number;
      }> = [];
      const req = idx.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const value = cursor.value as TileRecord;
          collected.push({
            url: value.url,
            size: value.size,
            timestamp: value.timestamp,
          });
          cursor.continue();
        } else {
          resolve(collected);
        }
      };
      req.onerror = () => reject(req.error);
    });

    const total = entries.reduce((sum, e) => sum + e.size, 0);
    if (total <= MAX_CACHE_BYTES) return;

    // Walk from oldest forward, collect eviction targets until under budget.
    let running = total;
    const toEvict: string[] = [];
    for (const entry of entries) {
      if (running <= MAX_CACHE_BYTES) break;
      toEvict.push(entry.url);
      running -= entry.size;
    }
    if (toEvict.length === 0) return;

    // Pass 2: read-write — delete collected keys.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore(STORE_NAME);
      for (const url of toEvict) {
        store.delete(url);
      }
    });
  } catch {
    // swallow — eviction is best-effort
  }
}

/**
 * Test-only: drop the entire object store. Not exported from the
 * barrel; tests import via the direct module path.
 */
export async function __clearTileCacheForTests(): Promise<void> {
  if (!hasIndexedDB()) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE_NAME).clear();
    });
  } catch {
    // ignore
  }
}
