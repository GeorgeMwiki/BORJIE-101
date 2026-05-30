/**
 * Rate Limit — Redis-backed sliding window for truth-engine on-demand refresh.
 *
 * Replaces the in-process Map in security.ts (which doesn't survive across
 * serverless invocations and gives an attacker a free pass on every cold
 * boot). When Upstash Redis is configured, we use it; otherwise we fall back
 * to the in-process Map, but log loudly so production deployments wire up
 * Redis. Either way the API is uniform: caller doesn't know which backend ran.
 */

import { getRedisClient } from "@/lib/redis-client";

const REFRESH_WINDOW_SECONDS = 60;
const REFRESH_MAX_PER_WINDOW = 3;
const KEY_PREFIX = "borjie:truthengine:refresh";

// Fallback in-memory tracker if Redis is unavailable (dev mode, tests)
const inMemoryTracker = new Map<string, number[]>();

/**
 * Returns true iff the actor may issue another on-demand refresh for this
 * factKey. Window-based: REFRESH_MAX_PER_WINDOW calls per actor per
 * REFRESH_WINDOW_SECONDS for the same fact key.
 */
export async function canRefreshOnDemand(
  actorId: string,
  factKey: string,
): Promise<boolean> {
  const safeActor = sanitize(actorId);
  const safeKey = sanitize(factKey);
  const bucketKey = `${KEY_PREFIX}:${safeActor}:${safeKey}`;

  // Try Redis first
  if (
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    try {
      return await checkRedis(bucketKey);
    } catch (err) {
      // Log at warn level — fall through to in-memory tracker
      console.warn(
        "[truth-engine] Redis rate-limit failed, falling back:",
        err,
      );
    }
  }

  return checkInMemory(bucketKey);
}

// ---------------------------------------------------------------------------
// Redis path (token bucket via INCR + EXPIRE)
// ---------------------------------------------------------------------------

async function checkRedis(bucketKey: string): Promise<boolean> {
  const redis = getRedisClient();
  const now = Date.now();
  const windowKey = `${bucketKey}:${Math.floor(now / (REFRESH_WINDOW_SECONDS * 1000))}`;

  const raw = await redis.get(windowKey);
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;

  if (count >= REFRESH_MAX_PER_WINDOW) return false;

  await redis.set(windowKey, String(count + 1), REFRESH_WINDOW_SECONDS);
  return true;
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

function checkInMemory(bucketKey: string): boolean {
  const now = Date.now();
  const recent = (inMemoryTracker.get(bucketKey) ?? []).filter(
    (t) => now - t < REFRESH_WINDOW_SECONDS * 1000,
  );
  if (recent.length >= REFRESH_MAX_PER_WINDOW) {
    inMemoryTracker.set(bucketKey, recent);
    return false;
  }
  inMemoryTracker.set(bucketKey, [...recent, now]);
  return true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip anything that could break the Redis key namespace or smuggle in
 * cross-tenant data. Permits [a-zA-Z0-9_:-] only, caps at 80 chars.
 */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:\-]/g, "_").slice(0, 80);
}

/**
 * Test-only helper to wipe the in-memory tracker.
 * Redis side intentionally not flushed (would clobber other tenants' counters).
 */
export function _resetInMemoryTrackerForTests(): void {
  inMemoryTracker.clear();
}
