/**
 * validate-env — fail-fast env-var validation for the API Gateway.
 *
 * Called once at boot from `src/index.ts`. Required vars throw on missing.
 * Optional vars log a one-line warning. Everything is Zod-schema-gated so a
 * typo'd env var is caught before the first request hits.
 *
 * Grouping:
 *   - core       — always required (DATABASE_URL, JWT_SECRET)
 *   - auth       — JWT secrets + audience/issuer
 *   - observe    — logging, Sentry, PostHog (optional)
 *   - providers  — Anthropic/OpenAI/ElevenLabs/AWS (optional)
 *   - payments   — GePG / M-Pesa (required when a gateway handler uses them)
 *   - transport  — Redis / queues / rate-limit (optional with safe defaults)
 */

import { z } from 'zod';

/**
 * `optional()` helper that also treats empty strings (`KEY=`) as unset.
 *
 * `.env.local` / `.env.example` follow the operator convention of leaving
 * unconfigured keys present with an empty value (so the key list documents
 * itself). Without this preprocess, `z.coerce.number()`, `z.string().url()`,
 * and `z.enum(...)` all fail on `""` — turning every blank optional key
 * into a fatal boot error. See N4 (2026-05-29).
 */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    schema.optional(),
  );
}

/** Required env: failure to set these is a boot-time error. */
const CoreSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(10, 'DATABASE_URL must be set — e.g. postgres://user:pass@host:5432/db')
    .refine(
      (v) => /^postgres(ql)?:\/\//.test(v),
      'DATABASE_URL must be a postgres:// or postgresql:// URL'
    ),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters (cryptographically strong)'),
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
});

/** Optional env — present → validated; absent → warning in non-test envs. */
const OptionalSchema = z.object({
  PORT: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(1).max(65_535).default(4000),
  ),
  APP_VERSION: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().default('dev'),
  ),
  GIT_SHA: optional(z.string()),
  LOG_LEVEL: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  ),

  // Auth — additional JWT knobs
  JWT_ACCESS_SECRET: optional(z.string().min(32)),
  JWT_REFRESH_SECRET: optional(z.string().min(32)),
  // P84 audit: JWT_ISSUER + JWT_AUDIENCE are validated here (dev/test
  // default ok) but the live auth middleware (auth.middleware.ts) fails
  // fast in production when unset, per BUG-HI-4. Default was
  // 'borjie-client' here but 'borjie-api' in the middleware —
  // aligned to 'borjie-api' so tokens issued under the validated
  // env match the verifier when neither is explicitly configured.
  JWT_ISSUER: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().default('borjie'),
  ),
  JWT_AUDIENCE: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().default('borjie-api'),
  ),

  // CORS
  ALLOWED_ORIGINS: optional(z.string()),

  // Transport
  REDIS_URL: optional(z.string().url()),

  // Rate limit
  RATE_LIMIT_MAX_REQUESTS: optional(z.coerce.number().int().positive()),
  RATE_LIMIT_WINDOW_MS: optional(z.coerce.number().int().positive()),

  // Outbox / background workers
  OUTBOX_WORKER_DISABLED: optional(z.enum(['true', 'false'])),
  OUTBOX_INTERVAL_MS: optional(z.coerce.number().int().positive()),
  OUTBOX_BATCH_SIZE: optional(z.coerce.number().int().positive()),
  BORJIE_BG_TASKS_ENABLED: optional(z.enum(['true', 'false'])),

  // Observability
  SENTRY_DSN: optional(z.string().url()),
  SENTRY_ENVIRONMENT: optional(z.string()),
  SENTRY_TRACES_SAMPLE_RATE: optional(z.coerce.number().min(0).max(1)),
  POSTHOG_API_KEY: optional(z.string()),
  POSTHOG_HOST: optional(z.string().url()),

  // AI providers — be permissive on key formats (vendors change prefixes;
  // only enforce min length when the value is actually present; empty-string
  // env values are common from .env files and must be treated as unset).
  ANTHROPIC_API_KEY: optional(z.string().min(20)),
  OPENAI_API_KEY: optional(z.string().min(20)),
  ELEVENLABS_API_KEY: optional(z.string().min(20)),
  ELEVENLABS_DEFAULT_VOICE_ID: optional(z.string()),

  // Document intelligence — `mock` is a dev-only sentinel that means
  // "no real OCR backend wired"; call sites only truthy-check the var
  // (see services/api-gateway/src/routes/scans.router.ts).
  OCR_PROVIDER: optional(
    z.enum(['aws_textract', 'google_vision', 'tesseract', 'none', 'mock']),
  ),
  GOOGLE_APPLICATION_CREDENTIALS: optional(z.string()),
  AWS_TEXTRACT_REGION: optional(z.string()),

  // Payments (TZ) — `true|false` accepted in dev as a mock-mode toggle
  // alongside the real `client_cert|hmac` production modes.
  GEPG_ENV: optional(z.enum(['sandbox', 'production'])),
  GEPG_BASE_URL: optional(z.string().url()),
  GEPG_CALLBACK_BASE_URL: optional(z.string().url()),
  GEPG_HMAC_SECRET: optional(z.string()),
  GEPG_HEALTH_URL: optional(z.string().url()),
  GEPG_PKCS: optional(z.string()),
  GEPG_PSP_MODE: optional(z.enum(['client_cert', 'hmac', 'true', 'false'])),
  GEPG_PUBLIC_CERT_PEM: optional(z.string()),
  GEPG_SP: optional(z.string()),
  GEPG_SP_SYS_ID: optional(z.string()),

  // SMS providers
  AFRICASTALKING_WEBHOOK_SECRET: optional(z.string()),
  META_APP_SECRET: optional(z.string()),
  TWILIO_AUTH_TOKEN: optional(z.string()),

  // Internal keys
  API_KEYS: optional(z.string()),
  API_KEY_REGISTRY: optional(z.string()),
  INTERNAL_API_KEY: optional(z.string()),
  AGENT_CERT_SIGNING_SECRET: optional(z.string()),
  WEBHOOK_DEFAULT_HMAC_SECRET: optional(z.string()),

  // Audit-hash-chain HMAC root (packages/ai-copilot/src/security/audit-hash-chain.ts).
  // When unset the chain degrades to unkeyed SHA-256 which is forge-able by anyone
  // with DB write access. REQUIRED in production. `_PREV` is an optional rotation
  // overlap slot consumed during the 24h soak window (see Docs/SECRETS_ROTATION.md).
  SESSION_HASH_SECRET: optional(
    z.string().min(32, 'SESSION_HASH_SECRET must be at least 32 chars'),
  ),
  SESSION_HASH_SECRET_PREV: optional(
    z.string().min(32, 'SESSION_HASH_SECRET_PREV must be at least 32 chars'),
  ),

  // Inter-service
  API_URL: optional(z.string().url()),
  NOTIFICATIONS_SERVICE_URL: optional(z.string().url()),
  TENANT_SERVICE_URL: optional(z.string().url()),

  // Defaults for tenant bootstrap
  DEFAULT_TENANT_CITY: optional(z.string()),
  DEFAULT_TENANT_COUNTRY: optional(z.string()),
  DEFAULT_TENANT_CURRENCY: optional(z.string().length(3)),
  DEV_DEFAULT_COUNTRY_CODE: optional(z.string().length(2)),

  // Health checks
  DEEP_HEALTH_CACHE_MS: optional(z.coerce.number().int().nonnegative()),

  // Testing / dev
  USE_MOCK_DATA: optional(z.enum(['true', 'false'])),
});

export const EnvSchema = CoreSchema.merge(OptionalSchema);
export type Env = z.infer<typeof EnvSchema>;

/**
 * PRODUCTION_REQUIRED — the full credential set the gateway truly needs to
 * BOOT AND SERVE in production. This is the single source of truth shared by
 * the boot-time assertion below AND the standalone CLIs
 * (`scripts/preflight-production.mjs`, `scripts/set-gh-secrets.mjs`) so the
 * two can never drift.
 *
 * Each entry is one *requirement*. A requirement is satisfied when ANY of its
 * `keys` is present (aliases). The gateway reads the Supabase URL / anon key
 * under either the server-only name OR the `NEXT_PUBLIC_*` name (see
 * `middleware/auth.middleware.ts`, `composition/public-auth-wiring.ts`), so a
 * production deploy that sets only one alias is still complete.
 *
 * `label` is the operator-facing name used in the missing-list / preflight
 * output. `keys[0]` is the canonical name a secret store / GH Actions secret
 * should use.
 */
export interface ProductionRequirement {
  /** Operator-facing requirement label (also the canonical secret name). */
  readonly label: string;
  /** Env keys that satisfy this requirement — present if ANY is non-empty. */
  readonly keys: readonly string[];
  /** One-line why, surfaced in CLI output. */
  readonly why: string;
}

export const PRODUCTION_REQUIRED: readonly ProductionRequirement[] = Object.freeze([
  {
    label: 'DATABASE_URL',
    keys: ['DATABASE_URL'],
    why: 'Primary Postgres connection — gateway cannot reach the DB without it.',
  },
  {
    label: 'JWT_SECRET',
    keys: ['JWT_SECRET'],
    why: 'HS256 access-token signing root (≥ 32 chars).',
  },
  {
    label: 'SUPABASE_URL',
    keys: ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
    why: 'Supabase project URL — server auth + storage. Either alias satisfies.',
  },
  {
    label: 'SUPABASE_ANON_KEY',
    keys: ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    why: 'Supabase anon key — public auth path. Either alias satisfies.',
  },
  {
    label: 'SUPABASE_SERVICE_ROLE_KEY',
    keys: ['SUPABASE_SERVICE_ROLE_KEY'],
    why: 'Server-only key (bypasses RLS) — required by storage + signup wiring.',
  },
  {
    label: 'SUPABASE_JWT_SECRET',
    keys: ['SUPABASE_JWT_SECRET'],
    why: 'Canonical auth — the verified-JWT middleware fails closed without it.',
  },
  {
    label: 'ANTHROPIC_API_KEY',
    keys: ['ANTHROPIC_API_KEY'],
    why: 'Primary LLM provider — the brain kernel cannot think without it.',
  },
  {
    label: 'SESSION_HASH_SECRET',
    keys: ['SESSION_HASH_SECRET'],
    why: 'Audit hash-chain HMAC root — chain degrades to forge-able SHA-256 if unset.',
  },
]);

/**
 * findMissingProductionKeys — pure helper. Given an env source, return the
 * `label`s of every {@link PRODUCTION_REQUIRED} requirement NOT satisfied. A
 * requirement is satisfied when any of its `keys` is a non-empty string.
 *
 * Shared by the boot assertion and the preflight CLI so the required set is
 * computed identically in both places.
 */
export function findMissingProductionKeys(
  source: Record<string, string | undefined> = process.env,
): readonly string[] {
  return PRODUCTION_REQUIRED.filter(
    (req) => !req.keys.some((k) => {
      const v = source[k];
      return typeof v === 'string' && v.trim() !== '';
    }),
  ).map((req) => req.label);
}

export interface ValidatedEnv {
  readonly env: Env;
  readonly warnings: readonly string[];
}

/**
 * Validate process.env at boot. Throws a single clear error if required
 * vars are missing or malformed; returns any non-fatal warnings as a list
 * so the caller can log them through the structured logger.
 */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): ValidatedEnv {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Environment validation failed — gateway cannot boot.\n${issues}\n\n` +
        'See Docs/DEPLOYMENT.md for the full env-var reference.'
    );
  }

  const env = parsed.data;
  const warnings: string[] = [];
  if (env.NODE_ENV === 'production') {
    // PRODUCTION-REQUIRED assertion — fail LOUD, never silent-degrade. Every
    // credential the gateway truly needs to serve must be present; on a miss,
    // throw ONE error that lists EVERY missing requirement by name so the
    // operator fixes the whole set in one pass (not whack-a-mole on reboot).
    // The required set comes from PRODUCTION_REQUIRED (shared with the
    // preflight + set-gh-secrets CLIs) so the two never drift.
    const missing = findMissingProductionKeys(source);
    if (missing.length > 0) {
      const lines = PRODUCTION_REQUIRED
        .filter((req) => missing.includes(req.label))
        .map((req) => `  - ${req.label}: ${req.why}`)
        .join('\n');
      throw new Error(
        'Environment validation failed — gateway cannot boot in production.\n' +
          `Missing ${missing.length} required value(s):\n${lines}\n\n` +
          `Missing keys (copy-paste): ${missing.join(', ')}\n` +
          'Run `node scripts/preflight-production.mjs` for a full readiness report, ' +
          'or `node scripts/set-gh-secrets.mjs` to push present secrets to GitHub Actions.\n' +
          'See scripts/secrets/REQUIRED_SECRETS.md for how to obtain each value.'
      );
    }

    // Production-only nudges: optional-but-strongly-recommended vars.
    const recommend = [
      'SENTRY_DSN',
      'REDIS_URL',
      'ALLOWED_ORIGINS',
      'APP_VERSION',
      'GIT_SHA',
    ] as const;
    for (const k of recommend) {
      if (!env[k]) warnings.push(`env[${k}] not set in production — recommended.`);
    }
    if (env.JWT_SECRET.length < 64) {
      warnings.push(
        'JWT_SECRET is less than 64 chars in production — consider rotating to a 64+ char random secret.'
      );
    }
  } else if (env.NODE_ENV === 'development' && !env.DATABASE_URL.includes('localhost')) {
    warnings.push(
      'env[NODE_ENV]=development but DATABASE_URL does not reference localhost — verify this is a dev DB.'
    );
  }

  return { env, warnings };
}
