import { describe, it, expect } from 'vitest';
import { decideSchedule } from '../connector-base/sync-scheduler.js';
import type { OmnidataConnectorMetadata, RefreshPolicy } from '../types.js';

function makeMeta(refreshPolicy: RefreshPolicy): OmnidataConnectorMetadata {
  return {
    id: 'x:1',
    sourceKind: 'slack',
    displayName: 'X',
    description: 'X',
    phase: 'P0',
    volumeClass: 'light',
    refreshPolicy,
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  };
}

const fixedNow = '2026-05-26T12:00:00.000Z';
const clock = { nowIso: () => fixedNow };

describe('decideSchedule', () => {
  it('forces a run when forceRun is true', () => {
    const result = decideSchedule(
      { meta: makeMeta({ kind: 'on-demand' }), lastSyncedAt: null, forceRun: true },
      clock,
    );
    expect(result.kind).toBe('run-now');
  });

  it('returns run-now for first-time realtime sync', () => {
    const result = decideSchedule(
      { meta: makeMeta({ kind: 'realtime', webhookSecret: 's' }), lastSyncedAt: null },
      clock,
    );
    expect(result.kind).toBe('run-now');
    if (result.kind === 'run-now') {
      expect(result.reason).toBe('no-prior-sync');
    }
  });

  it('defers realtime when there is a prior sync (webhook-driven)', () => {
    const result = decideSchedule(
      {
        meta: makeMeta({ kind: 'realtime', webhookSecret: 's' }),
        lastSyncedAt: '2026-05-26T11:00:00.000Z',
      },
      clock,
    );
    expect(result.kind).toBe('defer');
  });

  it('defers pushed when there is a prior sync (subscription-driven)', () => {
    const result = decideSchedule(
      {
        meta: makeMeta({ kind: 'pushed', subscriptionToken: 'tok' }),
        lastSyncedAt: '2026-05-26T11:00:00.000Z',
      },
      clock,
    );
    expect(result.kind).toBe('defer');
  });

  it('runs cron when due', () => {
    const result = decideSchedule(
      {
        meta: makeMeta({ kind: 'cron', cron: '*/5 * * * *', maxRowsPerRun: 100 }),
        lastSyncedAt: '2026-05-26T11:00:00.000Z',
      },
      clock,
    );
    expect(result.kind).toBe('run-now');
    if (result.kind === 'run-now') {
      expect(result.reason).toBe('cron-due');
    }
  });

  it('defers cron when next-due is in the future', () => {
    const result = decideSchedule(
      {
        meta: makeMeta({ kind: 'cron', cron: '*/5 * * * *', maxRowsPerRun: 100 }),
        lastSyncedAt: '2026-05-26T11:59:00.000Z',
      },
      clock,
    );
    expect(result.kind).toBe('defer');
  });

  it('parses daily cron at fixed hour', () => {
    const result = decideSchedule(
      {
        meta: makeMeta({ kind: 'cron', cron: '0 6 * * *', maxRowsPerRun: 200 }),
        lastSyncedAt: '2026-05-26T05:00:00.000Z',
      },
      clock,
    );
    // last sync at 05:00, next due 06:00 ≤ now 12:00 → run-now
    expect(result.kind).toBe('run-now');
  });

  it('parses every-N-hours cron', () => {
    const result = decideSchedule(
      {
        meta: makeMeta({ kind: 'cron', cron: '0 */2 * * *', maxRowsPerRun: 200 }),
        lastSyncedAt: '2026-05-26T09:00:00.000Z',
      },
      clock,
    );
    expect(result.kind).toBe('run-now');
  });

  it('always defers on-demand without forceRun', () => {
    const result = decideSchedule(
      { meta: makeMeta({ kind: 'on-demand' }), lastSyncedAt: null },
      clock,
    );
    expect(result.kind).toBe('defer');
  });

  it('returns run-now for first-time pushed sync', () => {
    const result = decideSchedule(
      { meta: makeMeta({ kind: 'pushed', subscriptionToken: 'tok' }), lastSyncedAt: null },
      clock,
    );
    expect(result.kind).toBe('run-now');
  });

  it('returns run-now for first-time cron sync', () => {
    const result = decideSchedule(
      { meta: makeMeta({ kind: 'cron', cron: '*/5 * * * *', maxRowsPerRun: 100 }), lastSyncedAt: null },
      clock,
    );
    expect(result.kind).toBe('run-now');
  });
});
