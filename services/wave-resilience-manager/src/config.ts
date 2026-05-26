/**
 * Env schema for the wave-resilience-manager.
 *
 * Validation is intentionally hand-rolled (no zod runtime dep at this
 * layer) — the only operator-facing knobs are integers + URLs, and
 * we want degraded-mode behaviour when DATABASE_URL is absent (same
 * pattern the other workers use).
 *
 * Founder-locked defaults (Wave 18DD-config) are documented in
 * `Docs/DESIGN/AGENT_SELF_REVIVAL_SPEC.md` § "Founder-locked
 * configuration". Override any value with the matching env var.
 */

import {
  DEFAULT_DETECTOR_INTERVAL_MS,
  DEFAULT_STALE_HEARTBEAT_MS,
  MAX_ATTEMPTS,
} from './types.js';

/** Channels we know how to dispatch unrecoverable escalations to. */
export const NOTIFICATION_CHANNELS = [
  'sms',
  'slack',
  'email',
  'logger',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Per-repo vs unified cross-repo ledger semantics (founder decision #4). */
export const CROSS_REPO_LEDGER_MODES = ['per_repo', 'unified'] as const;
export type CrossRepoLedgerMode = (typeof CROSS_REPO_LEDGER_MODES)[number];

/** Founder-locked default: industry-standard retry budget per 24h. */
export const DEFAULT_DAILY_REVIVAL_BUDGET = 50 as const;

export interface TwilioConfig {
  readonly accountSid: string | null;
  readonly authToken: string | null;
  readonly fromNumber: string | null;
  readonly operatorNumber: string | null;
}

export interface ResilienceManagerConfig {
  readonly databaseUrl: string | null;
  readonly port: number;
  readonly host: string;
  readonly detectorIntervalMs: number;
  readonly staleHeartbeatMs: number;
  readonly maxAttempts: number;
  readonly dailyRevivalBudget: number;
  readonly autoMergeResumedCommits: boolean;
  readonly notificationChannel: NotificationChannel;
  readonly crossRepoLedgerMode: CrossRepoLedgerMode;
  readonly twilio: TwilioConfig;
  readonly slackWebhookUrl: string | null;
  readonly resendApiKey: string | null;
  readonly operatorEmail: string | null;
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

/**
 * Read a boolean env var. Accepts 1/0, true/false, yes/no
 * (case-insensitive). Falls back on absence / parse failure.
 */
function readBoolEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const raw = env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function readEnumEnv<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  const raw = env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  return (allowed as ReadonlyArray<string>).includes(raw) ? (raw as T) : fallback;
}

function readOptionalString(
  env: NodeJS.ProcessEnv,
  name: string,
): string | null {
  const raw = env[name];
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw;
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
  const dailyRevivalBudget = readIntEnv(
    env,
    'WAVE_RESILIENCE_DAILY_BUDGET',
    DEFAULT_DAILY_REVIVAL_BUDGET,
  );
  const autoMergeResumedCommits = readBoolEnv(
    env,
    'WAVE_RESILIENCE_AUTO_MERGE_RESUMED_COMMITS',
    true,
  );
  const notificationChannel = readEnumEnv<NotificationChannel>(
    env,
    'WAVE_RESILIENCE_NOTIFICATION_CHANNEL',
    NOTIFICATION_CHANNELS,
    'email',
  );
  const crossRepoLedgerMode = readEnumEnv<CrossRepoLedgerMode>(
    env,
    'WAVE_RESILIENCE_CROSS_REPO_LEDGER_MODE',
    CROSS_REPO_LEDGER_MODES,
    'per_repo',
  );

  const twilio: TwilioConfig = {
    accountSid: readOptionalString(env, 'TWILIO_ACCOUNT_SID'),
    authToken: readOptionalString(env, 'TWILIO_AUTH_TOKEN'),
    fromNumber: readOptionalString(env, 'TWILIO_FROM_NUMBER'),
    operatorNumber: readOptionalString(env, 'OPERATOR_PHONE_NUMBER'),
  };

  return {
    databaseUrl,
    port,
    host,
    detectorIntervalMs,
    staleHeartbeatMs,
    maxAttempts: Math.max(1, maxAttempts),
    dailyRevivalBudget: Math.max(1, dailyRevivalBudget),
    autoMergeResumedCommits,
    notificationChannel,
    crossRepoLedgerMode,
    twilio,
    slackWebhookUrl: readOptionalString(env, 'SLACK_WEBHOOK_URL'),
    resendApiKey: readOptionalString(env, 'RESEND_API_KEY'),
    operatorEmail: readOptionalString(env, 'OPERATOR_EMAIL'),
    degraded: databaseUrl === null,
  };
}
