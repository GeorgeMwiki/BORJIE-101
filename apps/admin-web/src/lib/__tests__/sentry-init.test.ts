/**
 * Admin-web Sentry wrapper — init safety contract.
 *
 * Mirrors `apps/owner-web/src/lib/__tests__/sentry-init.test.ts`. The
 * wrapper must NEVER throw when the DSN is unset (dev boxes) and must
 * degrade to pino logging when the `@sentry/*` package is absent.
 *
 * `NODE_ENV` is pinned to 'production' before the wrapper import so the
 * underlying `createLogger` picks the silent-pino path (the pretty
 * transport is not installed in this workspace's hoist set under
 * vitest's transformed environment).
 */
process.env.NODE_ENV = 'production';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'NEXT_PUBLIC_SENTRY_DSN',
  'NEXT_PUBLIC_BORJIE_PILOT_MODE',
  'BORJIE_PILOT_MODE',
  'NEXT_PUBLIC_GIT_SHA',
] as const;

type SavedEnv = Readonly<Record<(typeof ENV_KEYS)[number], string | undefined>>;

function snapshotEnv(): SavedEnv {
  const snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot as SavedEnv;
}

function restoreEnv(snapshot: SavedEnv): void {
  for (const key of ENV_KEYS) {
    const v = snapshot[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
}

describe('admin-web sentry wrapper init safety', () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = snapshotEnv();
    vi.resetModules();
  });

  afterEach(() => {
    restoreEnv(saved);
    vi.resetModules();
  });

  it('imports without crashing when no DSN is configured', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const mod = await import('../sentry.js');
    expect(typeof mod.initAdminWebSentry).toBe('function');
    expect(typeof mod.captureError).toBe('function');
    expect(typeof mod.captureMessage).toBe('function');
    expect(typeof mod.startTransaction).toBe('function');
  });

  it('initAdminWebSentry resolves without throwing when DSN is unset', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const mod = await import('../sentry.js');
    await expect(mod.initAdminWebSentry()).resolves.toBeUndefined();
  });

  it('initAdminWebSentry resolves without throwing when DSN is set', async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://example@sentry.io/2';
    const mod = await import('../sentry.js');
    await expect(mod.initAdminWebSentry()).resolves.toBeUndefined();
  });

  it('captureError tolerates any error shape without throwing', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const mod = await import('../sentry.js');
    expect(() => mod.captureError(new Error('boom'))).not.toThrow();
    expect(() => mod.captureError('string error')).not.toThrow();
    expect(() => mod.captureError({ weird: 'shape' })).not.toThrow();
  });

  it('startTransaction returns a callable end() under all configurations', async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const mod = await import('../sentry.js');
    const tx = mod.startTransaction('admin-web.test');
    expect(tx.name).toBe('admin-web.test');
    expect(() => tx.end()).not.toThrow();
  });

  it('respects pilot-mode sample rate (no throw with pilot flag set)', async () => {
    process.env.NEXT_PUBLIC_BORJIE_PILOT_MODE = '1';
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const mod = await import('../sentry.js');
    await expect(mod.initAdminWebSentry()).resolves.toBeUndefined();
  });
});
