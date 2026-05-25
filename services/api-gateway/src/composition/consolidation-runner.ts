/**
 * Consolidation runner — composition-root entry for the brain's
 * "sleep" cycle. Iterates active (tenantId, userId) pairs and runs
 * `runConsolidationCycle` for each. Designed to be invoked by an
 * external scheduler (cron / Kubernetes CronJob / GitHub-Actions
 * scheduled-task system) — this module does NOT install a cron
 * itself.
 *
 * Two ways to invoke:
 *
 *   1. Library — `runConsolidationForActiveTenants(db, anthropic, opts)`
 *      from another in-process composition root.
 *   2. CLI    — `node ./dist/composition/consolidation-runner.js`. The
 *      CLI guard at the bottom of the file boots from env vars
 *      (DATABASE_URL + ANTHROPIC_API_KEY) and exits non-zero on a
 *      missing prerequisite. When either env var is missing the runner
 *      logs a warning and is a NO-OP — so a misconfigured cron does
 *      not crash the deployment.
 *
 * Contract notes:
 *   - The cycle is RESILIENT: a per-tenant failure is caught + logged
 *     and the runner moves on. `runConsolidationForActiveTenants`
 *     returns aggregated counts across all successful tenants.
 *   - "Active" = has at least one episodic entry within the
 *     discovery window. Default window: 14 days. Pass `discoverScopes`
 *     for tests or to wire a different active-set source (e.g. a join
 *     against an audit table).
 */

import { sql } from 'drizzle-orm';
import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import {
  runConsolidationCycle,
  type ConsolidationConfig,
  type ConsolidationDeps,
  type ConsolidationJudgePort,
  type ConsolidationReport,
  type ConsolidationScope,
} from '@borjie/central-intelligence';
import {
  createEpisodicMemoryService,
  createSemanticMemoryService,
  createProceduralMemoryService,
  createReflectiveMemoryService,
} from '@borjie/database';
import type { ReflectivePeriodKind } from '@borjie/central-intelligence';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ActiveScope {
  readonly tenantId: string | null;
  readonly userId: string;
}

export interface AnthropicLikeClient {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ReadonlyArray<{ role: 'user' | 'assistant'; content: string | unknown }>;
    }): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
    }>;
  };
}

export interface ConsolidationRunnerOptions {
  /** How many days to scan for active scopes. Default 14. */
  readonly windowDays?: number;
  /** Period kind passed to each cycle. Default 'daily'. */
  readonly periodKind?: ReflectivePeriodKind;
  /** Override the active-scope discovery (tests). */
  readonly discoverScopes?: () => Promise<ReadonlyArray<ActiveScope>>;
  /** Override per-cycle config (windowDays, decay, thresholds). */
  readonly cycleConfig?: Partial<ConsolidationConfig>;
  /** Haiku model id; defaults to the dynamic-registry's "haiku" family. */
  readonly modelId?: string;
}

export interface ConsolidationRunnerSummary {
  readonly tenantsProcessed: number;
  readonly factsUpserted: number;
  readonly patternsRecorded: number;
  readonly digestsWritten: number;
  readonly expiredPurged: number;
  readonly decayedFacts: number;
  readonly errors: ReadonlyArray<string>;
  readonly reports: ReadonlyArray<ConsolidationReport>;
}

// Drizzle client shape — we only depend on the tiny subset we use.
// Casting `any` keeps this file decoupled from drizzle-orm/postgres-js's
// declaration merging at the consumption site (see db-client.ts comment).
type DrizzleLikeClient = {
  execute: (q: unknown) => Promise<unknown>;
};

// ---------------------------------------------------------------------------
// Library entry — call from another composition root.
// ---------------------------------------------------------------------------

export async function runConsolidationForActiveTenants(
  db: DrizzleLikeClient | null | undefined,
  anthropic: AnthropicLikeClient | null | undefined,
  options: ConsolidationRunnerOptions = {},
): Promise<ConsolidationRunnerSummary> {
  if (!db || !anthropic) {
    logger.warn('consolidation-runner: missing prerequisites; runner is a no-op', {
        hasDb: !!db,
        hasAnthropic: !!anthropic,
      });
    return emptySummary();
  }

  const windowDays = options.windowDays ?? 14;
  const periodKind: ReflectivePeriodKind = options.periodKind ?? 'daily';

  // Build memory ports from the shared db client.
  const episodic = createEpisodicMemoryService(db as never);
  const semantic = createSemanticMemoryService(db as never);
  const procedural = createProceduralMemoryService(db as never);
  const reflective = createReflectiveMemoryService(db as never);

  // Build the Haiku judge port.
  const judge = buildAnthropicJudge(anthropic, options.modelId);

  // Discover active scopes.
  const discover = options.discoverScopes ?? (() => discoverFromEpisodic(db, windowDays));
  let scopes: ReadonlyArray<ActiveScope> = [];
  try {
    scopes = await discover();
  } catch (error) {
    logger.warn('consolidation-runner: scope discovery failed', { error });
    return { ...emptySummary(), errors: [asMsg(error)] };
  }

  const deps: ConsolidationDeps = {
    episodic,
    semantic,
    procedural,
    reflective,
    judge,
  };

  let factsUpserted = 0;
  let patternsRecorded = 0;
  let digestsWritten = 0;
  let expiredPurged = 0;
  let decayedFacts = 0;
  const reports: ConsolidationReport[] = [];
  const errors: string[] = [];

  for (const scope of scopes) {
    const cycleScope: ConsolidationScope = {
      tenantId: scope.tenantId,
      userId: scope.userId,
      periodKind,
    };
    try {
      const report = await runConsolidationCycle(
        deps,
        cycleScope,
        options.cycleConfig,
      );
      reports.push(report);
      factsUpserted += report.factsUpserted;
      patternsRecorded += report.patternsRecorded;
      digestsWritten += report.digestsWritten;
      expiredPurged += report.expiredPurged;
      decayedFacts += report.decayedFacts;
      for (const e of report.errors) errors.push(e);
    } catch (error) {
      const msg = `cycle failed for tenant=${scope.tenantId ?? 'null'} user=${scope.userId}: ${asMsg(error)}`;
      logger.warn('consolidation-runner', { msg });
      errors.push(msg);
    }
  }

  return {
    tenantsProcessed: reports.length,
    factsUpserted,
    patternsRecorded,
    digestsWritten,
    expiredPurged,
    decayedFacts,
    errors,
    reports,
  };
}

// ---------------------------------------------------------------------------
// Active-scope discovery — distinct (tenantId, userId) from episodic.
// ---------------------------------------------------------------------------

async function discoverFromEpisodic(
  db: DrizzleLikeClient,
  windowDays: number,
): Promise<ReadonlyArray<ActiveScope>> {
  // Raw SQL is the lightest-weight path here — we don't want to add a
  // new repository surface to @borjie/database for a one-off
  // discovery query. The episodic table is migrated at 0121.
  try {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const rows = (await db.execute(
      sql`select distinct tenant_id, user_id
          from kernel_memory_episodic
          where captured_at >= ${cutoff}`,
    )) as unknown as ReadonlyArray<{ tenant_id: string | null; user_id: string }>;

    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r) => typeof r.user_id === 'string' && r.user_id.length > 0)
      .map((r) => ({ tenantId: r.tenant_id ?? null, userId: r.user_id }));
  } catch (error) {
    logger.warn('consolidation-runner: episodic discovery failed', { error });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Anthropic judge port — Haiku one-shot.
// ---------------------------------------------------------------------------

function buildAnthropicJudge(
  client: AnthropicLikeClient,
  modelId?: string,
): ConsolidationJudgePort {
  // Dynamic resolve — pick up newest haiku id auto-discovered by L2
  // refresh; baseline fallback ensures we never pass `undefined`.
  const model = modelId ?? getModelLatest('haiku');
  return {
    async call({ system, userPrompt, maxTokens }) {
      try {
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens ?? 1024,
          system,
          messages: [
            {
              role: 'user',
              content: userPrompt,
            },
          ],
        });
        let body = '';
        for (const block of response.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            body += block.text;
          }
        }
        return body;
      } catch (error) {
        logger.warn('consolidation-runner: judge call failed', { value: asMsg(error) });
        return '';
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): ConsolidationRunnerSummary {
  return {
    tenantsProcessed: 0,
    factsUpserted: 0,
    patternsRecorded: 0,
    digestsWritten: 0,
    expiredPurged: 0,
    decayedFacts: 0,
    errors: [],
    reports: [],
  };
}

function asMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// CLI entry — `node ./dist/composition/consolidation-runner.js`.
// Lazy-imports the @anthropic-ai/sdk and the api-gateway db-client so
// this file is still importable in unit tests that don't want to boot
// real connections.
// ---------------------------------------------------------------------------

export async function runFromEnv(): Promise<ConsolidationRunnerSummary> {
  const dbUrl = process.env.DATABASE_URL?.trim();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!dbUrl || !apiKey) {
    logger.warn('consolidation-runner CLI: DATABASE_URL and ANTHROPIC_API_KEY are required; no-op', { hasDbUrl: !!dbUrl, hasApiKey: !!apiKey });
    return emptySummary();
  }

  let db: DrizzleLikeClient | null = null;
  try {
    const dbModule = await import('./db-client.js');
    db = (dbModule.getDb?.() ?? null) as DrizzleLikeClient | null;
  } catch (error) {
    logger.warn('consolidation-runner CLI: db-client import failed', { error });
    return emptySummary();
  }

  let anthropic: AnthropicLikeClient | null = null;
  try {
    const sdk = await import('@anthropic-ai/sdk');
    const Anthropic = (sdk.default ?? sdk) as unknown as new (cfg: { apiKey: string }) => AnthropicLikeClient;
    anthropic = new Anthropic({ apiKey });
  } catch (error) {
    logger.warn('consolidation-runner CLI: @anthropic-ai/sdk import failed', { error });
    return emptySummary();
  }

  const periodKind = (process.env.CONSOLIDATION_PERIOD_KIND ?? 'daily') as ReflectivePeriodKind;
  const windowDays = parsePositiveInt(process.env.CONSOLIDATION_WINDOW_DAYS, 14);
  const cycleWindowDays = parsePositiveInt(process.env.CONSOLIDATION_CYCLE_WINDOW_DAYS, periodKind === 'weekly' ? 7 : 1);

  return runConsolidationForActiveTenants(db, anthropic, {
    windowDays,
    periodKind,
    cycleConfig: { windowDays: cycleWindowDays },
  });
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

// When invoked directly via `node dist/composition/consolidation-runner.js`
// — but only when this file is the program entry, not when imported.
const isDirect =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  typeof process.argv[1] === 'string' &&
  /consolidation-runner(\.js|\.ts)?$/.test(process.argv[1]);

if (isDirect) {
  runFromEnv()
    .then((summary) => {
      logger.info(`consolidation-runner: tenantsProcessed=${summary.tenantsProcessed} facts=${summary.factsUpserted} patterns=${summary.patternsRecorded} digests=${summary.digestsWritten} purged=${summary.expiredPurged} decayed=${summary.decayedFacts} errors=${summary.errors.length}`);
      process.exit(summary.errors.length > 0 ? 1 : 0);
    })
    .catch((error) => {
      logger.error('consolidation-runner: fatal', { error: error });
      process.exit(2);
    });
}
