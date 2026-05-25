/**
 * Real-adapters tests.
 *
 * For each port that got a real wiring (listing, creditRating,
 * negotiation, inspection, policy, events, waitlist) we cover:
 *   - the adapter calls the underlying service with the right shape
 *   - the return value matches the orchestrator port contract
 *   - errors from the service propagate (or fall back to default when
 *     intentional — e.g. resolver returned null)
 *
 * Default-only ports (enquiry, renewal) are exercised through the
 * composite `createRealOrchestratorAdapters` to confirm they fall
 * through to the conservative defaults.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createRealCreditRatingAdapter,
  createRealEnquiryAdapter,
  createRealEventAdapter,
  createRealInspectionAdapter,
  createRealListingAdapter,
  createRealNegotiationAdapter,
  createRealOrchestratorAdapters,
  createRealPolicyAdapter,
  createRealRenewalAdapter,
  createRealWaitlistAdapter,
  type RealAutonomyPolicyService,
  type RealCreditRatingService,
  type RealEnquiryService,
  type RealEventBus,
  type RealInspectionHints,
  type RealInspectionService,
  type RealLeaseSeedingService,
  type RealListingHints,
  type RealListingService,
  type RealNegotiationHints,
  type RealNegotiationService,
  type RealWaitlistService,
} from '../real-adapters.js';

// ---------------------------------------------------------------------------
// Listing port
// ---------------------------------------------------------------------------

describe('createRealListingAdapter', () => {
  function makeService(): RealListingService & {
    publish: ReturnType<typeof vi.fn>;
  } {
    return {
      publish: vi.fn().mockResolvedValue({
        ok: true,
        value: { id: 'lst_123' },
      }),
    } as any;
  }

  function makeHints(overrides: Partial<RealListingHints> = {}): RealListingHints {
    return {
      resolveHeadlinePrice: vi.fn().mockResolvedValue(50_000),
      resolveCurrency: vi.fn().mockResolvedValue('KES'),
      resolveNegotiationPolicyId: vi.fn().mockResolvedValue('pol_1'),
      resolvePropertyId: vi.fn().mockResolvedValue('prop_1'),
      ...overrides,
    };
  }

  it('publishes through the real ListingService and returns its id', async () => {
    const service = makeService();
    const hints = makeHints();
    const adapter = createRealListingAdapter({ service, hints });

    const result = await adapter.publishListing(
      'tenant_1',
      'unit_1',
      'user_1',
      'corr_1',
    );

    expect(result).toEqual({ listingId: 'lst_123' });
    expect(service.publish).toHaveBeenCalledTimes(1);
    const [tenantId, input, userId, correlationId] = service.publish.mock.calls[0];
    expect(tenantId).toBe('tenant_1');
    expect(userId).toBe('user_1');
    expect(correlationId).toBe('corr_1');
    expect(input).toMatchObject({
      unitId: 'unit_1',
      headlinePrice: 50_000,
      currency: 'KES',
      negotiable: true,
      publishImmediately: true,
      negotiationPolicyId: 'pol_1',
      propertyId: 'prop_1',
      listingKind: 'unit_for_rent',
    });
  });

  it('falls back to the default port when headline price cannot be resolved', async () => {
    const service = makeService();
    const hints = makeHints({
      resolveHeadlinePrice: vi.fn().mockResolvedValue(null),
    });
    const adapter = createRealListingAdapter({ service, hints });

    const result = await adapter.publishListing('t', 'u', 'a', 'c');

    expect(service.publish).not.toHaveBeenCalled();
    expect(result.listingId).toMatch(/^listing_t_u_/);
  });

  it('throws when the service returns no listing', async () => {
    const service = makeService();
    service.publish.mockResolvedValueOnce({ ok: false, error: { message: 'boom' } });
    const adapter = createRealListingAdapter({ service, hints: makeHints() });

    await expect(adapter.publishListing('t', 'u', 'a', 'c')).rejects.toThrow(/boom/);
  });
});

// ---------------------------------------------------------------------------
// Credit rating port
// ---------------------------------------------------------------------------

describe('createRealCreditRatingAdapter', () => {
  it('returns the score from CreditRatingService.computeRating', async () => {
    const service: RealCreditRatingService = {
      computeRating: vi.fn().mockResolvedValue({ score: 712 }),
    };
    const adapter = createRealCreditRatingAdapter({ service });

    const result = await adapter.score('tenant_1', 'cust_1');

    expect(result).toEqual({ score: 712 });
    expect(service.computeRating).toHaveBeenCalledWith('tenant_1', 'cust_1');
  });

  it('propagates errors from the underlying service', async () => {
    const service: RealCreditRatingService = {
      computeRating: vi.fn().mockRejectedValue(new Error('CUSTOMER_NOT_FOUND')),
    };
    const adapter = createRealCreditRatingAdapter({ service });

    await expect(adapter.score('t', 'c')).rejects.toThrow(/CUSTOMER_NOT_FOUND/);
  });
});

// ---------------------------------------------------------------------------
// Negotiation port
// ---------------------------------------------------------------------------

describe('createRealNegotiationAdapter', () => {
  function makeService(): RealNegotiationService & {
    startNegotiation: ReturnType<typeof vi.fn>;
  } {
    return {
      startNegotiation: vi.fn().mockResolvedValue({
        success: true,
        data: { id: 'neg_1' },
      }),
    } as any;
  }

  function makeHints(overrides: Partial<RealNegotiationHints> = {}): RealNegotiationHints {
    return {
      resolvePolicyId: vi.fn().mockResolvedValue('pol_1'),
      resolveOpeningOffer: vi.fn().mockResolvedValue(48_000),
      ...overrides,
    };
  }

  it('starts a negotiation through the service and returns its id', async () => {
    const service = makeService();
    const adapter = createRealNegotiationAdapter({
      service,
      hints: makeHints(),
    });

    const result = await adapter.proposeOffer(
      'tenant_1',
      'lst_1',
      'cust_1',
      'user_1',
    );

    expect(result).toEqual({ negotiationId: 'neg_1' });
    expect(service.startNegotiation).toHaveBeenCalledTimes(1);
    const [tenantId, input, , actorUserId] = service.startNegotiation.mock.calls[0];
    expect(tenantId).toBe('tenant_1');
    expect(actorUserId).toBe('user_1');
    expect(input).toMatchObject({
      policyId: 'pol_1',
      listingId: 'lst_1',
      prospectCustomerId: 'cust_1',
      domain: 'lease_price',
      openingOffer: 48_000,
    });
  });

  it('falls back to the default port when policyId is missing', async () => {
    const service = makeService();
    const adapter = createRealNegotiationAdapter({
      service,
      hints: makeHints({ resolvePolicyId: vi.fn().mockResolvedValue(null) }),
    });

    const result = await adapter.proposeOffer('t', 'lst', 'cust', 'a');

    expect(service.startNegotiation).not.toHaveBeenCalled();
    expect(result.negotiationId).toMatch(/^neg_t_lst_/);
  });

  it('throws when the service returns failure', async () => {
    const service = makeService();
    service.startNegotiation.mockResolvedValueOnce({
      success: false,
      error: { message: 'POLICY_INACTIVE' },
    });
    const adapter = createRealNegotiationAdapter({ service, hints: makeHints() });

    await expect(adapter.proposeOffer('t', 'l', 'c', 'a')).rejects.toThrow(
      /POLICY_INACTIVE/,
    );
  });
});

// ---------------------------------------------------------------------------
// Inspection port
// ---------------------------------------------------------------------------

describe('createRealInspectionAdapter', () => {
  function makeService(): RealInspectionService & {
    scheduleInspection: ReturnType<typeof vi.fn>;
  } {
    return {
      scheduleInspection: vi.fn().mockResolvedValue({
        ok: true,
        value: { id: 'insp_1' },
      }),
    } as any;
  }

  function makeHints(
    overrides: Partial<RealInspectionHints> = {},
  ): RealInspectionHints {
    return {
      resolvePropertyId: vi.fn().mockResolvedValue('prop_1'),
      resolveScheduledDate: vi.fn().mockResolvedValue('2026-06-01'),
      resolveInspectorId: vi.fn().mockResolvedValue('user_inspector'),
      ...overrides,
    };
  }

  it('schedules a move-in inspection through the service', async () => {
    const service = makeService();
    const adapter = createRealInspectionAdapter({
      service,
      hints: makeHints(),
    });

    const result = await adapter.scheduleMoveInInspection(
      'tenant_1',
      'unit_1',
      'cust_1',
    );

    expect(result).toEqual({ inspectionId: 'insp_1' });
    expect(service.scheduleInspection).toHaveBeenCalledTimes(1);
    const [tenantId, propertyId, unitId, type, scheduledDate, inspectorId, options] =
      service.scheduleInspection.mock.calls[0];
    expect({ tenantId, propertyId, unitId, type, scheduledDate, inspectorId }).toEqual({
      tenantId: 'tenant_1',
      propertyId: 'prop_1',
      unitId: 'unit_1',
      type: 'move_in',
      scheduledDate: '2026-06-01',
      inspectorId: 'user_inspector',
    });
    expect(options).toMatchObject({ createdBy: 'user_inspector' });
  });

  it('falls back when any hint resolves null', async () => {
    const service = makeService();
    const adapter = createRealInspectionAdapter({
      service,
      hints: makeHints({
        resolveInspectorId: vi.fn().mockResolvedValue(null),
      }),
    });

    const result = await adapter.scheduleMoveInInspection('t', 'u', 'c');

    expect(service.scheduleInspection).not.toHaveBeenCalled();
    expect(result).toEqual({ inspectionId: null });
  });
});

// ---------------------------------------------------------------------------
// Policy port
// ---------------------------------------------------------------------------

describe('createRealPolicyAdapter', () => {
  it('binds to the leasing domain by default and forwards the decision', async () => {
    const service: RealAutonomyPolicyService = {
      isAuthorized: vi.fn().mockResolvedValue({
        authorized: true,
        requiresApproval: false,
        reason: 'auto-approved',
      }),
    };
    const adapter = createRealPolicyAdapter({ service });

    const decision = await adapter.isAuthorized('t1', 'publish_listing', { x: 1 });

    expect(decision).toEqual({
      authorized: true,
      requiresApproval: false,
      reason: 'auto-approved',
    });
    expect(service.isAuthorized).toHaveBeenCalledWith(
      't1',
      'leasing',
      'publish_listing',
      { x: 1 },
    );
  });

  it('honours an explicit domain override', async () => {
    const service: RealAutonomyPolicyService = {
      isAuthorized: vi.fn().mockResolvedValue({
        authorized: false,
        requiresApproval: true,
        reason: 'needs head approval',
      }),
    };
    const adapter = createRealPolicyAdapter({ service, domain: 'finance' });

    await adapter.isAuthorized('t', 'a');

    expect(service.isAuthorized).toHaveBeenCalledWith('t', 'finance', 'a', undefined);
  });
});

// ---------------------------------------------------------------------------
// Events port
// ---------------------------------------------------------------------------

describe('createRealEventAdapter', () => {
  it('wraps the orchestrator event in the standard envelope shape', async () => {
    const bus: RealEventBus = { publish: vi.fn().mockResolvedValue(undefined) };
    const adapter = createRealEventAdapter({
      bus,
      eventId: () => 'evt_fixed',
      correlationId: () => 'corr_fixed',
      now: () => '2026-05-05T00:00:00.000Z',
    });

    await adapter.emit({
      eventType: 'VacancyPipeline:listed',
      tenantId: 'tenant_1',
      runId: 'vpr_1',
      unitId: 'unit_1',
      state: 'listed',
      payload: { from: 'idle', via: 'StartPipeline' },
    });

    expect(bus.publish).toHaveBeenCalledTimes(1);
    expect((bus.publish as any).mock.calls[0][0]).toEqual({
      event: {
        eventId: 'evt_fixed',
        eventType: 'VacancyPipeline:listed',
        timestamp: '2026-05-05T00:00:00.000Z',
        tenantId: 'tenant_1',
        correlationId: 'corr_fixed',
        causationId: null,
        metadata: {},
        payload: {
          runId: 'vpr_1',
          unitId: 'unit_1',
          state: 'listed',
          from: 'idle',
          via: 'StartPipeline',
        },
      },
      version: 1,
      aggregateId: 'vpr_1',
      aggregateType: 'VacancyPipelineRun',
    });
  });

  it('swallows bus errors and forwards to onError', async () => {
    const onError = vi.fn();
    const bus: RealEventBus = {
      publish: vi.fn().mockRejectedValue(new Error('bus offline')),
    };
    const adapter = createRealEventAdapter({ bus, onError });

    await expect(
      adapter.emit({
        eventType: 'X',
        tenantId: 't',
        runId: 'r',
        unitId: 'u',
        state: 'listed',
        payload: {},
      }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Enquiry port
// ---------------------------------------------------------------------------

describe('createRealEnquiryAdapter', () => {
  it('returns the customerId from EnquiryService.latestApplicant', async () => {
    const service: RealEnquiryService = {
      latestApplicant: vi.fn().mockResolvedValue({ customerId: 'cust_42' }),
    };
    const adapter = createRealEnquiryAdapter({ service });

    const result = await adapter.latestApplicant('tenant_1', 'lst_1');

    expect(result).toEqual({ customerId: 'cust_42' });
    expect(service.latestApplicant).toHaveBeenCalledWith({
      tenantId: 'tenant_1',
      listingId: 'lst_1',
    });
  });

  it('returns null when the service has no applicant for the listing', async () => {
    const service: RealEnquiryService = {
      latestApplicant: vi.fn().mockResolvedValue(null),
    };
    const adapter = createRealEnquiryAdapter({ service });

    const result = await adapter.latestApplicant('t', 'lst');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Renewal port (semantically: first-term lease seeder)
// ---------------------------------------------------------------------------

describe('createRealRenewalAdapter', () => {
  it('returns the leaseId from LeaseService.seedFirstTerm', async () => {
    const service: RealLeaseSeedingService = {
      seedFirstTerm: vi.fn().mockResolvedValue({ leaseId: 'lease_x9' }),
    };
    const adapter = createRealRenewalAdapter({ service });

    const result = await adapter.seedFirstTerm('tenant_1', 'unit_1', 'cust_1');

    expect(result).toEqual({ leaseId: 'lease_x9' });
    expect(service.seedFirstTerm).toHaveBeenCalledWith({
      tenantId: 'tenant_1',
      unitId: 'unit_1',
      customerId: 'cust_1',
    });
  });

  it('falls back to the default port when the service returns null', async () => {
    const service: RealLeaseSeedingService = {
      seedFirstTerm: vi.fn().mockResolvedValue(null),
    };
    const adapter = createRealRenewalAdapter({ service });

    const result = await adapter.seedFirstTerm('t', 'u', 'c');

    expect(result).toEqual({ leaseId: null });
  });
});

// ---------------------------------------------------------------------------
// Waitlist port
// ---------------------------------------------------------------------------

describe('createRealWaitlistAdapter', () => {
  it('invokes WaitlistService.markFilled when a service is supplied', async () => {
    const service: RealWaitlistService = {
      markFilled: vi.fn().mockResolvedValue(undefined),
    };
    const adapter = createRealWaitlistAdapter({ service });

    await adapter.markUnitFilled('t1', 'u1');

    expect(service.markFilled).toHaveBeenCalledWith({
      tenantId: 't1',
      unitId: 'u1',
    });
  });

  it('prefers the real service over a bare callback when both are supplied', async () => {
    const service: RealWaitlistService = {
      markFilled: vi.fn().mockResolvedValue(undefined),
    };
    const markFilled = vi.fn().mockResolvedValue(undefined);
    const adapter = createRealWaitlistAdapter({ service, markFilled });

    await adapter.markUnitFilled('t1', 'u1');

    expect(service.markFilled).toHaveBeenCalledTimes(1);
    expect(markFilled).not.toHaveBeenCalled();
  });

  it('invokes the markFilled callback when only the callback is supplied', async () => {
    const markFilled = vi.fn().mockResolvedValue(undefined);
    const adapter = createRealWaitlistAdapter({ markFilled });

    await adapter.markUnitFilled('t1', 'u1');

    expect(markFilled).toHaveBeenCalledWith('t1', 'u1');
  });

  it('falls back to the default no-op when neither is supplied', async () => {
    const adapter = createRealWaitlistAdapter({});
    await expect(adapter.markUnitFilled('t', 'u')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Composite bundle
// ---------------------------------------------------------------------------

describe('createRealOrchestratorAdapters', () => {
  it('falls through to defaults for ports without supplied deps', async () => {
    const adapters = createRealOrchestratorAdapters({});
    // Every port still has a sensible default when no deps are supplied.
    const applicant = await adapters.enquiry.latestApplicant('t', 'lst');
    expect(applicant).toBeNull();
    const lease = await adapters.renewal.seedFirstTerm('t', 'u', 'c');
    expect(lease).toEqual({ leaseId: null });
  });

  it('wires real enquiry + renewal + waitlist when supplied', async () => {
    const enquiryService: RealEnquiryService = {
      latestApplicant: vi.fn().mockResolvedValue({ customerId: 'cust_zzz' }),
    };
    const leaseSeedingService: RealLeaseSeedingService = {
      seedFirstTerm: vi.fn().mockResolvedValue({ leaseId: 'lease_zzz' }),
    };
    const waitlistService: RealWaitlistService = {
      markFilled: vi.fn().mockResolvedValue(undefined),
    };

    const adapters = createRealOrchestratorAdapters({
      enquiry: { service: enquiryService },
      renewal: { service: leaseSeedingService },
      waitlist: { service: waitlistService },
    });

    const applicant = await adapters.enquiry.latestApplicant('t1', 'lst_1');
    expect(applicant).toEqual({ customerId: 'cust_zzz' });

    const lease = await adapters.renewal.seedFirstTerm('t1', 'u1', 'c1');
    expect(lease).toEqual({ leaseId: 'lease_zzz' });

    await adapters.waitlist.markUnitFilled('t1', 'u1');
    expect(waitlistService.markFilled).toHaveBeenCalledWith({
      tenantId: 't1',
      unitId: 'u1',
    });
  });

  it('wires real listing + credit-rating + policy when supplied, defaults the rest', async () => {
    const listingService: RealListingService = {
      publish: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { id: 'lst_X' } }),
    };
    const creditRatingService: RealCreditRatingService = {
      computeRating: vi.fn().mockResolvedValue({ score: 690 }),
    };
    const policyService: RealAutonomyPolicyService = {
      isAuthorized: vi.fn().mockResolvedValue({
        authorized: true,
        requiresApproval: false,
        reason: 'ok',
      }),
    };

    const adapters = createRealOrchestratorAdapters({
      listing: {
        service: listingService,
        hints: {
          resolveHeadlinePrice: () => Promise.resolve(40_000),
          resolveCurrency: () => Promise.resolve('TZS'),
        },
      },
      creditRating: { service: creditRatingService },
      policy: { service: policyService },
    });

    const listing = await adapters.listing.publishListing('t', 'u', 'a', 'c');
    expect(listing.listingId).toBe('lst_X');

    const score = await adapters.creditRating.score('t', 'c');
    expect(score.score).toBe(690);

    const decision = await adapters.policy.isAuthorized('t', 'publish_listing');
    expect(decision.authorized).toBe(true);

    // Negotiation/inspection/waitlist remain defaults.
    const offer = await adapters.negotiation.proposeOffer('t', 'l', 'c', 'a');
    expect(offer.negotiationId).toMatch(/^neg_/);
    const insp = await adapters.inspection.scheduleMoveInInspection('t', 'u', 'c');
    expect(insp).toEqual({ inspectionId: null });
    await expect(adapters.waitlist.markUnitFilled('t', 'u')).resolves.toBeUndefined();
  });
});
