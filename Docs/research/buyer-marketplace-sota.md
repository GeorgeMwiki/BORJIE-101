# Buyer / Marketplace UX — SOTA 2026 for Borjie buyer-mobile

**Audience:** Borjie engineering + product.
**Scope:** Mineral BUYER (off-taker / refiner / aggregator) opens an
Expo app, sees parcels listed by miners across TZ, places bids,
negotiates, completes KYC, and tracks deals through to payment +
chain-of-custody. Real money. Real stakes. 5-inch screens.
**Bias:** B2B commodity, trust-paramount, mobile-only constraints.
Not consumer e-commerce. Not retail crypto.

---

## §1 — Landscape (12 reference players, what to copy)

A scan of the buyer-mobile state-of-the-art across commodities,
auctions, brokerage, real-estate, procurement, and KYC. No single
incumbent has solved **mineral-buyer-on-mobile-in-Africa**; we
synthesize from twelve adjacent leaders.

1. **Cargill MiApp + CargillAg.** First "around-the-clock global
   commodity price" mobile app. Live cash-bid updates by saved
   delivery location, contract status, offer placement directly from
   bid cards tagged "Sell". Buyers tap a bid, the contract form
   pre-fills. *Copy:* one-tap from price-card → bid/offer creation.
2. **Bushel Mobile (grain).** "Make Offer" via mobile portal collapses
   a 5-minute phone call into a 42-second flow. 24/7 cash bids,
   scale-ticket upload, e-sign contracts. *Copy:* the Make-Offer
   speed-floor — a buyer must place a bid in < 60 s of opening a
   parcel card.
3. **Metalshub.** Procurement / Sales / Tolling tri-mode platform.
   Three buyer modes: respond to **public enquiry**, accept **private
   tender**, or **launch own RFB**. Bundled credit insurance,
   forfaiting, logistics. *Copy:* the three-mode buyer entry — public
   open market vs. invited private tender vs. self-initiated RFB —
   maps perfectly onto our marketplace / direct-deal / open-tender
   split.
4. **Alibaba.com B2B Trade App.** Real-time chat translator (16
   languages, 54 currencies), Trade Assurance escrow, ML
   recommendation engine improving with browse + saved-items signal.
   *Copy:* the saved-items → recommendations → escrow continuum;
   Swahili / English translator equivalent.
5. **Faire (wholesale).** Buyer-first marketplace UX — net-60 terms
   surfaced as a primary trust signal, return-window guarantee on
   every order. *Copy:* the "Net X / Refund-X-days / Lab-verified"
   triplet of guarantee chips sitting under every parcel price.
6. **Robinhood + Coinbase Pro mobile.** Order acknowledgement under
   200 ms even if exchange fill takes longer. Confetti / haptic on
   completion. Number-flip animations on live price. *Copy:* the
   sub-200 ms bid-acknowledgement budget; optimistic UI with rollback
   on policy reject.
7. **eBay buyer + Sotheby's mobile.** Live countdown with
   green→yellow→red progressive color, last-60-seconds visual
   escalation, "X watchers" social proof, sticky bottom-sheet bid
   pad. *Copy:* the auction timer color states and the sticky
   bid-pad pattern (see §3).
8. **Zillow / Redfin buyer mode.** Listings refresh every 2 min,
   alerts 3–10 min after MLS post, conversational search
   ("describe your dream home"), 3D tour + agent-coord. *Copy:* the
   saved-search + new-match-alert pipeline (3-min freshness for
   mineral parcels — gold price moves fast).
9. **Pipedrive mobile.** Compact swipe-friendly deal cards, smart
   status indicators, kanban stages drag-and-drop, 42 % reduction in
   deal-update time vs. desktop. *Copy:* kanban for our Deal stages
   (Bid → Negotiate → KYC-cleared → Escrow → Custody-transferred →
   Settled).
10. **Coupa mobile (procurement).** G2 mobile score 8.0 vs. Ariba's
    lower — wins on broad spend, voice search, expense capture,
    vendor evaluation chips. *Copy:* the vendor-evaluation chip
    pattern at the top of every supplier (miner) profile.
11. **Persona + Onfido + Stripe Identity.** ID + selfie liveness in
    5–10 s prod traffic; whole flow under 60 s on mobile data.
    Dynamic Flow: passive liveness first, step up to active only on
    risk signal. Async UX — never block on spinning loader; queue
    for manual review with notification on resolution. *Copy:*
    progressive liveness + chunked persistent KYC (resume after
    network drop, save partial uploads server-side).
12. **Airbnb host-verified architecture.** Trust signals occupy >50 %
    of above-the-fold area on listing detail; "reviews from people
    like you" beats generic stars; tipping point at 10 reviews.
    *Copy:* the verified-miner badge sequence (Govt-licensed +
    Lab-assayed + Borjie-vetted) sitting above price.

---

## §2 — Marketplace home (first open: what does a B2B buyer see?)

The mineral buyer is a serial scanner. They open the app multiple
times a day. The home must be a **decision surface**, not a
brochure.

**Section order (top → bottom, mobile portrait):**

1. **Wallet bar (sticky top).** TZS balance primary + USD / KES
   secondary, with a tiny toggle. One-tap to fund / withdraw.
   Multi-currency MUST show all three; never hide. (Pattern: Sorted
   Wallet 2.0, multi-currency mobile wallets — local-currency-first
   reduces mental conversion friction.)
2. **Active bids strip (horizontal scroll).** Each card: parcel
   thumbnail, current top bid, *your* bid position
   (Leading / Outbid / Closing-soon), countdown timer if auction.
   Countdown switches color: green > 24 h, yellow < 24 h, red <
   60 min, red+pulse < 60 s. (Pattern: eBay, Sotheby's progressive
   color escalation.)
3. **Recommended parcels (vertical feed).** ML-ranked by buyer's
   past mineral type, geography, grade, deal size. Each card: hero
   image, mineral type chip, grade, location (region + w3w),
   quantity, ask price in TZS + USD, trust badges (Govt-licensed,
   Lab-assayed, Borjie-vetted), "View" + "Bid" actions inline.
   (Pattern: Alibaba.com recommendation engine + Faire's chip
   stack.)
4. **Saved searches with new-match badges.** "Gold 22k+, Geita,
   ≤ 5 kg" with red dot if matches added since last open. Fresh
   listings push within 3 min of seller publishing — gold price
   moves and stale alerts cost deals. (Pattern: Redfin 3–10 min
   MLS alerts, but tighter for commodities.)
5. **Deal pipeline summary (collapsed kanban).** "3 negotiating /
   2 KYC-pending / 1 escrow / 1 custody-transit". Tap → full deal
   pipeline screen. (Pattern: Pipedrive mobile compact deal cards.)
6. **Market signal strip.** Today's LME gold close in USD/oz,
   tanzanite spot, copper. Pulled from the existing Borjie market-
   intelligence ingestor. Read-only, never the buy surface; price
   discovery happens against actual listed parcels.

**Anti-pattern:** marketing carousels, hero banners, promo modals,
"start your journey" empty states. This is a working professional's
app; treat their attention like the trader floor.

---

## §3 — Bid placement (the bid card + the slide-to-confirm)

A bid is a binding commercial offer. Treat it that way.

**Bid-card layout (parcel detail screen, bottom 40 % is the action
zone):**

- **Current top bid** large numeral, with "+N over ask" or "-N
  under ask" tag. Update via WebSocket / Supabase realtime.
- **Your bid input** with stepper (+5 %, +10 %, custom) and
  immediate currency-equivalent in TZS + USD shown below the
  field. (Pattern: multi-currency wallets — never make the buyer do
  mental math.)
- **Urgency cue** — countdown timer if timed auction; "Seller
  reviews offers daily at 18:00 EAT" if open-RFB.
- **Sticky bottom: slide-to-confirm.** Pattern from Swiggy + Amazon
  Buy Now. Slide-to-pay on tap-buttons leads to accidental fires;
  slide adds **healthy friction**. Completion threshold at **70 %**,
  not 100 %, to reduce abandonment. Visual: bounce-shimmer on idle
  (educates first-time users), double-chevron → checkmark + haptic
  on completion. (Source: Swiggy Design's slide-to-pay study.)
- **Sub-200 ms acknowledgment.** Bid lands → instant optimistic UI
  state (orange "Submitting…"), rolled back only on policy reject.
  (Pattern: Robinhood order acknowledgment.) The actual ledger
  hold/escrow happens via `LedgerService.post()` asynchronously.

**Bid types we need to support (Metalshub three-mode):**

- **Open marketplace bid** — public, all buyers see.
- **Private tender response** — seller-invited, sealed.
- **Buyer-initiated RFB** — "I want 3 kg gold 22k, Geita, TZS 800M,
  any miner respond."

**Deal-room transition.** When a bid is accepted, the parcel
graduates to a **deal room** — a chat + document + milestone screen
co-owned by buyer, seller, and (optionally) a Borjie escrow agent.
(Pattern: Alibaba Trade Assurance escrow + B2B auction case study's
"auction lobby" stat strip.)

---

## §4 — KYC flow (chunked, persistent, fail-safe)

KYC is the highest-abandonment screen in any B2B app. The miner-buyer
flow is harder than consumer fintech because we need company docs +
authorized-signer + buy-authority licenses.

**Design constraints (from Persona, Onfido, Stripe Identity):**

- **Client SDK mandatory.** Server-only KYC drops pass rate sharply
  — the SDK handles camera permissions, lighting hints, liveness
  gesture coaching.
- **Chunked.** No single 6-screen flow. Break into atoms:
  (1) personal-ID + selfie, (2) company registration + TIN,
  (3) buy-authority license (Tanzania Mineral Commission), (4) bank
  proof, (5) AML screening confirm. Each atom independently
  persisted server-side and resumable on relaunch.
- **Persistent.** Upload starts immediately on file pick; spinner
  on the screen, but the user can close the app and resume — the
  partial state lives in `buyer_kyc_atoms` table, keyed by buyer +
  atom-type, with an `upload_status` column.
- **Progressive liveness.** Passive (image metadata + biometric
  consistency) first; active head-turn or blink **only** if risk
  signal trips. (Pattern: Persona Dynamic Flow.)
- **Async manual-review handoff.** If document quality fails or
  AML hits, the screen says "Under review — usually < 4 h" with a
  notification on resolution. Never block the buyer behind a
  spinner. (Pattern: Persona / Onfido async UX best practice.)
- **Bilingual.** Every label + instruction in `sw` + `en`. Default
  `sw` per Borjie hard rule.
- **Time budget.** Total user-time for a complete KYC must be
  under **8 minutes** across atoms; processing time async
  thereafter.

**Failure recovery.** Common failure modes — flaky data, blurry
ID, missing license — must each have a distinct recovery path with
clear next-step copy. Never "Verification failed. Try again."

---

## §5 — Deal tracking (pipeline + timeline + milestones)

After a bid is accepted, the deal becomes the buyer's job. SOTA
B2B sales-pipeline UX (Pipedrive, Monday, Apollo) maps cleanly.

**Pipeline stages (kanban, swipeable horizontally on mobile):**

1. **Negotiating** — chat-active, counter-offers in flight.
2. **KYC-cleared** — buyer + seller both verified.
3. **Escrow funded** — buyer's funds locked in
   `LedgerService.post()` escrow account.
4. **Lab assay pending** — sample collected, certificate awaited.
5. **Custody in transit** — handoff scanned, blockchain
   chain-of-custody started (cryptoseal pattern from Metalor /
   blockchain-traceability research).
6. **Settled** — funds released, custody confirmed, deal closed.

**Deal-detail screen sections (vertical scroll):**

- Header: parcel hero + counterparties (avatars + verified
  badges) + amount in TZS / USD / KES.
- **Milestone timeline** — vertical with checkmarks for completed,
  spinner for in-progress, dashed line for upcoming. Each milestone
  has an evidence link (lab cert PDF, transport waybill, cryptoseal
  scan).
- **Document gather** — required docs auto-listed (assay,
  transport, export license), with red-dot if missing.
- **Chat thread** — in-app, encrypted, with file attach (Pattern:
  Alibaba real-time chat translator with sw/en autotranslate.)
- **Payment milestones** — escrow funded → partial release on lab
  cert → final release on custody confirm. Each release is a
  `LedgerService.post()` event (Borjie hard rule).
- **Dispute escalate.** One-tap red button, opens human-Borjie
  arbiter ticket. (Pattern: Airbnb dispute resolution + Trade
  Assurance.)

86 % of B2B deals stall mid-process across the industry (Apollo
2026 data). The pipeline view is **the** core anti-stall surface;
swipe-to-nudge a counterparty must be one gesture.

---

## §6 — Buyer self-performance (the "you" tab)

The buyer should see themselves as a counterparty would — i.e. the
reverse of the seller-verification badges in §7. This builds
discipline and gives Borjie a signal lever (good buyers get better
deals).

**Metrics displayed on `/profile`:**

- **Win rate** — bids won / bids placed, rolling 90 days.
- **Average deal size** — TZS, with USD / KES toggles.
- **Response time** — median time-to-counter on negotiations
  (sellers see this — fast buyers win more deals).
- **Settlement reliability** — % deals settled without dispute.
- **Volume YTD** — kg gold, ct tanzanite, t copper, broken by
  mineral.
- **Trust tier** — Bronze / Silver / Gold / Platinum tied to
  history; unlocks larger escrow caps, lower fees, priority on
  private tenders. (Pattern: Airbnb Superhost; eBay seller
  reputation tiers.)

This screen is also where **buy-authority license expiry** is
surfaced 30 / 14 / 7 days out. License lapse mid-deal is a known
Tanzania-buyer failure mode.

---

## §7 — Trust signals (the chip stack)

Trust is everything when money moves. Adopt Airbnb's "trust
above-the-fold" architecture (>50 % of the listing-detail visible
area is social proof / verification before product detail).

**Trust chips on every parcel card (compact) and parcel detail
(expanded):**

- **Govt-licensed seller** (Tanzania Mineral Commission license
  number, click to verify).
- **Lab-assayed** (SSEF / GIA / TZ Mineral Authority cert, ≤ 30
  days old, click to view PDF).
- **Chain-of-custody started** (cryptoseal blockchain tx hash,
  Metalor-style — cryptoseal scanned on container, custody recorded
  on-chain).
- **Borjie-vetted** (Borjie team site-visited, manual badge — the
  highest trust tier).
- **Seller history** (N deals settled, settlement % — Airbnb-style;
  tipping point at 10 deals per Stanford research).
- **Reviews from buyers like you** (filter by buyer mineral type
  + region — Stanford finding that similar-reviewer trust beats
  generic stars).

**Anti-pattern.** Generic "Verified" green checkmarks with no
underlying source-of-truth. Every badge must hyperlink to the
ground-truth evidence (license PDF, lab cert PDF, on-chain tx).

---

## §8 — Multi-currency (TZS-primary, USD/KES toggle)

Per Borjie hard rule: every money render uses
`formatCurrency(amount, currencyCode)`. Domestic non-TZS contracts
rejected at API.

**Display patterns:**

- **Primary line** in deal-currency (typically TZS for domestic;
  USD for export deals).
- **Secondary line** small grey, showing equivalents in the other
  two of {TZS, USD, KES} at the bid-time spot rate (locked at bid
  submission to avoid post-bid FX surprise).
- **FX rate visible** in wallet bar — "1 USD = TZS 2,540 @ 14:32"
  with timestamp. Stale > 5 min triggers refresh.
- **Settlement currency banner** on deal-room — bold, never
  hidden, with FX-lock indicator.

(Source: Sorted Wallet, multi-currency mobile-wallet UX research.)

**Hedging UX (Trust-tier Gold+).** Optional — buyer can lock FX
rate for 24 h with a small forward-fee, shown as a chip on the bid
card. Below-tier buyers see this disabled with "Reach Gold tier to
unlock."

---

## §9 — Mobile-only constraints (high-stakes on a 5-inch screen)

- **Thumb zone discipline.** All critical actions (Bid, Confirm,
  Slide-to-Pay, KYC-Continue) live in the bottom third — that's the
  one-handed reachable zone per Apple HIG / mobile-UX research.
- **Tap target ≥ 44 × 44 pt.** Increase to 56 pt for irreversible
  actions (slide-to-confirm bid).
- **Form field count.** Every form field on mobile adds ~10 %
  abandonment. KYC chunked into atoms keeps each screen ≤ 4 fields.
- **Optimistic UI under 200 ms.** Bid taps acknowledge instantly
  with rollback on reject — Robinhood standard.
- **Realtime over polling.** Supabase realtime channels for
  parcel-bid updates, deal-state changes, KYC-resolved
  notifications. WebSocket beats every-N-second polling for both
  battery + latency.
- **Offline resilience.** A buyer in Mwanza on patchy 3G must be
  able to draft a bid, queue it, and have it auto-submit on
  reconnect. (Pattern: progressive web app + service worker
  queue; React Native equivalent via offline mutation queue.)

---

## §10 — Anti-patterns (do not do)

- **Carousel hero on home.** Steals attention from working data.
  Buyers want bids and balances on first frame, not marketing.
- **Modal "complete your KYC" popups.** Block the surface. Use a
  persistent yellow banner instead, dismissible per session.
- **Generic "Verified" green checkmark with no source link.** Erodes
  trust the moment one fraudulent listing slips through.
- **Tap-to-pay on bid confirm.** Accidental fires are catastrophic
  at six-figure TZS bid amounts. Slide-to-confirm only.
- **Hidden FX rate at settlement.** Surprise FX is the #1
  small-buyer complaint on cross-border deals. Always show locked
  rate on deal-room.
- **Spinner on KYC submission.** Always async-queue with
  push-notification on resolution.
- **English-only labels.** Default `sw`; bilingual everywhere.
- **Confetti on bid placement.** A bid is a binding offer, not a
  game. Save celebration for **settled** deals.

---

## §11 — Concrete proposal: `apps/buyer-mobile/app/(tabs)/marketplace/index.tsx`

**Verified path:** `apps/buyer-mobile/app/(tabs)/marketplace/index.tsx`
(file exists at this path; the `[id].tsx` parcel-detail screen
lives one level up at `apps/buyer-mobile/app/marketplace/[id].tsx`).

**Sections (top → bottom, scrollable, sticky header):**

| # | Section | Endpoint | Notes |
|---|---------|----------|-------|
| Header | Wallet bar (sticky) | `/v1/mining/buyers/wallet` | TZS primary, USD/KES toggle, fund/withdraw CTAs |
| 1 | Active bids strip | `/v1/mining/bids?buyer_id=me&status=open` | Horizontal scroll, color-coded countdowns |
| 2 | Recommended parcels | `/v1/mining/marketplace?recommended=true&buyer_id=me` | ML-ranked feed, trust-chip stack on each card |
| 3 | Saved searches | `/v1/mining/buyers/saved-searches` | Red dot for new matches; 3-min freshness SLA |
| 4 | Deal pipeline summary | `/v1/mining/deals?buyer_id=me&stage_summary=true` | Collapsed kanban counts; tap → full pipeline |
| 5 | Market signal strip | `/v1/mining/market-intelligence/spot` | Read-only; LME gold, tanzanite, copper |

**Endpoints to add / verify (server side):**

- `GET /v1/mining/marketplace` — list parcels with filters
  (mineral, region, min/max grade, quantity, ask price). Supports
  `recommended=true` for ML-ranked feed per buyer.
- `GET /v1/mining/marketplace/:parcelId` — full parcel detail
  including trust-chip evidence URLs.
- `POST /v1/mining/bids` — place bid; idempotent via
  `Idempotency-Key`. Returns < 200 ms ack; ledger hold async.
- `GET /v1/mining/bids?buyer_id=me&status=open` — active bids
  with countdowns.
- `POST /v1/mining/buyers/kyc/atoms/:atomType` — upload one KYC
  atom (personal-ID, company-reg, buy-license, bank-proof, AML).
  Idempotent and resumable.
- `GET /v1/mining/buyers/kyc/status` — atom-level completion
  state for resume-on-relaunch.
- `GET /v1/mining/deals?buyer_id=me` — deal pipeline with stage.
- `POST /v1/mining/deals/:id/milestones/:milestoneId/confirm` —
  advance milestone; each confirm fires `LedgerService.post()`
  for any associated payment release.
- `GET /v1/mining/buyers/me/performance` — win rate, response
  time, settlement reliability, trust tier.

**Brain integration.** The recommended-feed ML ranker, the
new-match detector, and the buyer trust-tier calculator all run
through the existing `packages/central-intelligence/` pipeline
(per Borjie cognitive composition). Junior recommendations cite
≥ 1 `evidence_id` (Borjie hard rule).

**Hard-rule compliance:**

- Every money render → `formatCurrency()`. ✓
- Multi-currency primary TZS, never hard-coded. ✓
- Swahili default, bilingual labels. ✓
- All POSTs idempotent via `Idempotency-Key`. ✓
- Realtime via Supabase channels, not polling. ✓
- RLS enforces buyer can only see own bids / deals / KYC. ✓
- Predictions append to rule-based recommendations, never
  replace. ✓

---

## §12 — References (15 sources, 1-line takeaway each)

1. [Cargill MiApp](https://www.cargill.com/food-beverage/miapp) —
   first 24/7 mobile commodity-price app for B2B food buyers.
2. [CargillAg](https://apps.apple.com/us/app/cargillag/id1511732255)
   — one-tap-from-bid-card-to-contract-creation; mobile B2B grain
   buy/sell.
3. [Bushel Mobile](https://bushelfarm.com/bushel-customer-portal-provided-by-grain-buyers-ag-retailers-free-for-farmers/)
   — Make-Offer in 42 s vs. 5 min phone call.
4. [Metalshub Trader](https://www.metals-hub.com/en/by-use-case/trader/)
   — three buyer modes (public enquiry / private tender / launch
   own RFB).
5. [Alibaba.com B2B Trade App](https://apps.apple.com/to/app/alibaba-com-b2b-trade-app/id503451073)
   — 16-language translator, 54 currencies, Trade Assurance
   escrow, ML rec engine.
6. [Faire Marketplace UX](https://excited.agency/blog/marketplace-ux-design)
   — buyer-first marketplace guarantees (net-60, returns)
   surfaced as trust chips.
7. [B2B Auction UX Case Study](https://medium.com/design-bootcamp/designing-a-b2b-e-auction-platform-a-ui-ux-case-study-a0084e7954c4)
   — four-tab nav (Dashboard / Auction / Saved / Chat), supplier
   anonymity, auction lobby stat strip.
8. [Swiggy Slide-to-Pay](https://medium.com/swiggydesign/healthy-friction-in-ux-a46c800cb479)
   — slide completes at 70 %, shimmer educates, haptic confirms;
   prevents accidental high-value fires.
9. [Robinhood UX](https://medium.com/design-bootcamp/ux-tricks-from-robinhood-app-c485d6fba7a8)
   — sub-200 ms order ack, animated price flips engage attention.
10. [System Design Robinhood](https://www.systemdesignhandbook.com/guides/design-robinhood/)
    — order acknowledgment under 200 ms is the industry floor.
11. [Persona KYC](https://withpersona.com/blog/kyc-verification)
    — Dynamic Flow: progressive liveness, step up only on risk
    signal; SDK mandatory for pass rate.
12. [Onfido vs. Persona vs. Stripe Identity](https://www.index.dev/skill-vs-skill/authentication-stripe-identity-vs-onfido-vs-persona)
    — 5–10 s ID+selfie production traffic; async UX, never block on
    spinner.
13. [Pipedrive Mobile Pipeline](https://rondesignlab.com/blog/work-in-progress/pipedrive-crm-sales-deal-management-mobile-app-ux-ui-design)
    — swipe-friendly deal cards, kanban stages, 42 % faster
    updates than desktop.
14. [Redfin Mobile](https://www.redfin.com/mobile) — 2-min listing
    refresh, conversational search, agent-coord; saved-search +
    alert is the buyer's daily surface.
15. [Airbnb Social-Proof Playbook](https://wyndomb.medium.com/designing-trust-lessons-from-airbnbs-social-proof-playbook-8c2e335717f7)
    — >50 % above-the-fold is trust; "reviews from people like
    you" beats stars; 10-review tipping point.

**Additional supporting reads.**

- [eBay Auction UX](https://www.octalsoftware.com/blog/best-auction-app-and-websites)
  — countdown + watcher counts + auto-refresh as urgency triplet.
- [LME](https://www.lme.com/) — LMElive is the reference for
  industrial-metals price terminal UX.
- [Knowde Chemicals](https://www.knowde.com/marketplace) —
  semantic-search across mineral chemistry properties; relevant
  for our parcel-search.
- [Blockchain Mineral Chain-of-Custody](https://metalor.com/financial-key-figures/blockchain-custody/)
  — cryptoseal scan via mobile transfers custody on-chain;
  reference for our §5 milestone 5 (custody in transit).
- [Multi-Currency Wallet UX](https://medium.com/@sortedwallet/sorted-wallets-new-2-0-look-09934dcae9ab)
  — local-currency-first display reduces mental conversion
  friction.
- [Coupa vs. Ariba Mobile](https://www.procuredesk.com/ariba-vs-coupa-procurement/)
  — voice search, expense capture, vendor-evaluation chips raise
  procurement-app G2 score.

---

**Last updated:** 2026-05-27.
**Owner:** Borjie buyer-mobile squad.
**Next review:** when buyer-mobile beta opens to first 10 KYC'd
buyers.

---

## Shipping log

- **[SHIPPED 2026-05-29]** Trust-chip stack on parcel cards (§7) —
  new `TrustChipStack` + pure `deriveTrustChips` module wires 5 chips
  (gov-licensed, lab-assayed w/ 30-day freshness, borjie-vetted,
  chain-of-custody, seller-history w/ 4.0★ tipping point). Each chip
  carries an evidence handle for deep-linking. Bilingual sw/en keys
  added under `marketplace.trust.*`. See
  `apps/buyer-mobile/src/marketplace/TrustChipStack.tsx` and tests
  `trust-chip-stack.test.ts`. Closes G2 in
  `Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md`.

- **[SHIPPED 2026-05-29]** WalletBar (§2.1 + §8) — sticky-top wallet
  component on the marketplace home with TZS-primary + USD/KES
  secondary toggle, FX timestamp + stale-after-5-min indicator. Pure
  `formatWalletAmount` formatter respects Borjie hard rule (currency
  code is always supplied, never hard-coded). Renders a stub snapshot
  until the gateway endpoint `/v1/mining/buyers/wallet` ships
  (sibling-owned). See
  `apps/buyer-mobile/src/marketplace/WalletBar.tsx`,
  `walletFormat.ts`, and tests `wallet-format.test.ts`. Closes G3 in
  `Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md`.
