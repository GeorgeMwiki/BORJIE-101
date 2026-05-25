---
name: prepare-kra-filing
description: Stage a KRA (Kenya Revenue Authority) rental-income filing draft from a tenant's rent-payment ledger for a given period. Jurisdiction-gated to KE. Writes a `kra_filing_draft` entity for operator review.
when_to_use:
  - KE landlord needs to file rental income
  - monthly rental-income (MRI) return due
  - operator asks to prepare KRA filing
allowed_tools:
  - Read
  - Write
jurisdiction_aware: true
code_entrypoint: ./prepare-kra-filing.skill.ts
version: 1.0.0
---

# Prepare KRA Filing

Constructs a draft Monthly Rental Income (MRI) filing for a KE landlord
based on the rent payments recorded against their properties during the
return period. The skill:

1. Aggregates gross rental income from the payment ledger (KES only).
2. Applies the gross-tax method default (currently 7.5% for MRI — the
   skill READS the rate from the entity-store `kra_rate` config, not
   hardcoded).
3. Computes net tax payable.
4. Writes a `kra_filing_draft` entity for operator four-eye review.

**The skill never SUBMITS the filing** — the operator must approve via the
autonomy-governance flow before submission to iTax happens.

The skill is jurisdiction-gated: the library will refuse to retrieve it
into a non-KE tenant context (because `jurisdiction !== 'KE'` invalidates
retrieval).
