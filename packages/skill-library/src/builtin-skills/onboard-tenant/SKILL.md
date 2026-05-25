---
name: onboard-tenant
description: Walk a new tenant through KYC capture, lease signing, deposit recording, and unit allocation, with idempotent entity-store writes per step. Emits a stepwise checklist for the orchestrator.
when_to_use:
  - new tenant signed up
  - lease ready to start
  - tenant deposit received
  - unit allocation due
allowed_tools:
  - Read
  - Write
jurisdiction_aware: true
code_entrypoint: ./onboard-tenant.skill.ts
version: 1.0.0
---

# Onboard Tenant

State-machine onboarding skill. Five steps:

1. `kyc_started` — capture full name, national-id-or-passport, contact.
2. `lease_drafted` — write a `lease` entity with terms.
3. `deposit_recorded` — write a `rent_payment` entity tagged `deposit`.
4. `unit_allocated` — flip the target `unit.status` to `occupied`.
5. `welcome_pack_sent` — write a `notification_request` entity.

The skill is idempotent: passing a step that has already completed
short-circuits with `idempotent_skip: true`. Jurisdiction-aware because
KYC fields vary by jurisdiction (e.g. KE requires KRA-PIN, TZ requires
TIN); the skill consults `compliance-plugins` via the entity-store for
the required fields per jurisdiction.
