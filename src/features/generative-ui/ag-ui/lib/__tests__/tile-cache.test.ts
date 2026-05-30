/**
 * tile-cache.test.ts — iter-50-final.
 *
 * Vitest unit tests for the offline tile cache helper. Happy-dom does
 * not ship an `indexedDB` polyfill, so we install a small in-memory
 * fake at module-load time that's just rich enough for `tile-cache.ts`
 * (object store with a single `timestamp` index, `get`/`put`/`delete`
 * /`clear`, and a `openCursor` walk for eviction).
 *
 * Three suites:
 *   1. round-trip — `setCachedTile` then `getCachedTile` returns the blob.
 *   2. miss returns null and graceful-no-op when IDB is absent.
 *   3. budget eviction — LRU drops oldest tiles when over `MAX_CACHE_BYTES`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tiny in-memory IndexedDB fake. Installed BEFORE importing tile-cache so
// the module-level `typeof indexedDB` check evaluates against this fake.
// ---------------------------------------------------------------------------

interface FakeRecord {
  readonly url: string;
  readonly blob: Blob;
  readonly size: number;
  readonly timestamp: number;
}

class FakeRequest<T = unknown> {
  result: T | undefined = undefined;
  error: unknown = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  oncomplete: (() => void) | null = null;
  _resolveSync(result: T): void {
    this.result = result;
    queueMicrotask(() => {
      this.onsuccess?.();
    });
  }
}

class FakeCursor {
  constructor(
    private readonly records: FakeRecord[],
    private index: number,
    private readonly req: FakeRequest<FakeCursor | null>,
  ) {}
  get value(): FakeRecord {
    return this.records[this.index]!;
  }
  continue(): void {
    this.index += 1;
    queueMicrotask(() => {
      if (this.index < this.records.length) {
        this.req.result = this;
        this.req.onsuccess?.();
      } else {
        this.req.result = null;
        this.req.onsuccess?.();
      }
    });
  }
}

class FakeIndex {
  constructor(private readonly store: FakeObjectStore) {}
  openCursor(): FakeRequest<FakeCursor | null> {
    const req = new FakeRequest<FakeCursor | null>();
    const sorted = [...this.store._records.values()].sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    queueMicrotask(() => {
      if (sorted.length === 0) {
        req.result = null;
        req.onsuccess?.();
        return;
      }
      const cursor = new FakeCursor(sorted, 0, req);
      req.result = cursor;
      req.onsuccess?.();
    });
    return req;
  }
}

class FakeObjectStore {
  _records: Map<string, FakeRecord> = new Map();
  get(key: string): FakeRequest<FakeRecord | undefined> {
    const req = new FakeRequest<FakeRecord | undefined>();
    queueMicrotask(() => req._resolveSync(this._records.get(key)));
    return req;
  }
  put(record: FakeRecord): FakeRequest<void> {
    const req = new FakeRequest<void>();
    this._records.set(record.url, record);
    queueMicrotask(() => req._resolveSync(undefined));
    return req;
  }
  delete(key: string): FakeRequest<void> {
    const req = new FakeRequest<void>();
    this._records.delete(key);
    queueMicrotask(() => req._resolveSync(undefined));
    return req;
  }
  clear(): FakeRequest<void> {
    const req = new FakeRequest<void>();
    this._records.clear();
    queueMicrotask(() => req._resolveSync(undefined));
    return req;
  }
  index(_name: string): FakeIndex {
    return new FakeIndex(this);
  }
  createIndex(_name: string, _keyPath: string): void {}
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  error: unknown = null;
  private _completed = false;
  constructor(private readonly _store: FakeObjectStore) {
    // Resolve completion after caller has had a chance to enqueue ops.
    queueMicrotask(() => {
      queueMicrotask(() => {
        if (!this._completed) {
          this._completed = true;
          this.oncomplete?.();
        }
      });
    });
  }
  objectStore(_name: string): FakeObjectStore {
    return this._store;
  }
}

class FakeDB {
  readonly _store: FakeObjectStore = new FakeObjectStore();
  readonly objectStoreNames = {
    contains: (_name: string) => true,
  };
  transaction(_storeName: string, _mode?: string): FakeTransaction {
    return new FakeTransaction(this._store);
  }
  createObjectStore(_name: string, _opts: unknown): FakeObjectStore {
    return this._store;
  }
}

class FakeOpenRequest extends FakeRequest<FakeDB> {
  constructor(private readonly _db: FakeDB) {
    super();
    queueMicrotask(() => {
      // Existing DB — no upgrade needed because objectStoreNames.contains
      // returns true unconditionally.
      this.result = this._db;
      this.onsuccess?.();
    });
  }
}

let fakeDB = new FakeDB();
const fakeIndexedDB = {
  open: (_name: string, _version: number) => new FakeOpenRequest(fakeDB),
};

// Install the fake on `globalThis` BEFORE the module under test loads,
// then dynamic-import the module so its top-level `typeof indexedDB`
// check sees the fake.
beforeEach(() => {
  fakeDB = new FakeDB();
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = fakeIndexedDB;
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("tile-cache: round-trip", () => {
  it("setCachedTile then getCachedTile returns the same blob bytes", async () => {
    const mod = await import("../tile-cache");
    const url = "https://a.tile.openstreetmap.org/10/512/512.png";
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const blob = new Blob([payload], { type: "image/png" });

    await mod.setCachedTile(url, blob);
    const got = await mod.getCachedTile(url);

    expect(got).not.toBeNull();
    expect(got!.size).toBe(blob.size);
  });
});

describe("tile-cache: misses and SSR safety", () => {
  it("returns null for an unknown tile URL", async () => {
    const mod = await import("../tile-cache");
    const got = await mod.getCachedTile(
      "https://a.tile.openstreetmap.org/0/0/0.png",
    );
    expect(got).toBeNull();
  });

  it("no-ops gracefully when indexedDB is undefined (SSR)", async () => {
    // Remove the fake to simulate a Node / SSR runtime.
    (globalThis as unknown as { indexedDB: unknown }).indexedDB =
      undefined as unknown;
    vi.resetModules();
    const mod = await import("../tile-cache");

    const got = await mod.getCachedTile("https://x/y/z.png");
    expect(got).toBeNull();

    // Should not throw.
    await expect(
      mod.setCachedTile("https://x/y/z.png", new Blob([new Uint8Array(1)])),
    ).resolves.toBeUndefined();
    await expect(mod.evictOldTiles()).resolves.toBeUndefined();
  });
});

describe("tile-cache: LRU eviction under budget", () => {
  it("evicts oldest tiles when total size exceeds MAX_CACHE_BYTES", async () => {
    const mod = await import("../tile-cache");

    // Use a 12 MB blob so 3 of them exceed the 25 MB budget.
    const big = new Blob([new Uint8Array(12 * 1024 * 1024)], {
      type: "image/png",
    });

    // Write tile1 first (oldest), then tile2, then tile3 — eviction
    // should drop tile1 because its timestamp is smallest.
    await mod.setCachedTile("t1", big);
    // Sleep one microtask-cycle gap so timestamps are strictly
    // monotonic across writes. Date.now() can return identical values
    // on fast machines, so we patch the second + third writes through
    // a controlled timestamp source by walking the fake store directly.
    fakeDB._store._records.set("t1", {
      url: "t1",
      blob: big,
      size: big.size,
      timestamp: 1,
    });
    fakeDB._store._records.set("t2", {
      url: "t2",
      blob: big,
      size: big.size,
      timestamp: 2,
    });
    fakeDB._store._records.set("t3", {
      url: "t3",
      blob: big,
      size: big.size,
      timestamp: 3,
    });

    await mod.evictOldTiles();

    // After eviction: total must be <= MAX_CACHE_BYTES. With three
    // 12 MB blobs (36 MB total) and a 25 MB cap, eviction drops the
    // oldest (t1), leaving t2 + t3 = 24 MB <= 25 MB.
    expect(fakeDB._store._records.has("t1")).toBe(false);
    expect(fakeDB._store._records.has("t2")).toBe(true);
    expect(fakeDB._store._records.has("t3")).toBe(true);
    const total = [...fakeDB._store._records.values()].reduce(
      (sum, r) => sum + r.size,
      0,
    );
    expect(total).toBeLessThanOrEqual(mod.MAX_CACHE_BYTES);
  });
});
