/**
 * validate-env — happy path, required-missing, and production-recommendation
 * coverage.
 */

import { describe, it, expect } from 'vitest';
import {
  validateEnv,
  findMissingProductionKeys,
  PRODUCTION_REQUIRED,
} from '../config/validate-env';

/**
 * A FULLY production-ready env: every PRODUCTION_REQUIRED requirement present.
 * Individual prod tests strip one key from this to assert it surfaces.
 */
const PROD_COMPLETE = {
  NODE_ENV: 'production' as const,
  DATABASE_URL: 'postgres://user:pass@prod-db.example.com:5432/db',
  JWT_SECRET: 'j'.repeat(64),
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key-value',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-value',
  SUPABASE_JWT_SECRET: 's'.repeat(48),
  ANTHROPIC_API_KEY: 'sk-ant-' + 'x'.repeat(40),
  SESSION_HASH_SECRET: 'a'.repeat(48),
  // Recommended (silence prod warnings so tests assert only on the throw path)
  SENTRY_DSN: 'https://example.ingest.sentry.io/1',
  REDIS_URL: 'redis://localhost',
  ALLOWED_ORIGINS: 'https://borjie.com',
  APP_VERSION: '1.0.0',
  GIT_SHA: 'deadbeef',
};

const VALID_BASE = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(64),
  NODE_ENV: 'development' as const,
};

describe('validate-env', () => {
  it('passes with minimal valid env', () => {
    const { env, warnings } = validateEnv(VALID_BASE as never);
    expect(env.DATABASE_URL).toContain('postgres://');
    expect(env.JWT_SECRET).toHaveLength(64);
    expect(warnings).toEqual([]);
  });

  it('throws a clear error if DATABASE_URL is missing', () => {
    expect(() =>
      validateEnv({ JWT_SECRET: 'a'.repeat(64) } as never)
    ).toThrow(/DATABASE_URL/);
  });

  it('throws a clear error if JWT_SECRET is missing', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: VALID_BASE.DATABASE_URL } as never)
    ).toThrow(/JWT_SECRET/);
  });

  it('rejects a malformed DATABASE_URL', () => {
    expect(() =>
      validateEnv({ ...VALID_BASE, DATABASE_URL: 'redis://oops' } as never)
    ).toThrow(/postgres:\/\//);
  });

  it('rejects a too-short JWT_SECRET', () => {
    expect(() =>
      validateEnv({ ...VALID_BASE, JWT_SECRET: 'short' } as never)
    ).toThrow(/at least 32 characters/);
  });

  it('coerces PORT and defaults NODE_ENV', () => {
    const { env } = validateEnv({
      DATABASE_URL: VALID_BASE.DATABASE_URL,
      JWT_SECRET: VALID_BASE.JWT_SECRET,
      PORT: '8080',
    } as never);
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe('development');
  });

  it('emits production-env warnings for missing recommended vars', () => {
    // Fully-required env, but strip the *recommended* SENTRY_DSN so the
    // warning path (not the throw path) is exercised.
    const { SENTRY_DSN: _omit, ...withoutSentry } = PROD_COMPLETE;
    const { warnings } = validateEnv(withoutSentry as never);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes('SENTRY_DSN'))).toBe(true);
  });

  it('warns when JWT_SECRET is weak in production', () => {
    const { warnings } = validateEnv({
      ...PROD_COMPLETE,
      JWT_SECRET: 'a'.repeat(40),
    } as never);
    expect(warnings.some((w) => w.includes('JWT_SECRET'))).toBe(true);
  });

  it('throws when SESSION_HASH_SECRET is missing in production', () => {
    const { SESSION_HASH_SECRET: _omit, ...withoutHash } = PROD_COMPLETE;
    expect(() => validateEnv(withoutHash as never)).toThrow(/SESSION_HASH_SECRET/);
  });

  it('rejects a too-short SESSION_HASH_SECRET when provided', () => {
    expect(() =>
      validateEnv({
        ...VALID_BASE,
        SESSION_HASH_SECRET: 'too-short',
      } as never)
    ).toThrow(/SESSION_HASH_SECRET/);
  });

  it('accepts a valid SESSION_HASH_SECRET + optional _PREV', () => {
    const { env } = validateEnv({
      ...VALID_BASE,
      SESSION_HASH_SECRET: 'a'.repeat(48),
      SESSION_HASH_SECRET_PREV: 'b'.repeat(48),
    } as never);
    expect(env.SESSION_HASH_SECRET).toBe('a'.repeat(48));
    expect(env.SESSION_HASH_SECRET_PREV).toBe('b'.repeat(48));
  });

  it('warns when dev env points at a non-localhost DB', () => {
    const { warnings } = validateEnv({
      ...VALID_BASE,
      DATABASE_URL: 'postgres://u:p@prod-db.example.com:5432/app',
    } as never);
    expect(warnings.some((w) => w.includes('localhost'))).toBe(true);
  });

  // N4 (2026-05-29) regression — `.env.local` ships blank optional keys
  // (KEY=) as self-documenting placeholders. Previously every blank value
  // hit `z.coerce.number()` / `z.string().url()` / `z.enum(...)` and
  // crashed boot. The `optional()` helper now treats `""` as unset.
  it('treats empty-string optional values as unset (N4)', () => {
    const { env } = validateEnv({
      ...VALID_BASE,
      JWT_ACCESS_SECRET: '',
      RATE_LIMIT_WINDOW_MS: '',
      BORJIE_BG_TASKS_ENABLED: '',
      SENTRY_DSN: '',
      GEPG_CALLBACK_BASE_URL: '',
      GEPG_HEALTH_URL: '',
      NOTIFICATIONS_SERVICE_URL: '',
      DEV_DEFAULT_COUNTRY_CODE: '',
    } as never);
    expect(env.JWT_ACCESS_SECRET).toBeUndefined();
    expect(env.RATE_LIMIT_WINDOW_MS).toBeUndefined();
    expect(env.BORJIE_BG_TASKS_ENABLED).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.GEPG_CALLBACK_BASE_URL).toBeUndefined();
    expect(env.GEPG_HEALTH_URL).toBeUndefined();
    expect(env.NOTIFICATIONS_SERVICE_URL).toBeUndefined();
    expect(env.DEV_DEFAULT_COUNTRY_CODE).toBeUndefined();
  });

  it('accepts dev sentinels OCR_PROVIDER=mock + GEPG_PSP_MODE=true|false (N4)', () => {
    const { env } = validateEnv({
      ...VALID_BASE,
      OCR_PROVIDER: 'mock',
      GEPG_PSP_MODE: 'true',
    } as never);
    expect(env.OCR_PROVIDER).toBe('mock');
    expect(env.GEPG_PSP_MODE).toBe('true');
  });

  // ---------------------------------------------------------------------------
  // PRODUCTION-REQUIRED assertion (LANE 2 — fail-loud preflight)
  // ---------------------------------------------------------------------------
  describe('production-required assertion', () => {
    it('accepts a fully-provisioned production env', () => {
      const { env, warnings } = validateEnv(PROD_COMPLETE as never);
      expect(env.NODE_ENV).toBe('production');
      // Fully-provisioned ⇒ no missing-key throw; recommended vars all set ⇒
      // no warnings either.
      expect(warnings).toEqual([]);
    });

    it('throws ONE error listing EVERY missing required key in production', () => {
      // Strip three required values: SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY,
      // and SUPABASE_JWT_SECRET.
      const {
        SUPABASE_SERVICE_ROLE_KEY: _a,
        ANTHROPIC_API_KEY: _b,
        SUPABASE_JWT_SECRET: _c,
        ...partial
      } = PROD_COMPLETE;
      let thrown: Error | undefined;
      try {
        validateEnv(partial as never);
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).toBeInstanceOf(Error);
      const msg = thrown!.message;
      // All three missing keys named in the single error.
      expect(msg).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(msg).toContain('ANTHROPIC_API_KEY');
      expect(msg).toContain('SUPABASE_JWT_SECRET');
      // A copy-pasteable missing list.
      expect(msg).toMatch(/Missing keys \(copy-paste\):/);
      expect(msg).toMatch(/Missing 3 required value/);
    });

    it('treats either Supabase URL alias as satisfying the URL requirement', () => {
      const { SUPABASE_URL: _omit, ...withPublicAlias } = PROD_COMPLETE;
      expect(() =>
        validateEnv({
          ...withPublicAlias,
          NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
        } as never)
      ).not.toThrow();
    });

    it('treats either anon-key alias as satisfying the anon-key requirement', () => {
      const { SUPABASE_ANON_KEY: _omit, ...withPublicAlias } = PROD_COMPLETE;
      expect(() =>
        validateEnv({
          ...withPublicAlias,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-value',
        } as never)
      ).not.toThrow();
    });

    it('treats empty-string required values as missing in production', () => {
      expect(() =>
        validateEnv({ ...PROD_COMPLETE, ANTHROPIC_API_KEY: '   ' } as never)
      ).toThrow(/ANTHROPIC_API_KEY/);
    });

    it('does NOT apply the production gate in dev/test (missing keys ok)', () => {
      // Dev env with only the two CoreSchema keys — none of the extra prod
      // requirements present, yet validation passes.
      expect(() => validateEnv(VALID_BASE as never)).not.toThrow();
      expect(() =>
        validateEnv({ ...VALID_BASE, NODE_ENV: 'test' } as never)
      ).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // findMissingProductionKeys — pure helper shared with the preflight CLI
  // ---------------------------------------------------------------------------
  describe('findMissingProductionKeys', () => {
    it('returns [] when every requirement is satisfied', () => {
      expect(findMissingProductionKeys(PROD_COMPLETE)).toEqual([]);
    });

    it('returns the labels of every unsatisfied requirement', () => {
      const missing = findMissingProductionKeys({
        DATABASE_URL: 'postgres://x@localhost/db',
      });
      // 7 of the 8 requirements are missing (only DATABASE_URL is present).
      expect(missing).toContain('JWT_SECRET');
      expect(missing).toContain('SUPABASE_URL');
      expect(missing).toContain('ANTHROPIC_API_KEY');
      expect(missing).not.toContain('DATABASE_URL');
      expect(missing).toHaveLength(PRODUCTION_REQUIRED.length - 1);
    });

    it('counts an alias as satisfying its requirement', () => {
      const missing = findMissingProductionKeys({
        NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
      });
      expect(missing).not.toContain('SUPABASE_URL');
    });
  });
});
