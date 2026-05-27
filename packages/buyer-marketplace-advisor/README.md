# @borjie/buyer-marketplace-advisor

Buyer-side marketplace advisor for the BORJIE Tanzania mining SaaS.

## What it does

Given a buyer's commodity need, this package:

1. **`recommendMines(need)`** — ranks the tenant's mines by fit score
   across volume / grade / price / region / compliance.
2. **`assessKycRisk(buyerId, tenantId)`** — scores KYC facts and
   returns a band (low / medium / high) plus blockers.
3. **`proposePaymentTerms(input)`** — selects a primary payment
   instrument (Net-30/60, LC, escrow, CAD, open account) with a
   deposit % and an FX hedge ladder (spot / forward / option).
4. **`estimateEta(input)`** — combines logistics-port route data with
   tonnage + disruption uplift to return days + uncertainty.

All public input is parsed via Zod at the boundary; nothing internal
trusts external shape. All cross-tenant access is blocked via the
tenantId scope on every read port.

## Usage

```ts
import {
  createBuyerMarketplaceAdvisor,
  createInMemoryMineCatalog,
  createInMemoryKycSource,
  createInMemoryLogistics,
} from '@borjie/buyer-marketplace-advisor';

const advisor = createBuyerMarketplaceAdvisor({
  mineCatalog: createInMemoryMineCatalog(myMines),
  kycSource: createInMemoryKycSource(myKycFacts),
  logistics: createInMemoryLogistics(myRoutes),
});

const recs = await advisor.recommendMines({
  buyerId: 'buyer-001',
  tenantId: 'tenant-tz-001',
  commodity: 'gold',
  volumeTonnes: 300,
  minGrade: 3.0,
  preferredRegions: ['TZ-20'],
});
```

## Wrapped packages

- `@borjie/mining-commodity-intelligence` — mine catalog + price feed
- `@borjie/compliance-pack` — KYC screening + sanctions list
- `@borjie/fx-treasury-advisor` — FX hedge calibration
- `@borjie/geo-intelligence` / `@borjie/geo-parcels` — route + disruption

In-memory ports ship for tests; composition roots replace them with
Drizzle-backed adapters. Replacement points are marked `TODO(wire)`.

## Errors

| Code | Class | Cause |
| --- | --- | --- |
| `UNKNOWN_BUYER` | `UnknownBuyerError` | KYC source has no record for the buyer/tenant pair. |
| `KYC_BLOCKED` | `KycBlockedError` | Sanctions / hard-block hit. Caller should refuse to quote. |
| `ROUTE_UNAVAILABLE` | `RouteUnavailableError` | Logistics port returned no waypoints. |
| `INVALID_INPUT` | `BuyerAdvisorError` | Schema parse failure (wrapped from Zod). |
