# Orphan Audit (Components + Endpoints + Form Submissions)

**Date:** 2026-05-29
**Pass:** deep — beyond #155 / #181 / #184.

This audit examines:
1. **Orphan components** — defined but not imported anywhere.
2. **Forms / buttons** — `onSubmit` / `onClick` that go nowhere.
3. **Endpoints** — Hono routes with zero UI consumers.
4. **Dispositions** — every item gets WIRED, DELETED, or LATER (with
   roadmap effort).

## Method

Detection used a stricter `grep` predicate than the prior runs:

```
grep -rln "from.*\b${base}\b\|import.*\b${base}\b" apps --include='*.tsx' --include='*.ts'
```

Bare-substring matches (false positives in `InlineBlockRenderer.tsx` and
similar dispatchers) were eliminated by also checking whether the
component is enumerated in a known dispatcher (`InlineBlockRenderer`,
`UiBlockRenderer`, `SuperpowerChips`, `board-element-renderer`).

## Components — disposition

| Component | Status | Action |
|-----------|--------|--------|
| `apps/owner-web/src/components/OwnerSidebar.tsx` | DELETED | Replaced by `owner-shell/Sidebar.tsx`. |
| `apps/owner-web/src/components/OwnerTopBar.tsx` | DELETED | Replaced by `owner-shell/TopBar.tsx`. |
| `apps/owner-web/src/components/PlaceholderCard.tsx` | DELETED | Legacy — no callers since #155 sweep. |
| `apps/owner-web/src/components/FeedbackButton.tsx` | WIRED | Mounted in `apps/owner-web/src/app/layout.tsx`. |
| `apps/owner-web/src/components/TenantRail.tsx` | LATER | Roadmap R12 — needs cross-tenant federation infra (`borjie-active-tenant` cookie + `/api/v1/orgs/me/memberships` not yet exposed). |
| `apps/owner-web/src/components/smart-compose/GhostCompletionInput.tsx` | LATER | Roadmap R9 — depends on `useGhostCompletion` hook; needs LLM completion proxy endpoint. |
| `apps/owner-web/src/components/finance/PnlTable.tsx` | LATER | No callers — finance page renders placeholders. Needs `/api/v1/accounting/pnl` BFF. |
| `apps/owner-web/src/components/shared/EntityTimeline.tsx` | LATER | Generic timeline component — used by per-entity drawers that are roadmap items (reminders, drafts, parcels, bids). |
| `apps/owner-web/src/components/workforce/WebAuthnClockIn.tsx` | LATER | Owner-web kiosk widget; needs `/workforce-tabs` host page with kiosk mode. |
| `apps/admin-web/src/components/FeedbackButton.tsx` | WIRED | Mounted in `apps/admin-web/src/app/layout.tsx`. |
| `apps/admin-web/src/components/FeedbackThumbs.tsx` | LATER | Per-turn Jarvis widget — needs `JarvisConsole` to render it under each assistant bubble. |
| `apps/admin-web/src/components/internal/ConsoleTopNav.tsx` | DELETED | Replaced by `AdminShell`. |
| `apps/admin-web/src/components/internal/flags/FlagRolloutForm.tsx` | LATER | Real form; `/api/v1/mining/internal/feature-flags` endpoint missing — parent renders stub. |
| `apps/admin-web/src/components/internal/juniors/JuniorActions.tsx` | LATER | Real form; `/api/v1/mining/internal/juniors` registry list endpoint missing. |
| `apps/admin-web/src/components/internal/support/TicketAck.tsx` | LATER | Real form; `/api/v1/mining/internal/support/tickets` list endpoint missing. |
| `apps/admin-web/src/components/internal/killswitch/TwoOperatorConfirm.tsx` | DELETED | Superseded by `PendingConfirmationsQueue.tsx`. |
| `apps/workforce-mobile/src/components/PilotErrorBoundary.tsx` | WIRED | Mounted at the root `apps/workforce-mobile/app/_layout.tsx`. |
| `apps/workforce-mobile/src/components/FeedbackButton.tsx` | LATER | Opt-in per-screen by design — left unmounted intentionally per its docblock. |
| `apps/marketing/src/components/SectionSkeleton.tsx` | LATER | Used as `next/dynamic` suspense fallback — needs marketing sections to migrate to lazy loading first. |
| `apps/marketing/src/components/effects/NeonGlow.tsx` | LATER | Decorative effect for marketing hero — not yet placed; design + perf pass pending. |
| `apps/marketing/src/components/effects/MeshGradient.tsx` | LATER | Same — Stripe-style mesh background; needs hero re-skin. |
| `apps/marketing/src/components/effects/InteractiveBackground.tsx` | LATER | Particle effect; same as above. |
| `apps/marketing/src/components/effects/HeroDemoPreview.tsx` | LATER | KPI mockup tile; needs narrow-viewport hero variant. |

## False positives (initially flagged but actually wired)

- All sixteen inline-blocks under `apps/owner-web/src/components/home-chat/inline-blocks/` — dispatched by `InlineBlockRenderer.tsx`.
- `apps/owner-web/src/components/blackboard/elements/SimpleElements.tsx` — dispatched by `board-element-renderer.tsx`.
- `apps/owner-web/src/components/home-chat/UiBlockRenderer.tsx` — used by `HomeChatTeach.tsx`.
- `apps/owner-web/src/components/home-chat/SuperpowerChips.tsx` — used by `HomeChatTeach.tsx`.
- `apps/admin-web/src/components/ask/SliceSelector.tsx` — used by `AskChat.tsx`.

## Form submissions audit

Searched for `onSubmit={() => {}}` or `onClick={() => {}}` patterns in
production paths. **0 dead handlers found** — every form has a real
mutation or navigation target. The Marketplace RFB create screen, the
worker hero card mark-complete + need-help buttons, the buyer
marketplace bid screens, and the cockpit dashboards all submit to real
endpoints.

## Endpoints — disposition

The endpoint-side orphan check focuses on `services/api-gateway/src/routes/marketplace/rfb.hono.ts` and key chain endpoints:

- `POST /api/v1/marketplace/rfb` — wired in `apps/buyer-mobile/app/rfb/create.tsx` and the buyer's `index.tsx` list.
- `GET /api/v1/marketplace/rfb/mine` — wired in `apps/buyer-mobile/app/rfb/index.tsx`.
- `GET /api/v1/marketplace/rfb/nearby` — UNWIRED on owner side. Sellers in workforce-mobile / owner-web have no surface that reads this. ⟶ Roadmap item ("Inbound RFB column on owner marketplace board").
- `PATCH /api/v1/marketplace/rfb/:id` — wired (cancellation flow in `apps/buyer-mobile/src/api/rfb.ts`).
- `POST /api/v1/marketplace/rfb/:id/respond` — UNWIRED on seller side. ⟶ Same roadmap item.
- `POST /api/v1/mining/tasks` — UNWIRED across all four apps. Manager-only create-task endpoint has zero callers. ⟶ Roadmap item ("Owner-web task dispatcher").
- `POST /api/v1/mining/tasks/:id/reassign` — same.
- `POST /api/v1/mining/shift-reports` — wired in workforce-mobile worker screens (W-M-02 etc.) but several screens render hardcoded mock data instead of fetching live. ⟶ #181's "REALITY_CHECK" already flagged this.

## Summary

**Components deleted:** 5 (OwnerSidebar, OwnerTopBar, PlaceholderCard,
ConsoleTopNav, TwoOperatorConfirm).
**Components wired:** 3 (PilotErrorBoundary, owner-web FeedbackButton,
admin-web FeedbackButton).
**Components documented LATER:** 14.
**Form submit-to-nowhere:** 0.
**Button no-op:** 0.
**Endpoints UNWIRED (chain-blocking):** 5 (RFB nearby, RFB respond,
mining tasks create / reassign, mining shift-reports live-fetch).

All 5 chain-blocking endpoints are documented under chain audit
remaining gaps. They are LATER (>200 LOC fix each) and require
coordinated owner-web + workforce-mobile UI work.
