/**
 * RTBF tests — cascade plan completeness + orchestrator state machine.
 */

import { describe, expect, it } from 'vitest';

import {
  decideCascade,
  planCascade,
  verifyCompleteness,
  type RtbfTarget,
} from '../rtbf/cascade-planner.js';
import {
  isExpired,
  openRequest,
  transition,
  verifyAuditChain,
} from '../rtbf/rtbf-orchestrator.js';
import { DataProtectionInvariantError } from '../types.js';

const targets: ReadonlyArray<RtbfTarget> = Object.freeze([
  Object.freeze({
    tableName: 'users',
    entityKind: 'user',
    entityId: 'u_1',
    class: 'pii',
    isEncrypted: true,
    categories: [],
  }),
  Object.freeze({
    tableName: 'invoices',
    entityKind: 'invoice',
    entityId: 'i_1',
    class: 'financial',
    isEncrypted: false,
    categories: [],
  }),
  Object.freeze({
    tableName: 'medical_screenings',
    entityKind: 'screening',
    entityId: 's_1',
    class: 'phi',
    isEncrypted: true,
    categories: [],
  }),
  Object.freeze({
    tableName: 'audit_events',
    entityKind: 'audit',
    entityId: 'a_1',
    class: 'critical',
    isEncrypted: false,
    categories: [],
  }),
  Object.freeze({
    tableName: 'tickets',
    entityKind: 'ticket',
    entityId: 't_1',
    class: 'confidential',
    isEncrypted: false,
    categories: [],
  }),
  Object.freeze({
    tableName: 'fraud_cases',
    entityKind: 'case',
    entityId: 'c_1',
    class: 'pii',
    isEncrypted: true,
    categories: ['fraud_investigation'],
  }),
]);

describe('rtbf/cascade-planner', () => {
  it('decides crypto-shredded for encrypted pii', () => {
    const target = targets[0];
    if (!target) throw new Error('fixture missing');
    expect(decideCascade({ target })).toBe('crypto-shredded');
  });

  it('decides retained-legal-hold for financial rows (statutory)', () => {
    const target = targets[1];
    if (!target) throw new Error('fixture missing');
    expect(decideCascade({ target })).toBe('retained-legal-hold');
  });

  it('decides crypto-shredded for encrypted phi', () => {
    const target = targets[2];
    if (!target) throw new Error('fixture missing');
    expect(decideCascade({ target })).toBe('crypto-shredded');
  });

  it('decides redacted for confidential rows', () => {
    const target = targets[4];
    if (!target) throw new Error('fixture missing');
    expect(decideCascade({ target })).toBe('redacted');
  });

  it('decides retained-legal-hold for any active legal-hold category', () => {
    const target = targets[5];
    if (!target) throw new Error('fixture missing');
    expect(decideCascade({ target })).toBe('retained-legal-hold');
  });

  it('plan covers every target — completeness check passes', () => {
    const plan = planCascade({
      tenantId: 't1',
      subjectId: 's1',
      targets,
    });
    expect(plan.entries).toHaveLength(targets.length);
    const missing = verifyCompleteness(targets, plan);
    expect(missing).toHaveLength(0);
    expect(plan.aggregateHash).toHaveLength(64);
  });

  it('plan is deterministic — same inputs produce the same aggregateHash', () => {
    const a = planCascade({ tenantId: 't1', subjectId: 's1', targets });
    const b = planCascade({ tenantId: 't1', subjectId: 's1', targets });
    expect(a.aggregateHash).toBe(b.aggregateHash);
  });

  it('completeness check detects a missing entry', () => {
    const partial = targets.slice(0, 3);
    const plan = planCascade({
      tenantId: 't1',
      subjectId: 's1',
      targets: partial,
    });
    const missing = verifyCompleteness(targets, plan);
    expect(missing.length).toBe(targets.length - partial.length);
  });
});

describe('rtbf/rtbf-orchestrator', () => {
  it('open → in-progress → completed builds a valid chain', () => {
    const r0 = openRequest({
      id: 'req_1',
      tenantId: 't1',
      subjectId: 's1',
      requestedAt: new Date('2026-05-01T00:00:00Z'),
    });
    const r1 = transition({ request: r0, to: 'in-progress' });
    const r2 = transition({
      request: r1,
      to: 'completed',
      completedAt: new Date('2026-05-10T00:00:00Z'),
    });
    expect(r2.status).toBe('completed');
    expect(verifyAuditChain([r0, r1, r2])).toBe(true);
  });

  it('rejects illegal transitions', () => {
    const r0 = openRequest({
      id: 'req_2',
      tenantId: 't1',
      subjectId: 's1',
      requestedAt: new Date(),
    });
    const r1 = transition({
      request: r0,
      to: 'in-progress',
    });
    const r2 = transition({
      request: r1,
      to: 'completed',
      completedAt: new Date(),
    });
    // Completed is terminal — cannot move back to in-progress.
    expect(() => transition({ request: r2, to: 'in-progress' })).toThrow(
      DataProtectionInvariantError,
    );
  });

  it('denial requires a reason', () => {
    const r0 = openRequest({
      id: 'req_3',
      tenantId: 't1',
      subjectId: 's1',
      requestedAt: new Date(),
    });
    expect(() => transition({ request: r0, to: 'denied' })).toThrow(
      /requires a non-empty denialReason/,
    );
  });

  it('isExpired flags an open request older than the SLA', () => {
    const r0 = openRequest({
      id: 'req_4',
      tenantId: 't1',
      subjectId: 's1',
      requestedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(
      isExpired({
        request: r0,
        slaDays: 30,
        now: new Date('2026-05-01T00:00:00Z'),
      }),
    ).toBe(true);
  });

  it('detects a broken chain when a hash is tampered', () => {
    const r0 = openRequest({
      id: 'req_5',
      tenantId: 't1',
      subjectId: 's1',
      requestedAt: new Date(),
    });
    const r1 = transition({ request: r0, to: 'in-progress' });
    // Tamper: flip the auditHash of r1.
    const r1Bad = { ...r1, auditHash: 'a'.repeat(64) };
    expect(verifyAuditChain([r0, r1Bad])).toBe(false);
  });
});
