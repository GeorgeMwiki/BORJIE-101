# Borjie cross-role chain map

**Date:** 2026-05-29
**Audience:** Builders, code reviewers, regulators who want to
verify Borjie's end-to-end multi-actor workflows.
**Status:** Authoritative inventory. Each chain rows references the
file(s) where each link is implemented. Three chains
(HR-onboarding, payroll, safety-incident) are closed end-to-end in
this same issue (#193); the rest are documented as-is and tracked in
sibling issues (#191, #194, #195) or marked as stable.

---

## Role inventory (11 roles)

| # | Role | Surface | Notes |
|--|--|--|--|
| 1 | Mining Owner | apps/owner-web | Strategic cockpit, 22 screens, 8 CEO modes. |
| 2 | Mining Manager | apps/workforce-mobile (MANAGER role) | Mid-tier supervisor; reviews onboarding + incident triage + RFB dispatch. |
| 3 | Mining Worker | apps/workforce-mobile (EMPLOYEE/WORKER role) | Field worker; clocks in, reports incidents, fulfils tasks. |
| 4 | Borjie Admin | apps/admin-web | Internal Borjie team; compliance + tenant management. |
| 5 | Mineral Buyer | apps/buyer-mobile | Mineral off-taker; posts RFBs, receives delivery notifications. |
| 6 | Visitor / Pre-signup | marketing site | Pre-tenant; converts to tenant via owner sign-up. |
| 7 | Cooperative Member | apps/workforce-mobile (subset of WORKER) | Aggregates output into a co-op share; receives settlement. |
| 8 | Insurance Broker | apps/owner-web (invitee surface) | External party; invited by owner to underwrite a parcel. |
| 9 | Regulator | apps/admin-web (read-only audit) | PCCB / NEMC / OSHA-TZ / EITI; receives filing drafts. |
| 10 | Off-taker Buyer Ops Manager | apps/buyer-mobile (org-admin tier) | Manages buyer-tenant org config + delegates buying. |
| 11 | Mr. Mwikila | AI persona, no surface | Autonomous orchestrator; tools gated by delegation matrix. |

---

## Chain catalogue

Every chain below has the same shape:
**Trigger -> Actors -> State mutations -> Notifications -> Audit.**

A chain is **CLOSED** when all five fields land in real, tested
TypeScript + UI; **DOCUMENTED** when implementation exists in a
sibling issue; **STABLE** when previously closed and verified by
this audit.

| # | Chain | Status | Reference |
|--|--|--|--|
| C1 | Commercial fulfilment (buyer RFB -> owner -> manager -> worker -> buyer signs) | DOCUMENTED (#191) | see §C1 |
| C2 | HR / workforce onboarding (owner posts opening -> candidate activates -> manager approves -> worker active) | **CLOSED (this issue, L-A)** | see §C2 |
| C3 | Payroll (clock-in -> shift-report approval -> period close -> M-Pesa bulk-payout) | **CLOSED (this issue, L-B)** | see §C3 |
| C4 | Safety incident (worker reports -> manager investigates -> owner reviews -> compliance officer files) | **CLOSED (this issue, L-C)** | see §C4 |
| C5 | Compliance / regulator (manager flags -> compliance officer drafts -> regulator-portal export) | DOCUMENTED (#194) | see §C5 |
| C6 | Knowledge / persona handoff (worker asks chat -> manager persona answers -> owner persona summarises) | DOCUMENTED (#195) | see §C6 |
| C7 | Cooperative settlement (parcel sold -> share calc -> member payout) | STABLE (built #131-#150) | see §C7 |
| C8 | Insurance claim (incident -> broker invited -> claim filed -> payout reconciliation) | DOCUMENTED (deferred) | see §C8 |
| C9 | Cross-tenant referral (owner refers peer -> peer signs up -> referrer rebate ledger) | DOCUMENTED (deferred) | see §C9 |
| C10 | Mr. Mwikila autonomous tick (cron -> Mwikila inspects state -> proposes action -> owner approves) | STABLE (built #187) | see §C10 |

---

## §C1 — Commercial fulfilment (DOCUMENTED, owned by #191)

**Trigger.** Buyer posts a Request-for-Bid (RFB) from
`apps/buyer-mobile`.

**Actors.** Buyer -> Owner -> Manager -> Worker -> Buyer.

**State mutations.**
1. `request_for_bids` row created.
2. Owner accepts -> `request_for_bid_responses` row.
3. Owner dispatches fulfilment -> `mining_tasks` row
   `kind='rfb_fulfill'`, `parent_rfb_id` set
   (`services/api-gateway/src/routes/mining/tasks.hono.ts`).
4. Manager assigns worker.
5. Worker submits chain-of-custody steps.
6. Buyer signs final CoC step.
7. Settlement orchestrator computes gross/royalty/fee/net + posts
   via `LedgerService.post()`
   (`services/api-gateway/src/services/settlement/*`).
8. Buyer notification enqueued
   (`buyer_notifications`, migration 0132).

**Notifications.** Buyer-mobile push on every state transition +
SSE pulse on owner cockpit.

**Audit.** Hash-chained entries in `ai_audit_chain` on every
mutation. Settlement row binds the ledger journal id.

**Locked files (do NOT touch in #193).**
- `services/api-gateway/src/services/settlement/*`
- `services/api-gateway/src/routes/marketplace/rfb.hono.ts` (dispatch leg)
- `services/api-gateway/src/routes/mining/tasks.hono.ts` (assign-worker leg)
- `services/api-gateway/src/routes/buyer/notifications.hono.ts`
- `apps/owner-web/src/app/(routes)/marketplace/*`
- `apps/workforce-mobile/app/worker/*` task screens
- `apps/buyer-mobile/app/notifications.tsx`
- `apps/buyer-mobile/app/sign-delivery.tsx`

---

## §C2 — HR / workforce onboarding (CLOSED in this issue, L-A)

**Trigger.** Owner posts a workforce opening from owner-web.

**Actors.** Owner -> (optional Mwikila draft) -> Candidate -> Manager
-> Worker.

**State mutations.**
1. Owner creates `workforce_openings` row
   (status=`open`, role=`employee|manager`, expires_at, count_needed)
   via `POST /api/v1/workforce/openings`.
2. Owner / Mwikila drafts invitation from opening via
   `POST /api/v1/workforce/invitations/from-opening` -> creates
   `workforce_invitations` row (uses the existing migration 0086
   substrate; opening_id added in migration 0134).
3. Candidate receives SMS deep-link -> activates via existing
   `POST /api/v1/workforce/invites/activate` (unchanged).
4. Manager opens "Onboarding queue" tab on workforce-mobile and
   reviews newly-activated candidate. Approve -> sets
   `users.workforce_status='active'` and decrements
   `workforce_openings.count_needed`. Reject -> sets
   `users.workforce_status='rejected'` and revokes invitation.
5. Worker becomes active; WorkerHomeHero card appears
   (`apps/workforce-mobile/src/components/WorkerHomeHero.tsx`).
6. First shift schedulable.

**Notifications.**
- Candidate: SMS body in sw+en with activation code.
- Manager: push on each new activation (kind=`onboarding_review`).
- Worker: push on approve (kind=`onboarding_active`).
- Owner: cockpit pulse `WorkforceOnboardingEvent` when opening fills.

**Audit.** Every transition appends to `ai_audit_chain` via the
existing `appendAuditEntry` helper.

**Brain tools added in this issue.**
- `owner.workforce_opening.create`
- `owner.workforce_opening.list`
- `manager.candidate.review`

**Files in this chain.**
- Migration: `packages/database/src/migrations/0134_workforce_openings_and_payroll.sql`
- Schema: `packages/database/src/schemas/workforce-openings.schema.ts`
- Service: `services/api-gateway/src/services/workforce-onboarding/`
- Routes: `services/api-gateway/src/routes/workforce/openings.hono.ts`
- Tests: `services/api-gateway/src/routes/workforce/__tests__/openings.test.ts`
- owner-web: `apps/owner-web/src/app/(routes)/workforce/openings/page.tsx`
- workforce-mobile: `apps/workforce-mobile/app/(manager)/onboarding.tsx`

---

## §C3 — Payroll (CLOSED in this issue, L-B)

**Trigger.** Owner triggers a payroll run for a period
(start, end).

**Actors.** Worker -> Manager (approves shift_reports) -> Owner ->
Mr. Mwikila (computes) -> Worker (receives payslip + payout).

**State mutations.**
1. Worker clocks in/out -> `clock_in_events` rows (existing schema).
2. Manager approves daily `shift_reports` (existing schema).
3. Owner POSTs `POST /api/v1/owner/payroll/runs` with
   `period_start / period_end` -> creates
   `payroll_runs` row (status=`draft`).
4. Owner POSTs `POST /api/v1/owner/payroll/runs/:id/preview` ->
   Mwikila reads clock-events + shift-reports across the period,
   computes per-worker:
   - base_tzs = hours * rate
   - overtime_tzs = overtime_hours * rate * 1.5
   - bonus_tzs = manager-approved bonus
   - deduction_tzs = ppe / advance / loan repayments
   - net_tzs = base + overtime + bonus - deduction
   -> creates `payroll_line_items` rows + flips run to
   status=`previewed`.
5. Owner POSTs `POST /api/v1/owner/payroll/runs/:id/commit` ->
   - For each line item: **LedgerService.post()** posts the journal
     (debit: payroll-expense; credit: cash-or-bank). Hard rule per
     CLAUDE.md.
   - For each line item: enqueues M-Pesa B2C disbursement via the
     existing payouts service.
   - Flips run to status=`committed`, line items to status=`posted`.
6. M-Pesa webhook -> line item status -> `paid` or `failed`.

**Notifications.**
- Worker: push on commit (kind=`payslip_ready`).
- Owner: cockpit pulse `PayrollRunEvent` on each state change.

**Audit.** Every transition appends to `ai_audit_chain`. The ledger
journal id stamps onto each `payroll_line_items` row so the audit
view can show the full debit/credit chain.

**Brain tools.**
- `owner.payroll.run.create`
- `owner.payroll.run.preview`
- `owner.payroll.run.commit`
- `worker.payslip.show`

**Files in this chain.**
- Migration: `packages/database/src/migrations/0134_workforce_openings_and_payroll.sql`
- Schema: `packages/database/src/schemas/payroll-runs.schema.ts`
- Service: `services/api-gateway/src/services/payroll/`
- Routes: `services/api-gateway/src/routes/owner/payroll.hono.ts`
- Tests: `services/api-gateway/src/services/payroll/__tests__/payroll.test.ts`
- owner-web: `apps/owner-web/src/app/(routes)/payroll/page.tsx`
- workforce-mobile: `apps/workforce-mobile/app/(worker)/payslip.tsx`

---

## §C4 — Safety incident (CLOSED in this issue, L-C)

**Trigger.** Worker reports an incident from workforce-mobile (or
sensor auto-detect — future).

**Actors.** Worker -> Manager -> Owner -> Compliance officer
(admin-web).

**State mutations.**
1. Worker POSTs `POST /api/v1/mining/incidents` with `severity` +
   `kind` + optional photos / location (existing route, unchanged).
2. **severity-escalator** service
   (`services/api-gateway/src/services/safety-incident/escalator.ts`)
   runs synchronously after the insert:
   - low | medium -> manager investigation queue only.
   - high -> manager queue + owner cockpit pulse
     `SafetyIncidentEvent`.
   - critical | fatality -> manager + owner + admin compliance queue
     + draft regulator filing into `compliance_exports`
     (consumed by #194).
3. Manager opens incident, adds root_cause + corrective_actions,
   POSTs `POST /api/v1/mining/incidents/:id/investigate`.
4. Owner reviews on cockpit; can request escalation to OSHA / NEMC
   via `POST /api/v1/mining/incidents/:id/escalate-regulator`.
5. Compliance officer (admin) finalises filing draft + sends.
6. Manager / owner closes incident via existing
   `POST /api/v1/mining/incidents/:id/close`.

**Notifications.**
- Manager: SOS push on insert (kind=`safety_sos`,
  priority=`urgent`).
- Owner: cockpit pulse `SafetyIncidentEvent` (R6 SSE) when
  severity >= high.
- Compliance admin: in-app inbox alert when severity = critical |
  fatality.
- Bilingual sw/en for every push body.

**Audit.** Every transition appends to `ai_audit_chain`. The
existing `withSecurityEvents` wrapper guarantees hash-chained writes
on the insert + close routes. The new `investigate` and
`escalate-regulator` routes wear the same wrapper.

**Brain tools.**
- `worker.incident.report`
- `manager.incident.investigate`
- `owner.incident.review`
- `owner.incident.escalate_regulator`

**Files in this chain.**
- Service: `services/api-gateway/src/services/safety-incident/`
- Route extension: `services/api-gateway/src/routes/mining/incidents.hono.ts`
- Cockpit event kind: `services/api-gateway/src/services/cockpit-events/safety-incident-event.ts`
- Tests: `services/api-gateway/src/services/safety-incident/__tests__/escalator.test.ts`
- workforce-mobile worker: `apps/workforce-mobile/app/(worker)/incident-report.tsx`
- workforce-mobile manager: `apps/workforce-mobile/app/(manager)/incident-queue.tsx`
- owner-web pulse: cockpit consumes the new event kind (already wired).

---

## §C5 — Compliance / regulator (DOCUMENTED, owned by #194)

**Trigger.** Compliance officer (admin) clicks "Generate filing"
on a pending incident or audit finding.

**Actors.** Compliance officer -> Borjie admin queue -> Regulator
(read-only export portal).

**State mutations.**
1. `compliance_exports` row created (existing schema).
2. Officer reviews drafted PDF / CSV.
3. Officer submits -> row status=`submitted`.
4. Regulator opens read-only portal (`apps/admin-web`).

**Notifications.** In-app + email to regulator.

**Audit.** Append-only `compliance_export_events`.

**Locked files.** `services/api-gateway/src/routes/compliance/*` +
admin-web compliance UI.

---

## §C6 — Knowledge / persona handoff (DOCUMENTED, owned by #195)

**Trigger.** Worker asks Borjie chat a question outside their
persona's tool catalogue.

**Actors.** Worker persona -> Manager persona -> Owner persona ->
Master Brain.

**State mutations.** Chat thread persisted with handoff trail. No
table-level mutations — handoff lives in the chat scratchpad.

**Notifications.** None — fully in-chat.

**Audit.** Persona transitions append to `ai_audit_chain`.

**Locked files.** `packages/central-intelligence/*` + chat persona
switching.

---

## §C7 — Cooperative settlement (STABLE)

**Trigger.** Parcel marked sold and settlement final.

**Actors.** Cooperative member -> Cooperative manager -> Members.

**State mutations.** `cooperative_settlements` rows; share
calculation by stake; payout via M-Pesa B2C through
`LedgerService.post()`.

**Notifications.** Push to each member on share confirmation.

**Audit.** Append-only.

**Files.** `services/api-gateway/src/routes/cooperatives/*`.

---

## §C8 — Insurance claim (DOCUMENTED, deferred)

**Trigger.** Severe incident + insured parcel.

**Actors.** Owner -> Insurance broker (invited) -> Adjuster ->
Settlement.

**State mutations.** Future tables. Existing
`insurance-broker` service provides the invitation surface.

**Notifications + audit.** TBD.

**Locked files.** `services/api-gateway/src/services/insurance-broker/*`.

---

## §C9 — Cross-tenant referral (DOCUMENTED, deferred)

**Trigger.** Owner sends referral link to peer.

**Actors.** Referrer Owner -> Visitor -> New Owner -> Referrer rebate.

**State mutations.** Future `referrals` table + rebate journal via
`LedgerService.post()`.

---

## §C10 — Mr. Mwikila autonomous tick (STABLE)

**Trigger.** Per-tenant cron tick.

**Actors.** Mwikila -> Owner (approve) -> downstream chain (any of
C1-C5).

**State mutations.** `mwikila_actions_inbox` row per proposal.
Delegation matrix gates which actions are auto-applied vs. queued
for approval.

**Notifications.** Cockpit pulse `MwikilaProposalEvent`.

**Audit.** Append-only inbox + delegation log.

**Locked files.** `services/autonomy/*` + owner-web Mwikila inbox.

---

## Master-table — chain coverage

| Chain | Trigger | Actors | State | Notify | Audit | Status |
|--|--|--|--|--|--|--|
| C1 commercial | RFB | 4 | 8 | push + SSE | hash-chain | DOC |
| C2 onboarding | opening | 4 | 6 | SMS+push+SSE | hash-chain | CLOSED |
| C3 payroll | run | 4 | 6 | push+SSE | hash-chain+ledger | CLOSED |
| C4 safety | report | 4 | 6 | SOS+push+SSE+admin | hash-chain | CLOSED |
| C5 compliance | filing | 3 | 4 | in-app+email | append-only | DOC |
| C6 persona | chat | 4 | 0 (scratchpad) | none | append-only | DOC |
| C7 coop | settle | 3 | many | push | append-only | STABLE |
| C8 insurance | claim | 4 | TBD | TBD | TBD | DOC |
| C9 referral | link | 4 | TBD | TBD | TBD | DOC |
| C10 mwikila | cron | 2-N | inbox | SSE | append-only | STABLE |

10 chains across 11 roles. All commercial / HR / payroll / safety
chains have a closed evidence path. Compliance + persona + insurance
+ referral chains documented and tracked in sibling issues.
