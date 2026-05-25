# Domain Models Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/domain-models/`
**Public entry:** `packages/domain-models/src/index.ts`
**Tier scope:** all (cross-cutting type contracts)

## Purpose

The single source of truth for shared domain types, enums, and Zod
schemas. Every package, service, and app imports from here for things
like `KycStatus`, `LeaseStatus`, `PaymentStatus`, `PropertyType`,
`OnboardingState`, currency codes, work-order priorities, and the
extensive set of audit/regulatory categorical types. No business
logic lives here — purely shapes, schemas, and zod validators.

## Entry points

- `src/index.ts` — barrel that re-exports every subdomain.
- Subdomain barrels: `common/`, `customer/`, `property/`, `lease/`,
  `ledger/`, `payment/`, `payments/`, `documents/`, `intelligence/`,
  `maintenance/`, `audit/`, `geo/`, `identity/`, `legal/`,
  `notifications/`, `operations/`, `regulatory/`, `statements/`.

## Internal structure

- `common/enums.ts` — every shared enum + matching Zod schema
  (`AssetStatus + AssetStatusSchema`).
- One folder per bounded context with its own `index.ts`.
- Each schema is exported both as a TS type and as a runtime Zod
  schema so API gateway can parse incoming payloads.

## Dependencies

- Upstream: none (zero-dependency leaf package).
- Downstream: every other workspace package + service + app.

## Common workflows

- **Add a new status enum** → declare in
  `common/enums.ts` with matching `<Name>Schema = z.nativeEnum(...)`,
  re-export from `src/index.ts`.
- **Validate an API payload** → import the Zod schema, call
  `.parse(input)` at the route boundary.
- **Use in DB column** → import the enum type for Drizzle column
  enum constraints.

## Anti-patterns to avoid

- Never put business logic here — pure shapes only.
- Never import this package's `node_modules` reach-throughs; always
  consume from the barrel.
- Don't duplicate enums elsewhere — extend here.
- Don't mutate exported schemas at runtime.

## Related codemaps

- [database.md](./database.md) — uses these enums in Drizzle schemas
- [api-gateway.md](./api-gateway.md) — uses Zod schemas for request validation
- [payments-ledger.md](./payments-ledger.md) — consumes `LedgerAccountType`
