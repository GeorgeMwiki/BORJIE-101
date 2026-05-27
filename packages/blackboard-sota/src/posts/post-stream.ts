/**
 * Post stream — per (tenant, region) SSE fan-out with leaky-bucket
 * rate limiting.
 *
 * Wave BLACKBOARD-CORE. The reactive flow surface — every subscribed
 * consumer (chat-UI blackboard panel, the regulator portal, the
 * meta-learning-conductor cron) gets a `Post` notification for every
 * new post in the region. SSE is primary; WebSocket is a fallback the
 * api-gateway negotiates for the two collaborative regions (see
 * spec §9, §10).
 *
 * Rate limit per tenant: 100 posts/min via leaky-bucket. Excess
 * emissions buffer and replay when budget is restored. Persistence
 * is unaffected — only the SSE notification is delayed.
 *
 * No I/O — the stream is pure in-process publish-subscribe. The
 * api-gateway wraps the Subscribe iterator in an HTTP `EventStream`.
 */

import type { Post } from '../types.js';
import { BLACKBOARD_CONSTANTS } from '../types.js';

type Listener = (post: Post) => void;

interface BucketState {
  /** Tokens available — drains on emit, refills on tick. */
  tokens: number;
  /** Posts buffered because the bucket was empty when they arrived. */
  buffer: Post[];
  /** Last refill timestamp (ms epoch). */
  lastRefillMs: number;
}

export interface PostStreamDeps {
  /** Override clock for deterministic tests. */
  readonly now?: () => number;
  /** Override rate-limit bucket capacity (posts). */
  readonly capacity?: number;
  /** Override rate-limit refill (posts per minute). */
  readonly refillPerMin?: number;
}

export interface PostStream {
  /** Push a post into the stream. Honours the rate limit. */
  emit(post: Post): void;
  /** Subscribe to a single (tenant, region). Returns an unsubscribe fn. */
  subscribe(
    tenantId: string,
    regionId: string,
    listener: Listener,
  ): () => void;
  /** Total subscribers currently attached (diagnostic). */
  subscriberCount(): number;
  /** Posts currently buffered (diagnostic). */
  bufferedCount(tenantId: string): number;
  /** Manually pump the leaky bucket — for tests. Production wires a setInterval. */
  pump(): void;
}

export function createPostStream(deps: PostStreamDeps = {}): PostStream {
  const now = deps.now ?? (() => Date.now());
  const capacity = deps.capacity ?? BLACKBOARD_CONSTANTS.SSE_RATE_LIMIT_POSTS_PER_MIN;
  const refillPerMin =
    deps.refillPerMin ?? BLACKBOARD_CONSTANTS.SSE_RATE_LIMIT_POSTS_PER_MIN;
  const listeners = new Map<string, Set<Listener>>();
  const buckets = new Map<string, BucketState>();

  function getBucket(tenantId: string): BucketState {
    let bucket = buckets.get(tenantId);
    if (bucket === undefined) {
      bucket = { tokens: capacity, buffer: [], lastRefillMs: now() };
      buckets.set(tenantId, bucket);
    }
    return bucket;
  }

  function refill(bucket: BucketState): void {
    const t = now();
    const elapsedMs = t - bucket.lastRefillMs;
    if (elapsedMs <= 0) return;
    const refill = (elapsedMs / 60_000) * refillPerMin;
    bucket.tokens = Math.min(capacity, bucket.tokens + refill);
    bucket.lastRefillMs = t;
  }

  function deliver(post: Post): void {
    const key = `${post.tenantId}::${post.regionId}`;
    const set = listeners.get(key);
    if (set === undefined) return;
    for (const listener of set) {
      try {
        listener(post);
      } catch {
        // Subscribers are best-effort — one bad listener never blocks
        // the channel. The api-gateway adapter logs failures.
      }
    }
  }

  function tryFlush(bucket: BucketState): void {
    while (bucket.buffer.length > 0 && bucket.tokens >= 1) {
      const next = bucket.buffer.shift();
      if (next === undefined) break;
      bucket.tokens -= 1;
      deliver(next);
    }
  }

  return {
    emit(post) {
      const bucket = getBucket(post.tenantId);
      refill(bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        deliver(post);
        return;
      }
      bucket.buffer.push(post);
    },

    subscribe(tenantId, regionId, listener) {
      const key = `${tenantId}::${regionId}`;
      let set = listeners.get(key);
      if (set === undefined) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        const currentSet = listeners.get(key);
        if (currentSet !== undefined) {
          currentSet.delete(listener);
          if (currentSet.size === 0) listeners.delete(key);
        }
      };
    },

    subscriberCount() {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },

    bufferedCount(tenantId) {
      const bucket = buckets.get(tenantId);
      return bucket?.buffer.length ?? 0;
    },

    pump() {
      for (const bucket of buckets.values()) {
        refill(bucket);
        tryFlush(bucket);
      }
    },
  };
}
