# Vacancy-to-Lease Orchestrator — Real Adapters

The orchestrator is composition-agnostic: it depends only on nine narrow
ports defined in `orchestrator-service.ts`. `default-adapters.ts`
provides a conservative no-op / synthetic-id implementation of every
port so the gateway can boot without wiring everything. `real-adapters.ts`
fills in the gap for the ports where a concrete domain service
already exists in this monorepo.

## Wiring matrix

| Port | Status | Backing service / reason |
|------|--------|---------------------------|
| `OrchestratorListingPort` | REAL_WIRED | `domain-services/marketplace/ListingService.publish` |
| `OrchestratorEnquiryPort` | REAL_WIRED | `domain-services/marketplace/EnquiryService.latestApplicant` (returns the most recent `prospect_customer_id` for a listing; backed by an `EnquiryReadModel` injected at the composition root). |
| `OrchestratorCreditRatingPort` | REAL_WIRED | `ai-copilot/credit-rating/CreditRatingService.computeRating` |
| `OrchestratorNegotiationPort` | REAL_WIRED | `domain-services/negotiation/NegotiationService.startNegotiation` (requires a tenant `policyId` + opening offer; supplied by `RealNegotiationHints`). |
| `OrchestratorInspectionPort` | REAL_WIRED | `domain-services/inspections/InspectionService.scheduleInspection` (requires `propertyId`, `scheduledDate`, `inspectorId`; supplied by `RealInspectionHints`). |
| `OrchestratorRenewalPort` | REAL_WIRED | `domain-services/lease/LeaseService.seedFirstTerm` (note: the port is named "renewal" historically — semantically it creates the *initial* lease term using a 12-month default + the unit's market rent via the `UnitFirstTermFinder` injected on `LeaseService`). |
| `OrchestratorWaitlistPort` | REAL_WIRED | `domain-services/waitlist/WaitlistService.markFilled` (flips every active waitlist entry for the unit to `converted`). A bare `markFilled` callback on `RealOrchestratorAdaptersDeps.waitlist.markFilled` is also accepted for back-compat. |
| `OrchestratorPolicyPort` | REAL_WIRED | `ai-copilot/autonomy/AutonomyPolicyService.isAuthorized` (bound to the `'leasing'` domain). |
| `OrchestratorEventPort` | REAL_WIRED | Any `EventBus.publish` accepting the standard `EventEnvelope` shape. |

## Composition-root usage

In the api-gateway, compose the orchestrator with whichever real
services have been wired and let the rest fall through to defaults:

```ts
import {
  VacancyToLease,
} from '@borjie/ai-copilot/orchestrators';

const adapters = VacancyToLease.createRealOrchestratorAdapters({
  listing: {
    service: services.marketplace.listing,
    hints: {
      resolveHeadlinePrice: (t, u) => unitsRepo.askingRent(t, u),
      resolveCurrency: (t) => tenantConfig.currencyOf(t),
      resolveNegotiationPolicyId: (t, u) => policyRepo.defaultForUnit(t, u),
      resolvePropertyId: (t, u) => unitsRepo.propertyOf(t, u),
    },
  },
  enquiry: { service: services.marketplace.enquiry },
  creditRating: { service: services.creditRating },
  negotiation: {
    service: services.marketplace.negotiation,
    hints: {
      resolvePolicyId: (t, lst) => listingsRepo.policyOf(t, lst),
      resolveOpeningOffer: (t, lst) => listingsRepo.headlinePrice(t, lst),
    },
  },
  inspection: {
    service: services.inspections,
    hints: {
      resolvePropertyId: (t, u) => unitsRepo.propertyOf(t, u),
      resolveScheduledDate: () => isoDateInDays(7),
      resolveInspectorId: (t, u) => staffRepo.estateManagerOf(t, u),
    },
  },
  renewal: { service: services.lease },
  policy: { service: services.autonomy.policyService },
  events: { bus: services.eventBus },
  waitlist: { service: services.waitlist },
});

const orchestrator = new VacancyToLease.VacancyToLeaseOrchestrator({
  ...adapters,
  repo: pgVacancyPipelineRepo,
});
```

The bundle returned from `createRealOrchestratorAdapters` is shaped to
spread directly into the orchestrator constructor; whatever you pass
overrides the corresponding default. **Overrides win.**

## Fallback semantics

Each `Real*Adapter` falls back transparently to its default counterpart
when:

- a hint resolver returns `null` / a non-positive number (the underlying
  service would reject the call as `VALIDATION` — better to degrade
  gracefully than 500 the pipeline)
- the underlying service signals failure with a structured
  `Result.error`, in which case the adapter throws so the orchestrator's
  `SIDE_EFFECT_FAILED` path can surface the diagnostic to the caller

The default adapters themselves never throw — they return synthetic
ids / nulls so the state machine keeps moving.

## Migration path

When a future service lands that fills one of the DEFAULT_ONLY gaps:

1. Add the relevant deps slot to `RealOrchestratorAdaptersDeps`.
2. Add a `createReal*Adapter` factory and (if needed) a `Real*Hints`
   resolver shape.
3. Wire it in `createRealOrchestratorAdapters` so callers can pass the
   service via the bundle.
4. Add a row to the wiring matrix above + a unit test in
   `__tests__/real-adapters.test.ts`.

No changes to `orchestrator-service.ts` or `default-adapters.ts` are
needed — the contracts are stable.

## Why duck-typed dependency interfaces?

The `@borjie/ai-copilot` package does not (and should not) depend
on `@borjie/domain-services` or `@borjie/observability`. The
adapter file therefore declares minimal structural types for each
service it integrates with (`RealListingService`,
`RealCreditRatingService`, etc.) — they are the smallest subset of the
real surface the adapter actually invokes. This keeps the package
self-contained and makes the adapters trivially mockable in tests.
