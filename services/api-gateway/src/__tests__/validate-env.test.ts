/**
 * validate-env — happy path, required-missing, and production-recommendation
 * coverage.
 */

import { describe, it, expect } from 'vitest';
import { validateEnv } from '../config/validate-env';

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
    const { warnings } = validateEnv({
      ...VALID_BASE,
      NODE_ENV: 'production',
      SESSION_HASH_SECRET: 'a'.repeat(48),
    } as never);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings.some((w) => w.includes('SENTRY_DSN'))).toBe(true);
  });

  it('warns when JWT_SECRET is weak in production', () => {
    const { warnings } = validateEnv({
      ...VALID_BASE,
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(40),
      SENTRY_DSN: 'https://example.ingest.sentry.io/1',
      REDIS_URL: 'redis://localhost',
      ALLOWED_ORIGINS: 'https://borjie.com',
      APP_VERSION: '1.0.0',
      GIT_SHA: 'deadbeef',
      SESSION_HASH_SECRET: 'a'.repeat(48),
    } as never);
    expect(warnings.some((w) => w.includes('JWT_SECRET'))).toBe(true);
  });

  it('throws when SESSION_HASH_SECRET is missing in production', () => {
    expect(() =>
      validateEnv({
        ...VALID_BASE,
        NODE_ENV: 'production',
      } as never)
    ).toThrow(/SESSION_HASH_SECRET/);
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
});
