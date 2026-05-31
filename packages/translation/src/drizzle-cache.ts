/**
 * Drizzle-backed translation cache adapter.
 *
 * Reads/writes against the `translation_cache` table created by
 * migration 0155. Key is the SHA-256 content-hash so identical
 * source-text/lang/register/surface tuples collapse to one row across
 * tenants. Misses fall through to the SOTA runner; successful runs
 * are upserted back here.
 *
 * Production composition root binds this; tests use
 * `createInMemoryTranslationCache`.
 *
 * The schema is provided by the caller so this package doesn't depend
 * on `@borjie/database` directly (avoids a tight cycle — database
 * imports the runner types via @borjie/translation-sota types).
 */

import type {
  TranslationCacheKey,
  TranslationCachePort,
  TranslationCacheValue,
} from './types.js';
import { contentHash } from './hash.js';

/**
 * Minimal client shape — anything that exposes the Drizzle methods we
 * use. We avoid importing the concrete `DatabaseClient` so this
 * package does not need to dependency on `@borjie/database`.
 */
export interface DrizzleCacheClient {
  // We type this loosely on purpose: the caller injects a real
  // drizzle PgDatabase. We narrow the surface to what we actually
  // call so the type can be satisfied by either a transaction or the
  // root client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly execute: (query: any) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

export interface DrizzleCacheLogger {
  readonly warn: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface DrizzleCacheDeps {
  readonly db: DrizzleCacheClient;
  readonly logger?: DrizzleCacheLogger;
}

interface CacheRow {
  readonly target_text: string;
  readonly provider: string;
  readonly glossary_version: string;
}

/**
 * Build a Postgres-safe text literal. We don't have access to the
 * drizzle `sql` template tag here, so we use parameterised
 * `.execute()` with a custom shape via the consumer's adapter.
 *
 * For safety, this adapter goes via a thin SQL helper that the
 * caller passes — but to keep the contract small we accept a
 * pre-bound executor function that takes (sql, params).
 */
export interface SqlRunner {
  /** Returns array of rows. */
  readonly query: <Row = Record<string, unknown>>(
    sql: string,
    params: ReadonlyArray<unknown>,
  ) => Promise<ReadonlyArray<Row>>;
  /** Fire-and-forget mutation. */
  readonly exec: (
    sql: string,
    params: ReadonlyArray<unknown>,
  ) => Promise<void>;
}

export interface DrizzleCacheConfig {
  readonly runner: SqlRunner;
  readonly logger?: DrizzleCacheLogger;
}

export function createDrizzleTranslationCache(
  config: DrizzleCacheConfig,
): TranslationCachePort {
  const { runner, logger } = config;

  return Object.freeze({
    async get(key: TranslationCacheKey): Promise<string | null> {
      const hash = contentHash(key);
      try {
        const rows = await runner.query<CacheRow>(
          `SELECT target_text, provider, glossary_version
             FROM translation_cache
            WHERE content_hash = $1
            LIMIT 1`,
          [hash],
        );
        if (rows.length === 0) return null;

        // Best-effort: bump hit counter + touch last_used_at. Don't
        // fail the read if the update errors.
        runner
          .exec(
            `UPDATE translation_cache
                SET hits = hits + 1,
                    last_used_at = NOW()
              WHERE content_hash = $1`,
            [hash],
          )
          .catch((err) => {
            logger?.warn('translation.cache.hit-bump-failed', {
              error: (err as Error).message,
            });
          });

        return rows[0]?.target_text ?? null;
      } catch (err) {
        logger?.warn('translation.cache.get.failed', {
          error: (err as Error).message,
        });
        return null;
      }
    },

    async set(
      key: TranslationCacheKey,
      value: TranslationCacheValue,
    ): Promise<void> {
      const hash = contentHash(key);
      try {
        await runner.exec(
          `INSERT INTO translation_cache
             (content_hash, tenant_id, source_lang, target_lang,
              register, surface, source_text, target_text, provider,
              glossary_version, hits, created_at, last_used_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, NOW(), NOW())
           ON CONFLICT (content_hash) DO UPDATE
             SET last_used_at = NOW(),
                 hits = translation_cache.hits + 1`,
          [
            hash,
            key.tenantId === '' ? null : key.tenantId,
            key.sourceLang,
            key.targetLang,
            key.register,
            key.surface,
            key.sourceText,
            value.targetText,
            value.provider,
            value.glossaryVersion,
          ],
        );
      } catch (err) {
        logger?.warn('translation.cache.set.failed', {
          error: (err as Error).message,
        });
      }
    },
  });
}
