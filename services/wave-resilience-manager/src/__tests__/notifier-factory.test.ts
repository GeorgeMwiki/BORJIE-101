import { describe, it, expect } from 'vitest';
import { createNotifier } from '../notification/notifier-factory.js';
import { loadConfig, type ResilienceManagerConfig } from '../config.js';
import type { ResilienceLogger } from '../types.js';

function silentLogger(): ResilienceLogger & {
  readonly warns: ReadonlyArray<{ readonly obj: Record<string, unknown> }>;
} {
  const warns: Array<{ obj: Record<string, unknown> }> = [];
  return {
    warns,
    info() {},
    warn(obj) {
      warns.push({ obj });
    },
    error() {},
  };
}

function configWith(env: NodeJS.ProcessEnv): ResilienceManagerConfig {
  return loadConfig(env);
}

describe('createNotifier (factory)', () => {
  it('returns the SMS notifier when channel=sms and Twilio creds present', () => {
    const config = configWith({
      WAVE_RESILIENCE_NOTIFICATION_CHANNEL: 'sms',
      TWILIO_ACCOUNT_SID: 'AC',
      TWILIO_AUTH_TOKEN: 'tok',
      TWILIO_FROM_NUMBER: '+1',
      OPERATOR_PHONE_NUMBER: '+2',
    });
    const resolved = createNotifier({ config, logger: silentLogger() });
    expect(resolved.channel).toBe('sms');
    expect(resolved.degraded).toBe(false);
  });

  it('degrades sms → logger when Twilio creds are missing', () => {
    const config = configWith({
      WAVE_RESILIENCE_NOTIFICATION_CHANNEL: 'sms',
      // (no twilio env)
    });
    const logger = silentLogger();
    const resolved = createNotifier({ config, logger });
    expect(resolved.channel).toBe('logger');
    expect(resolved.degraded).toBe(true);
    expect(logger.warns.length).toBe(1);
  });

  it('returns the Slack notifier when channel=slack and webhook present', () => {
    const config = configWith({
      WAVE_RESILIENCE_NOTIFICATION_CHANNEL: 'slack',
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/x/y/z',
    });
    const resolved = createNotifier({ config, logger: silentLogger() });
    expect(resolved.channel).toBe('slack');
    expect(resolved.degraded).toBe(false);
  });

  it('degrades slack → logger when webhook is missing', () => {
    const config = configWith({
      WAVE_RESILIENCE_NOTIFICATION_CHANNEL: 'slack',
    });
    const resolved = createNotifier({ config, logger: silentLogger() });
    expect(resolved.channel).toBe('logger');
    expect(resolved.degraded).toBe(true);
  });

  it('returns the email notifier when channel=email and creds present', () => {
    const config = configWith({
      WAVE_RESILIENCE_NOTIFICATION_CHANNEL: 'email',
      RESEND_API_KEY: 're_test',
      OPERATOR_EMAIL: 'ops@borjie.com',
    });
    const resolved = createNotifier({ config, logger: silentLogger() });
    expect(resolved.channel).toBe('email');
    expect(resolved.degraded).toBe(false);
  });

  it('degrades email → logger when creds are missing', () => {
    const config = configWith({
      WAVE_RESILIENCE_NOTIFICATION_CHANNEL: 'email',
      RESEND_API_KEY: 're_test',
      // OPERATOR_EMAIL missing
    });
    const resolved = createNotifier({ config, logger: silentLogger() });
    expect(resolved.channel).toBe('logger');
    expect(resolved.degraded).toBe(true);
  });

  it('returns the logger notifier when channel=logger (no degrade flag)', () => {
    const config = configWith({
      WAVE_RESILIENCE_NOTIFICATION_CHANNEL: 'logger',
    });
    const resolved = createNotifier({ config, logger: silentLogger() });
    expect(resolved.channel).toBe('logger');
    expect(resolved.degraded).toBe(false);
  });

  it('defaults to sms when env is unset (founder-locked default)', () => {
    const config = configWith({});
    expect(config.notificationChannel).toBe('sms');
    // No Twilio creds in default env → degrades to logger.
    const resolved = createNotifier({ config, logger: silentLogger() });
    expect(resolved.channel).toBe('logger');
    expect(resolved.degraded).toBe(true);
  });
});

describe('config — founder-locked defaults', () => {
  it('locks the five founder defaults', () => {
    const cfg = loadConfig({});
    expect(cfg.detectorIntervalMs).toBe(60_000);
    expect(cfg.staleHeartbeatMs).toBe(5 * 60_000);
    expect(cfg.maxAttempts).toBe(3);
    expect(cfg.dailyRevivalBudget).toBe(50);
    expect(cfg.autoMergeResumedCommits).toBe(true);
    expect(cfg.notificationChannel).toBe('sms');
    expect(cfg.crossRepoLedgerMode).toBe('per_repo');
  });

  it('respects WAVE_RESILIENCE_AUTO_MERGE_RESUMED_COMMITS=false', () => {
    const cfg = loadConfig({
      WAVE_RESILIENCE_AUTO_MERGE_RESUMED_COMMITS: 'false',
    });
    expect(cfg.autoMergeResumedCommits).toBe(false);
  });

  it('respects WAVE_RESILIENCE_DAILY_BUDGET override', () => {
    const cfg = loadConfig({ WAVE_RESILIENCE_DAILY_BUDGET: '25' });
    expect(cfg.dailyRevivalBudget).toBe(25);
  });

  it('clamps daily budget to a positive integer', () => {
    const cfg = loadConfig({ WAVE_RESILIENCE_DAILY_BUDGET: '0' });
    expect(cfg.dailyRevivalBudget).toBeGreaterThanOrEqual(1);
  });

  it('falls back to per_repo on garbage ledger-mode env', () => {
    const cfg = loadConfig({
      WAVE_RESILIENCE_CROSS_REPO_LEDGER_MODE: 'banana',
    });
    expect(cfg.crossRepoLedgerMode).toBe('per_repo');
  });
});
