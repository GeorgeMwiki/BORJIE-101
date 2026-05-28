# Chat-as-OS Bidirectional Parity — Per-Surface Audit (2026-05-28)

Companion to
[`CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md`](../RESEARCH/CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md).

Legend:

- ✓ Parity present today.
- ⚠ Parity present but provenance not yet stamped (closed by
  migration `0101` + provenance helper).
- ❌ Gap — explicit path exists, no chat equivalent (or vice versa).
- — Not applicable.

For every gap (❌) the table also lists the wave item that closes it.
"P1" = closed in this PR. "P2+" = follow-up.

---

## 1. Marketing Visitor (apps/marketing-web)

| Explicit form / button | Chat equivalent | Same persistence? | Same audit row? | Status |
|------------------------|------------------|--------------------|------------------|--------|
| Request a pilot        | Marketing chat-CTA → `pilot.request-pilot` | `pilot_signups` table | `audit_events` ('pilot_signup') | ⚠ → ✓ after P1 (provenance stamped) |
| Contact form           | Marketing chat-CTA → `pilot.contact` | `pilot_contacts` | `audit_events` | ⚠ → ✓ |
| Newsletter signup      | Marketing chat-CTA → `marketing.newsletter` | `marketing_newsletter_subscribers` | `audit_events` | ⚠ → ✓ |

P1 closes the provenance stamping on all three.

---

## 2. Owner — apps/owner-web (port 3010)

### 2.1 Reminders / Drafts / Documents / Forms / Tasks / Tabs

| Explicit | Chat tool | Same DB row? | Provenance | Status |
|----------|-----------|--------------|-----------|--------|
| Reminders tab → Add reminder | `owner.reminders.create` (P1 — wired in this wave) | `reminders` | `provenance.via='chat'` | ⚠ → ✓ |
| Reminders tab → Snooze / dismiss | `owner.reminders.update` (P1) | `reminders` | ✓ | ⚠ → ✓ |
| Drafts tab → New draft (universal drafter free-form) | `owner.drafter.compose-free-form` (sibling #128) | `document_drafts` + `draft_revisions` | `provenance.via='chat'` | ⚠ → ✓ |
| Documents tab → Upload | (no chat equivalent — file upload) | `document_drafts` | `provenance.via='form'` | ✓ |
| Documents tab → Browse / search | `owner.documents.search` (existing) | reads `document_drafts` | n/a | ✓ |
| Forms tab → Submit ad-hoc form | `owner.forms.submit` (P2) | `form_submissions` | needs provenance | ❌ → P2 |
| Tasks tab → Create / assign | `owner.tasks.create` (P1) | `mining_tasks` | ✓ | ⚠ → ✓ |
| Tabs nav → Add custom tab | `owner.tabs.add` (existing `ops.tabs.add`) | `owner_tabs` | ⚠ → ✓ |
| Compliance tab → Log filing | `ops.regulator-filings.log` (existing) | `regulatory_filings` | ⚠ → ✓ |
| Counterparties tab → Log engagement | `ops.engagements.log` (existing) | `external_party_engagements` | ⚠ → ✓ |
| Counterparties tab → Add party | `ops.parties.create` (P2) | `external_parties` | ❌ → P2 |
| Estate tab → Add holding | `ops.estate.add-holding` (P2) | `estate_assets` | ❌ → P2 |
| Estate tab → Log capital movement | `ops.estate.log-capital-movement` (P2) | `estate_capital_movements` | ❌ → P2 |
| Chain-of-custody tab → Verify | `ops.chain-of-custody.append` (existing) | `mineral_chain_of_custody` | ⚠ → ✓ |
| Workforce config → Change role tab config | `ops.workforce-tab-config.request-change` (existing) | `workforce_tab_change_requests` | ⚠ → ✓ |

### 2.2 Owner Detail Drawers (Unified Timeline tab)

P1 ships `<EntityTimeline />` shared component that all owner-web
detail drawers mount. Drawers wired in P1:

- ReminderDrawer
- DraftDrawer
- DocumentDrawer
- TaskDrawer
- EngagementDrawer

Other drawers (Estate, Compliance, ChainOfCustody) follow in P2.

---

## 3. Admin — apps/admin-web (port 3020)

NOTE: Admin chat tools live in `services/api-gateway/src/routes/admin/chat/*`
(sibling #130). This wave only touches admin-web list views to add
the "via" pill. Tool wiring is sibling #130's responsibility.

| Explicit | Chat tool (sibling #130) | Provenance | Status |
|----------|--------------------------|-----------|--------|
| Tenant search | `admin.tenants.search` (sibling) | n/a (read) | ✓ |
| Audit query | `admin.audit-trail.search` (existing read tool) | n/a (read) | ✓ |
| Kill-switch open / close | `admin.kill-switch.initiate` (sibling) | `kill_switch_events.provenance.via='chat'` | ⚠ → ✓ after sibling #130 forwards body |
| Policy edit | `admin.policy.edit-rule` (sibling) | `policy_rule_revisions` | ⚠ → ✓ |
| Four-eye initiate | `admin.four-eye.initiate` (sibling) | `four_eye_requests` | ⚠ → ✓ |
| RLS investigation | `admin.rls.diagnose` (sibling read) | n/a | ✓ |

P1 ships the migration column on `kill_switch_events`,
`policy_rule_revisions`, `four_eye_requests` so sibling #130's
gateway-side wiring has somewhere to write.

---

## 4. Workforce Supervisor (apps/workforce-mobile, role=manager)

| Explicit | Chat tool | Same DB row? | Provenance | Status |
|----------|-----------|--------------|-----------|--------|
| Shift logs → Create entry | `manager.shifts.log-entry` (P1) | `shift_reports` | ✓ | ⚠ → ✓ |
| Crew assignments → Assign worker | `mining.tasks.assign` (existing) | `mining_tasks` | ⚠ → ✓ |
| Incident reports → Report incident | `mining.incidents.report` (existing on worker; mirror on manager P1) | `incidents` | ⚠ → ✓ |
| Fuel logs → Add entry | `manager.fuel.log-entry` (P2) | `fuel_log_entries` | ❌ → P2 |
| Attendance corrections | `manager.attendance.correct` (P2) | `attendance_records` | ❌ → P2 |
| Approve / reject | `mining.approvals.decide` (existing) | `mining_approval_items` | ⚠ → ✓ |
| Escalate to owner | `mining.escalations.create` (existing) | `mining_escalations` | ⚠ → ✓ |

---

## 5. Workforce Geologist (apps/workforce-mobile, role=geologist)

| Explicit | Chat tool | Same DB row? | Provenance | Status |
|----------|-----------|--------------|-----------|--------|
| Drill-hole logs → New log | `geologist.drill-hole.log` (P2) | `geo_drill_hole_logs` | ❌ → P2 |
| Assay submissions → Submit assay | `mining.assays.submit-sample` (existing on worker) | `assay_submissions` | ⚠ → ✓ |
| Mineral classifications | `geologist.classify-sample` (P2) | `mineral_classifications` | ❌ → P2 |

---

## 6. Workforce Treasury (apps/workforce-mobile, role=treasury)

| Explicit | Chat tool | Same DB row? | Provenance | Status |
|----------|-----------|--------------|-----------|--------|
| FX hedge → Initiate hedge | `treasury.fx.initiate-hedge` (P2; sibling #127 zone — fx-feed-cron) | `fx_hedges` | ❌ → P2 |
| Royalty draft sign-off | `treasury.royalty.sign-off` (P2) | `royalty_drafts` | ❌ → P2 |

---

## 7. Buyer (apps/buyer-mobile)

| Explicit | Chat tool | Same DB row? | Provenance | Status |
|----------|-----------|--------------|-----------|--------|
| Marketplace tab → Browse parcels | `mining.marketplace.list-bids` / `inspect-listing` (existing read) | n/a | ✓ |
| Marketplace tab → Place bid | `mining.bids.place` (existing WRITE) | `marketplace_bids` | ⚠ → ✓ |
| Marketplace tab → Cancel bid | `mining.bids.cancel` (existing WRITE) | `marketplace_bids` | ⚠ → ✓ |
| Inquiries → Send inquiry | `buyer.inquiries.send` (P2) | `buyer_inquiries` | ❌ → P2 |
| Acceptance → Accept counter | `buyer.bids.accept-counter` (P2) | `bid_negotiations` | ❌ → P2 |
| Chain-of-custody verify | `buyer.chain-of-custody.verify` (P1) | `mineral_chain_of_custody` | ⚠ → ✓ |
| KYC step submission | `mining.buyers.kyc.upload-atom` (existing WRITE) | `buyer_kyc_uploads` | ⚠ → ✓ |

### Buyer Detail Drawers

- ParcelDrawer (Marketplace tab) — gains EntityTimeline + "Open in
  chat" in P1.
- BidDrawer ("My Bids" list) — gains "via Mr. Mwikila" pill + click
  → opens chat session at the bid-place turn in P1.

---

## 8. Cross-Surface Gap Summary

| Gap | Closed in | Owner |
|-----|-----------|-------|
| `provenance` jsonb column missing on every state-mutable table | P1 (migration 0101) | this wave |
| `provenance.ts` helper missing | P1 | this wave |
| WRITE brain tools not forwarding provenance to POST body | P1 | this wave |
| List views not surfacing "via Mr. Mwikila" pill | P1 (owner-web 6 mount sites + buyer-mobile 2) | this wave |
| Detail drawers not showing unified timeline | P1 (5 drawers in owner-web + 2 in buyer-mobile) | this wave |
| Forms not gaining "Open in chat" icon | P1 (10 mount sites) | this wave |
| Chat replies not gaining "Open in tab" chips | P1 (chat renderer extension) | this wave |
| Universal drafter auto-categorisation into Documents folder | P1 (event listener) | this wave (sibling #128 owns drafter, we own the listener) |
| Owner forms / counterparty create / estate / fuel / attendance / royalty / geologist chat tools | P2 | follow-up |
| Buyer inquiries / accept-counter chat tools | P2 | follow-up |
| Workforce supervisor fuel / attendance chat tools | P2 | follow-up |

---

## 9. Policy-Gate Coverage

Every WRITE tool routes through an HTTP endpoint that already passes
through the api-gateway's `policyGate.evaluate()` middleware. The
test `policy-gate-coverage.spec.ts` (P1) walks every descriptor with
`isWrite: true` and asserts the endpoint family is in the gated set:

- `/mining/marketplace/bids*` — gated
- `/mining/marketplace/bids/cancel` — gated
- `/mining/attendance/clock-{in,out}` — gated
- `/mining/tasks/*` — gated
- `/mining/incidents/report` — gated
- `/mining/approvals/decide` — gated
- `/mining/escalations` — gated
- `/ops/engagements` — gated
- `/ops/tabs/add` — gated

A new tool that fails this test cannot land.

---

## 10. Smoke Plan

This wave ships four end-to-end smokes (one per surface) wired in
`evals/parity-smokes/`:

1. **Owner.** "Draft me an MSA with Mahenge Gemstones Ltd" →
   resulting `document_drafts` row visible in Documents tab with
   "via Mr. Mwikila" pill, click pill → opens chat session at the
   originating turn.
2. **Buyer.** "Bid 2.1M on parcel GLD-2026-04-12" → `marketplace_bids`
   row visible in Marketplace tab's "My Bids" list + pill + click-to-
   session.
3. **Admin.** "Initiate kill-switch for tenant XYZ" (sibling #130
   tool) → confirmation_card → four-eye flow → `kill_switch_events`
   row with `provenance.via='chat'`.
4. **Workforce supervisor.** "Log near-miss on shift A" →
   `incidents` row in Incidents list with pill + click-to-session.

Each smoke asserts:

- The row exists with the correct shape.
- The row's `provenance` column matches the expected envelope.
- The list view renders the pill.
- The chat-session deep link resolves to a real session+turn pair.
- The hash-chained audit row exists.
- A subsequent manual edit via the form path appears as a new
  revision with `provenance.via='form'` on the same entity.
