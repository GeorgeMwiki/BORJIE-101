/**
 * config.test — env-driven validation, defaults, and rejection of
 * malformed values.
 */

import { describe, it, expect } from 'vitest';
import {
  loadConfig,
  DEFAULT_LOCK_ACCEPTANCE_THRESHOLD,
  DEFAULT_LOCK_REVISION_CEILING,
  DEFAULT_LOCK_SUSTAINED_DAYS,
  DEFAULT_IMPROVE_ACCEPTANCE_CEILING,
  DEFAULT_IMPROVE_SECTION_REVISION_THRESHOLD,
  DEFAULT_ROLLING_WINDOW_DAYS,
  DEFAULT_REGULATOR_FLAG_LOOKBACK_DAYS,
  DEFAULT_NIGHTLY_CRON_EXPR,
} from '../config.js';

describe('loadConfig', () => {
  it('returns the spec defaults when no env vars are set', () => {
    const cfg = loadConfig({});
    expect(cfg.ROLLING_WINDOW_DAYS).toBe(DEFAULT_ROLLING_WINDOW_DAYS);
    expect(cfg.LOCK_SUSTAINED_DAYS).toBe(DEFAULT_LOCK_SUSTAINED_DAYS);
    expect(cfg.REGULATOR_FLAG_LOOKBACK_DAYS).toBe(
      DEFAULT_REGULATOR_FLAG_LOOKBACK_DAYS,
    );
    expect(cfg.LOCK_ACCEPTANCE_THRESHOLD).toBe(
      DEFAULT_LOCK_ACCEPTANCE_THRESHOLD,
    );
    expect(cfg.LOCK_REVISION_CEILING).toBe(DEFAULT_LOCK_REVISION_CEILING);
    expect(cfg.IMPROVE_ACCEPTANCE_CEILING).toBe(
      DEFAULT_IMPROVE_ACCEPTANCE_CEILING,
    );
    expect(cfg.IMPROVE_SECTION_REVISION_THRESHOLD).toBe(
      DEFAULT_IMPROVE_SECTION_REVISION_THRESHOLD,
    );
    expect(cfg.NIGHTLY_CRON_EXPR).toBe(DEFAULT_NIGHTLY_CRON_EXPR);
    expect(cfg.ENABLE_CRON).toBe(true);
    expect(cfg.ENABLE_TIER2_QUEUE).toBe(true);
    expect(cfg.ONE_SHOT).toBe(false);
  });

  it('overrides defaults from env', () => {
    const cfg = loadConfig({
      DOC_EVO_ROLLING_WINDOW_DAYS: '30',
      DOC_EVO_LOCK_ACCEPTANCE_THRESHOLD: '0.9',
      DOC_EVO_ONE_SHOT: 'true',
      DOC_EVO_ENABLE_CRON: 'false',
      DOC_EVO_NIGHTLY_CRON_EXPR: '0 4 * * *',
    });
    expect(cfg.ROLLING_WINDOW_DAYS).toBe(30);
    expect(cfg.LOCK_ACCEPTANCE_THRESHOLD).toBe(0.9);
    expect(cfg.ONE_SHOT).toBe(true);
    expect(cfg.ENABLE_CRON).toBe(false);
    expect(cfg.NIGHTLY_CRON_EXPR).toBe('0 4 * * *');
  });

  it('respects DOC_EVO_TIER2_QUEUE_POLL_MS override', () => {
    const cfg = loadConfig({ DOC_EVO_TIER2_QUEUE_POLL_MS: '500' });
    expect(cfg.TIER2_QUEUE_POLL_MS).toBe(500);
  });

  it('throws when an env var fails validation (e.g. negative int)', () => {
    expect(() =>
      loadConfig({ DOC_EVO_ROLLING_WINDOW_DAYS: '-5' }),
    ).toThrow(/invalid/);
  });

  it('ENABLE_TIER2_QUEUE defaults to true and can be disabled via env', () => {
    const cfg = loadConfig({ DOC_EVO_ENABLE_TIER2_QUEUE: 'false' });
    expect(cfg.ENABLE_TIER2_QUEUE).toBe(false);
  });
});
