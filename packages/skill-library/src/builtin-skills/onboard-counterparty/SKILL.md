---
name: onboard-counterparty
description: Walk a new counterparty through KYC capture, supply-agreement signing, prepayment recording, and consignment allocation, with idempotent entity-store writes per step. Emits a stepwise checklist for the orchestrator.
when_to_use:
  - new counterparty signed up
  - supply agreement ready to start
  - counterparty prepayment received
  - consignment allocation due
allowed_tools:
  - Read
  - Write
jurisdiction_aware: true
code_entrypoint: ./onboard-counterparty.skill.ts
version: 1.0.0
---

# Onboard Counterparty

State-machine onboarding skill. Five steps:

1. `kyc_started` — capture full name, national-id-or-passport, contact.
2. `agreement_drafted` — write an `offtake_agreement` entity with terms.
3. `prepayment_recorded` — write a `royalty_payment` entity tagged `prepayment`.
4. `allocation_confirmed` — flip the target `consignment.status` to `allocated`.
5. `welcome_pack_sent` — write a `notification_request` entity.

The skill is idempotent: passing a step that has already completed
short-circuits with `idempotent_skip: true`. Jurisdiction-aware because
KYC fields vary by jurisdiction (e.g. TZ requires a TRA TIN, plus a
Mining Commission counterparty reference); the skill consults
`compliance-plugins` via the entity-store for the required fields per
jurisdiction.
