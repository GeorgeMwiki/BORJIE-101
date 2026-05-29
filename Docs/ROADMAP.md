# Borjie Roadmap — true future enhancements only

**Last updated:** 2026-05-29
**Closure pass:** see `Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md` for the
default-CLOSE-NOW triage that retired 30+ stale "wave-scale" entries.

This roadmap is intentionally short. It lists ONLY items the
product team has elected to defer to a future cycle for reasons
unrelated to engineering capacity. Specifically:

- Genuine 2027+ research targets,
- Polish waves dependent on design / pilot-feedback decisions,
- Items requiring an explicit product-strategy authorization to start.

**Operator-action items** (purchases, credentials, signed
contracts) live in `Docs/OPS/OPERATOR_ACTION_LIST.md`.

**Items engineering CAN close but did not fit this sweep's time
budget** are tracked in `Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md`
§"CLOSE-NOW backlog".

---

## R-FUTURE-1 — On-device router (MiniLM-L6-v2 ONNX) (Q4 2026+)

**Source:** `Docs/RESEARCH/mobile-onload-intelligence.md` Phase 4
(§9.4)
**Status:** Stubbed at `packages/on-device-router/` so callers can
wire the slot today. 6/6 vitest tests lock the contract. The 80 MB
ONNX model bundle is the blocker.

**Why deferred:** Bundle-size + hardware diversity (Itel / Tecno
worker phones) make this risky for the pilot demographic. Research
doc explicitly defers to 2027.

**Decision gate:** revisit when pilot telemetry shows ≥ 30 % of
mobile turns blocked on tool-routing round-trip latency.

---

## R-FUTURE-2 — GhostCompletionInput textarea overlay rewrite (post-pilot)

**Source:** `Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md` (R27 retained
as design pass).
**Status:** Input-only version ships + endpoint + hook + 13 router
tests. Textarea overlay (sync scroll + line-wrap + cursor coords +
IME composition handling) is a v2 design pass.

**Why deferred:** Non-trivial UX — needs cursor math + IME handling
that input-only skipped. Schedule once pilot tells us whether
multi-line predictive composition is desired.

---

## R-FUTURE-3 — PnlTable finance BFF wire (product wave)

**Source:** `Docs/AUDIT/ORPHAN_AUDIT_2026-05-29.md`
**Status:** PnlTable component + bilingual headers + tests. No
gateway endpoint, no host page yet.

**Why deferred:** Requires a new `services/finance-tools` aggregator
package + a new `/finance` route in owner-web. Product strategy has
prioritized owner-cockpit + mobile cockpit ahead of the finance
surface; that ordering stands.

**Decision gate:** when the first commercial tenant requests a
monthly P&L view.

---

## R-FUTURE-4 — EntityTimeline per-entity drawer wiring (polish wave)

**Source:** `Docs/AUDIT/ORPHAN_AUDIT_2026-05-29.md`
**Status:** Generic timeline component + utilities. 4 entity
drawers (reminders, drafts, parcels, bids) need entity-specific
event composers.

**Why deferred:** Each drawer is ~2 dev-days × 4 = 8 dev-days. The
parent entity-drawer surfaces aren't yet pilot-load-tested; ship
basic drawer behaviour first, add the timeline once we know which
event streams matter.

**Decision gate:** post-pilot UI polish wave.

---

## R-FUTURE-5 — Marketing hero re-skin with effects (design pass)

**Source:** `Docs/AUDIT/ORPHAN_AUDIT_2026-05-29.md`
**Status:** Mesh / NeonGlow / InteractiveBackground / HeroDemoPreview
components ship — polished, perf-aware. Hero section unchanged.

**Why deferred:** Hero re-skin is a brand decision (does Borjie
present as a research console or as a consumer SaaS?). The brand
team has not signalled which direction. Components are kept under
`apps/marketing/src/components/effects/` so the swap is a 3-line
import flip when the brand direction lands.

**Decision gate:** brand pass before Series-A fundraise.

---

End of roadmap. Every other historical roadmap entry was either:

- **Shipped** (sibling agents closed during the 2026-05-29 sweeps —
  see `Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md` §"Verdict table"),
- **Moved to operator-action list** (`Docs/OPS/OPERATOR_ACTION_LIST.md`),
- **Closed inline** in the default-CLOSE-NOW pass,
- **Deleted as dead code** (R18 station-master / R23 renewal /
  R26 marketplace-inbound / R34 SectionSkeleton-equivalent-shipped),
- **Engineering backlog** awaiting one more focused pass (R16, R19,
  R22, R24, R37, R41 — see purge doc).
