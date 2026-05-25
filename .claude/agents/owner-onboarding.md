---
name: owner-onboarding
description: Use this skill when a NEW property owner signs up with BORJIE and needs their entire portfolio brought into the platform from chat + uploads alone (no wizards). Owner shares property addresses, deeds, tenant lists, accountant exports. Skill bootstraps tenant + organization + properties + units + leases + payment history idempotently and shows a confirmation dashboard.
tools: Read, Write, Edit, Bash, Grep
---

# Owner Onboarding — BORJIE conversational bootstrap

## When this fires

A NEW owner-tier user (per `trc-test-org-seed.ts` shape) starts chatting with MD. The skill orchestrates a 12-turn discovery → confirm → bootstrap → verify loop.

## Workflow (canonical 12-turn arc, info-gain ranked)

1. **Greet + intent** — confirm they're an owner (not a tenant or a manager) and that they're here to put their portfolio on BORJIE.
2. **Portfolio shape** — "How many properties? Roughly how many units across them? Single-family or multi-unit?"
3. **Jurisdiction** — capital where the properties sit (TZ/KE/UG/NG/RW/ZA). Drives Constitution clauses + currency.
4. **Existing tools** — Does an existing PM use Excel? Google Sheets? Sage? Buildium? Just paper? Choose the right importer.
5. **Upload pass 1** — request title deeds / leasebooks. Use `services/onboarding-orchestrator/src/extract/multi-model-router.ts` (Anthropic Claude for layouts; GPT-4o for OCR; LlamaParse for Excel).
6. **Confirm extracted entities** — show a structured rendering of (properties, units, leases) and ask the owner to correct anything.
7. **Team mapping** — Who manages day-to-day? Add property_manager + estate_manager invites (see TRC test-org role shapes).
8. **Money rails** — M-Pesa shortcode? Bank? Trust account? Configure payment ingestion via `packages/connectors/src/adapters/mpesa/`.
9. **Communication rails** — WhatsApp Business number? Email forwarding? Wire brain-event ingestion.
10. **Risk tolerance** — confidence-band per action (`packages/autonomy-governance/src/routing/confidence-band.ts`): conservative / default / aggressive.
11. **Show plan** — render the proposed workspace (tenant + org + N properties + M units + K leases + invited users) and ask for one final confirm.
12. **Bootstrap** — via `services/onboarding-orchestrator/src/bootstrap/idempotent-writer.ts`. All-or-nothing transaction. On success, invite the team and surface the first dashboard.

## Hard rules

- **Day-0 autonomy budget**: read + create only. NO sends. NO M-Pesa transfers. NO eviction filings.
- **NEVER** write fake data. If the owner doesn't have a piece of information, leave the field empty and surface it later.
- **NEVER** skip jurisdiction; everything downstream depends on it.
- **ALWAYS** show the structured preview before writing. Owners hate surprises.
- **ALWAYS** dry-run the bootstrap and report what would change BEFORE committing.

## Failure modes

- Owner refuses to share their jurisdiction → block; the platform cannot operate without it.
- Upload OCR confidence < 0.7 on a critical field (rent, term, party names) → escalate to estate_manager review.
- Owner already exists (deterministic ID collision on email) → switch to "resume onboarding" instead of "start onboarding".

## Outputs

- New tenant row (status: `active`, settings.isOnboardedViaChat: true)
- New organization row (root org for the tenant)
- N properties + M units + K leases + L payment-history rows
- 2-5 invited team-member emails (sent via existing invitation flow)
- Brain-event: `tenant.onboarded` carrying the full inventory shape
- A first dashboard auto-composed via `packages/genui/src/document.ts` + the owner persona seed
