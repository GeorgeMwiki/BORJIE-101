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
    // Audit-hash-chain HMAC root — REQUIRED in production. The chain silently
    // degrades to unkeyed SHA-256 when unset (forge-able with DB write access).
    if (!env.SESSION_HASH_SECRET) {
      throw new Error(
        'Environment validation failed — gateway cannot boot.\n' +
          '  - SESSION_HASH_SECRET: required in production (≥ 32 chars). ' +
          'Generate with `openssl rand -base64 48`. ' +
          'Without it, the audit hash chain falls back to unsigned SHA-256.\n\n' +
          'See Docs/SECRETS_ROTATION.md for rotation policy.'
      );
    }
  } else if (env.NODE_ENV === 'development' && !env.DATABASE_URL.includes('localhost')) {
    warnings.push(
      'env[NODE_ENV]=development but DATABASE_URL does not reference localhost — verify this is a dev DB.'
    );
  }

  return { env, warnings };
}
