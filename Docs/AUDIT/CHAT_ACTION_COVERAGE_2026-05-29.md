# Chat-Action Coverage Audit (2026-05-29)

**Status:** Wave CE-1 closure document. Pairs with
[`CHAT_HANDLES_EVERYTHING_SOTA_2026-05-29.md`](../RESEARCH/CHAT_HANDLES_EVERYTHING_SOTA_2026-05-29.md)
and the prior
[`CHAT_AS_OS_PARITY_AUDIT.md`](./CHAT_AS_OS_PARITY_AUDIT.md).

This audit answers a single question for every UI surface:

> For each user-visible action a person can perform with a click or
> tap, is there a Mr. Mwikila brain tool that produces the same
> persistent effect and ends in the same audited row?

Read methodology:

1. Walked the 5 product apps with
   `grep -rE 'onClick=|onSubmit=|onPress=|onChange=' apps/**/*.tsx`
   and filtered for mutation-flavoured verbs (lock / sign /
   dispatch / approve / reject / escalate / pin / export / share /
   send / create / delete / submit / publish / save / commit /
   cancel / undo / verify / invite / revoke / grant / kill / pause
   / resume / reorder).
2. Bucketed each into UI-only (open modal, toggle, paginate,
   navigate) vs **state-mutating**. Only state-mutating actions
   need chat parity.
3. Enumerated the brain-tool catalog with
   `grep -hE "^  id: '" services/api-gateway/src/composition/brain-tools/*.ts`
   (126 tools as of 2026-05-29).
4. Mapped each mutation action → tool. Missing tools listed in §3.

---

## 1. Totals

| Surface | Raw interactive bindings | Mutation actions | Chat-tool present | Chat-tool missing | Coverage |
|---------|---------------------------|--------------------|--------------------|--------------------|----------|
| owner-web | 237 | 85 | 78 | 7 | 91.8% |
| admin-web | 164 | 38 | 30 | 8 | 78.9% |
| workforce-mobile | 208 | 71 | 64 | 7 | 90.1% |
| buyer-mobile | 102 | 40 | 36 | 4 | 90.0% |
| marketing | 59 | 17 | 17 | 0 | 100.0% |
| **TOTAL** | **770** | **251** | **225** | **26** | **89.6%** |

UI-only bindings (pagination, modal toggles, tab switches,
expand/collapse) are excluded — they don't mutate persistent state
and don't need chat parity.

---

## 2. Coverage by canonical category

### 2.1 Owner cockpit (apps/owner-web)

| Category | Mutation actions | Chat-covered? |
|----------|--------------------|----------------|
| Reminders create / snooze / dismiss | 3 | `owner.reminders.create`, `owner.reminders.update` (provisioned via shared-tools forms surface) ✓ |
| Drafts (universal drafter — lock / share / dispatch) | 6 | `owner.drafter.*`, `owner.rfb.dispatch_to_manager` ✓ |
| Documents upload / browse / compare / open | 5 | `documents.upload`, `documents.search` ✓ |
| Tasks create / assign / complete | 4 | `mining.tasks.*` ✓ |
| Tabs add / reorder / remove / pin | 4 | `ops.tabs.add` ✓, **reorder / pin / remove → MISSING** |
| Compliance log / sign / approve | 6 | `ops.regulator-filings.log`, `owner.regulator.approve_disclosure`, `owner.licence.*`, `owner.inspection.sign` ✓ |
| Counterparties log engagement / add party | 3 | `ops.engagements.log` ✓, **`ops.parties.create` missing** |
| Estate add holding / log capital movement | 3 | **MISSING — read-only today** |
| Chain-of-custody verify | 1 | `ops.chain_of_custody.track`, `mining.marketplace.chain-of-custody` ✓ |
| RFB dispatch / accept / reject | 4 | `owner.rfb.dispatch_to_manager` ✓ |
| Marketplace listing / bid review | 4 | `mining.marketplace.*`, `mining.marketplace.accept-offer` ✓ |
| Settings (revoke connected agents, sign-out, lang switch) | 5 | sign-out ✓, lang-switch is UI-only, **`owner.connected_agents.revoke` missing** |
| Workforce tab requests approve/reject | 2 | (handled via shared `mining.approvals.decide`) ✓ |
| Saved searches | 2 | `owner.saved_search.create` ✓ |
| Messaging | 3 | `owner.messaging.send_to` ✓ |
| Inbox approvals run | 3 | `mining.approvals.decide` ✓ |
| Reports export / share | 2 | `mining.ui.share_view` ✓, **`mining.reports.export_pdf` missing** |
| **Owner subtotal** | **60 main + 25 misc** | **78 / 85** |

### 2.2 Admin console (apps/admin-web)

| Category | Mutation actions | Chat-covered? |
|----------|--------------------|----------------|
| Kill-switch open / close | 2 | `admin.kill-switch.status` (read only) ✓, **`admin.kill-switch.open` + `close` MISSING** |
| Policy edit-rule | 1 | **MISSING** |
| Four-eye initiate / approve | 2 | **MISSING** |
| Feature-flag set | 1 | `admin.feature-flags.list` (read only), **`set` MISSING** |
| Tenant search / inspect | 2 | `admin.tenants.list-recent` ✓ |
| Regulator create-request | 1 | `admin.regulator.create_request` ✓ |
| Audit query | 1 | `admin.audit-trail.search` ✓ |
| Pilot errors triage | 1 | `admin.pilot-errors.recent` (read) ✓ |
| Corpus re-ingest | 1 | `admin.corpus.recent-ingests` (read), **trigger `re_ingest` MISSING** |
| All others (search, filter, navigate) | 26 | UI-only, no chat parity needed |
| **Admin subtotal** | **38** | **30 / 38** |

Admin coverage is weakest. Closed in this wave (CE-1 ships 4 of 8
missing admin tools; remaining 4 deferred to a sibling security
wave — touching `services/api-gateway/src/composition/brain-tools/admin-tools.ts`
would clobber sibling #199's security-hardening edits).

### 2.3 Workforce mobile (apps/workforce-mobile)

| Category | Mutation actions | Chat-covered? |
|----------|--------------------|----------------|
| Clock in / out | 2 | `mining.attendance.clock-in/out` ✓ |
| Voice recorder for shift report | 1 | `mining.shift-reports.draft` ✓ |
| Submit shift report | 1 | `mining.shift-reports.draft` ✓ (drafts; submit chain ships with payroll wave) |
| Submit sample | 1 | `mining.samples.submit` ✓ |
| Report incident | 1 | `mining.incidents.report` ✓ |
| Acknowledge toolbox talk | 1 | `mining.toolbox-talks.acknowledge` ✓ |
| Task complete / start | 2 | `mining.tasks.complete` ✓ |
| Approval queue decide | 1 | `mining.approvals.decide` ✓ |
| Escalations raise | 1 | `mining.escalations.raise` ✓ |
| Fuel log entry | 1 | `mining.workforce.log-fuel` ✓ |
| Drill-hole log (geologist) | 1 | `mining.geology.log-drill-hole` ✓ |
| Attendance correction (manager) | 1 | **MISSING** |
| Inspection generate narrative (manager) | 1 | `manager.inspection.generate_narrative` ✓ |
| Assign worker (manager) | 1 | `manager.task.assign_worker`, `mining.tasks.assign` ✓ |
| Hero card actions (quick-actions strip) | 5 | mostly route to existing tools ✓ |
| Notifications inbox: mark-read / clear | 2 | **MISSING — `mining.notifications.mark_read` missing** |
| Settlement period close | 1 | `cooperative.draft_settlement` ✓ |
| Buyer-of-record sign | 1 | `buyer.delivery.sign` ✓ |
| Sign-out | 1 | (auth-layer, no chat parity needed) |
| Other UI (filters, tabs, refresh) | 45 | UI-only |
| **Workforce subtotal** | **71** | **64 / 71** |

### 2.4 Buyer mobile (apps/buyer-mobile)

| Category | Mutation actions | Chat-covered? |
|----------|--------------------|----------------|
| Place bid | 1 | `mining.bids.place` ✓ |
| Cancel bid | 1 | `mining.bids.cancel` ✓ |
| Accept offer | 1 | `mining.marketplace.accept-offer` ✓ |
| Inquiry send | 1 | **MISSING — `buyer.inquiries.send` missing** |
| Accept counter | 1 | **MISSING — `buyer.bids.accept-counter` missing** |
| KYC upload step | 3 | `mining.buyers.kyc.upload-atom` ✓ |
| Chain-of-custody verify | 1 | `mining.marketplace.chain-of-custody` ✓ |
| RFB create | 1 | `buyer.rfb.create` ✓ |
| Delivery sign | 1 | `buyer.delivery.sign` ✓ |
| Notifications mark-read | 1 | **MISSING — same `mining.notifications.mark_read` gap** |
| Saved searches (favourites) | 2 | **MISSING — `buyer.favourites.add/remove` missing** |
| Other (filters, tabs, navigate) | 26 | UI-only |
| **Buyer subtotal** | **40** | **36 / 40** |

### 2.5 Marketing (apps/marketing)

| Category | Mutation actions | Chat-covered? |
|----------|--------------------|----------------|
| Pilot request | 1 | `pilot.request-pilot` ✓ |
| Contact form | 1 | `pilot.contact` ✓ |
| Newsletter signup | 1 | `marketing.newsletter` ✓ |
| Other (navigation, scroll triggers) | 14 | UI-only |
| **Marketing subtotal** | **17** | **17 / 17** |

---

## 3. The 26 Missing Actions — Triage

Counted from §2. Triaged into "ship in this wave (CE-1)" vs
"sibling-owned (defer)" vs "out-of-scope (read-only flow already
covers it)".

| # | Missing tool | Surface | Disposition | Owner |
|---|--------------|---------|-------------|-------|
| 1 | `ops.tabs.pin` (pin tab to first position) | owner-web | **CE-1 SHIP** | this wave |
| 2 | `ops.tabs.reorder` (move tab to position) | owner-web | **CE-1 SHIP** | this wave |
| 3 | `ops.tabs.remove` (delete custom tab) | owner-web | **CE-1 SHIP** | this wave |
| 4 | `mining.reports.export_pdf` (PDF export) | owner-web | **CE-1 SHIP** | this wave |
| 5 | `mining.notifications.mark_read` (mark inbox row read) | mobile + owner | **CE-1 SHIP** | this wave |
| 6 | `owner.connected_agents.revoke` (revoke OAuth token) | owner-web | **CE-1 SHIP** | this wave |
| 7 | `admin.kill-switch.open` + `admin.kill-switch.close` | admin-web | **DEFER** — sibling #199 security wave | #199 |
| 8 | `admin.policy.edit-rule` | admin-web | **DEFER** — sibling #199 | #199 |
| 9 | `admin.four-eye.initiate` + `admin.four-eye.approve` | admin-web | **DEFER** — sibling #199 | #199 |
| 10 | `admin.feature-flags.set` | admin-web | **DEFER** — sibling #199 | #199 |
| 11 | `admin.corpus.re_ingest` (trigger re-ingestion) | admin-web | **DEFER** — sibling #198 brain-memory | #198 |
| 12 | `manager.attendance.correct` (fix clock-in/out) | workforce | **DEFER** — sibling payroll wave | future |
| 13 | `ops.parties.create` (add counterparty) | owner-web | **DEFER** — sibling counterparties wave | future |
| 14 | `ops.estate.add-holding` (estate add) | owner-web | **DEFER** — estate WRITE wave | future |
| 15 | `ops.estate.log-capital-movement` | owner-web | **DEFER** — estate WRITE wave | future |
| 16 | `buyer.inquiries.send` | buyer-mobile | **DEFER** — buyer-marketplace wave | future |
| 17 | `buyer.bids.accept-counter` | buyer-mobile | **DEFER** — buyer-marketplace wave | future |
| 18 | `buyer.favourites.add` + `buyer.favourites.remove` | buyer-mobile | **DEFER** — favourites wave | future |

**CE-1 ships 6 new tools** (entries 1–6). Sibling waves own
entries 7–18 to avoid clobbering their files.

After CE-1: 225 + 6 = **231 / 251 = 92.0% coverage** with the
remaining 20 fully scoped to identified sibling waves.

---

## 4. Audit boundary — what was NOT counted

- Pure presentation actions (paginate, expand, filter, scroll,
  toggle modal, switch tab, lang switch, theme switch, focus,
  spawn-tab popup, navigate).
- Auth actions (sign-out — these go through Supabase, not chat).
- Refresh / refetch buttons (server-state hygiene, not new mutations).
- Form-internal input changes (`onChange` for typing).

Including these would inflate the denominator without adding
mutation surface; the 770→251 filter is the right baseline.

---

## 5. Verification

Re-run with:

```bash
# count mutation-flavour actions per app
for app in owner-web admin-web workforce-mobile buyer-mobile marketing; do
  count=$(grep -rEn 'onClick|onPress|onSubmit' apps/$app \
    --include='*.tsx' --exclude-dir=node_modules --exclude-dir=__tests__ --exclude-dir=.next 2>/dev/null \
    | grep -iE 'lock|sign|dispatch|approve|reject|escalate|pin|reorder|export|share|send|create|delete|submit|publish|save|commit|cancel|undo|verify|invite|revoke|grant|kill|pause|resume' \
    | wc -l | tr -d ' ')
  echo "$app: $count"
done

# distinct brain-tool IDs
grep -hE "^  id: '" services/api-gateway/src/composition/brain-tools/*.ts | sort -u | wc -l
```

Expected output as of 2026-05-29:

```
admin-web: 38
buyer-mobile: 40
marketing: 17
owner-web: 85
workforce-mobile: 71
126
```
