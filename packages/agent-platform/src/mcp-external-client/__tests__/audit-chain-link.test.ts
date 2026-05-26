/**
 * Audit-chain link builder unit tests.
 */
import { describe, expect, it } from 'vitest';
import { buildAuditLink } from '../audit/audit-chain-link.js';

describe('buildAuditLink', () => {
  it('builds an ok link without errorMessage', () => {
    const link = buildAuditLink({
      tenantId: 't1',
      connectionId: 'c1',
      toolName: 'send_message',
      inputHash: 'i',
      outputHash: 'o',
      startedAt: 1,
      finishedAt: 2,
      outcome: 'ok',
    });
    expect(link.outcome).toBe('ok');
    expect(link.errorMessage).toBeUndefined();
  });

  it('builds an error link carrying the errorMessage', () => {
    const link = buildAuditLink({
      tenantId: 't1',
      connectionId: 'c1',
      toolName: 'send_message',
      inputHash: 'i',
      outputHash: 'o',
      startedAt: 1,
      finishedAt: 2,
      outcome: 'error',
      errorMessage: 'auth expired',
    });
    expect(link.outcome).toBe('error');
    expect(link.errorMessage).toBe('auth expired');
  });

  it('rejects negative durations', () => {
    expect(() =>
      buildAuditLink({
        tenantId: 't1',
        connectionId: 'c1',
        toolName: 'x',
        inputHash: 'i',
        outputHash: 'o',
        startedAt: 10,
        finishedAt: 5,
        outcome: 'ok',
      }),
    ).toThrow(/finishedAt < startedAt/);
  });

  it('rejects error outcomes without an errorMessage', () => {
    expect(() =>
      buildAuditLink({
        tenantId: 't1',
        connectionId: 'c1',
        toolName: 'x',
        inputHash: 'i',
        outputHash: 'o',
        startedAt: 1,
        finishedAt: 2,
        outcome: 'error',
      }),
    ).toThrow(/requires errorMessage/);
  });
});
