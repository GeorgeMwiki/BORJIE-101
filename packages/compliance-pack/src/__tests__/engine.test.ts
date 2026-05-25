/**
 * Top-level engine + end-to-end smoke tests.
 */

import { describe, expect, it } from 'vitest';

import { createComplianceEngine } from '../index.js';
import { createFixtureCollector } from '../dsar/index.js';
import { createInMemoryEnvelopeEncryptor } from '../encryption/index.js';
import { cannedErasureRules } from '../erasure-cascade/index.js';
import { ResidencyViolationError, type DSARRecord } from '../types.js';

describe('createComplianceEngine', () => {
  it('wires DSAR + encryption + residency + cascade into one object', async () => {
    const fixture = new Map<string, ReadonlyArray<DSARRecord>>([
      [
        's_alice',
        [
          {
            table: 'users',
            primaryKey: 'u_1',
            columns: { email: 'a@x' },
            piiFields: ['email'],
          },
        ],
      ],
    ]);
    const engine = createComplianceEngine({
      collectors: [createFixtureCollector({ id: 'fx', fixture })],
      encryptor: createInMemoryEnvelopeEncryptor(),
      residency: {
        tenantId: 't_1',
        region: 'eu-west-1',
        allowFailover: false,
      },
    });

    // DSAR works
    const req = engine.dsar.submit({
      subjectId: 's_alice',
      kind: 'access',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    const resp = await engine.dsar.processAccess({ request: req });
    expect(resp.records).toHaveLength(1);

    // Residency works
    expect(engine.residency.tenantId).toBe('t_1');
    expect(() =>
      engine.residency.enforce({ table: 'users', region: 'us-east-1', action: 'read' }),
    ).toThrow(ResidencyViolationError);

    // Encryption works (bindField → encrypt/decrypt round-trip)
    const bound = engine.bindField({
      tenantId: 't_1',
      field: 'email',
      resource: 'users',
    });
    const env = await bound.encryptField('secret');
    expect(await bound.decryptField(env)).toBe('secret');

    // Cascade is reachable
    expect(typeof engine.cascadeRunner.run).toBe('function');
  });

  it('end-to-end: submit erasure → cascade produces correct summary', async () => {
    const fixture = new Map<string, ReadonlyArray<DSARRecord>>([
      [
        's_alice',
        [
          {
            table: 'users',
            primaryKey: 'u_1',
            columns: { email: 'a@x' },
            piiFields: ['email'],
          },
          {
            table: 'payments',
            primaryKey: 'p_1',
            columns: { amount: 99 },
            piiFields: ['payer_name'],
          },
        ],
      ],
    ]);
    const engine = createComplianceEngine({
      collectors: [createFixtureCollector({ id: 'fx', fixture })],
      encryptor: createInMemoryEnvelopeEncryptor(),
      residency: { tenantId: 't_1', region: 'eu-west-1', allowFailover: false },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });
    const req = engine.dsar.submit({
      subjectId: 's_alice',
      kind: 'erasure',
      jurisdiction: 'EU',
      channel: 'web_form',
    });
    const report = await engine.dsar.processErasure({
      request: req,
      cascade: {
        tenantId: 't_1',
        rules: cannedErasureRules(new Date('2026-01-01T00:00:00.000Z')),
      },
    });
    expect(report.summary.anonymized).toBe(1); // users
    expect(report.summary.legalHold).toBe(1); // payments
  });
});
