---
name: prepare-tra-filing
description: Stage a TRA (Tanzania Revenue Authority) mineral royalty return draft from an operator's royalty-payment ledger for a given period. Jurisdiction-gated to TZ. Writes a `tra_filing_draft` entity for operator review.
when_to_use:
  - TZ operator needs to file a mineral royalty return
  - monthly royalty return due
  - operator asks to prepare TRA filing
allowed_tools:
  - Read
  - Write
jurisdiction_aware: true
code_entrypoint: ./prepare-tra-filing.skill.ts
version: 1.0.0
---

# Prepare TRA Filing

Constructs a draft mineral royalty return for a TZ operator based on the
royalty payments recorded against their sites during the return period.
The skill:

1. Aggregates gross mineral value from the payment ledger (TZS only).
2. Applies the statutory mineral royalty rate (currently 6% under the
   Mining Act 2010 (am. 2017) — the skill READS the rate from the
   entity-store `tra_royalty_rate` config, not hardcoded). The 1%
   clearing fee is staged downstream by the compliance plugin.
3. Computes net royalty payable.
4. Writes a `tra_filing_draft` entity for operator four-eye review.

**The skill never SUBMITS the filing** — the operator must approve via the
autonomy-governance flow before submission to the Mining Commission / TRA
portal happens.

The skill is jurisdiction-gated: the library will refuse to retrieve it
into a non-TZ tenant context (because `jurisdiction !== 'TZ'` invalidates
retrieval).
