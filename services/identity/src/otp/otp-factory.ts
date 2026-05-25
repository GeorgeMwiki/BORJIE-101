/**
 * OTP composition-root helper.
 *
 * Builds a production-ready `OtpService` wired to:
 *
 *   - `NotificationsSmsDispatcher` — delegates SMS delivery to the
 *     notifications service's `enqueueNotification` function.
 *   - A Redis-backed `OtpStore` when `REDIS_URL` is set, or
 *     `InMemoryOtpStore` as a fallback for dev / test / single-node.
 *
 * Keep this file dependency-light: the Redis client is imported lazily so
 * identity service consumers that don't use Redis never pay the import cost.
 *
 * Identity is an ESM workspace and does NOT depend on the notifications
 * package. The caller (the identity service composition root) supplies the
 * notifications `enqueue` function, keeping the package graph acyclic.
 */

import {
  InMemoryOtpStore,
  OtpService,
  type OtpRecord,
  type OtpServiceOptions,
  type OtpStore,
} from './otp-service.js';
import {
  NotificationsSmsDispatcher,
  type DispatcherLogger,
  type EnqueueNotificationFn,
} from './notifications-sms-dispatcher.js';
import type { TenantIdentityId } from '@borjie/domain-models';
import { logger } from '../logger.js';

export interface OtpFactoryDeps {
  /** Injected notifications enqueue. Supplied by the identity composition root. */
  readonly enqueue: EnqueueNotificationFn;
  /** Tenant the OTP flow is operating under. */
  readonly tenantId: string;
  /** Optional user id — passed through to notifications preferences gate. */
  readonly userId?: string;
  /** Optional correlation id for tracing. */
  readonly correlationId?: string;
  /** Optional override of the Redis connection URL. Defaults to env var. */
  readonly redisUrl?: string;
  /** Optional override of the OTP store — wins over redis/in-memory selection. */
  readonly store?: OtpStore;
  /** Optional logger for fallback warnings. */
  readonly logger?: DispatcherLogger;
  /** Optional OtpService behaviour overrides (attempts, ttl, sleep). */
  readonly options?: OtpServiceOptions;
}

/**
 * Resolve the configured OTP store. Selection precedence:
 *   1. `deps.store` (explicit override)
 *   2. Redis-backed store if `redisUrl` / `REDIS_URL` is present
 *   3. `InMemoryOtpStore` fallback
 */
async function resolveStore(deps: OtpFactoryDeps): Promise<OtpStore> {
  if (deps.store) return deps.store;
  const url = deps.redisUrl ?? process.env.REDIS_URL;
  if (!url) return new InMemoryOtpStore();
  try {
    return await buildRedisStore(url);
  } catch (error) {
    const logger = deps.logger ?? defaultLogger;
    logger.warn('Redis OTP store unavailable, falling back to in-memory', {
      error: (error as Error).message,
    });
    return new InMemoryOtpStore();
  }
}

const defaultLogger: DispatcherLogger = {
  warn(message, meta) {
    logger.warn(`[identity.otp.factory] ${message}`, { value: meta ?? {} })
  },
};

/**
 * Lazy Redis store. Uses `ioredis` if it is available in the runtime
 * `node_modules` but does not declare it as a hard dependency — this keeps
 * `@borjie/identity` installable in environments that don't ship Redis.
 *
 * Records are stored as JSON under `otp:{identityId}` with a TTL that
 * matches the OTP expiry window.
 */
async function buildRedisStore(url: string): Promise<OtpStore> {
  // Dynamic import so environments without `ioredis` still build.
  const mod = (await import('ioredis').catch(() => null)) as
    | { default?: unknown; Redis?: unknown }
    | null;
  if (!mod) {
    throw new Error("ioredis module not installed; cannot build Redis OTP store");
  }
  interface RedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>;
    del(key: string): Promise<unknown>;
  }
  type RedisNew = new (url: string) => RedisLike;
  // ioredis ships as CJS with a `default` export under ESM-interop, and
  // also exposes a named `Redis` export — probe both, fall back to bare.
  const modShape = mod as { default?: RedisNew; Redis?: RedisNew };
  const RedisCtor: RedisNew =
    modShape.default ?? modShape.Redis ?? (mod as unknown as RedisNew);
  const client: RedisLike = new RedisCtor(url);

  const key = (identityId: TenantIdentityId): string =>
    `otp:${identityId as unknown as string}`;

  return {
    async get(identityId) {
      const raw = await client.get(key(identityId));
      if (!raw) return undefined;
      try {
        return JSON.parse(raw) as OtpRecord;
      } catch {
        return undefined;
      }
    },
    async set(record) {
      const ttlMs = Math.max(1, record.expiresAt - Date.now());
      await client.set(
        key(record.identityId),
        JSON.stringify(record),
        'PX',
        ttlMs
      );
    },
    async delete(identityId) {
      await client.del(key(identityId));
    },
  };
}

/**
 * Build a production OTP service. Callers should treat this as the single
 * composition-root helper — avoid constructing `OtpService` directly in
 * service/application code.
 */
export async function createOtpService(
  deps: OtpFactoryDeps
): Promise<OtpService> {
  if (!deps || typeof deps.enqueue !== 'function') {
    throw new Error('createOtpService: `enqueue` is required');
  }
  if (!deps.tenantId || deps.tenantId.trim().length === 0) {
    throw new Error('createOtpService: `tenantId` is required');
  }

  const store = await resolveStore(deps);
  const sms = new NotificationsSmsDispatcher({
    enqueue: deps.enqueue,
    tenantId: deps.tenantId,
    userId: deps.userId,
    correlationId: deps.correlationId,
    logger: deps.logger,
  });

  return new OtpService(store, sms, deps.options ?? {});
}
