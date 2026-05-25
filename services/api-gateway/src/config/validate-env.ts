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
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  APP_VERSION: z.string().default('dev'),
  GIT_SHA: z.string().optional(),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // Auth — additional JWT knobs
  JWT_ACCESS_SECRET: z.string().min(32).optional(),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  // P84 audit: JWT_ISSUER + JWT_AUDIENCE are validated here (dev/test
  // default ok) but the live auth middleware (auth.middleware.ts) fails
  // fast in production when unset, per BUG-HI-4. Default was
  // 'borjie-client' here but 'borjie-api' in the middleware —
  // aligned to 'borjie-api' so tokens issued under the validated
  // env match the verifier when neither is explicitly configured.
  JWT_ISSUER: z.string().default('borjie'),
  JWT_AUDIENCE: z.string().default('borjie-api'),

  // CORS
  ALLOWED_ORIGINS: z.string().optional(),

  // Transport
  REDIS_URL: z.string().url().optional(),

  // Rate limit
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().optional(),

  // Outbox / background workers
  OUTBOX_WORKER_DISABLED: z.enum(['true', 'false']).optional(),
  OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().optional(),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().optional(),
  BORJIE_BG_TASKS_ENABLED: z.enum(['true', 'false']).optional(),

  // Observability
  SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  POSTHOG_API_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().url().optional(),

  // AI providers — be permissive on key formats (vendors change prefixes;
  // only enforce min length when the value is actually present; empty-string
  // env values are common from .env files and must be treated as unset).
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().min(20).optional()
  ),
  OPENAI_API_KEY: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().min(20).optional()
  ),
  ELEVENLABS_API_KEY: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().min(20).optional()
  ),
  ELEVENLABS_DEFAULT_VOICE_ID: z.string().optional(),

  // Document intelligence
  OCR_PROVIDER: z.enum(['aws_textract', 'google_vision', 'tesseract', 'none']).optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  AWS_TEXTRACT_REGION: z.string().optional(),

  // Payments (TZ)
  GEPG_ENV: z.enum(['sandbox', 'production']).optional(),
  GEPG_BASE_URL: z.string().url().optional(),
  GEPG_CALLBACK_BASE_URL: z.string().url().optional(),
  GEPG_HMAC_SECRET: z.string().optional(),
  GEPG_HEALTH_URL: z.string().url().optional(),
  GEPG_PKCS: z.string().optional(),
  GEPG_PSP_MODE: z.enum(['client_cert', 'hmac']).optional(),
  GEPG_PUBLIC_CERT_PEM: z.string().optional(),
  GEPG_SP: z.string().optional(),
  GEPG_SP_SYS_ID: z.string().optional(),

  // SMS providers
  AFRICASTALKING_WEBHOOK_SECRET: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),

  // Internal keys
  API_KEYS: z.string().optional(),
  API_KEY_REGISTRY: z.string().optional(),
  INTERNAL_API_KEY: z.string().optional(),
  AGENT_CERT_SIGNING_SECRET: z.string().optional(),
  WEBHOOK_DEFAULT_HMAC_SECRET: z.string().optional(),

  // Audit-hash-chain HMAC root (packages/ai-copilot/src/security/audit-hash-chain.ts).
  // When unset the chain degrades to unkeyed SHA-256 which is forge-able by anyone
  // with DB write access. REQUIRED in production. `_PREV` is an optional rotation
  // overlap slot consumed during the 24h soak window (see Docs/SECRETS_ROTATION.md).
  SESSION_HASH_SECRET: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().min(32, 'SESSION_HASH_SECRET must be at least 32 chars').optional(),
  ),
  SESSION_HASH_SECRET_PREV: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.string().min(32, 'SESSION_HASH_SECRET_PREV must be at least 32 chars').optional(),
  ),

  // Inter-service
  API_URL: z.string().url().optional(),
  NOTIFICATIONS_SERVICE_URL: z.string().url().optional(),
  TENANT_SERVICE_URL: z.string().url().optional(),

  // Defaults for tenant bootstrap
  DEFAULT_TENANT_CITY: z.string().optional(),
  DEFAULT_TENANT_COUNTRY: z.string().optional(),
  DEFAULT_TENANT_CURRENCY: z.string().length(3).optional(),
  DEV_DEFAULT_COUNTRY_CODE: z.string().length(2).optional(),

  // Health checks
  DEEP_HEALTH_CACHE_MS: z.coerce.number().int().nonnegative().optional(),

  // Testing / dev
  USE_MOCK_DATA: z.enum(['true', 'false']).optional(),
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
