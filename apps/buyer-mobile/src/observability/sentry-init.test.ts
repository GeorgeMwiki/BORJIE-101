/**
 * Buyer-mobile Sentry wrapper — init safety contract.
 *
 * Twin of `apps/workforce-mobile/src/observability/sentry-init.test.ts`.
 * Verifies the wrapper imports cleanly, init resolves under the no-DSN
 * path, and capture helpers tolerate any input without throwing.
 *
 * `@borjie/observability`'s createLogger is mocked because pino's
 * `pino-pretty` transport isn't installed in this workspace's hoist
 * set under vitest — the real logger tries to resolve it during
 * import and crashes the test file. The mock returns a no-op logger
 * with the same shape so the wrapper's `state.logger.info(...)` calls
 * still type-check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@borjie/observability', () => {
  const noop = () => {};
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
  };
  return {
    createLogger: () => logger,
    buildPilotEventContext: (input: {
      readonly pilotUserId?: string;
      readonly pilotCohort?: string;
      readonly replaySessionId?: string;
    }) => {
      const tags: Record<string, string> = {};
      const extra: Record<string, string> = {};
      if (input?.pilotUserId) tags.pilot_user_id = input.pilotUserId;
      if (input?.pilotCohort) tags.pilot_cohort = input.pilotCohort;
      if (input?.replaySessionId) extra.replay_session_id = input.replaySessionId;
      return { tags, extra, tracesSampleRate: 0.1 };
    },
    resolvePilotSampleRate: () => 0.1,
  };
});

import {
  initBuyerMobileSentry,
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

describe('buyer-mobile sentry wrapper init safety', () => {
  let saved: SavedEnv;

  beforeEach(() => {
    saved = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(saved);
  });

  it('exports the wrapper surface without crashing', () => {
    expect(typeof initBuyerMobileSentry).toBe('function');
    expect(typeof captureError).toBe('function');
    expect(typeof captureMessage).toBe('function');
    expect(typeof startTransaction).toBe('function');
    expect(typeof setPilotUser).toBe('function');
  });

  it('initBuyerMobileSentry resolves without throwing when DSN is unset', async () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    await expect(initBuyerMobileSentry()).resolves.toBeUndefined();
  });

  it('captureError tolerates any error shape under no-DSN path', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    expect(() => captureError(new Error('boom'))).not.toThrow();
    expect(() => captureError('string error')).not.toThrow();
    expect(() => captureError({ unexpected: 'object' })).not.toThrow();
  });

  it('startTransaction returns a callable end() function', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    const tx = startTransaction('buyer-mobile.test');
    expect(tx.name).toBe('buyer-mobile.test');
    expect(() => tx.end()).not.toThrow();
  });

  it('respects pilot-mode flag without throwing', async () => {
    process.env.EXPO_PUBLIC_BORJIE_PILOT_MODE = '1';
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    await expect(initBuyerMobileSentry()).resolves.toBeUndefined();
  });

  it('setPilotUser does not throw when called before init', () => {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    expect(() => setPilotUser('pilot-1', 'tanzanite-beta')).not.toThrow();
  });
});
