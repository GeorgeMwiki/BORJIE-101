/**
 * Test doubles + deterministic fixtures shared across the
 * `@borjie/intel-self-improve` test suite. Live-test only — no mocks
 * (per the spec's testing constraint). Every fixture is frozen and
 * deterministic so failures are reproducible.
 *
 * The logger is the *real* `@borjie/observability` Logger configured
 * with the full TelemetryConfig in `silent` mode (LogLevel.FATAL +
 * consoleExport=false). This matches the spec's
 * `createLogger from @borjie/observability with full TelemetryConfig`
 * constraint while keeping test output clean.
 *
 * @module @borjie/intel-self-improve/__fixtures__/test-doubles
 */

import { createLogger, LogLevel, type Logger } from '@borjie/observability';
import type { Clock, IdGen } from '../wrap/wrap-as-measured.js';

// ---------------------------------------------------------------------------
// Deterministic clock — every `.now()` returns the current cursor
// ---------------------------------------------------------------------------

export function createDeterministicClock(
  startIso = '2026-05-27T08:00:00.000Z',
): Clock & { advance(ms: number): void } {
  let ms = new Date(startIso).getTime();
  return {
    now: () => new Date(ms),
    advance: (delta: number) => {
      ms += delta;
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic UUID generator — returns formatted-stable ids
// ---------------------------------------------------------------------------

export function createSequentialIdGen(): IdGen {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      const hex = counter.toString(16).padStart(12, '0');
      return `00000000-0000-0000-0000-${hex}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Real observability logger — quiet by default for test runs
// ---------------------------------------------------------------------------

export function createTestLogger(): Logger {
  return createLogger({
    service: {
      name: 'intel-self-improve-tests',
      version: '0.1.0',
      environment: 'development',
    },
    enabled: false,
    logLevel: LogLevel.FATAL,
    traceSampleRatio: 0,
    metricsIntervalMs: 60000,
    consoleExport: false,
    redactFields: ['password', 'token', 'secret'],
  });
}

// ---------------------------------------------------------------------------
// Constants used across tests
// ---------------------------------------------------------------------------

export const TEST_TENANT = 'tenant-acme-mining';
export const TEST_CAPABILITY_ID = '11111111-1111-1111-1111-111111111111';
