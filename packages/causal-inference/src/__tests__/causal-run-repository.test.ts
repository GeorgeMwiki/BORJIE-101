import { describe, expect, it } from 'vitest';
import { createInMemoryCausalRunRepository } from '../repositories/causal-run-repository.js';

describe('In-memory causal_runs repository', () => {
  it('inserts a run and assigns a unique audit hash', async () => {
    const repo = createInMemoryCausalRunRepository({
      now: () => new Date('2026-05-27T00:00:00Z'),
    });
    const row = await repo.insert({
      tenantId: 't1',
      question: 'did fuel price cause a production drop?',
      treatment: 'fuel_price',
      outcome: 'production',
      identification: 'granger',
      effectEstimate: 0.42,
      ciLow: 0.21,
      ciHigh: 0.63,
    });
    expect(row.id.length).toBeGreaterThan(0);
    expect(row.tenantId).toBe('t1');
    expect(row.prevHash).toBe('');
    expect(row.auditHash.length).toBeGreaterThan(0);
  });

  it('chains audit hashes per tenant', async () => {
    const repo = createInMemoryCausalRunRepository({
      now: () => new Date('2026-05-27T00:00:00Z'),
    });
    const a = await repo.insert({
      tenantId: 't1',
      question: 'q1',
      treatment: 't',
      outcome: 'o',
      identification: 'did',
      effectEstimate: 1,
      ciLow: 0,
      ciHigh: 2,
    });
    const b = await repo.insert({
      tenantId: 't1',
      question: 'q2',
      treatment: 't',
      outcome: 'o',
      identification: 'did',
      effectEstimate: 1.5,
      ciLow: 0.5,
      ciHigh: 2.5,
    });
    expect(b.prevHash).toBe(a.auditHash);
    expect(b.auditHash).not.toBe(a.auditHash);
  });

  it('isolates tenants (tenant A cannot find tenant B rows)', async () => {
    const repo = createInMemoryCausalRunRepository({
      now: () => new Date('2026-05-27T00:00:00Z'),
    });
    const a = await repo.insert({
      tenantId: 'A',
      question: 'q',
      treatment: 't',
      outcome: 'o',
      identification: 'rd',
      effectEstimate: 1,
      ciLow: 0,
      ciHigh: 2,
    });
    const foundFromB = await repo.findById('B', a.id);
    expect(foundFromB).toBeNull();
  });

  it('filters listForTenant by identification strategy', async () => {
    const repo = createInMemoryCausalRunRepository({
      now: () => new Date('2026-05-27T00:00:00Z'),
    });
    await repo.insert({
      tenantId: 't1',
      question: 'q1',
      treatment: 't',
      outcome: 'o',
      identification: 'did',
      effectEstimate: 1,
      ciLow: 0,
      ciHigh: 2,
    });
    await repo.insert({
      tenantId: 't1',
      question: 'q2',
      treatment: 't',
      outcome: 'o',
      identification: 'synthetic-control',
      effectEstimate: 2,
      ciLow: 1,
      ciHigh: 3,
    });
    const did = await repo.listForTenant('t1', { identification: 'did' });
    expect(did.length).toBe(1);
    expect(did[0]?.identification).toBe('did');
  });
});
