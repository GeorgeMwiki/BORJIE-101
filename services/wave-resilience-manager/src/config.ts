/**
 * Env schema for the wave-resilience-manager.
 *
 * Validation is intentionally hand-rolled (no zod runtime dep at this
 * layer) — the only operator-facing knobs are integers + URLs, and
 * we want degraded-mode behaviour when DATABASE_URL is absent (same
 * pattern the other workers use).
 */

import {
  DEFAULT_DETECTOR_INTERVAL_MS,
  DEFAULT_STALE_HEARTBEAT_MS,
  MAX_ATTEMPTS,
} from './types.js';

export interface ResilienceManagerConfig {
  readonly databaseUrl: string | null;
  readonly port: number;
  readonly host: string;
  readonly detectorIntervalMs: number;
  readonly staleHeartbeatMs: number;
  readonly maxAttempts: number;
  /** When true, the manager runs in degraded mode (no DB). */
  readonly degraded: boolean;
}

const DEFAULTS = {
  port: 4090,
  host: '0.0.0.0',
} as const;

/**
 * Read a non-negative integer env var, falling back to `fallback` on
 * absence / parse failure.
 */
function readIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): ResilienceManagerConfig {
  const databaseUrl =
    typeof env['DATABASE_URL'] === 'string' && env['DATABASE_URL'].length > 0
      ? env['DATABASE_URL']
      : null;
  const port = readIntEnv(env, 'PORT', DEFAULTS.port);
  const host = env['HOST'] ?? DEFAULTS.host;
  const detectorIntervalMs = readIntEnv(
    env,
    'WAVE_RESILIENCE_DETECTOR_INTERVAL_MS',
    DEFAULT_DETECTOR_INTERVAL_MS,
  );
  const staleHeartbeatMs = readIntEnv(
    env,
    'WAVE_RESILIENCE_STALE_HEARTBEAT_MS',
    DEFAULT_STALE_HEARTBEAT_MS,
  );
  const maxAttempts = readIntEnv(
    env,
    'WAVE_RESILIENCE_MAX_ATTEMPTS',
    MAX_ATTEMPTS,
  );

  return {
    databaseUrl,
    port,
    host,
    detectorIntervalMs,
    staleHeartbeatMs,
    maxAttempts: Math.max(1, maxAttempts),
    degraded: databaseUrl === null,
  };
}
