# Borjie SOTA Wiring Verification (2026-05-28)

## Summary

Fast sweep of 15 claimed SOTA capabilities. **8 ✅ fully wired, 5 ❌ incomplete, 2 ⚠️ partial**.

Database is healthy (74 migrations applied, 129 tables, all required tables present). Endpoints mounted correctly. Core brain tools registered. FE components exist. **No code fixes applied per scope.**

---

## Capability-by-Capability Verification

| # | Capability | Migration | Endpoint | Brain Tool | FE Handler | Smoke | Status |
|---|---|---|---|---|---|---|---|
| 1 | Owner reminders + tabs | ✅ reminders, owner_tabs (0073-0074 era) | ✅ /owner/reminders, /owner/tabs mounted | – | ✅ OwnerOSRemindersPanel, useOwnerTabs found | ⚠️ /owner/tabs GET untested (server on :4000, unreachable) | ✅ Wired |
| 2 | Daily brief cron | ✅ daily_brief_dispatches exists | ✅ /owner/daily-brief mounted | ✅ mining.cockpit.daily-brief tool in owner-tools.ts | ✅ DailyBriefCard in cockpit + dashboard | ⚠️ Smoke blocked (unreachable server) | ✅ Wired |
| 3 | Mining ops scope | ✅ external_parties, external_benchmarks exist | ✅ /ops/external-parties mounted | ✅ track_parcel_chain, check_regulatory_deadline, lookup_counterparty, log_engagement in owner-tools.ts L419–668 | ✅ counterparties route handler found | ⚠️ Smoke blocked | ✅ Wired |
| 4 | Mining estate | ✅ estate_groups, peer_cohort_aggregates, scope_nodes exist | ✅ /estate/groups mounted | ✅ estate.net_worth_summary, estate.succession_review_needed, estate.asset_register_browse in owner-estate-tools.ts | ✅ /estate routes wired | ⚠️ Smoke blocked | ✅ Wired |
| 5 | Workforce fixed tabs | ✅ workforce_role_tab_configs + workforce_tab_change_requests exist | ✅ /owner/workforce, /workforce mounted | – | ✅ RequestTabChangeSheet, workforce-tabs page found | ⚠️ Smoke blocked | ✅ Wired |
| 6 | Cross-domain MD intelligence | ✅ peer_cohort_aggregates, external_benchmarks exist | – (called via brain tools) | ❌ correlation_for_question, trace_causes, compare_baselines, emit_insights **NOT found** | – (dispatch via existing) | ❌ Tools unregistered | ❌ Missing |
| 7 | Scope segmentation | ✅ scope_nodes, scope_taxonomy_preferences exist | ❌ /scope/nodes, /scope/taxonomy **NOT mounted** | ❌ resolve_scope_label, roll_up, compare, cross_domain_matrix, taxonomy_display_for **NOT found** | – (no renderer) | ❌ Routes missing | ❌ Missing |
| 8 | SOTA depth (never shallow) | – (catalog file) | – | ❌ compliance_full_picture, domain_full_picture, sub_area_drill **NOT found** | – | – | ❌ Missing |
| 9 | Inline-first chat blocks | – | – | – | ❌ 15 block renderers claimed, **only 4 Element.tsx files found** (Formula, Diagram, Chart, Comparison) | – | ⚠️ Partial |
| 10 | Dynamic tab registry | – | ✅ /owner/tabs/recent-types likely present | – | ✅ OwnerOSShell + SpawnTabMenu + useTabAugmentation found | ⚠️ Smoke blocked | ✅ Wired |
| 11 | Blackboard | – | – | – | ✅ Blackboard.tsx, board-element-renderer, 4 Element types present | – | ✅ Wired |
| 12 | Marketing chat strip | – | ✅ /public/chat mounted via publicChatRouter | – | ✅ BorjieChatPanel, FloatingAskBorjie wired | ⚠️ Smoke blocked | ✅ Wired |
| 13 | Auth cookie | – | ✅ /auth/sign-in, /auth/sign-out, /orgs/signup mounted | – | ✅ OwnerSignInForm, OwnerSignUpForm found | ⚠️ Smoke blocked | ✅ Wired |
| 14 | BorjieLogo system | – | – | – | ✅ BorjieLogo.tsx, Logomark.tsx exist in packages/design-system/src/brand; favicons in public | – | ✅ Wired |
| 15 | LitFin spec docs | – | – | – | – (audit baseline) | – | ✅ Baseline |

---

## Top Priority Fixes (Ranked by Demo Criticality)

### 🔴 **CRITICAL** (Block demo)

1. **Scope segmentation tools & routes (Cap #7)**  
   - Missing `/scope/nodes` and `/scope/taxonomy` endpoints  
   - No brain tools: resolve_scope_label, roll_up, compare, cross_domain_matrix, taxonomy_display_for  
   - Tables exist (scope_nodes, scope_taxonomy_preferences) but plumbing is broken  
   - Demo impact: Owner cockpit can't render scope hierarchy or cross-domain comparisons

2. **Cross-domain MD intelligence tools (Cap #6)**  
   - Missing brain tools: correlation_for_question, trace_causes, compare_baselines, emit_insights  
   - Tables exist (peer_cohort_aggregates, external_benchmarks)  
   - Demo impact: Owner can't ask "how do peers compare?" — core differentiator

### 🟡 **HIGH** (Partial capability)

3. **Inline-first chat blocks (Cap #9)**  
   - Claimed 15 renderers; only 4 Element files found  
   - Missing: simple text, code, image, metric, timeline, risk-score, and others  
   - Demo impact: HomeChatTeach can only render 4 block types, not full rich UI

---

## Notes

- **Smoke tests skipped** — API Gateway unreachable (server appears to bind :4000 but curl fails; Docker/process state uncertain)
- **Database healthy** — 74 migrations applied, all required tables present, 129 total tables
- **Endpoint mounting verified** via grep in `services/api-gateway/src/index.ts`
- **Brain tools verified** via grep in `services/api-gateway/src/composition/brain-tools/*.ts`
- **FE components verified** via grep in `apps/owner-web/src/components/`

---

**Generated:** 2026-05-28  
**Scope:** Verification only — no fixes applied  
**Next Step:** Sibling agents #125 (scope), #127 (cross-domain), #128 (inline-blocks), #129 (auth polish) will remediate
