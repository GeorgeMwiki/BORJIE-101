/**
 * Unit tests for RenewalService transitions.
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import {
  RenewalService,
  type RenewalLeaseSnapshot,
  type RenewalRepository,
} from '../renewal-service.js';

function makeLease(
  overrides: Partial<RenewalLeaseSnapshot> = {},
): RenewalLeaseSnapshot {
  return {
    id: 'lease_1',
    tenantId: 'tnt_1' as TenantId,
    leaseNumber: 'L-2026-000001',
    propertyId: 'prop_1',
    unitId: 'unit_1',
    customerId: 'cust_1',
    startDate: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
    endDate: '2026-12-31T00:00:00.000Z' as ISOTimestamp,
    rentAmount: 100000,
    rentCurrency: 'KES',
    renewalStatus: 'not_started',
    renewalWindowOpenedAt: null,
    renewalProposedAt: null,
    renewalProposedRent: null,
    renewalDecidedAt: null,
    renewalDecisionBy: null,
    terminationDate: null,
    terminationReasonNotes: null,
    ...overrides,
  };
}

function makeRepo(initial: RenewalLeaseSnapshot): {
  repo: RenewalRepository;
  store: RenewalLeaseSnapshot;
} {
  const store: RenewalLeaseSnapshot = { ...initial };
  const repo: RenewalRepository = {
    findById: vi.fn(async () => ({ ...store })),
    update: vi.fn(async (lease) => {
      Object.assign(store, lease);
      return { ...store };
    }),
    createRenewedLease: vi.fn(async (params) => ({
      id: params.newLeaseId,
      tenantId: params.tenantId,
      leaseNumber: params.newLeaseNumber,
      propertyId: store.propertyId,
      unitId: store.unitId,
      customerId: store.customerId,
      startDate: params.startDate,
      endDate: params.endDate,
      rentAmount: params.rentAmount,
      rentCurrency: params.rentCurrency,
      renewalStatus: 'not_started',
      renewalWindowOpenedAt: null,
      renewalProposedAt: null,
      renewalProposedRent: null,
      renewalDecidedAt: null,
      renewalDecisionBy: null,
      terminationDate: null,
      terminationReasonNotes: null,
    })),
    nextLeaseSequence: vi.fn(async () => 2),
  };
  return { repo, store };
}

function makeEventBus(): EventBus {
  return {
    publish: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
  };
}

const tenantId = 'tnt_1' as TenantId;
const userId = 'usr_1' as UserId;
const correlationId = 'corr_1';

describe('RenewalService', () => {
  it('openRenewalWindow transitions not_started -> window_opened', async () => {
    const { repo } = makeRepo(makeLease());
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.openRenewalWindow(
      'lease_1',
      tenantId,
      userId,
      correlationId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.renewalStatus).toBe('window_opened');
      expect(result.value.renewalWindowOpenedAt).not.toBeNull();
    }
  });

  it('proposeRenewal requires positive rent', async () => {
    const { repo } = makeRepo(makeLease({ renewalStatus: 'window_opened' }));
    const service = new RenewalService(repo, makeEventBus());
    const bad = await service.proposeRenewal(
      'lease_1',
      tenantId,
      { proposedRent: 0, proposedBy: userId },
      correlationId,
    );
    expect(bad.ok).toBe(false);
  });

  it('proposeRenewal records proposed rent', async () => {
    const { repo } = makeRepo(makeLease({ renewalStatus: 'window_opened' }));
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.proposeRenewal(
      'lease_1',
      tenantId,
      { proposedRent: 110000, proposedBy: userId },
      correlationId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.renewalStatus).toBe('proposed');
      expect(result.value.renewalProposedRent).toBe(110000);
    }
  });

  it('acceptRenewal creates a new lease', async () => {
    const { repo } = makeRepo(
      makeLease({
        renewalStatus: 'proposed',
        renewalProposedRent: 120000,
      }),
    );
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.acceptRenewal(
      'lease_1',
      tenantId,
      {
        newEndDate: '2027-12-31T00:00:00.000Z' as ISOTimestamp,
        acceptedBy: userId,
      },
      correlationId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.rentAmount).toBe(120000);
      expect(result.value.id).not.toBe('lease_1');
    }
  });

  it('declineRenewal from proposed succeeds', async () => {
    const { repo } = makeRepo(makeLease({ renewalStatus: 'proposed' }));
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.declineRenewal(
      'lease_1',
      tenantId,
      { declinedBy: userId, reason: 'tenant relocating' },
      correlationId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.renewalStatus).toBe('declined');
    }
  });

  it('rejects transitions from terminal states', async () => {
    const { repo } = makeRepo(makeLease({ renewalStatus: 'accepted' }));
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.proposeRenewal(
      'lease_1',
      tenantId,
      { proposedRent: 100, proposedBy: userId },
      correlationId,
    );
    expect(result.ok).toBe(false);
  });
});
