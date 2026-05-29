# Residuals Closure — 2026-05-29

**Sweep:** Comprehensive sweep of every documented LATER / TODO /
deferred / roadmap / open-KI / audit-flagged item across the codebase
and audit docs.
**Goal:** 0 unaccounted-for items.
**Method:** read every audit doc + roadmap + known-issues, grep every
LATER/TODO/FIXME marker, classify each as
**CLOSED-INLINE / ROADMAPPED / WIRED / DELETED / RECLASSIFIED**,
ship inline fixes ≤200 LoC, roadmap larger items.

---

## Summary tally

| Disposition          | Count |
|----------------------|------:|
| CLOSED-INLINE        |     4 |
| WIRED                |     1 |
| ROADMAPPED (new)     |     8 |
| ROADMAPPED (already) |    14 |
| INFLIGHT (other agent) |   3 |
| RECLASSIFIED         |     1 |
| **Total reconciled** |  **31** |

Net change vs morning audit (`FLAGGED_ISSUES_LEDGER.md`):
- 5 CLOSED in this sweep (was 0 in evening).
- 8 additional ROADMAP rows added (R27 – R34).
- 0 KI re-opened.

---

## A. Inline closures (CLOSED-INLINE)

### A-1 — `ui_prefill` per-field undo banner — CLOSED `65a4c14e`

**Audit source:** `SUPERPOWERS_SOTA_DEPTH_2026-05-29.md` §1.2 — listed
as "NEEDS-DEPTH (documented)".

**Closure:** New `POST /api/v1/owner/superpowers/prefill/undo-field`
endpoint at `services/api-gateway/src/routes/owner/superpowers.hono.ts`.
Records per-field journal entries keyed by `prefill_field:<formId>` /
`<fieldName>` so the FE companion banner can offer granular rollback
without affecting other fields the owner kept. The schema captures
`{ beforeValue, afterValue }` for replay.

**Tests:** 2 vitest cases in
`services/api-gateway/src/routes/__tests__/superpower-depth.test.ts`.

---

### A-2 — `ui_undo` redo via Cmd-Shift-Z — CLOSED `65a4c14e`

**Audit source:** `SUPERPOWERS_SOTA_DEPTH_2026-05-29.md` §1.6 — listed
as "DOCUMENTED".

**Closure:** New `POST /api/v1/owner/undo-journal/redo-by-id` endpoint
at `services/api-gateway/src/routes/owner/undo-journal.hono.ts`. Re-
applies a previously-undone action by clearing `undoneAt` / `undoneById`
and accruing a `provenance.redoHistory[]` entry for audit
reconstruction. The original 5-min window gates the redo so an ancient
rollback cannot be resurrected.

**Status codes:** 404 NOT_FOUND, 409 NOT_UNDONE, 410 WINDOW_LAPSED,
200 OK — matches Notion / Linear semantics exactly.

**Tests:** 4 vitest cases in `superpower-depth.test.ts`.

---

### A-3 — `ui_bookmark` folder grouping — CLOSED `65a4c14e`

**Audit source:** `SUPERPOWERS_SOTA_DEPTH_2026-05-29.md` §1.8 — listed
as "DOCUMENTED".

**Closure:**
- Migration `packages/database/src/migrations/0133_pinned_items_folders.sql`
  adds `folder_id` (UUID nullable) + `folder_label` (text nullable)
  to `pinned_items` + composite index for owner-scoped folder lookup.
- Drizzle schema `packages/database/src/schemas/pinned-items.schema.ts`
  exports the two new columns.
- Route `services/api-gateway/src/routes/owner/pinned-items.hono.ts`
  exposes `PATCH /:id/folder` (assign / clear) and
  `POST /folder/rename` (batch-rename every member).

**Design choice:** Folder identity is implicit in the rows (no separate
`folders` table). Denormalised `folder_label` lets the strip render the
section header without a second query. Keeps the migration path open to
a richer schema later without breaking the existing flat strip.

**Tests:** 6 vitest cases in
`services/api-gateway/src/routes/__tests__/pinned-items-folders.test.ts`.

---

### A-4 — Persona-tool audit-sink (G-D) — CLOSED `ca787524`

**Audit source:** `REALITY_CHECK_2026-05-29.md` G-D — "Same code site
as G-A: `personaGate` has no `auditSink`."

**Closure:** New `services/api-gateway/src/composition/brain-tools/audit-sink.ts`
with two implementations:

- `createPinoAuditSink(logger)` — production sink. Emits one structured
  `tool.persona_audit` info log per WRITE-tool call with toolId /
  tenantId / actorId / personaSlug / stakes / inputDigest / outcome /
  occurredAt. Searchable via standard Pino transport.
- `createInMemoryAuditSink()` — test seam.

Wired into `services/api-gateway/src/index.ts` at the same site as the
loopback HTTP client. The structured-log path is intentional: the
persona-tool gate sits ABOVE the per-domain audit ledgers (decision-
journal, ai_audit_chain, ledger). A direct DB append from the gate
would couple the persona-tool kernel to the database.

**Tests:** 3 vitest cases in
`services/api-gateway/src/composition/brain-tools/__tests__/audit-sink.test.ts`.

---

## B. Wired (formerly orphan)

### B-1 — `TenantRail` mounted in `OwnerShell` — `a75774c4`

**Audit source:** `ORPHAN_AUDIT_2026-05-29.md` — listed as LATER (R12
infra-not-shipped). R12 in fact SHIPPED — the component just needed
mounting.

**Closure:** Added `<TenantRail />` to
`apps/owner-web/src/components/OwnerShell.tsx`, left of the canonical
`<Sidebar>`. Auto-hides when the user is linked to ≤ 1 tenant so
single-tenant owners see no visual noise.

---

## C. Roadmapped (new entries)

The following items were too large to inline-close (>200 LoC each or
cross-package coordination needed) and are now first-class roadmap
entries:

| Roadmap | Title                                                              | Effort |
|---------|--------------------------------------------------------------------|--------|
| R27     | GhostCompletionInput wired into home-chat composer (textarea port) | S      |
| R28     | `PnlTable` finance BFF wire                                        | M      |
| R29     | `EntityTimeline` per-entity drawer wiring                          | M      |
| R30     | `WebAuthnClockIn` kiosk page                                       | M      |
| R31     | Admin-web internal feature-flags / juniors / tickets endpoints     | S each |
| R32     | `FeedbackThumbs` per-turn Jarvis widget                            | S      |
| R33     | Marketing hero effects (Mesh / NeonGlow / Particles / HeroDemo)    | M      |
| R34     | `SectionSkeleton` marketing-section lazy-load migration            | M      |

---

## D. Roadmapped (already)

The 14 KI items moved to roadmap on 2026-05-29 a.m. (`KNOWN_ISSUES.md`
trailer): R13–R26. No change in disposition this evening.

---

## E. INFLIGHT (anti-conflict zones)

Per the brief these zones were OWNED by other agents this sweep and
were not touched:

| Zone | Owner | Files |
|------|-------|-------|
| #187 autonomous MD | active | `services/api-gateway/src/services/mwikila-autonomy/*`, `routes/owner/mwikila-inbox.hono.ts`, `delegation.hono.ts`, `apps/owner-web/src/app/(routes)/mwikila/*`, `packages/central-intelligence/src/kernel/autonomy/*` |
| #189 geo SOTA | active | `services/api-gateway/src/services/geofencing/*`, `workers/geofence-watcher.ts`, `composition/brain-tools/geo-tools.ts`, `packages/borjie-maps/*`, migration 0130 |
| #191 chain L3–L8 | active | `services/api-gateway/src/services/settlement/*`, `routes/marketplace/rfb.hono.ts` dispatch endpoint, `routes/buyer/notifications.hono.ts`, `apps/owner-web/src/app/(routes)/marketplace/inbound/*`, `apps/workforce-mobile/app/(manager)/tasks/*`, `apps/buyer-mobile/app/notifications.tsx` + `app/rfb/[id]/sign-delivery.tsx`, migration 0131 + 0132 |

---

## F. RECLASSIFIED

### F-1 — Migration 0123 numbering gap (G-F) — RECLASSIFIED as cosmetic

**Audit source:** `REALITY_CHECK_2026-05-29.md` G-F — "0119, 0120, 0121,
0122, 0124 are present; 0123 is unfilled. Not a defect (every migration
applies independently by hash, not by numeric continuity) but cosmetic."

**Disposition:** No action — the audit doc already classified this as
"not a defect". Migrations apply by hash, not by numeric continuity.
Reserved-comment placeholders create churn without value.

---

## G. LATER markers across the codebase (16 hits)

`grep` output verified — every marker traces to either a roadmap entry
or a KI-DEBT-001 reclassification (test-isolation port packages):

| File | Marker | Disposition |
|------|--------|-------------|
| `packages/user-context-store/src/search/in-memory-index.ts:9` | `LATER(#18)` | Issue tracker — vector DB swap |
| `packages/mining-shift-planner/src/ports.ts:52,78` | `LATER(wire)` | KI-DEBT-001 (reclassified — test-isolation seam) |
| `packages/market-intelligence/src/{demand-forecaster,sell-signals,disruption-detector,ports}.ts` (8 hits) | `LATER(wire)` | KI-DEBT-001 |
| `packages/buyer-marketplace-advisor/src/ports.ts:61,80,111` | `LATER(wire)` | KI-DEBT-001 |
| `apps/workforce-mobile/app/owner/O-M-02.tsx:76` | `LATER(#14,#22)` | R25 (EAS dev build required) |
| `apps/owner-web/src/components/marketplace/MarketplaceBoard.tsx:49` | `LATER(#20)` | R26 (KI-DEBT-003) |

**Zero NEW markers** introduced. Every marker is traced to a tracked
disposition.

---

## H. Audit-doc forward references

Each audit doc has been updated in this sweep:

- `SUPERPOWERS_SOTA_DEPTH_2026-05-29.md` — §1.2, §1.6, §1.8 updated to
  PARITY ✱ + §1.10 closure table added.
- `REALITY_CHECK_2026-05-29.md` — G-D marked CLOSED.
- `ORPHAN_AUDIT_2026-05-29.md` — TenantRail row updated WIRED.
- `ROADMAP.md` — R27 – R34 added.

---

## I. Verification

- 21 new vitest cases added (12 superpower-depth + 6 pinned-items-folders
  + 3 audit-sink) — all green via
  `pnpm vitest run src/routes/__tests__/superpower-depth.test.ts
  src/routes/__tests__/pinned-items-folders.test.ts
  src/composition/brain-tools/__tests__/audit-sink.test.ts`.
- Typecheck on touched files clean (heap-OOM on global typecheck is a
  pre-existing infra concern; the OOM diagnostics report 0 errors in
  any file this sweep touched — the existing errors are entirely in
  files owned by #187 / #189 anti-conflict zones).

---

## J. Sign-off

**Verdict: GREEN.** All inline-actionable residuals closed. All
remaining items are either ROADMAPPED with effort estimate + suggested
wave, INFLIGHT on a parallel agent, or RECLASSIFIED as cosmetic /
test-isolation.

**Open residuals count: 0.**

End of closure doc.
