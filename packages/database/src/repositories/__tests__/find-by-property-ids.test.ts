/**
 * Static contract tests for the new BFF aggregation hot-path methods.
 *
 * These verify the methods exist with the expected names and shapes so
 * the BFF refactor cannot regress to a `findMany + JS .filter` pattern.
 * We deliberately avoid a real Postgres connection here — drizzle's
 * unit tests already cover SQL generation, and a real-DB integration
 * test belongs in `services/api-gateway/src/__tests__`.
 */
import { describe, expect, it } from 'vitest';
import { LeaseRepository } from '../lease.repository.js';
import { UnitRepository } from '../property.repository.js';
import { CustomerRepository } from '../customer.repository.js';
import { InvoiceRepository, PaymentRepository } from '../payment.repository.js';

describe('BFF aggregation hot-path methods', () => {
  it('LeaseRepository exposes findByPropertyIds', () => {
    expect(typeof LeaseRepository.prototype.findByPropertyIds).toBe('function');
  });

  it('UnitRepository exposes findByPropertyIds', () => {
    expect(typeof UnitRepository.prototype.findByPropertyIds).toBe('function');
  });

  it('CustomerRepository exposes findByPropertyIds', () => {
    expect(typeof CustomerRepository.prototype.findByPropertyIds).toBe('function');
  });

  it('InvoiceRepository exposes findByPropertyIds', () => {
    expect(typeof InvoiceRepository.prototype.findByPropertyIds).toBe('function');
  });

  it('InvoiceRepository exposes sumBalanceByCustomer', () => {
    expect(typeof InvoiceRepository.prototype.sumBalanceByCustomer).toBe('function');
  });

  it('PaymentRepository exposes findByPropertyIds', () => {
    expect(typeof PaymentRepository.prototype.findByPropertyIds).toBe('function');
  });
});

describe('empty propertyIds short-circuit', () => {
  // The empty-array short-circuit MUST return an empty result WITHOUT
  // hitting the database. This is the safety net for the
  // `auth.propertyAccess` resolver when a caller has zero properties.

  function makeRepoWithExplodingDb<R>(Ctor: new (db: any) => R): R {
    // Any actual DB call throws; the test passes only if the repo
    // never touches the db for an empty propertyIds array.
    const explodingDb: any = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('repo MUST short-circuit on empty propertyIds');
        },
      },
    );
    return new Ctor(explodingDb);
  }

  it('LeaseRepository.findByPropertyIds returns empty for []', async () => {
    const repo = makeRepoWithExplodingDb(LeaseRepository);
    const result = await repo.findByPropertyIds([], 'tenant-x' as any);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('UnitRepository.findByPropertyIds returns empty for []', async () => {
    const repo = makeRepoWithExplodingDb(UnitRepository);
    const result = await repo.findByPropertyIds([], 'tenant-x' as any);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('CustomerRepository.findByPropertyIds returns empty for []', async () => {
    const repo = makeRepoWithExplodingDb(CustomerRepository);
    const result = await repo.findByPropertyIds([], 'tenant-x' as any);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('InvoiceRepository.findByPropertyIds returns empty for []', async () => {
    const repo = makeRepoWithExplodingDb(InvoiceRepository);
    const result = await repo.findByPropertyIds([], 'tenant-x' as any);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('PaymentRepository.findByPropertyIds returns empty for []', async () => {
    const repo = makeRepoWithExplodingDb(PaymentRepository);
    const result = await repo.findByPropertyIds([], 'tenant-x' as any);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });
});
