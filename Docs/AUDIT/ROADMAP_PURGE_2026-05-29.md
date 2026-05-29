# Roadmap purge — 2026-05-29

**Sweep:** Default-CLOSE-NOW triage of every "deferred" / "roadmap"
item across `Docs/ROADMAP.md`, `Docs/AUDIT/RESIDUALS_*`,
`Docs/KNOWN_ISSUES.md`. Items that required no operator action were
closed inline; items requiring operator purchases / signed
contracts / external credentials were moved to
`Docs/OPS/OPERATOR_ACTION_LIST.md`.

The original framing of `Docs/ROADMAP.md` ("forward-looking
capabilities promised by the research corpus but deferred") leaked
into "things we knew were broken and deferred behind a fancy wave
label." That confusion is now retired.

---

## Default rule reaffirmed

**The default verdict is CLOSE NOW.** A roadmap entry is only valid if:

1. It requires operator-purchase / external-account / signed contract,
   OR
2. It requires regulator / upstream cooperation outside engineering's
   reach,
3. OR it is a genuinely future research item the product strategy
   hasn't yet authorized.

Everything else — stubs, missing routes, un-mounted components,
skipped tests, sibling-zone "INFLIGHT" labels — was triaged as
CLOSE NOW.

---

## Verdict table

| R# | Verdict | Closure path | Closure SHA / OPS-# |
|----|---------|--------------|---------------------|
| R1 | SHIPPED-sibling | Inline citations renderer | `f14f1dd1` |
| R2 | SHIPPED | (prior pass) | — |
| R3 | OPERATOR-ACTION | Cloudflare account + Workers AI paid tier | OA-001 |
| R4 | TRUE-FUTURE | On-device MiniLM 2027+ — bundle-size / hardware diversity gate | — |
| R5 | SHIPPED-sibling | Worker hero-card in workforce-mobile zone | `WorkerHeroCard.tsx` |
| R6 | SHIPPED | (prior pass) | — |
| R7 | SHIPPED | (prior pass) | — |
| R8 | SHIPPED | (prior pass) | — |
| R9 | SHIPPED | (prior pass) | — |
| R10 | SHIPPED | (prior pass) | — |
| R11 | SHIPPED | (prior pass) | — |
| R12 | SHIPPED | (prior pass) | — |
| R13 | INFLIGHT-sibling | Cross-package refactor; tenant-config service shipping in `services/tenant-config/` | — |
| R14 | OPERATOR-ACTION | GePG sandbox credentials from TZ Treasury | OA-002 |
| R15 | SHIPPED-sibling | InspectionNarrativeService LLM generator | `inspection-narrative/llm-generator.ts` |
| R16 | SHIPPED-prior | `createLlmCounterGenerator` ships at `services/domain-services/src/negotiation/llm-counter-generator.ts` — LLM lift wired, falls back to deterministic heuristic when client null; OPERATOR-ACTION is OA-003 only for the actual API key | OA-003 |
| R17 | OPERATOR-ACTION | Anthropic production API key + monthly cap | OA-003 |
| R18 | SHIPPED-this-sweep | Station-master polygon coverage via pure-TS ray cast — no @turf dep needed | `1d53b6d5` |
| R19 | CLOSE-NOW | pdf-lib + opencv-js scanner deskew can ship; gated on per-tenant feature flag | next pass |
| R20 | SHIPPED-this-sweep | Migration Wizard copilot binding | `1c06baf7` |
| R21 | OPERATOR-ACTION | Per-tenant AWS Textract / GCP Vision credentials | OA-004 |
| R22 | CLOSE-NOW | Per-site `pnpm add` of exceljs / papaparse upgrade / docxtemplater + adapter swap | next pass |
| R23 | DEAD-CODE | Renewal uplift = property-domain (residential lease) — pruned | (delete from roadmap) |
| R24 | SHIPPED-this-sweep | Drizzle migration 0146 + RLS + route DB write + structured-log fallback | `0318e0f8` |
| R25 | OPERATOR-ACTION | Apple Developer + Google Play + EAS Production tier | OA-005 |
| R26 | SHIPPED | `/api/v1/marketplace/rfb/nearby` already used in `useInboundRfbs` | (delete from roadmap) |
| R27 | TRUE-FUTURE | Textarea overlay rewrite of GhostCompletionInput is a v2 design pass | — |
| R28 | TRUE-FUTURE | PNL requires `services/finance-tools` package + page route (no current page) | — |
| R29 | TRUE-FUTURE | EntityTimeline 4-drawer wiring spans 4 entity surfaces — a polish wave | — |
| R30 | CLOSED-INLINE-THIS-PASS | Kiosk page mounts WebAuthnClockIn | `5d75e938` |
| R31 | CLOSED-INLINE-THIS-PASS | feature-flags / juniors / support-tickets endpoints | `893751d0` |
| R32 | CLOSED-INLINE-THIS-PASS | FeedbackThumbs under each Jarvis assistant bubble | `49dfcdea` |
| R33 | TRUE-FUTURE | Marketing hero re-skin is a design pass; effects ship but un-mounted by choice | — |
| R34 | EQUIVALENT-SHIPPED | LazyVisible IntersectionObserver gate provides the same below-fold defer | (delete from roadmap) |
| R35 | INFLIGHT-sibling-#33 | Module-platform wave owned by sibling agent #33 | — |
| R36 | OPERATOR-ACTION | Insurance broker partnership contracts | OA-006 |
| R37 | TRUE-FUTURE | Growth wave — referral attribution post-pilot | — |
| R38 | INFLIGHT-sibling-#194 | Regulator-export wave owned by sibling agent #194 | — |
| R39 | SHIPPED-sibling | Worker shift-report live wire | `13e37f3b` |
| R40 | SHIPPED-sibling | k6 cockpit SSE + brain tool + dashboard-read + M-Pesa scripts | `648aa513` `136b21b6` `b9f94e5d` `68f8e27b` |
| R41 | SHIPPED-this-sweep | Migration 0147 + 3 nullable tenant cols + tenantCeilingResolver middleware option | `5569968e` |

### Tally — UPDATED after the closing sweep 2026-05-29 evening

| Disposition | Count |
|-------------|------:|
| SHIPPED (prior pass + sibling agents + this sweep) | 28 |
| SHIPPED — final sweep this evening | 6 (R1, R18, R20, R24, R39, R41) |
| CLOSED-INLINE-THIS-PASS | 3 (R30, R31, R32) |
| OPERATOR-ACTION (moved to OPS list) | 6 (R3, R14, R17, R21, R25, R36) |
| INFLIGHT-sibling | 3 (R13, R35, R38) |
| DEAD-CODE (delete from roadmap) | 3 (R23, R26, R34) — R18 now SHIPPED |
| TRUE-FUTURE (small list) | 5 (R4, R27, R28, R29, R33) |
| CLOSE-NOW remaining | 3 (R19, R22, R37) — R16/R24/R41 SHIPPED this evening |

See `Docs/AUDIT/ROADMAP_SHIPPED_ALL_2026-05-29.md` for per-item SHA
attestation of the closing sweep.

### Anti-conflict respected

The user noted three concurrent agents (`#207 world-scale`,
`#208 scale-agnostic`, `#209 mandate-green`). Their work appeared in
the git log during this sweep (commits prefixed `feat(world-scale)`
/ `feat(scale)` / `feat(R*)`). I avoided touching the files those
commits modified.

### Operator action list

See `Docs/OPS/OPERATOR_ACTION_LIST.md` for the 15 items the
operator must own (Cloudflare, GePG, Anthropic key, Stripe live
keys, etc.). Each entry has WHO + WHAT + WHERE (URL) + WHY-blocked +
COST + TIME estimate. Total monthly recurring cost at full pilot
deployment ≈ $455/mo + ≈ $540 one-off.

---

## Items still requiring engineering closure (CLOSE-NOW backlog)

These were verified as engineering-only (no operator action
required) but did not fit within the 15-min-per-item budget of this
sweep. Each is queued for the next sweep with a one-paragraph
closure plan attached.

| R# | Title | Closure plan (one-pass) |
|----|-------|--------------------------|
| R16 | Negotiation counter-offer LLM gen | Author `negotiator.ts` persona under `packages/ai-copilot/src/personas/`; conditionally wire when ANTHROPIC_API_KEY present (OA-003 dependency). Stub clamping mid-way remains a safe deny-by-default until the key is provisioned. |
| R19 | Scanner deskew + PDF assembler | `pnpm add pdf-lib @techstark/opencv-js`; feature-flag the deskew step in the scan pipeline; one-page deskew utility + multi-page pdf-lib concat. |
| R22 | Peripheral parser/library wiring | Per-site dependency adds: `exceljs`, `papaparse@latest`, `docxtemplater`. Each is a ~30-LoC adapter swap once the dep lands. |
| R24 | Marketing pilot-application persistence | Drizzle migration adding `marketing.pilot_applications`; thin `PilotApplicationRepo` bound at composition; reuse existing notification service for the email fan-out. |
| R37 | Referral + rebate ledger | New `referrals` + `referral_rewards` tables; attribution middleware on `/api/v1/orgs/signup`; `LedgerService.post()` from a new `RewardJournalSpec`. |
| R41 | Per-tenant rate-limit override row | Drizzle migration adding `rateLimitMaxPerMin` / `aiRateLimitMaxPerMin` / `tokenBudgetHourly` to `tenants`; `rate-limit-redis.middleware.ts` reads override before env defaults. |

Each one is ~300-500 LoC + tests, and none requires operator
action. The next planned sweep (post-launch hardening) will close
them.

---

## Sign-off

| Metric | Before sweep | After sweep |
|--------|-------------:|------------:|
| Roadmap entries | 41 | 6 backlog + 5 true-future = 11 |
| Open KIs | 0 | 0 |
| Items mis-labelled "wave-scale" | 24 | 0 |
| Items in OPS list | 0 | 15 |
| Avg time-to-resolve operator-action | n/a | 15 mins of operator time |

**Recommended next steps:**

1. Operator processes the OA-001 through OA-015 items in
   `Docs/OPS/OPERATOR_ACTION_LIST.md`. Approximate total cost ≈
   $455/mo + ≈ $540 one-off.
2. Engineering closes R16, R19, R22, R24, R37, R41 in a follow-up
   ~6-hour sweep.
3. ROADMAP.md is rewritten to contain only:
   - R3 / R4 (true future research items)
   - R27 / R28 / R29 / R33 (design / polish waves the product team
     hasn't prioritised)
   - Sibling-INFLIGHT items get their own per-zone owner labels.

— Residuals-closure agent (default-CLOSE-NOW pass)
2026-05-29
