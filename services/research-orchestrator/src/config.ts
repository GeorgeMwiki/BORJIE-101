/**
 * Env validation — zod schema.
 *
 * Centralised env-validation so a misconfigured deploy fails fast at
 * startup. Adapter API keys are OPTIONAL: a missing key downgrades that
 * tool to a no-op (returns [] artifacts), so the service still launches
 * in degraded mode for ops + local-dev.
 *
 * Required: DATABASE_URL (the orchestrator writes plan/step/artifact
 * rows). Everything else is optional and sensibly defaulted.
 *
 * @module research-orchestrator/config
 */
import { z } from 'zod';

const PortSchema = z
  .union([z.string(), z.number()])
  .transform((v) => Number(v))
  .pipe(z.number().int().min(1).max(65535));

// UNIV-4: hardcoded launch-beachhead fallback timezone — env DEFAULT_TENANT_TZ overrides; future jurisdictions resolve via tenant.settings.timezone + jurisdiction profile. Tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
const TimezoneFallback = 'Africa/Dar_es_Salaam';

const EnvSchema = z.object({
  // ─────────── Service-level ───────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: PortSchema.default(4011),
  SERVICE_NAME: z.string().default('research-orchestrator'),

  // ─────────── Required infrastructure ───────────
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // ─────────── Adapter API keys (optional — missing ⇒ tool is a no-op) ───────────
  TAVILY_API_KEY: z.string().optional(),
  EXA_API_KEY: z.string().optional(),
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  FIRECRAWL_API_KEY: z.string().optional(),
  LME_API_KEY: z.string().optional(),
  KITCO_FEED_URL: z.string().optional(),
  GDELT_BASE_URL: z.string().default('https://api.gdeltproject.org'),

  // ─────────── Mode budgets (override per env if ops needs to tune) ───────────
  REACTIVE_QUERY_LATENCY_MS: z.coerce.number().int().positive().default(8_000),
  REACTIVE_QUERY_COST_CENTS: z.coerce.number().int().nonnegative().default(5), // $0.05
  ANTICIPATORY_SWEEP_LATENCY_MS: z.coerce.number().int().positive().default(30_000),
  ANTICIPATORY_SWEEP_COST_CENTS: z.coerce.number().int().nonnegative().default(10), // $0.10
  DAILY_BRIEFING_LATENCY_MS: z.coerce.number().int().positive().default(900_000), // 15 min
  DAILY_BRIEFING_COST_CENTS: z.coerce.number().int().nonnegative().default(200), // $2.00
  DEEP_DIVE_LATENCY_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  DEEP_DIVE_COST_CENTS: z.coerce.number().int().nonnegative().default(2_500), // $25
  CONTINUOUS_WATCH_LATENCY_MS: z.coerce.number().int().positive().default(60_000),
  CONTINUOUS_WATCH_COST_CENTS: z.coerce.number().int().nonnegative().default(100), // $1.00

  // ─────────── Cron schedules ───────────
  /** Daily briefing cron expression (per-tenant time uses tenant TZ). */
  DAILY_BRIEFING_CRON_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  DAILY_BRIEFING_CRON_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  /** Continuous-watch sweep cadence in ms (the sweep iterates due watches). */
  CONTINUOUS_WATCH_SWEEP_MS: z.coerce.number().int().positive().default(60_000), // 1 min

  // ─────────── Fallback / safety ───────────
  /** When set, skips Postgres + Redis wiring entirely. Used in CI / tests. */
  DRY_RUN: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  /** Default tenant timezone when the tenants row has no `settings.timezone`. */
  DEFAULT_TENANT_TZ: z.string().default(TimezoneFallback),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * Parse + validate process.env. Throws on invalid config so the process
 * exits early with a structured error instead of crashing mid-flight.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`research-orchestrator: invalid env — ${issues}`);
  }
  return parsed.data;
}

/**
 * Mode budget extracted from config — provides the `ModeBudget` envelope
 * each mode handler consumes. Centralised so the spec's §9 table is the
 * single source of truth.
 */
export function modeBudgetsFromConfig(cfg: AppConfig): {
  readonly reactive_query: { readonly latency_ms: number; readonly cost_usd_cents: number };
  readonly anticipatory_sweep: { readonly latency_ms: number; readonly cost_usd_cents: number };
  readonly daily_briefing: { readonly latency_ms: number; readonly cost_usd_cents: number };
  readonly deep_dive: {
    readonly latency_ms: number;
    readonly cost_usd_cents: number;
    readonly owner_confirm_gates_usd: ReadonlyArray<number>;
  };
  readonly continuous_watch: { readonly latency_ms: number; readonly cost_usd_cents: number };
} {
  return {
    reactive_query: {
      latency_ms: cfg.REACTIVE_QUERY_LATENCY_MS,
      cost_usd_cents: cfg.REACTIVE_QUERY_COST_CENTS,
    },
    anticipatory_sweep: {
      latency_ms: cfg.ANTICIPATORY_SWEEP_LATENCY_MS,
      cost_usd_cents: cfg.ANTICIPATORY_SWEEP_COST_CENTS,
    },
    daily_briefing: {
      latency_ms: cfg.DAILY_BRIEFING_LATENCY_MS,
      cost_usd_cents: cfg.DAILY_BRIEFING_COST_CENTS,
    },
    deep_dive: {
      latency_ms: cfg.DEEP_DIVE_LATENCY_MS,
      cost_usd_cents: cfg.DEEP_DIVE_COST_CENTS,
      owner_confirm_gates_usd: [5, 15],
    },
    continuous_watch: {
      latency_ms: cfg.CONTINUOUS_WATCH_LATENCY_MS,
      cost_usd_cents: cfg.CONTINUOUS_WATCH_COST_CENTS,
    },
  };
}
