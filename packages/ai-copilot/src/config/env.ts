/**
 * Brain runtime configuration — strict, fail-fast environment loader.
 *
 * Production policy: NO silent fallbacks. If `ANTHROPIC_API_KEY` is missing
 * the Brain refuses to start; if Supabase variables are missing for the
 * Postgres-backed thread store, the host gets an explicit error rather than
 * silently switching to in-memory.
 *
 * The MockAIProvider remains in the package for unit tests, but it is no
 * longer wired by `createBrain` — callers must opt in explicitly via
 * `createMockBrain` (test surface).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Required env shape
// ---------------------------------------------------------------------------

// Treat empty strings as "unset" for optional URL fields. Operators
// routinely leave `ANTHROPIC_BASE_URL=` in their .env to mean "use the
// provider default"; zod's `.url().optional()` rejects an empty string
// as an invalid URL even though the intent is "no override".
const optionalUrl = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url().optional(),
  );

export const BrainEnvSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(10, 'ANTHROPIC_API_KEY must be set to a real key (sk-ant-...)'),
  ANTHROPIC_BASE_URL: optionalUrl,
  ANTHROPIC_MODEL_DEFAULT: z.string().optional(),

  // Supabase — primary database & auth provider.
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(10),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  /** JWT secret for verifying Supabase access tokens (HS256). */
  SUPABASE_JWT_SECRET: z.string().min(10),

  /** Direct Postgres connection (Supabase pooler / session connection string). */
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (u) => u.startsWith('postgres://') || u.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres connection string'
    ),
});

export type BrainEnv = z.infer<typeof BrainEnvSchema>;

/**
 * Load and validate environment variables. Throws if any required value is
 * missing or malformed. Caller chooses whether this happens at boot
 * (preferred) or lazily on first use.
 */
export function loadBrainEnv(env: NodeJS.ProcessEnv = process.env): BrainEnv {
  const parsed = BrainEnvSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('\n  ');
    throw new BrainConfigError(
      `Brain configuration is invalid:\n  ${missing}\n` +
        '\nThe Borjie Brain refuses to start without real Anthropic + ' +
        'Supabase credentials. Configure your .env (see .env.example) and retry.'
    );
  }
  return parsed.data;
}

/**
 * Custom error class so callers can distinguish missing-config from runtime
 * failures.
 */
export class BrainConfigError extends Error {
  readonly kind = 'BrainConfigError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'BrainConfigError';
  }
}

/**
 * Soft-load — returns null on failure instead of throwing. Used by code paths
 * that need to decide whether the Brain *can* run (e.g. health endpoints) vs.
 * actively run it.
 */
export function tryLoadBrainEnv(
  env: NodeJS.ProcessEnv = process.env
): BrainEnv | null {
  const parsed = BrainEnvSchema.safeParse(env);
  return parsed.success ? parsed.data : null;
}
