/**
 * `createETagCache` — server-side ETag/304 helper. The classic
 * "conditional GET" pattern that turns a 100KB response into a 304
 * empty body when the client has the same version cached.
 *
 *   const etag = createETagCache({ keyer: (req) => req.url + req.user.tenantId });
 *   app.get('/api/v1/properties', async (c) => {
 *     const properties = await fetchProperties();
 *     const result = await etag.handle({
 *       req: c.req,
 *       value: properties,
 *       responder: (etagValue) => c.json(properties, 200, { ETag: etagValue }),
 *       notModifiedResponder: () => c.body(null, 304, { ETag: etagValue }),
 *     });
 *     return result;
 *   });
 */

import type { ETagCacheOptions, ETagStore } from '../types.js';

/** In-memory LRU with a fixed cap — safe default for single-replica dev. */
class MemoryETagStore implements ETagStore {
  private readonly map = new Map<string, string>();
  constructor(private readonly cap = 1024) {}
  async get(key: string): Promise<string | undefined> {
    const v = this.map.get(key);
    if (v !== undefined) {
      // touch for LRU
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  async set(key: string, etag: string): Promise<void> {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, etag);
    if (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

/** Weak ETag generator. Uses djb2 over a JSON.stringify — fast + stable. */
export function computeETag(payload: unknown): string {
  const src = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let hash = 5381;
  for (let i = 0; i < src.length; i++) {
    hash = (hash * 33 + src.charCodeAt(i)) >>> 0;
  }
  return `W/"${hash.toString(36)}"`;
}

export interface ETagHandleArgs<TReq, TRes> {
  readonly req: TReq;
  readonly value: unknown;
  /** Builds the 200 OK response with the computed ETag header. */
  readonly responder: (etag: string) => TRes;
  /** Builds the 304 Not Modified response. */
  readonly notModifiedResponder: (etag: string) => TRes;
  /** Override how the request's If-None-Match header is read. */
  readonly readIfNoneMatch?: (req: TReq) => string | undefined;
}

export interface ETagCache<TReq> {
  handle<TRes>(args: ETagHandleArgs<TReq, TRes>): Promise<TRes>;
  /** Pure helper that just computes the etag — no req/store touch. */
  compute(value: unknown): string;
}

export function createETagCache<TReq extends { header?: (n: string) => string | undefined } = never>(
  opts: ETagCacheOptions<TReq>,
): ETagCache<TReq> {
  const store: ETagStore = opts.store ?? new MemoryETagStore();
  return {
    compute: computeETag,
    async handle<TRes>(args: ETagHandleArgs<TReq, TRes>): Promise<TRes> {
      const etag = computeETag(args.value);
      const key = opts.keyer(args.req);
      await store.set(key, etag);
      const incoming = args.readIfNoneMatch
        ? args.readIfNoneMatch(args.req)
        : args.req.header?.('If-None-Match');
      if (incoming !== undefined && incoming === etag) {
        return args.notModifiedResponder(etag);
      }
      return args.responder(etag);
    },
  };
}
