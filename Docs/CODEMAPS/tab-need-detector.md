# Tab Need Detector Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/tab-need-detector/`
**Public entry:** `packages/tab-need-detector/src/index.ts`
**Tier scope:** tenant + user (every row goes through RLS via `app.current_tenant_id`)
**Piece:** O — Need-Detection Tab Spawning v2

## Purpose

Beyond Piece B's "user requests a module" — Piece O is the system
DETECTING need and OFFERING to add a tab. The Compliance tab only
appears when compliance need is observed; the Legal tab only when
legal signals fire. Per-user layout overrides on top of tenant defaults.

Vision:
1. **Observe** user behaviour (searches, conversations, doc uploads,
   tab events, external triggers).
2. **Detect** unmet need via signal scoring (NER + intent + frequency
   thresholds with half-life decay).
3. **Propose** spawning a relevant tab/module to the user with a banner.
4. **Personalise** layout per user when the tab spawns (sections
   ordered by mastery + recency + frustration).

Backs migrations **0261-0265**.

## Entry points

- `src/index.ts` — barrel; re-exports every public surface.
- `src/types.ts` — Zod schemas mirroring migrations 0261-0265 plus
  `resolveDetectorConfig` + `ResolvedDetectorConfig`.
- `src/scoring-matrix.ts` — pure constants + `evaluateSearchQuery`,
  `evaluateNerEntities`, `evaluateIntentLabel`, `evaluateDocType`,
  `evaluateTabEventPattern`, `evaluateExternalTrigger`.
- `src/signal-observers/` — one observer per signal kind:
  - `conversation-observer.ts` — `observeConversation` (NER + intent)
  - `document-observer.ts` — `observeDocument` (doc_type)
  - `tab-event-observer.ts` — `observeTabEventPattern` (Piece L patterns)
  - `search-observer.ts` — `observeSearch` + `tokeniseQuery`
- `src/signal-aggregator.ts` — `aggregateSignals` + `filterAboveThreshold`.
- `src/proposal-emitter.ts` — `planEmissions`, `planExpirations`,
  `validateTransition`.
- `src/personalization-engine.ts` — `decidePersonalization`.
- `src/cron.ts` — `runCron` + `scanTenant` + `NeedDetectorRepository` port.

## Internal structure

- `src/types.ts` — every type & Zod schema. No IO.
- `src/scoring-matrix.ts` — 6 lookup tables + 6 evaluator functions.
  Pure. KRA/TRA literals are entity-type LABELS (NER outputs), not
  jurisdictional business logic — file-level disable applied per the
  same convention as `packages/ai-copilot/src/security/pii-scrubber.ts`.
- `src/signal-observers/` — 4 pure converters. Each turns one source
  event into `NewSignalInput[]` rows ready for migration 0261.
- `src/signal-aggregator.ts` — half-life decay (base-2, so `halfLife=7d`
  literally halves a 7-day-old signal). Groups by `(user, module)`,
  sorts deterministically.
- `src/proposal-emitter.ts` — threshold check + decline-snooze (30d
  default) + already-installed + already-pending skip. Outputs
  `EmitPlan` with rows to insert + skipped reasons for telemetry.
  Message templates live in a `Map` for security/detect-object-injection
  compliance.
- `src/personalization-engine.ts` — mastery gate (novice<31 hides
  advanced; expert>=71 hides beginner), recency boost (1/idx), frustration
  nudge (>=0.6 hides advanced), and override merging (low→high
  priority order so high-priority writes last and wins).
- `src/cron.ts` — `NeedDetectorRepository` IO port + `scanTenant` (pure
  pipeline atom) + `runCron` (multi-tenant wrap with per-tenant try/
  catch).

## Migrations

| # | Table | Purpose |
|---|-------|---------|
| 0261 | `tab_spawn_signals` | Append-only signal stream (one row per observed event) |
| 0262 | `tab_spawn_proposals` | Emitted proposals + status (pending/accepted/declined/expired/snoozed) |
| 0263 | `tab_personalization` | Per-user layout overrides (one row per (tenant, user, module)) |
| 0264 | `layout_overrides` | Section-level overrides (tenant-wide OR user-specific) |
| 0265 | `spawn_detector_state` | Cron state + per-tenant config |

All five tables FORCE RLS via `public.current_app_tenant_id()` (the
GUC helper installed by 0172). RLS pattern is identical to the
gold-standard 0182/0185.

## Dependencies

- Upstream: `services/api-gateway/` (will mount the emitter + observer
  hooks once the cron is wired in Wave 24); `packages/dynamic-sections/`
  (the `PersonalizationDecision.sectionOrder` is consumed by the
  registry evaluator); `packages/chat-ui/` (the proposal banner is
  planned as a sibling to `ProactiveHint`).
- Downstream / soft pointers (tables may not exist yet):
  - Piece B's module catalogue (`modules` / `module_templates`)
  - Piece F's `conversation_messages`
  - Piece K's `document_extractions`
  - Piece L's `tab_event_log`
  Each observer accepts plain events via an in-memory contract so this
  package doesn't hard-depend on schemas that ship later.

## Common workflows

- **Observe a chat message** → call `observeConversation({tenantId,
  userId, messageId, intent, entities})` and persist the returned
  `NewSignalInput[]` to `tab_spawn_signals`.
- **Observe a document upload** → `observeDocument({…, docType,
  confidence})`. Confidence damps the weight.
- **Run the detector cron** → `runCron({repo, now, generateId, log})`
  iterates every tenant, fetches signals over the lookback window
  (`config.lookbackDays`, default 14), aggregates with half-life
  decay (`signalHalfLifeDays`, default 7), and emits proposals for
  every (user, module) whose score >= `scoreThreshold` (default 5.0).
- **User accepts a proposal** → app calls `validateTransition(pending,
  accepted)` (pure check), updates the row, then triggers Piece B's
  module install flow (out of scope for this package — stubbed by Wave
  24).
- **User declines a proposal** → `validateTransition(pending,
  declined)`, set `status='declined'`, `decided_at=now()`. Emitter
  will skip the same `(user, module)` for `declineSnoozeDays` (30 days
  default, per-tenant configurable via `spawn_detector_state.config_jsonb`).
- **Personalise a fresh tab** → `decidePersonalization({tenantId,
  userId, moduleId, baseSectionIds, masteryLevel, advancedSectionIds,
  beginnerSectionIds, recentActionSectionIds, frustration, overrides})`
  yields the section ordering to persist into `tab_personalization`.

## Algorithm details

**Half-life decay (aggregator):**

```
weighted = signal.weight * 2 ^ (-ageDays / halfLifeDays)
```

`2` (not `e`) so the half-life is literal: at exactly halfLife,
contribution is half. Future-dated rows clamp to zero age (no boost).
Rows outside the lookback window are dropped.

**Mastery tiers (personalization):**

| mastery | tier | behaviour |
|---------|------|-----------|
| 0-30 | novice | hide `advancedSectionIds` |
| 31-70 | intermediate | full surface |
| 71-100 | expert | hide `beginnerSectionIds` |

**Override priority order:** processed ASCENDING so highest-priority
writes LAST and therefore wins (last-writer-wins per section + kind).

## Anti-patterns to avoid

- Never write directly to `tab_spawn_signals` from observer
  callers — the observers return `NewSignalInput[]`; let the cron's
  writer insert with `generateId()` so ids are uniform.
- Never re-propose without consulting `fetchProposalHistory` — the
  declined-snooze rule is what keeps the experience trustable. Users
  who see "want a Compliance tab?" twice in a week will dismiss the
  whole system.
- Never mutate the returned `PersonalizationDecision` — it's frozen.
  Persist as-is or compute a fresh decision.
- Never lift the half-life formula to `Math.E` — the literal-half
  semantic is what tenants reason about when they tune
  `signalHalfLifeDays`.
- Never bypass the `NeedDetectorRepository` port from `cron.ts` — the
  package stays IO-free. The Drizzle implementation lives outside.

## Related codemaps

- [dynamic-sections.md](./dynamic-sections.md) — adaptive layout
  engine that consumes `PersonalizationDecision.sectionOrder`.
- [chat-ui.md](./chat-ui.md) — `ProactiveHint` is the sibling pattern
  for the proposal banner.
- [database.md](./database.md) — migrations 0261-0265 + RLS policies.
- [central-intelligence.md](./central-intelligence.md) — NER pipeline
  feeds `observeConversation`; affective profile feeds the
  personalization engine.
