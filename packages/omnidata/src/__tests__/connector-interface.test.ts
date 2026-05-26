import { describe, it, expect } from 'vitest';
import { assertConnectorMetadata } from '../connector-base/connector-interface.js';
import type { OmnidataConnectorMetadata } from '../types.js';

const VALID: OmnidataConnectorMetadata = {
  id: 'slack:t1',
  sourceKind: 'slack',
  displayName: 'Slack',
  description: 'Slack workspace.',
  phase: 'P0',
  volumeClass: 'medium',
  refreshPolicy: { kind: 'realtime', webhookSecret: 'secret-value' },
  requiresConsentScope: 'channel',
  mcpServerOpportunity: 'yes',
  authKind: 'oauth2',
};

describe('assertConnectorMetadata', () => {
  it('accepts well-formed metadata', () => {
    const result = assertConnectorMetadata(VALID);
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejects empty id', () => {
    const result = assertConnectorMetadata({ ...VALID, id: '' });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('id must be non-empty');
  });

  it('rejects empty displayName', () => {
    const result = assertConnectorMetadata({ ...VALID, displayName: '' });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('displayName must be non-empty');
  });

  it('rejects realtime policy with empty webhook secret', () => {
    const result = assertConnectorMetadata({
      ...VALID,
      refreshPolicy: { kind: 'realtime', webhookSecret: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('refreshPolicy is invalid for its kind');
  });

  it('rejects pushed policy with empty subscription token', () => {
    const result = assertConnectorMetadata({
      ...VALID,
      refreshPolicy: { kind: 'pushed', subscriptionToken: '' },
    });
    expect(result.ok).toBe(false);
  });

  it('rejects cron policy with zero maxRowsPerRun', () => {
    const result = assertConnectorMetadata({
      ...VALID,
      refreshPolicy: { kind: 'cron', cron: '0 * * * *', maxRowsPerRun: 0 },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts on-demand policy unconditionally', () => {
    const result = assertConnectorMetadata({
      ...VALID,
      refreshPolicy: { kind: 'on-demand' },
    });
    expect(result.ok).toBe(true);
  });

  it('returns a list of issues when several fields are bad', () => {
    const result = assertConnectorMetadata({
      ...VALID,
      id: '',
      displayName: '',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });
});
