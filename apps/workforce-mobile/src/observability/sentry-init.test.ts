/**
 * Workforce-mobile Sentry wrapper — init safety contract.
 *
 * The mobile wrapper falls back to console logging when
 * `@sentry/react-native` is absent. Once the dep is installed the
 * `require()` in `loadSentry()` resolves and the wrapper auto-upgrades.
 * These tests verify the wrapper imports without crashing and the
 * capture helpers tolerate any input under the no-DSN path.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initWorkforceMobileSentry,
  captureError,
  captureMessage,
  startTransaction,
  setPilotUser,
} from './sentry';

const ENV_KEYS = [
  'EXPO_PUBLIC_SENTRY_DSN',
  'EXPO_PUBLIC_BORJIE_PILOT_MODE',
  'BORJIE_PILOT_MODE',
  'EXPO_PUBLIC_GIT_SHA',
] as const;

type SavedEnv = Readonly<
  Record<(typeof ENV_KEYS)[number], string | undefined>
>;

function snapshotEnv(): SavedEnv {
  const snapshot: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {};
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

describe('workforce-mobile sentry wrapper init safety', () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it('exports the wrapper surface without crashing', () => {
    expect(typeof initWorkforceMobileSentry).toBe('function');
    expect(typeof captureError).toBe('function');
    expect(typeof captureMessage).toBe('function');
    expect(typeof startTransaction).toBe('function');
    expect(typeof setPilotUser).toBe('function');
  });

  it('initWorkforceMobileSentry resolves without throwing when DSN is unset', async () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    await expect(initWorkforceMobileSentry()).resolves.toBeUndefined();
  });

  it('captureError tolerates any error shape under no-DSN path', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    expect(() => captureError(new Error('boom'))).not.toThrow();
    expect(() => captureError('string error')).not.toThrow();
    expect(() => captureError({ unexpected: 'object' })).not.toThrow();
  });

  it('startTransaction returns a callable end() function', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    const tx = startTransaction('workforce-mobile.test');
    expect(tx.name).toBe('workforce-mobile.test');
    expect(() => tx.end()).not.toThrow();
  });

  it('respects pilot-mode flag without throwing', async () => {
    process.env.EXPO_PUBLIC_BORJIE_PILOT_MODE = '1';
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    await expect(initWorkforceMobileSentry()).resolves.toBeUndefined();
  });

  it('setPilotUser does not throw when called before init', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    expect(() => setPilotUser('pilot-1', 'ferengi-alpha')).not.toThrow();
  });
});
