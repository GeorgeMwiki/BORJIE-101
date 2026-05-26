import { describe, it, expect, vi } from 'vitest';
import { createSlackExampleConnector } from '../examples/slack-example.js';
import type { OmnidataConnectorMetadata, OmnidataIngestedItem, OmnidataSyncRequest } from '../types.js';

const META: OmnidataConnectorMetadata = {
  id: 'slack:t1',
  sourceKind: 'slack',
  displayName: 'Slack',
  description: 'Slack workspace.',
  phase: 'P0',
  volumeClass: 'medium',
  refreshPolicy: { kind: 'realtime', webhookSecret: 'sec' },
  requiresConsentScope: 'channel',
  mcpServerOpportunity: 'yes',
  authKind: 'oauth2',
};

function makeRequest(overrides: Partial<OmnidataSyncRequest> = {}): OmnidataSyncRequest {
  return {
    tenantId: 't1',
    connectorId: 'slack:t1',
    auth: {
      kind: 'oauth2',
      accessToken: 'tok',
      refreshToken: 'r',
      expiresAt: '2026-05-26T13:00:00.000Z',
    },
    since: null,
    maxItems: 100,
    correlationId: 'corr-1',
    ...overrides,
  };
}

function makeItem(ts: string): OmnidataIngestedItem<{ channel: string; user: string; ts: string; text: string }> {
  return {
    id: `id-${ts}`,
    tenant_id: 't1',
    connector_id: 'slack:t1',
    source_kind: 'slack',
    source_record_id: ts,
    retrieved_at: '2026-05-26T12:00:00.000Z',
    payload: { channel: 'C1', user: 'U1', ts, text: 'hi' },
    redaction_applied: [],
    consent_record_id: null,
    audit_hash: `hash-${ts}`,
  };
}

describe('createSlackExampleConnector', () => {
  it('exposes its metadata', () => {
    const connector = createSlackExampleConnector({ metadata: META, fetchSince: vi.fn() });
    expect(connector.metadata).toBe(META);
  });

  it('returns ok with items on a successful sync', async () => {
    const items = [makeItem('100.0001'), makeItem('100.0002')];
    const connector = createSlackExampleConnector({
      metadata: META,
      fetchSince: vi.fn(async () => items),
    });
    const result = await connector.sync(makeRequest({ maxItems: 5 }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.items).toHaveLength(2);
      expect(result.nextSince).toBe('100.0002');
      expect(result.hasMore).toBe(false);
    }
  });

  it('reports hasMore when items reach maxItems', async () => {
    const items = [makeItem('100.0001'), makeItem('100.0002')];
    const connector = createSlackExampleConnector({
      metadata: META,
      fetchSince: vi.fn(async () => items),
    });
    const result = await connector.sync(makeRequest({ maxItems: 2 }));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.hasMore).toBe(true);
    }
  });

  it('returns unconfigured when auth is not OAuth2', async () => {
    const connector = createSlackExampleConnector({
      metadata: META,
      fetchSince: vi.fn(),
    });
    const result = await connector.sync(makeRequest({ auth: { kind: 'unconfigured' } }));
    expect(result.kind).toBe('unconfigured');
  });

  it('catches fetch errors as transport-error', async () => {
    const connector = createSlackExampleConnector({
      metadata: META,
      fetchSince: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const result = await connector.sync(makeRequest());
    expect(result.kind).toBe('transport-error');
    if (result.kind === 'transport-error') {
      expect(result.message).toBe('boom');
    }
  });

  it('rejects unverified webhooks by default (skeleton returns false)', () => {
    const connector = createSlackExampleConnector({ metadata: META, fetchSince: vi.fn() });
    expect(connector.verifyWebhook('body', 'sig', 'secret')).toBe(false);
  });
});
