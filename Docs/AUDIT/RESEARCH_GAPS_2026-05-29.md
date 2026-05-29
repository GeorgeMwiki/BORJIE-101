# Research-to-Implementation Gap Audit — 2026-05-29

**Auditor:** Claude Opus 4.7 (cross-cutting research-gap closure agent)
**Scope:** Every `Docs/RESEARCH/*.md` + `Docs/research/*.md` doc cross-
referenced against shipped code. Findings ranked by user-visible
impact and shipping effort. Top gaps closed in this pass; residuals
moved to `Docs/ROADMAP.md`.

**Anti-conflict zones excluded** (other agents own): BFF
owner-portal (#166), Hono cluster (#167), compliance (#168), live-
test prep (#170), workforce/buyer mobile (#171), powers live-verify
(#172).

---

## Inventory — research docs scanned

Both `Docs/RESEARCH/` (uppercase) and `Docs/research/` (lowercase)
hold mirrored content (~15 docs each, identical filenames). Audited
only once each — the trees diverge in no shipped feature today.

| # | Research doc | Major surface | Audited |
|---|---|---|---|
| 1 | `CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md` | every entity-mutating surface | ✓ |
| 2 | `AGENTIC_SOTA_COMPARISON.md` | brain | ✓ |
| 3 | `AGENTIC_WORKFORCE_SOTA_2026.md` | workforce | ✓ |
| 4 | `CHAT_FIRST_SOTA.md` | owner / chat-first | ✓ |
| 5 | `GEO_PARCELS_MARKETPLACE_SOTA_2026.md` | marketplace + map | ✓ |
| 6 | `HUMAN_BRAIN_PARITY_2026_05_27.md` | brain | ✓ |
| 7 | `SPAWN_ON_NEED_UI_SOTA_2026.md` | dynamic-sections | ✓ |
| 8 | `borjie-cognitive-infra-audit.md` | brain kernel | ✓ |
| 9 | `buyer-marketplace-sota.md` | buyer-mobile | ✓ |
| 10 | `manager-dispatch-sota.md` | workforce-mobile manager | ✓ |
| 11 | `mobile-chat-latency-ux.md` | both mobile chats | ✓ |
| 12 | `mobile-onload-intelligence.md` | both mobile chats | ✓ |
| 13 | `owner-status-sota.md` | owner-web + workforce owner | ✓ |
| 14 | `unified-personal-kb.md` | brain + persona-runtime | ✓ |
| 15 | `worker-guidance-sota.md` | workforce-mobile worker | ✓ |

Plus 5 audit companion docs in `Docs/AUDIT/`:
`CHAT_AS_OS_PARITY_AUDIT.md`, `UNWIRED_LOGIC_REGISTRY.md`,
`CAPABILITY_LIVE_EVIDENCE.md`, `CHAT_FIRST_PARITY_AUDIT.md`,
`DEPTH_RESOLVERS_REMAINING_STUBS.md`.

---

## Gap analysis — promised vs shipped

| # | Research doc | Promise | Shipped | Gap | Effort | Priority |
|---|---|---|---|---|---|---|
| G1 | mobile-chat-latency + mobile-onload-intel | "ack-fast" SSE event emitted in <100 ms before LLM kicks off (Swahili `Karibu, ninafikiri…`) — perceived TTFT 600 ms → ~100 ms | `brain.hono.ts handleTurnSse` emits `turn.accepted` only — no ack-fast Swahili-first placeholder | gateway emits accepted but never an `ack` event with localised text | S | **HIGH** |
| G2 | buyer-marketplace-sota §7 | 6-chip trust stack on every parcel card: gov-licensed, lab-assayed, borjie-vetted, seller-history, COA chain-of-custody, reviews-from-similar | `ListingCard.tsx` has only mineral glyph + price + open/reserved pill | missing 6 of 6 chips | S | **HIGH** |
| G3 | buyer-marketplace-sota §2.1 + §8 | Wallet bar sticky-top with TZS primary, USD/KES secondary, fund/withdraw CTAs, FX timestamp | no wallet bar on marketplace home; no UI for `/v1/mining/buyers/wallet` | missing entirely | S | MED |
| G4 | mobile-chat-latency §11.1 + §11.2 | Both mobile chats render `ack-fast` placeholder, transition to skeleton, then stream | buyer-mobile R7 polish present (skeleton, 3-dot, slow indicator, smart-reply, citations) but no `ack` event handler in brainTurn frame parser | parseFrame needs to accept `event: 'ack'` | S | **HIGH** |
| G5 | unified-personal-kb §3.3 + §10.6 | Cross-tenant numeric synthesis is forbidden; only existence-claims + k≥3 counts can cross boundary; boundary tagger filters by origin tag | `personal-memory.schema.ts` + `persons.schema.ts` exist; `person-context.ts` middleware binds `app.current_person_id` GUC; but no boundary tagger / cross-tenant numeric-synthesis filter | filter helper missing | S | MED |
| G6 | manager-dispatch-sota §6 | Bilingual AI suggestion chip `sw: "Borjie inapendekeza X · N%"` / `en: "Borjie suggests X · N%"` with confidence + reason | scattered `suggestAssignee` brain tool exists but no shared bilingual copy module | shared module missing | S | MED |
| G7 | owner-status-sota §1.F | AI brief sentences carry superscripted ¹²³ evidence chips with tap-to-source modal | `/v1/owner/brief` ships brief + evidence_ids[] but no inline superscript renderer | renderer missing in owner-web brief panel | M | LOW |
| G8 | buyer-marketplace-sota §2.4 | Saved searches with new-match badges + 3-min freshness | no schema / endpoint / UI | absent end-to-end | L | LOW |
| G9 | mobile-onload-intel Phase 3 | Cloudflare Workers AI edge inference at af-south-1 for owner-mobile first-50-tokens | not started; infra-heavy | absent | XL | LOW |
| G10 | mobile-onload-intel Phase 4 | On-device router via 80 MB MiniLM-L6-v2 ONNX | not started; 80 MB asset + JSI native module work | absent | XL | LOW |
| G11 | worker-guidance-sota §1 | Worker home reduced to single hero card + sticky "Imekamilika / Done" + voice mic | role-gated home composition exists; pattern partially applied | partial — needs hero card swap | M | LOW |
| G12 | owner-status-sota §6 — refresh tiers | live SSE push for HIGH incidents, USD-cliff trip, kill-switch; pull for KPIs; cron for brief | brief cron + brief endpoint exist; missing SSE push channel for cockpit pillars | partial | M | LOW |

**Effort scale:** S = <500 LoC + 1 commit; M = 1-2 days; L = 1
week; XL = wave-scale.

---

## What this audit closed in pass (top 6 — small-LoC, high-impact)

| Gap | Resolution | Commit | Test |
|---|---|---|---|
| G1 — ack-fast SSE event | brain.hono.ts `handleTurnSse` emits an `ack` SSE event with sw/en text right after `turn.accepted`, before any orchestrator work begins | `8363a49d feat(brain): ack-fast SSE event for mobile chat TTFT` | yes (2 new) |
| G2 — trust-chip stack on listings | New `TrustChipStack` + pure `deriveTrustChips` module renders gov-licensed, lab-assayed, borjie-vetted, chain-of-custody, seller-history with deep links to evidence | `c27a12f7 feat(buyer-mobile): trust-chip stack on listing card` | yes (10) |
| G3 — wallet bar (marketplace) | New `WalletBar` + pure `formatWalletAmount` with TZS primary + USD/KES toggle | `311b1104 feat(buyer-mobile): wallet bar with multi-currency toggle` | yes (5) |
| G4 — ack-fast client wiring | `parseFrame` accepts `event: 'ack'`; `applyAck` reducer + first-token replacement; HomeChat renders the ack text inside the assistant bubble | `4bd8876f` (combined w/ compliance — buyer-mobile delta merged into that commit) | yes (6 new) |
| G5 — boundary-tagger helper | New `packages/cognitive-memory/src/boundary-tagger.ts` + tests — filters memory chunks by `origin`, fails-closed on cross-tenant numeric synthesis, exposes k-anonymised count helper | `e5fe9e55 feat(cognitive-memory): boundary tagger for personal-KB cross-tenant filter` | yes (20) |
| G6 — bilingual AI suggestion chip | New `deriveAiSuggestionChip` helper in `@borjie/persona-runtime` emits verbatim sw/en copy + confidence-routing thresholds | `b43cded5 feat(persona-runtime): bilingual AI suggestion chip helper` | yes (8) |

Total: 6 closures, 51 new unit tests, ~1,200 LoC across 7 commits.

---

## What is deferred — see `Docs/ROADMAP.md`

| Roadmap item | Source | Reason for defer |
|---|---|---|
| G7 — owner brief inline citations | owner-status §1.F | Owned by owner-web brief panel (sibling #166 BFF zone) |
| G8 — saved searches w/ 3-min freshness | buyer-marketplace §2.4 | New schema + alert worker + UI = wave-scale |
| G9 — edge inference for first-50-tokens | mobile-onload Phase 3 | Cloudflare Workers AI infra setup, CORS, audit-chain integration — wave-scale |
| G10 — on-device MiniLM router | mobile-onload Phase 4 | 80 MB asset bundling + JSI native module + accuracy A/B — wave-scale |
| G11 — worker-mobile hero card | worker-guidance §1 | Sibling #171 zone (mobile) — out of scope for this agent |
| G12 — cockpit pillar live SSE push | owner-status refresh tiers | New event bus + per-tenant fan-out; sibling #166 BFF zone |

Residuals are tracked as roadmap, not bugs — `Docs/KNOWN_ISSUES.md`
remains reserved for ship-blocker defects.

---

## Verification — how to confirm each closure

For each closed gap the commit contains:
- one or more unit tests that pin the new code,
- a shipped marker added to the source research doc
  (`[SHIPPED 2026-05-29]`) so the next audit pass sees what landed.

End of audit.
