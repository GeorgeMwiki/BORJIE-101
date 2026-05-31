/**
 * Translation wiring — composition-root binding for the
 * `@borjie/translation` facade.
 *
 * Builds:
 *   1. A SOTA runner with the Claude tier-1 provider (Anthropic API
 *      key from env) and in-memory glossary / run repos (Drizzle
 *      adapters land in a follow-up wave).
 *   2. A Drizzle-backed cache adapter that targets the
 *      `translation_cache` table (migration 0155).
 *   3. A Pino logger shim that routes through the api-gateway's
 *      Pino instance.
 *
 * Calls `setGlobalTranslate()` exactly once so every consumer of the
 * package-level `translate(...)` export resolves to the real, cached,
 * Claude-backed implementation.
 *
 * Fails open with a logged warning when ANTHROPIC_API_KEY is not
 * configured — the global stays unbound and consumers fall back to
 * source text (per the facade's documented contract). This is the
 * pilot-acceptable behaviour for dev environments that don't carry
 * the key.
 */

import {
  createTranslate,
  setGlobalTranslate,
  createDrizzleTranslationCache,
  createInMemoryTranslationCache,
  type SqlRunner,
} from '@borjie/translation';
import {
  createTranslationRunner,
  createClaudeProvider,
  createInMemoryTranslationRunRepository,
  createInMemoryGlossaryOverrideRepository,
  createLogger,
  type ClaudeFetcher,
} from '@borjie/translation-sota';
import { sql } from 'drizzle-orm';
import type { DatabaseClient } from '@borjie/database';
import type pino from 'pino';

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929';
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

export interface TranslationWiringInput {
  readonly db: DatabaseClient | null;
  readonly logger: pino.Logger;
}

export interface TranslationWiringResult {
  readonly bound: boolean;
  readonly reason?: string;
}

/**
 * Resolve the Anthropic key from env — same precedence as the rest of
 * the gateway (CLAUDE_API_KEY or ANTHROPIC_API_KEY).
 */
function resolveAnthropicKey(): string | null {
  const key =
    process.env['ANTHROPIC_API_KEY'] ??
    process.env['CLAUDE_API_KEY'] ??
    process.env['ANTHROPIC_KEY'];
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Real fetch-based Claude fetcher. Stays out of the runner so tests
 * can inject deterministic transports.
 */
function makeClaudeFetcher(): ClaudeFetcher {
  return async (req) => {
    const response = await fetch(req.url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.body,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: () => response.text(),
      json: () => response.json(),
    };
  };
}

/**
 * Build a thin SqlRunner that adapts Drizzle's `execute(sql.raw(...))`
 * to the (sql, params) port expected by the Drizzle cache adapter.
 */
function makeSqlRunner(db: DatabaseClient): SqlRunner {
  return {
    async query<Row = Record<string, unknown>>(
      query: string,
      params: ReadonlyArray<unknown>,
    ) {
      // Compose a parameterised statement via drizzle's sql template.
      // We need positional interpolation; drizzle's sql tag supports
      // sql.raw + sql.placeholder via sql`...`. The simplest path is
      // a sql.raw with manual quoting fallback — but for safety we
      // build a sql chunk that emits the parameters as bind values.
      const stmt = buildParamSql(query, params);
      const result = await db.execute(stmt);
      // drizzle-orm's PgDatabase.execute returns { rows } on Postgres.
      // The runtime shape can be a QueryResult — normalise.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (result as any).rows ?? (result as unknown as Row[]);
      return rows as ReadonlyArray<Row>;
    },
    async exec(query: string, params: ReadonlyArray<unknown>) {
      const stmt = buildParamSql(query, params);
      await db.execute(stmt);
    },
  };
}

/**
 * Build a parameterised drizzle `sql` chunk from a positional query
 * like `SELECT $1, $2`. Replaces $N tokens with the corresponding
 * value via sql template literal interpolation.
 */
function buildParamSql(query: string, params: ReadonlyArray<unknown>) {
  // Walk the query, splitting on $N markers and interpolating values
  // through the drizzle sql template so binding is safe.
  const parts = query.split(/(\$\d+)/);
  const chunks: ReturnType<typeof sql>[] = [];
  for (const part of parts) {
    const m = part.match(/^\$(\d+)$/);
    if (m) {
      const idx = Number(m[1]) - 1;
      chunks.push(sql`${params[idx]}`);
    } else if (part.length > 0) {
      chunks.push(sql.raw(part));
    }
  }
  // sql.join is unavailable in this drizzle version — chain via reduce.
  return chunks.reduce(
    (acc, c, i) => (i === 0 ? c : sql`${acc}${c}`),
    sql``,
  );
}

export function wireTranslation(
  input: TranslationWiringInput,
): TranslationWiringResult {
  const apiKey = resolveAnthropicKey();
  if (apiKey === null) {
    input.logger.warn(
      'translation: ANTHROPIC_API_KEY not set — translate() will fall back to source text',
    );
    return { bound: false, reason: 'missing-api-key' };
  }
  if (input.db === null) {
    input.logger.warn(
      'translation: DATABASE_URL not set — cache disabled, every request hits Claude',
    );
  }

  try {
    const fetcher = makeClaudeFetcher();
    const claudeProvider = createClaudeProvider({
      config: {
        apiKey,
        model: CLAUDE_MODEL,
        endpoint: CLAUDE_ENDPOINT,
        temperature: 0,
        maxTokens: 4096,
      },
      fetcher,
      now: () => Date.now(),
    });

    const sotaLogger = createLogger(
      {
        service: 'api-gateway',
        component: 'translation',
        version: '0.1.0',
      },
      input.logger,
    );

    const runner = createTranslationRunner({
      providers: [claudeProvider],
      overrideRepo: createInMemoryGlossaryOverrideRepository(),
      runRepo: createInMemoryTranslationRunRepository({ now: () => new Date() }),
      logger: sotaLogger,
    });

    const cache =
      input.db !== null
        ? createDrizzleTranslationCache({
            runner: makeSqlRunner(input.db),
            logger: {
              warn: (msg, meta) => input.logger.warn(meta ?? {}, msg),
            },
          })
        : // No DB — use a Map so at least within-process repeats are free.
          createInMemoryTranslationCache();

    const translate = createTranslate({
      cache,
      runner,
      logger: {
        info: (msg, meta) => input.logger.info(meta ?? {}, msg),
        warn: (msg, meta) => input.logger.warn(meta ?? {}, msg),
        error: (msg, meta) => input.logger.error(meta ?? {}, msg),
      },
      defaultSurface: 'api-gateway',
    });

    setGlobalTranslate(translate);
    input.logger.info(
      'translation: bound (Claude tier-1 + Drizzle cache + Pino logger)',
    );
    return { bound: true };
  } catch (err) {
    input.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'translation: wiring failed',
    );
    return {
      bound: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
