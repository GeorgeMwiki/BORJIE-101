import { describe, it, expect, vi } from 'vitest';
import { createProvenanceStamper } from '../connector-base/provenance-stamper.js';
import { createDefaultPIIRedactor, DEFAULT_BOUNDARY_PII_FIELDS } from '../connector-base/pii-redactor.js';
import { createAuditLink } from '../audit/audit-chain-link.js';
import type { AuditChainPort, ClockPort, UuidPort } from '../types.js';

function deps() {
  let counter = 0;
  const uuid: UuidPort = { v4: () => `uuid-${++counter}` };
  const clock: ClockPort = { nowIso: () => '2026-05-26T12:00:00.000Z' };
  const audit: AuditChainPort = {
    append: vi.fn(async () => ({ hash: 'hash-abc' })),
  };
  return {
    redactor: createDefaultPIIRedactor(DEFAULT_BOUNDARY_PII_FIELDS),
    audit,
    clock,
    uuid,
  };
}

describe('createProvenanceStamper', () => {
  it('returns a canonical ingested item', async () => {
    const stamper = createProvenanceStamper(deps());
    const item = await stamper.stamp({
      tenantId: 't1',
      connectorId: 'slack:t1',
      sourceKind: 'slack',
      sourceRecordId: 'msg-100',
      payload: { text: 'hello', user: 'U01', ts: '100.0001' },
      consentRecordId: 'consent-1',
    });
    expect(item.id).toBe('uuid-1');
    expect(item.tenant_id).toBe('t1');
    expect(item.connector_id).toBe('slack:t1');
    expect(item.source_kind).toBe('slack');
    expect(item.source_record_id).toBe('msg-100');
    expect(item.retrieved_at).toBe('2026-05-26T12:00:00.000Z');
    expect(item.audit_hash).toBe('hash-abc');
    expect(item.consent_record_id).toBe('consent-1');
    expect(item.redaction_applied).toHaveLength(0); // no PII in this payload
  });

  it('redacts PII before stamping', async () => {
    const stamper = createProvenanceStamper(deps());
    const item = await stamper.stamp({
      tenantId: 't1',
      connectorId: 'gmail:t1',
      sourceKind: 'gmail',
      sourceRecordId: 'email-9',
      payload: { from: 'a@x.com', email: 'b@y.com', subject: 'Hello' },
      consentRecordId: null,
    });
    expect((item.payload as { email: string }).email).toBe('[REDACTED:email]');
    expect(item.redaction_applied).toContain('email');
  });

  it('preserves consent_record_id of null', async () => {
    const stamper = createProvenanceStamper(deps());
    const item = await stamper.stamp({
      tenantId: 't1',
      connectorId: 'github:t1',
      sourceKind: 'github',
      sourceRecordId: 'pr-1',
      payload: { title: 'feat: x' },
      consentRecordId: null,
    });
    expect(item.consent_record_id).toBeNull();
  });

  it('calls the audit chain with the correct action', async () => {
    const d = deps();
    const stamper = createProvenanceStamper(d);
    await stamper.stamp({
      tenantId: 't1',
      connectorId: 'slack:t1',
      sourceKind: 'slack',
      sourceRecordId: 'msg-1',
      payload: { text: 'hi' },
      consentRecordId: null,
    });
    expect(d.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        action: 'omnidata.ingest',
        resourceId: 'slack:t1:msg-1',
      }),
    );
  });
});

describe('createAuditLink', () => {
  it('appends a sync.started event', async () => {
    const append = vi.fn(async () => ({ hash: 'h1' }));
    const link = createAuditLink({ append });
    const result = await link.recordSyncEvent({
      tenantId: 't1',
      connectorId: 'slack:t1',
      event: { kind: 'sync.started', correlationId: 'c1' },
    });
    expect(result.hash).toBe('h1');
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        action: 'omnidata.sync.started',
        resourceId: 'slack:t1',
      }),
    );
  });

  it('appends a sync.completed event with item count', async () => {
    const append = vi.fn(async () => ({ hash: 'h2' }));
    const link = createAuditLink({ append });
    await link.recordSyncEvent({
      tenantId: 't1',
      connectorId: 'slack:t1',
      event: { kind: 'sync.completed', correlationId: 'c1', itemsIngested: 12, latencyMs: 400 },
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'omnidata.sync.completed',
        metadata: expect.objectContaining({ itemsIngested: 12, latencyMs: 400 }),
      }),
    );
  });

  it('appends a sync.failed event with error message', async () => {
    const append = vi.fn(async () => ({ hash: 'h3' }));
    const link = createAuditLink({ append });
    await link.recordSyncEvent({
      tenantId: 't1',
      connectorId: 'slack:t1',
      event: { kind: 'sync.failed', correlationId: 'c1', errorMessage: 'boom' },
    });
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'omnidata.sync.failed' }),
    );
  });
});
