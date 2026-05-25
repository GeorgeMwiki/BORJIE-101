# Tutoring Skill Pack Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/tutoring-skill-pack/`
**Public entry:** `packages/tutoring-skill-pack/src/index.ts`
**Tier scope:** all tenants
**Migration:** `0210_tutoring_skill_pack.sql`

## Purpose

Piece H — Socratic adaptive tutor. Drives a lesson through:
`assess → hook → explain → worked_example → check_understanding →
remediate → mastery → complete`. The "secret sauce" is the
data-grounded worked example: the orchestrator pulls real tenant
ledger rows through the data adapter, substitutes them into the
example, and carries `DataCitation` back-pointers so the UI can drill
into the source row.

Built-in concepts (10): `net_operating_income`, `cap_rate`,
`arrears_aging`, `occupancy_rate`, `depreciation`, `trial_balance`,
`profit_and_loss`, `balance_sheet`, `cash_flow`, `irr`. Each carries
hook + definition + formula + worked example + common mistakes +
check-understanding probes.

## Entry points

- `lesson-orchestrator.ts` → `startLesson(input, deps)` returns a
  `LessonSession` for interactive use; `runLesson(input, deps)`
  walks the whole lesson auto-mode (for tests, study-notes export).
- `built-in-concepts.ts` → `BUILT_IN_CONCEPTS`,
  `InMemoryConceptStore`. TS mirror of migration 0210 seed.
- `state-machine.ts` → pure transitions (`initialState`, `advance`,
  `nextStep`, `isDontGetIt`, `scoreCheckAnswer`,
  `pickCitationFocus`).
- `data-grounding.ts` → `groundWorkedExample(...)`,
  `substitute(...)`, `StubTutoringDataAdapter`.
- `mastery-gate-integration.ts` → `makeMasteryRecorder`,
  `tutorActionId`, `noopMasteryRecorder`, `summariseLessonOutcomes`.

## Internal structure

- `types.ts` — `TutoringConcept`, `TutoringContent`, `LessonState`,
  `LessonEvent`, `ConceptStore`, `TutoringDataAdapter`,
  `MasteryRecorder`, `DataCitation`, `TutoringEngineError`.
- `state-machine.ts` — pure functions. Branch rules:
  - First wrong answer: stay on probe, attempt += 1.
  - Second wrong: surface common mistakes, advance.
  - "I don't get it" (regex): branch to `remediate` with citation
    focus picked from learner's words.
- `data-grounding.ts` — substitute `{{key}}` placeholders with
  resolved values; format numbers with thousands separators;
  graceful degrade to static text when adapter fails.
- `mastery-gate-integration.ts` — emits one `UserActionEvent` per
  outcome with action id `tutor.<concept>.<correct|incorrect>`.
  Routes through the existing `user_action_tracker` table (migration
  0183) so UI-3 MasteryGate / UI-5 LearnedShortcutsPanel light up.
- `__tests__/` — state-machine, lesson-orchestrator, data-grounding,
  parity with migration 0210.

## Dependencies

- Upstream: chat-ui surfaces tutor lessons; api-gateway wires real
  concept-store + data-adapter delegating to payments-ledger /
  occupancy repositories.
- Downstream:
  - `packages/database` (`tutoring_skill_pack` table, migration
    0210; `user_action_tracker` table for mastery progression).
  - Optional: `packages/chat-ui` (the recorder writes one row per
    answer; the existing `useUserMastery` hook reads them).
- Zero third-party runtime deps. No React import — server-side
  package.

## Common workflows

- Run a lesson interactively → `const session = await startLesson(...); session.submit(reply)`.
- Auto-run a lesson (e.g. for study-notes export) → `await runLesson(...)` returns `LessonEvent[]`.
- Add a tenant-custom concept → `conceptStore.registerTenantConcept(concept)`. Same state machine; new content.
- Ground a worked example in live data → register the binding's `source` key on the data adapter; the orchestrator handles substitution + citations.
- Recover when the data adapter is unavailable → `groundWorkedExample` swallows adapter errors and emits static text with placeholders still visible. The lesson still teaches.

## Anti-patterns to avoid

- NEVER produce raw SQL from a tutor question — every numeric in the
  worked example must come from a typed adapter call.
- NEVER block the lesson on the data adapter — failures degrade to
  static text, not exceptions.
- NEVER fabricate citations. If `DataCitation.sourceRef` is set, it
  MUST resolve to a real row id; otherwise omit the citation.
- The state machine MUST stay pure. Adding side effects there breaks
  resumability (we serialise state to advance later).
- Do not import React / chat-ui — server-side library only. The
  mastery bridge accepts a flush callback so the React tracker
  remains the chat-ui's concern.

## Related codemaps

- [chat-ui.md](./chat-ui.md) — MasteryGate + `useUserMastery` read
  the same `user_action_tracker` table the tutor writes to.
- [report-engine.md](./report-engine.md) — Piece H sibling; tutor
  notes can be exported as a report.
- [presentation-engine.md](./presentation-engine.md) — Piece H
  sibling; tutor lessons can be re-rendered as decks.
- [database.md](./database.md) — `tutoring_skill_pack` table,
  `user_action_tracker` table.
