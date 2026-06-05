/**
 * Unit tests for RenewalService transitions.
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId, ISOTimestamp } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import {
  RenewalService,
  type RenewalOfftakeSnapshot,
  type RenewalRepository,
} from '../renewal-service.js';

function makeOfftake(
  overrides: Partial<RenewalOfftakeSnapshot> = {},
): RenewalOfftakeSnapshot {
  return {
    id: 'offtake_1',
    tenantId: 'tnt_1' as TenantId,
    offtakeNumber: 'O-2026-000001',
    propertyId: 'prop_1',
    unitId: 'unit_1',
    customerId: 'cust_1',
    startDate: '2026-01-01T00:00:00.000Z' as ISOTimestamp,
    endDate: '2026-12-31T00:00:00.000Z' as ISOTimestamp,
    royaltyAmount: 100000,
    royaltyCurrency: 'KES',
    renewalStatus: 'not_started',
    renewalWindowOpenedAt: null,
    renewalProposedAt: null,
    renewalProposedRoyalty: null,
    renewalDecidedAt: null,
    renewalDecisionBy: null,
    terminationDate: null,
    terminationReasonNotes: null,
    ...overrides,
  };
}

function makeRepo(initial: RenewalOfftakeSnapshot): {
  repo: RenewalRepository;
  store: RenewalOfftakeSnapshot;
} {
  const store: RenewalOfftakeSnapshot = { ...initial };
  const repo: RenewalRepository = {
    findById: vi.fn(async () => ({ ...store })),
    update: vi.fn(async (offtake) => {
      Object.assign(store, offtake);
      return { ...store };
    }),
    createRenewedLease: vi.fn(async (params) => ({
      id: params.newOfftakeId,
      tenantId: params.tenantId,
      offtakeNumber: params.newOfftakeNumber,
      propertyId: store.propertyId,
      unitId: store.unitId,
      customerId: store.customerId,
      startDate: params.startDate,
      endDate: params.endDate,
      royaltyAmount: params.royaltyAmount,
      royaltyCurrency: params.royaltyCurrency,
      renewalStatus: 'not_started',
      renewalWindowOpenedAt: null,
      renewalProposedAt: null,
      renewalProposedRoyalty: null,
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
    const { repo } = makeRepo(makeOfftake());
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.openRenewalWindow(
      'offtake_1',
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

  it('proposeRenewal requires positive royalty', async () => {
    const { repo } = makeRepo(makeOfftake({ renewalStatus: 'window_opened' }));
    const service = new RenewalService(repo, makeEventBus());
    const bad = await service.proposeRenewal(
      'offtake_1',
      tenantId,
      { proposedRoyalty: 0, proposedBy: userId },
      correlationId,
    );
    expect(bad.ok).toBe(false);
  });

  it('proposeRenewal records proposed royalty', async () => {
    const { repo } = makeRepo(makeOfftake({ renewalStatus: 'window_opened' }));
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.proposeRenewal(
      'offtake_1',
      tenantId,
      { proposedRoyalty: 110000, proposedBy: userId },
      correlationId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.renewalStatus).toBe('proposed');
      expect(result.value.renewalProposedRoyalty).toBe(110000);
    }
  });

  it('acceptRenewal creates a new offtake', async () => {
    const { repo } = makeRepo(
      makeOfftake({
        renewalStatus: 'proposed',
        renewalProposedRoyalty: 120000,
      }),
    );
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.acceptRenewal(
      'offtake_1',
      tenantId,
      {
        newEndDate: '2027-12-31T00:00:00.000Z' as ISOTimestamp,
        acceptedBy: userId,
      },
      correlationId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.royaltyAmount).toBe(120000);
      expect(result.value.id).not.toBe('offtake_1');
    }
  });

  it('declineRenewal from proposed succeeds', async () => {
    const { repo } = makeRepo(makeOfftake({ renewalStatus: 'proposed' }));
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.declineRenewal(
      'offtake_1',
      tenantId,
      { declinedBy: userId, reason: 'counterparty relocating' },
      correlationId,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.renewalStatus).toBe('declined');
    }
  });

  it('rejects transitions from terminal states', async () => {
    const { repo } = makeRepo(makeOfftake({ renewalStatus: 'accepted' }));
    const service = new RenewalService(repo, makeEventBus());
    const result = await service.proposeRenewal(
      'offtake_1',
      tenantId,
      { proposedRoyalty: 100, proposedBy: userId },
      correlationId,
    );
    expect(result.ok).toBe(false);
  });
});
