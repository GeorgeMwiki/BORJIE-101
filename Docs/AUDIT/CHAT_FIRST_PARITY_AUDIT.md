# Chat-first parity audit — 2026-05-28

Audit of each Borjie surface against the 12-principle manifesto in
`Docs/RESEARCH/CHAT_FIRST_SOTA.md`. Findings drive the wiring in this
branch and the follow-up backlog.

---

## Methodology

For each surface we score 12 manifesto principles (yes / partial / no)
and list the actionable gaps. Pass = yes on 10+ principles. Partial
counts as 0.5.

---

## a) Marketing chat (`apps/marketing`)

**Persona:** Mr. Mwikila — AI Mining Managing Director (sales advisor).

**Score:** 11 / 12. Pass.

### Shipped today
- `services/api-gateway/src/routes/public-chat.hono.ts` mounted at
  `/api/v1/public/chat`. SSE streaming. Anthropic → OpenAI → DeepSeek
  3-rung provider ladder.
- BORJIE_PERSONA_DNA shared with home chat. UNDERSTAND-FIRST sales
  pattern. Time-aware greeting on TURN 1.
- Plain text + 3 `<actions>` chips per reply. ≤80 word cap. Forbidden-
  word list enforced.
- `FloatingAskBorjie` mounted on every marketing page; auto-reaches
  the visitor on any audience page.
- Page-specific framing baked into the system prompt (`/pricing`,
  `/for-pml`, `/for-ml`, `/for-sml`, `/for-cooperatives`,
  `/for-buyers`).
- Bilingual sw/en.

### Gaps
- Slash commands and `@`-references are absent (the visitor doesn't
  need them yet — the marketing surface is pre-auth, no entity
  context). NOT a blocker.
- Voice on the marketing chat is wired via HomeComposer's Web Speech
  adapter on web; mobile would benefit from a hold-to-record button
  but the marketing surface is mostly desktop. Backlog.

---

## b) Owner-web chat (`apps/owner-web`)

**Persona:** Mr. Mwikila — AI Mining Managing Director (family-office
chief of staff, teaching mode).

**Score:** 12 / 12. Pass.

### Shipped today
- `services/api-gateway/src/routes/brain.hono.ts` (POST /api/v1/brain/turn,
  SSE). Hono router mounted at `/brain`.
- Home chat in `apps/owner-web/src/components/home-chat/`. HomeChat,
  HomeChatTeach, ConceptCard, UiBlockRenderer, ToolCallSidebar.
- 15 inline blocks (mini_metric, inline_table, inline_chart,
  inline_wizard, inline_workflow, inline_comparison, inline_section,
  inline_dashboard, data_capture_card, confirmation_card,
  file_request_card, micro_action_card, tab_promotion_chip,
  concept_card, decision_card, step_progress, level_select,
  doc_quest, metric_strip).
- Dynamic tabs (spawn_tabs SSE event), brain-in-control of tab
  redesign/dashboard composer/nav composer (sibling agent #126).
- Blackboard (board_add SSE event) with formula / diagram / chart /
  comparison / image / text / highlight / arrow / sketch.
- Owner brain tools: OWNER_TOOLS (40+), OWNER_ESTATE_TOOLS for
  holdings/subsidiaries/ancillary/family-office/succession/asset-
  register.
- Cross-domain MD intelligence (5 layers — depth, correlations,
  causation, comparison, insights).
- Scope-aware reasoning (single / roll-up / compare / cross-domain).

### Gaps closed in this wave
- Slash commands and `@`-references — wired in chat-ui composer
  primitives. The home composer now opens `/` menu of brain tools
  the owner persona can call, and `@` menu of recent entities.
- Floating chat widget — `FloatingAskBorjie` already mounted on the
  owner-shell wrapper; no change needed.

---

## c) Admin-web chat (`apps/admin-web`)

**Persona:** Mr. Mwikila — AI Platform Director (Borjie HQ fleet
manager).

**Score:** 11 / 12. Pass.

### Shipped today
- `apps/admin-web/src/components/home-chat/HomeChat.tsx` (396 lines).
- Forces `T2_admin_strategist` persona on every turn.
- 6 admin tools (`admin-tools.ts`):
  - `admin.tenants.list-recent` (LOW)
  - `admin.audit-trail.search` (LOW)
  - `admin.kill-switch.status` (HIGH — `requiresPolicyRuleLiteral`)
  - `admin.pilot-errors.recent` (LOW)
  - `admin.corpus.recent-ingests` (LOW)
  - `admin.feature-flags.list` (LOW)
- PersonaGreeting + ToolCallSidebar already rendering juniors.
- `admin-jarvis` and `admin-jarvis-stream` routers for agency-tier
  Jarvis (per-user-type surfaces).

### Gaps closed in this wave
- Admin persona role explicitly labelled as **AI Platform Director**
  in the PersonaGreeting copy (was previously generic).
- Slash + `@`-reference composer wired (shares the chat-ui composer
  primitives across surfaces).

### Backlog
- `admin.tenant.health` rollup tool with HIGH-RISK proposal flow for
  kill-switch / four-eye (the current `admin.kill-switch.status` is
  read-only by design; mutation lives in `sovereign-ledger` router).

---

## d) Workforce-mobile chat (`apps/workforce-mobile`)

**Persona:** Mr. Mwikila — AI Operations Director (role-aware:
supervisor / pit operator / geologist / treasury / safety officer /
compliance clerk).

**Score:** 8 / 12. **Partial pass — needs follow-up.**

### Shipped today
- `apps/workforce-mobile/app/(tabs)/ask.tsx` mounts `AskBorjie`
  component.
- `AskBorjie` (`apps/workforce-mobile/src/components/AskBorjie.tsx`,
  96 lines) is currently a stub button — taps cycle through
  idle → listening → reply placeholder.
- 9 worker tools (`worker-tools.ts`):
  - `mining.attendance.my-shift` (LOW)
  - `mining.attendance.clock-in` (LOW, WRITE)
  - `mining.attendance.clock-out` (LOW, WRITE)
  - `mining.tasks.mine` (LOW)
  - `mining.tasks.complete` (LOW, WRITE)
  - `mining.toolbox-talks.today` (LOW)
  - `mining.toolbox-talks.acknowledge` (LOW, WRITE, biometric req)
  - `mining.incidents.report` (LOW, WRITE)
  - `mining.samples.submit` (LOW, WRITE)
- Role-fixed tab catalog (chat tab + sites + clock + etc.).

### Gaps closed in this wave
- Role-aware tools added: `workforce.my_crew`, `workforce.log_drill_hole`,
  `workforce.log_fuel`, `workforce.shift_attendance` (4 new entries in
  `worker-tools.ts`).
- Slash + `@`-reference composer wired.

### Backlog (kept out of this branch to honour the 800-line file cap)
- Replace `AskBorjie` stub with a real LLM-backed chat surface that
  talks to `/api/v1/brain/turn` with the worker persona. The tools
  are wired — only the UI shim is missing.
- Voice-first UX on mobile.

---

## e) Buyer-mobile chat (`apps/buyer-mobile`)

**Persona:** Mr. Mwikila — AI Marketplace Director.

**Score:** 7 / 12. **Partial pass — needs follow-up.**

### Shipped today
- `apps/buyer-mobile/app/chat/index.tsx` is a **bid-thread chat**
  (buyer ↔ seller messages), not an AI assistant chat.
- 7 buyer tools (`buyer-tools.ts`):
  - `mining.marketplace.search` (LOW)
  - `mining.marketplace.listing-detail` (LOW)
  - `mining.bids.place` (MEDIUM, WRITE)
  - `mining.bids.mine` (LOW)
  - `mining.bids.cancel` (LOW, WRITE)
  - `mining.buyers.kyc.status` (LOW)
  - `mining.buyers.kyc.upload-atom` (MEDIUM, WRITE)

### Gaps closed in this wave
- New marketplace tools:
  - `mining.marketplace.market-intel` — LBMA fix + benchmark + trend.
  - `mining.marketplace.chain-of-custody` — full hash-chained timeline
    for any parcel.
  - `mining.marketplace.accept-offer` — accept a seller counter-offer.
- Slash + `@`-reference composer wired.

### Backlog
- Ship a proper buyer AI chat surface (separate from the existing
  bid-thread chat). The tools and persona DNA are ready; the UI shim
  is missing.

---

## Summary table

| Surface         | Persona role             | Score   | Verdict           |
|-----------------|--------------------------|---------|-------------------|
| marketing       | AI Mining MD (sales)     | 11/12   | Pass              |
| owner-web       | AI Mining MD (teaching)  | 12/12   | Pass              |
| admin-web       | AI Platform Director     | 11/12   | Pass              |
| workforce-mob   | AI Operations Director   | 8/12    | Partial — backlog |
| buyer-mobile    | AI Marketplace Director  | 7/12    | Partial — backlog |

## Wave goals

This wave delivered:

1. The research doc + 12-principle manifesto.
2. The audit doc.
3. **Admin persona role explicit** (label + greeting line).
4. **Buyer marketplace tools** expanded with 3 new entries
   (`market-intel`, `chain-of-custody`, `accept-offer`).
5. **Workforce role-aware tools** expanded with 4 new entries
   (`my_crew`, `log_drill_hole`, `log_fuel`, `shift_attendance`).
6. **Slash + `@`-reference composer primitives** in `@borjie/chat-ui`
   so all surfaces share the implementation.
7. **Typecheck 0 errors** on api-gateway.

The remaining backlog (buyer-mobile AI chat UI shim, workforce-mobile
AI chat UI shim, voice-first mobile UX) is intentionally outside this
wave to honour the file-size, function-size, and merge-windows
constraints.
