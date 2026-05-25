# `@borjie/anti-corruption-layer`

DDD Anti-Corruption Layer (ACL) pattern + worked examples. Closes LITFIN-parity audit item 3.

## Why this exists

The domain layer should not know what Drizzle, M-Pesa Daraja, Stripe, or Supabase
look like. When their shapes leak into domain code, three things break:

1. **Refactors propagate.** Renaming `display_name` in the DB forces edits across the
   service, controller, and presenter layers.
2. **Vendor lock-in.** Replacing M-Pesa with Airtel Money requires touching every file
   that pattern-matches on `ResponseCode === "0"`.
3. **Test fragility.** Unit tests need to manufacture vendor-shaped fixtures with all
   the PascalCase keys, null-flavored absences, and stringly-typed integers.

The ACL absorbs the boundary. Inside the boundary, the domain speaks its own clean
dialect. At the edge, ACL subclasses translate to/from the external dialect.

## When to use this vs Zod

Use Zod when you want **validation** — "is this payload well-formed?". Use ACL when
you want **translation** — "convert this well-formed payload to the domain shape".
They compose: parse with Zod first, then feed the result through the ACL.

## Pattern

```ts
import { BaseACL, type BaseACLOptions } from '@borjie/anti-corruption-layer';

// 1. Define the domain shape.
interface DomainLease {
  readonly id: LeaseId;
  readonly rentAmount: Money;
  readonly startDate: Date;
}

// 2. Define the external shape (mirror the foreign system EXACTLY).
interface DrizzleLeaseRow {
  readonly id: string;
  readonly rent_amount_cents: number;
  readonly start_date: Date;
}

// 3. Subclass.
class LeaseDrizzleACL extends BaseACL<DomainLease, DrizzleLeaseRow> {
  constructor(opts: BaseACLOptions = {}) { super(opts); }

  protected override mapToDomain(row: DrizzleLeaseRow): DomainLease {
    return {
      id: row.id as LeaseId,
      rentAmount: Money.fromCents(row.rent_amount_cents),
      startDate: row.start_date,
    };
  }

  protected override mapFromDomain(domain: DomainLease): DrizzleLeaseRow {
    return {
      id: domain.id,
      rent_amount_cents: domain.rentAmount.toCents(),
      start_date: domain.startDate,
    };
  }
}
```

## Caching

Pass `cacheSize` to memoise `toDomain` results. Useful when the same external row
is read many times in one request (joins, batch ingestion).

```ts
new LeaseDrizzleACL({ cacheSize: 1000 });
```

Cache keys are canonical-JSON forms of the external object, so semantically-equal
inputs (same fields in different order) hit the same cache entry.

## Code generation

`generateACL()` emits a subclass skeleton. Hand-edit afterwards for complex
transforms — the generator only handles 1:1 field mappings.

```ts
import { generateACL } from '@borjie/anti-corruption-layer';

const src = generateACL({
  className: 'LeaseACL',
  domainType: 'Lease',
  externalType: 'LeaseRow',
  mappings: [
    { domainField: 'id', externalField: 'id' },
    {
      domainField: 'rentAmount',
      externalField: 'rent_amount_cents',
      toDomainExpr: 'Money.fromCents(external.rent_amount_cents)',
      fromDomainExpr: 'domain.rentAmount.toCents()',
    },
  ],
});
```

## Worked examples in this package

- `TenantDrizzleACL` — typical snake_case row → camelCase domain (drizzle-acl.ts)
- `MPesaSTKPushACL` — vendor PascalCase + stringly-typed → discriminated union (mpesa-acl.ts)

Subclass these for tenants / payments respectively, or copy the shape for new
boundaries.

## Decision tree

```
Is the external system foreign (vendor API / legacy DB / partner system)?
├─ No  → just inline the mapping; no ACL needed
└─ Yes ↓
   Will more than one call-site translate this shape?
   ├─ No  → inline once; revisit if it grows
   └─ Yes ↓
      Are there business rules in the translation
      (e.g. "ResponseCode '0' means success")?
      ├─ Yes → ACL absolutely (encapsulate the rule)
      └─ No  → ACL still preferred (cleaner refactors)
```
