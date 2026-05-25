---
name: eviction-prep
description: Use this skill ONLY when a tenant is in confirmed arrears beyond the jurisdictional grace period and the operator wants to PREPARE (not execute) an eviction. Drafts the lawful notice per jurisdiction, captures evidence chain, schedules human-only escalation. Constitution C09 hard-blocks autonomous filing. Triggers on "prepare eviction", "draft eviction notice", "tenant arrears escalation".
tools: Read, Write, Edit, Bash, Grep
---

# Eviction Preparation — BORJIE operator skill

## ⚠️ Hard gate

Constitution C09 (NO-AUTONOMOUS-FILING) requires human approval at every commit point. This skill is **draft-and-stage only**. It produces documents and a scheduled escalation — never files them.

## When this fires

Operator asks AI to prepare an eviction. Pre-conditions ALL must be true:

1. Tenant is at least the **jurisdictional minimum** months in arrears (see `borjie-constitution.ts` C04 + jurisdiction registry).
2. At least one **payment-plan offer** has been declined OR no response within 14 days.
3. The unit is NOT under a court-ordered moratorium.
4. The lease was lawfully executed and is on file (verify via `@borjie/document-studio` lookup).

If any pre-condition fails → REFUSE and surface what's missing.

## Workflow

1. **Verify** all four pre-conditions; if any fail, refuse with reason codes.
2. **Read** lease, full payment ledger, all communication history (calls/SMS/WhatsApp via brain-event-bus), and any maintenance tickets that might constitute habitability issues (Constitution C07).
3. **Habitability check** — if there are open habitability complaints, REFUSE pending resolution. Eviction during unresolved habitability is high-litigation risk.
4. **Compose the notice** via `@borjie/document-studio` (template: `eviction-notice/<jurisdiction>`):
   - TZ: Land Act 1999 Sec. 53 — 30 days written notice
   - KE: Land Act 2012 Sec. 152 — 90 days for monthly tenancy
   - UG: LTA 2022 — 30 days for non-payment
   - NG: Recovery of Premises Law — quit notice per state
5. **Build evidence bundle** (zip): ledger CSV, all comms, lease PDF, KYC docs, prior notices.
6. **Confidence-band check** — if eviction risk model returns < 0.95 (auto-band), escalate to a senior reviewer (`packages/autonomy-governance/src/routing/confidence-band.ts`).
7. **Queue four-eye approval** — TWO operators with `estate_manager` or higher role must approve before the notice leaves the platform. Persist the original-portal + tier (privilege-laundering defense).
8. **Notify tenant** — schedule a courtesy heads-up via WhatsApp 24 hours before the notice is served (lawful in all four jurisdictions).
9. **DO NOT** commit the eviction case state yet. The case opens only on `eviction.served` event from a human operator.

## Hard rules

- **NEVER** generate a notice without jurisdictional citation block.
- **NEVER** skip the habitability check.
- **NEVER** bypass the four-eye approval.
- **ALWAYS** persist a hash-chain audit-trail entry for the draft + every approval action.
- **ALWAYS** offer the tenant one final payment plan in the same envelope (per Constitution C03 — owner funds segregation; payments still go through trust account).

## Failure modes

- Court moratorium detected → REFUSE + escalate to legal team via the existing case-management surface.
- Tenant has a pending habitability claim → REFUSE + create a remediation ticket.
- Operator attempts to auto-serve → BLOCKED by C09 + audit-log the attempt.

## Outputs

- `eviction_notice.pdf` (signed by 2 approvers; never auto-served)
- `evidence_bundle.zip`
- `last_chance_offer.docx` (delivered alongside)
- Brain-event: `eviction.draft.ready` (NOT `eviction.served`; that fires only from human action)
