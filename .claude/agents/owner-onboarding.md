---
name: owner-onboarding
description: Use this skill when a NEW mining-estate owner signs up with Borjie and needs their estate brought into the platform from chat + uploads alone (no wizards). Owner shares licences, royalty statements, workforce rosters, accountant exports. Skill bootstraps tenant + organization + sites/licences + workforce + holdings idempotently and shows a confirmation dashboard. NOTE (Batch-3 hygiene): the canonical implementation now lives behind the live `/api/v1/mining/onboarding` gateway routes — the old `services/onboarding-orchestrator` stub was deleted as a property-mgmt relic. Treat the property-flavoured wording below (deeds/units/leases/eviction) as stale and map it onto the mining estate model.
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
5. **Upload pass 1** — request licences / royalty statements / accountant exports. Route them through the live document-intelligence pipeline at `services/api-gateway/src/routes/mining/document-intelligence.hono.ts` (OCR + extraction → `intelligence_corpus_chunks`). NOTE: the old `services/onboarding-orchestrator/src/extract/multi-model-router.ts` was removed in the Batch-3 hygiene pass — do not reference it.
6. **Confirm extracted entities** — show a structured rendering of (properties, units, leases) and ask the owner to correct anything.
7. **Team mapping** — Who manages day-to-day? Add property_manager + estate_manager invites (see TRC test-org role shapes).
8. **Money rails** — M-Pesa shortcode? Bank? Trust account? Configure payment ingestion via `packages/connectors/src/adapters/mpesa/`.
9. **Communication rails** — WhatsApp Business number? Email forwarding? Wire brain-event ingestion.
10. **Risk tolerance** — confidence-band per action (`packages/autonomy-governance/src/routing/confidence-band.ts`): conservative / default / aggressive.
11. **Show plan** — render the proposed workspace (tenant + org + N properties + M units + K leases + invited users) and ask for one final confirm.
12. **Bootstrap** — via the live `/api/v1/mining/onboarding` gateway routes (the canonical owner-onboarding path; the old `services/onboarding-orchestrator/src/bootstrap/idempotent-writer.ts` stub was deleted in the Batch-3 hygiene pass). All-or-nothing transaction. On success, invite the team and surface the first dashboard.

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
