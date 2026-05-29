# Borjie Roadmap — research-derived forward items

**Last updated:** 2026-05-29
**Companion to:** [`Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md`](./AUDIT/RESEARCH_GAPS_2026-05-29.md)

Items here are **forward-looking** capabilities promised by the
research corpus but deferred from the 2026-05-29 closure pass. They
are NOT bugs — `Docs/KNOWN_ISSUES.md` remains reserved for ship-
blocker defects. Each entry cites the source research doc, an effort
estimate, and a suggested wave / milestone.

When a roadmap item ships, mark it with `[SHIPPED YYYY-MM-DD]` in
both the source research doc AND remove the entry from this file (or
move it to a "Shipped" trailer). The audit doc tracks the gap →
shipping reconciliation.

---

## R1 — Owner brief inline citations (effort: M)

**Source:** `Docs/RESEARCH/owner-status-sota.md` §1.F + §8
**Promise:** Every AI brief sentence carries superscripted ¹²³
evidence chips with tap-to-source modal — "every claim cites a
specific datum."
**Shipped:** `/v1/owner/brief` endpoint returns `evidence_ids[]`
alongside the brief text. The owner-web brief panel does not yet
render inline superscripts (the data is there but the UI consumes it
as a list at the bottom).
**Effort:** 1–2 days — owner-web panel needs a markdown→superscript
renderer that maps `¹²³` tokens to evidence-modal triggers.
**Suggested wave:** Owner-web BFF / brief polish (sibling-owned —
zone #166).
**Why deferred:** Owner-web zone owned by another agent; outside
this audit's safe touch area.

---

## R2 — Saved searches with 3-min new-match alerts (effort: L)

**Source:** `Docs/RESEARCH/buyer-marketplace-sota.md` §2.4
**Promise:** Buyer creates a saved search ("Gold 22k+, Geita, ≤ 5
kg"); red dot appears on home when new matches land within 3 min of
seller publishing (commodity-grade freshness SLA).
**Shipped:** Nothing yet — no schema, no endpoint, no UI.
**Effort:** ~1 week — needs:
- `buyer_saved_searches` schema + migration
- `POST /v1/mining/buyers/saved-searches` create endpoint
- worker that runs every 3 min, matches new listings against saved
  searches, fires push notification
- buyer-mobile UI for create / edit / delete saved search + red-dot
  badge on home
**Suggested wave:** Buyer-mobile pilot polish (post-launch).
**Why deferred:** Wave-scale work; pilot launch precedes it.

---

## R3 — Cloudflare Workers AI edge inference for owner-mobile
**(effort: XL)**

**Source:** `Docs/RESEARCH/mobile-onload-intelligence.md` Phase 3
(§9.3)
**Promise:** Edge inference at af-south-1 (Cape Town / Joburg) for
the owner-mobile chat first-50-tokens. ~200 ms TTFT saving for
urban-4G owners.
**Shipped:** Anthropic-only path with the ack-fast SSE event landed
in this audit (G1). Edge path is untouched.
**Effort:** 3 dev-weeks per the research doc — needs:
- New `services/edge-brain` Cloudflare Worker
- `edge-brain-client.ts` race-and-merge composition module in api-
  gateway
- CORS allowlist + audit chain integration
- Feature flag wiring (`BORJIE_EDGE_BRAIN=on` per surface)
**Suggested wave:** Performance wave (post-pilot).
**Why deferred:** Infra-heavy and gated on owner-mobile pilot SLO
data — only worth the build if 4G urban owners report TTFT pain.

---

## R4 — On-device router (MiniLM-L6-v2 ONNX) (effort: XL)

**Source:** `Docs/RESEARCH/mobile-onload-intelligence.md` Phase 4
(§9.4)
**Promise:** 80 MB MiniLM-L6-v2 ONNX embedding model bundled into
both mobile apps for pre-network intent routing. Saves 100–300 ms on
hot "which tool?" paths.
**Shipped:** Nothing — the mobile apps still round-trip every routing
decision to the gateway.
**Effort:** 4 dev-weeks — needs:
- `packages/router-onnx` new package wrapping
  `onnxruntime-react-native`
- Asset bundling (or download-on-first-use) for the 80 MB model
- JSI native module verification on Hermes
- Server-side `routerHint` field on brain `/turn/stream`
- Accuracy A/B between brain-routing vs router-hint paths
**Suggested wave:** Mobile performance wave (deferred to 2027 per
the research doc).
**Why deferred:** Bundle-size + hardware diversity (Itel/Tecno
worker phones) make this risky for the pilot demographic.

---

## R5 — Worker-mobile hero-card home (effort: M)

**Source:** `Docs/RESEARCH/worker-guidance-sota.md` §1
**Promise:** Worker home reduced to single hero card (current task +
map preview) + sticky bottom "Imekamilika / Done" + voice mic.
DoorDash / CommCare / Apple-Fitness-rings pattern.
**Shipped:** Role-gated home composition exists; the hero pattern is
partial (KPI strip is still present).
**Effort:** 2–3 days — needs:
- Restructure `apps/workforce-mobile/app/(tabs)/home.tsx` worker
  branch
- Sticky bottom-bar component
- Wire voice mic to existing `streamChatTranscript` endpoint
**Suggested wave:** Workforce-mobile polish (zone #171 — sibling-
owned).
**Why deferred:** Mobile zone owned by another agent.

---

## R6 — Owner-cockpit live SSE push channels (effort: M)

**Source:** `Docs/RESEARCH/owner-status-sota.md` §1.H + §8 (refresh
tiers)
**Promise:** `live` tier for safety incidents, cash position,
kill-switch state, USD-cliff trip, T-90 licence transitions, market
prices. Pull-to-refresh for KPIs; cron for the brief.
**Shipped:** Brief endpoint + brief cron exist; pull-to-refresh
wired. No per-tenant SSE fan-out for the `live` tier.
**Effort:** ~1 week — needs:
- Per-tenant SSE fan-out bus (could reuse
  `cross-portal-subscribe.router.ts` shape)
- Hooks in incident-create / kill-switch / billing / licence-renew
  paths
- Client subscribers on owner-web + workforce-mobile owner branch
**Suggested wave:** Cockpit liveness wave (post-pilot).
**Why deferred:** Wave-scale; cockpit baseline is pull-driven and
acceptable for pilot.

---

## R7 — Owner-mobile cockpit branch (effort: L)

**Source:** `Docs/RESEARCH/owner-status-sota.md` §8 (wire-level
spec)
**Promise:** `apps/workforce-mobile/app/(tabs)/home.tsx` owner
branch renders the 7-slot newspaper structure (greeting, brief,
needs-review, time-horizon, production / cash / safety / market
pillars). Brain composition via `/v1/owner/brief`.
**Shipped:** Endpoint + cron exist. Mobile screen scaffold not yet
implemented.
**Effort:** 1 week — needs:
- 7 slot components
- AsyncStorage for time-horizon persistence
- Pull-to-refresh + push notification wiring
**Suggested wave:** Mobile (zone #171 — sibling-owned).
**Why deferred:** Mobile zone is sibling-owned.

---

## R8 — Universal personal-KB UI (effort: L)

**Source:** `Docs/RESEARCH/unified-personal-kb.md` §10.5
**Promise:** Persona switcher "All my roles" view + onboarding modal
when a new user signs up at tenant N with a phone matching an
existing person + Settings → Share consent screen.
**Shipped:** Database schemas (`persons`, `person_links`,
`personal_memory_cells`) + middleware (`person-context.ts`) +
boundary tagger (G5, this audit). UI is not yet wired.
**Effort:** ~1 week — needs:
- `<RolesSwitcher />` in owner-web
- Onboarding modal across all 4 surfaces
- Per-category Share-consent settings screen
- `GET /api/me/persons/links` endpoint
**Suggested wave:** Personal-KB wave (next).
**Why deferred:** UI surfaces span 4 apps; needs coordinated wave.

---

## R9 — Smart-Compose ghost-text predictive composer (effort: L)

**Source:** `Docs/RESEARCH/mobile-chat-latency-ux.md` §3.1
**Promise:** Gboard-style inline ghost-text predictions while the
user types in the chat composer.
**Shipped:** Smart-reply chips above the keyboard (post-response)
shipped in the R7 polish wave. Pre-send predictive composer not
shipped.
**Effort:** ~1 week — needs:
- New `/brain/suggest` endpoint (low-latency, cached)
- React Native ghost-text overlay in the TextInput
**Suggested wave:** Chat polish wave (v2).
**Why deferred:** Research doc explicitly defers to v2.

---

## R10 — Adaptive token-streaming rate (effort: S)

**Source:** `Docs/RESEARCH/mobile-chat-latency-ux.md` §5.2 +
`mobile-onload-intelligence.md` §1.5
**Promise:** Stream rate adapts to content complexity per arxiv
2504.17999 — ~21 wps for simple, ~12 wps for complex.
**Shipped:** Fixed 15 wps (Swahili medium-complexity midpoint).
**Effort:** ~2 days — needs a complexity classifier on the streaming
chunk + a buffer reducer on the client.
**Suggested wave:** Chat polish wave (v2). Listed in research as
v1.5 candidate; safe to defer.

---

## R11 — Buyer-mobile predictive RFB composer (effort: M)

**Source:** `Docs/RESEARCH/buyer-marketplace-sota.md` §3 — Metalshub
three-mode buyer entry
**Promise:** Buyer-initiated RFB ("I want 3 kg gold 22k, Geita, TZS
800M, any miner respond") as a first-class buyer flow alongside open-
marketplace bids and private-tender responses.
**Shipped:** Bid placement against an existing listing is wired.
Buyer-initiated RFB is not yet a flow.
**Effort:** 3–4 days — needs:
- `buyer_rfbs` schema + migration
- `POST /v1/mining/buyers/rfbs` endpoint
- Marketplace UI "Create RFB" CTA + form
- Brain tool `buyer.rfb.create`
**Suggested wave:** Buyer-mobile pilot polish.
**Why deferred:** Wave-scale.

---

## R12 — Owner persona switcher (Discord per-server profile pattern)
**(effort: M)**

**Source:** `Docs/RESEARCH/unified-personal-kb.md` §2 + §10.5
**Promise:** Discord-style per-tenant presentation of one underlying
identity — name + avatar + greeting all change per active tenant,
without re-authenticating.
**Shipped:** persona-runtime supports tenant-scoped persona binding;
the UI switcher does not yet expose "wear another hat" inside one
session.
**Effort:** 3–4 days — needs:
- `<TenantSwitcher />` in owner-web header
- Persona-runtime session re-binding without re-auth
- Memory boundary check before allowing the switch
**Suggested wave:** Personal-KB UI wave.

---

End of roadmap. Items are listed in approximate order of expected
delivery, not strict priority — priority is set per wave-plan call.
