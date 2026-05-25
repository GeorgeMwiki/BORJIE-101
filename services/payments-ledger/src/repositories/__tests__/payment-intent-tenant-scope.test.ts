/**
 * Tenant-scoping contract test for `findByExternalId`.
 *
 * Closes the CRITICAL: previously `findByExternalId(externalId,
 * providerName)` returned ANY tenant's row that matched the
 * (provider, external_id) tuple. A leaked or guessable external_id
 * could be used by tenant A to read/mutate tenant B's payment row.
 *
 * Contract under test:
 *   - findByExternalId now requires `tenantId` as a third argument.
 *   - Returns the row only when (externalId, providerName, tenantId)
 *     all match. Cross-tenant collisions resolve to null for the
 *     non-matching tenant.
 *
 * The Drizzle implementation enforces the same predicate via SQL +
 * the migration-0169 unique index; the in-memory impl mirrors it.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryPaymentIntentRepository } from '../payment-intent.repository';
import { Money } from '@borjie/domain-models';
import type {
  PaymentIntent,
  PaymentIntentId,
  TenantId,
  CustomerId,
} from '@borjie/domain-models';

function makeIntent(overrides: Partial<PaymentIntent>): PaymentIntent {
  return {
    id: 'pi_test_1' as PaymentIntentId,
    tenantId: 'tenant_a' as TenantId,
    customerId: 'cust_1' as CustomerId,
    leaseId: undefined,
    type: 'RENT' as PaymentIntent['type'],
    status: 'PENDING' as PaymentIntent['status'],
    amount: Money.fromMinorUnits(10_000, 'KES'),
    platformFee: undefined,
    netAmount: undefined,
    description: 'test',
    externalId: 'ext_shared_xyz',
    providerName: 'stripe',
    idempotencyKey: 'idem_1',
    paidAt: undefined,
    failureReason: undefined,
    refundedAmount: undefined,
    receiptUrl: undefined,
    statementDescriptor: undefined,
    metadata: undefined,
    createdAt: new Date('2026-05-20T00:00:00Z'),
    updatedAt: new Date('2026-05-20T00:00:00Z'),
    ...overrides,
  } as PaymentIntent;
}

describe('findByExternalId tenant scoping', () => {
  it('returns the row only for the matching tenant', async () => {
    const repo = new InMemoryPaymentIntentRepository();
    await repo.create(
      makeIntent({
        id: 'pi_a' as PaymentIntentId,
        tenantId: 'tenant_a' as TenantId,
      }),
    );
    await repo.create(
      makeIntent({
        id: 'pi_b' as PaymentIntentId,
        tenantId: 'tenant_b' as TenantId,
        idempotencyKey: 'idem_2',
      }),
    );

    const a = await repo.findByExternalId(
      'ext_shared_xyz',
      'stripe',
      'tenant_a' as TenantId,
    );
    const b = await repo.findByExternalId(
      'ext_shared_xyz',
      'stripe',
      'tenant_b' as TenantId,
    );

    expect(a?.id).toBe('pi_a');
    expect(b?.id).toBe('pi_b');
  });

  it('returns null when tenantId does not match', async () => {
    const repo = new InMemoryPaymentIntentRepository();
    await repo.create(
      makeIntent({
        id: 'pi_a' as PaymentIntentId,
        tenantId: 'tenant_a' as TenantId,
      }),
    );

    const result = await repo.findByExternalId(
      'ext_shared_xyz',
      'stripe',
      'tenant_c' as TenantId,
    );

    expect(result).toBeNull();
  });

  it('returns null when provider does not match', async () => {
    const repo = new InMemoryPaymentIntentRepository();
    await repo.create(
      makeIntent({
        id: 'pi_a' as PaymentIntentId,
        tenantId: 'tenant_a' as TenantId,
        providerName: 'stripe',
      }),
    );

    const result = await repo.findByExternalId(
      'ext_shared_xyz',
      'mpesa',
      'tenant_a' as TenantId,
    );

    expect(result).toBeNull();
  });
});
