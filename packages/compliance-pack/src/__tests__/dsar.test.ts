/**
 * DSAR pipeline tests — access / portability / rectification / erasure.
 */

import { describe, expect, it } from 'vitest';

import {
  createDSARService,
  createFixtureCollector,
  type DSARCollector,
} from '../dsar/index.js';
import { buildErasureCascade, cannedErasureRules } from '../erasure-cascade/index.js';
import { computeDSARDeadline, DSAR_SLA_HOURS } from '../dsar/sla-table.js';
import type { DSARRecord, ErasureCascadeSpec } from '../types.js';

function makeCollector(): DSARCollector {
  const fixture = new Map<string, ReadonlyArray<DSARRecord>>([
    [
      'subject_alice',
      [
        {
          table: 'users',
          primaryKey: 'u_1',
          columns: { email: 'alice@example.com', full_name: 'Alice', tenant_id: 't_1' },
          piiFields: ['email', 'full_name'],
        },
        {
          table: 'payments',
          primaryKey: 'p_42',
          columns: { amount: 5000, payer_name: 'Alice', tenant_id: 't_1' },
          piiFields: ['payer_name'],
        },
        {
          table: 'communications',
          primaryKey: 'c_7',
          columns: { subject: 'Welcome', body: 'Hi Alice', tenant_id: 't_1' },
          piiFields: ['subject', 'body'],
        },
        {
          table: 'document_uploads',
          primaryKey: 'd_3',
          columns: { original_filename: 'kyc.pdf' },
          piiFields: ['original_filename'],
        },
      ],
    ],
  ]);
  return createFixtureCollector({ id: 'fx', fixture });
}

describe('DSAR: SLA table', () => {
  it('GDPR (EU) = 30 days = 720h', () => {
    expect(DSAR_SLA_HOURS.EU).toBe(720);
  });
  it('CCPA (US-CA) = 45 days = 1080h', () => {
    expect(DSAR_SLA_HOURS['US-CA']).toBe(1080);
  });
  it('computeDSARDeadline returns receivedAt + SLA hours', () => {
    const received = new Date('2026-01-01T00:00:00.000Z');
    const due = computeDSARDeadline(received, 'EU', 'access');
    expect(due.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('DSAR: submit', () => {
  it('returns a DSARRequest with `received` state and computed SLA', () => {
    const service = createDSARService({
      collectors: [makeCollector()],
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      idFactory: () => 'req_test_1',
    });
    const req = service.submit({
      subjectId: 'subject_alice',
      kind: 'access',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    expect(req.id).toBe('req_test_1');
    expect(req.state).toBe('received');
    expect(req.slaDueAt).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('DSAR: processAccess', () => {
  it('gathers PII rows across fixtures and summarises', async () => {
    const service = createDSARService({
      collectors: [makeCollector()],
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      idFactory: () => 'req_1',
    });
    const req = service.submit({
      subjectId: 'subject_alice',
      kind: 'access',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    const resp = await service.processAccess({ request: req });
    expect(resp.format).toBe('json');
    expect(resp.records).toHaveLength(4);
    expect(resp.summary.recordsFound).toBe(4);
    expect(resp.summary.piiFieldsFound).toBeGreaterThan(0);
  });

  it('returns empty for unknown subject (without throwing)', async () => {
    const service = createDSARService({ collectors: [makeCollector()] });
    const req = service.submit({
      subjectId: 'subject_unknown',
      kind: 'access',
      jurisdiction: 'EU',
      channel: 'email',
    });
    const resp = await service.processAccess({ request: req });
    expect(resp.records).toEqual([]);
    expect(resp.summary.recordsFound).toBe(0);
  });
});

describe('DSAR: processPortability', () => {
  it('returns records with the chosen format tag (json)', async () => {
    const service = createDSARService({ collectors: [makeCollector()] });
    const req = service.submit({
      subjectId: 'subject_alice',
      kind: 'portability',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    const resp = await service.processPortability({ request: req, format: 'json' });
    expect(resp.format).toBe('json');
    expect(resp.records).toHaveLength(4);
  });

  it('returns records with the chosen format tag (csv)', async () => {
    const service = createDSARService({ collectors: [makeCollector()] });
    const req = service.submit({
      subjectId: 'subject_alice',
      kind: 'portability',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    const resp = await service.processPortability({ request: req, format: 'csv' });
    expect(resp.format).toBe('csv');
  });
});

describe('DSAR: processRectification', () => {
  it('throws when the subject has no records', async () => {
    const service = createDSARService({ collectors: [makeCollector()] });
    const req = service.submit({
      subjectId: 'subject_unknown',
      kind: 'rectification',
      jurisdiction: 'EU',
      channel: 'email',
    });
    await expect(
      service.processRectification({
        request: req,
        corrections: new Map(),
      }),
    ).rejects.toThrow(/not found/);
  });

  it('applies corrections to matching records', async () => {
    const service = createDSARService({ collectors: [makeCollector()] });
    const req = service.submit({
      subjectId: 'subject_alice',
      kind: 'rectification',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    const corrections = new Map([
      ['users:u_1', { full_name: 'Alice Corrected' }],
    ]);
    const resp = await service.processRectification({ request: req, corrections });
    const userRow = resp.records.find((r) => r.table === 'users');
    expect(userRow?.columns.full_name).toBe('Alice Corrected');
  });
});

describe('DSAR: processErasure', () => {
  it('produces a deterministic manifest with summary counts', async () => {
    const service = createDSARService({
      collectors: [makeCollector()],
      cascadeRunner: buildErasureCascade(),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      idFactory: () => 'cascade_1',
    });
    const req = service.submit({
      subjectId: 'subject_alice',
      kind: 'erasure',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    const cascade: ErasureCascadeSpec = {
      tenantId: 't_1',
      rules: cannedErasureRules(new Date('2026-01-01T00:00:00.000Z')),
    };
    const report = await service.processErasure({ request: req, cascade });

    // users -> anonymize, payments -> legal_hold, communications -> pseudonymize, document_uploads -> hard_delete
    expect(report.summary.anonymized).toBe(1); // users
    expect(report.summary.legalHold).toBe(1); // payments
    expect(report.summary.pseudonymized).toBe(1); // communications
    expect(report.summary.hardDeleted).toBe(1); // document_uploads

    // payments row should carry the legal-hold reason
    const paymentsAction = report.actions.find((a) => a.table === 'payments');
    expect(paymentsAction?.strategy).toBe('legal_hold');
    expect(paymentsAction?.heldBecause).toMatch(/7-year/);
  });

  it('throws when called without a cascadeRunner', async () => {
    const service = createDSARService({ collectors: [makeCollector()] });
    const req = service.submit({
      subjectId: 'subject_alice',
      kind: 'erasure',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    await expect(
      service.processErasure({
        request: req,
        cascade: { tenantId: 't_1', rules: [] },
      }),
    ).rejects.toThrow(/no cascadeRunner/);
  });
});
