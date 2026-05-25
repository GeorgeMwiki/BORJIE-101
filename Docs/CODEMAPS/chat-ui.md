# Chat-UI Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/chat-ui/`
**Public entry:** `packages/chat-ui/src/index.ts`
**Tier scope:** all (per-user; mastery + shortcuts scoped to user_id)

## Purpose

Brain-aware UI primitives that every app shares. Owns three UX
outsized improvements: **UI-2 ProactiveHint** (suggestion bubbles
driven by theory-of-mind affect state), **UI-3 MasteryGate**
(progressive disclosure by user mastery score), **UI-5
LearnedShortcutsPanel** (top per-route frequent actions ranked by
recency + confirmation rate). Plus the blackboard, generative-UI,
dopamine, voice, and degraded-mode primitives.

## Entry points

- `components/ProactiveHint.tsx` — UI-2 affect-driven suggestion.
- `components/MasteryGate.tsx` — UI-3 render gate; takes
  `level: MasteryLevel` + `score`.
- `components/LearnedShortcutsPanel.tsx` — UI-5 panel.
- `components/DegradedBanner.tsx` — LLM-down visibility (Wave 2 S).
- `hooks/useLearnedShortcuts.ts` — pulls per-route shortcuts.
- `lib/user-mastery/`, `lib/learned-shortcuts/`.
- `blackboard/`, `chat-modes/`, `generative-ui/`, `dopamine/`,
  `voice/`, `widget/`.

## Internal structure

- `components/` — the four exposed components above.
- `lib/user-mastery/` — mastery-level computation (novice / regular /
  expert) from action counts.
- `lib/learned-shortcuts/` — `rankActions`, `scoreAction`,
  `recencyWeight`, `confirmationRate`. Pure functions.
- `dopamine/` — `achievement-badge`, `confetti-trigger`,
  `level-progress-bar`, `streak-counter`.
- `blackboard/` — choreographed artifact stream (mirror of LITFIN
  smartboard pattern).
- `generative-ui/` — ui_block renderer for kernel-emitted blocks.
- `voice/`, `widget/`, `chat-modes/`.

## Dependencies

- Upstream: every app shell.
- Downstream: `packages/database` (`user_action_tracker` table,
  migration `0183_user_action_tracker.sql`), `packages/central-
  intelligence` (theory-of-mind affect state, ui_block emit),
  `packages/genui` (block contracts), `packages/design-system`.

## Common workflows

- **Add a proactive hint** → render `<ProactiveHint affect={...}
  message={...} />` near the cursor target; consumes mind-state from
  context.
- **Gate an advanced feature** → wrap with `<MasteryGate
  level="expert" score={score}>...</MasteryGate>`. Defaults to
  rendering nothing when locked.
- **Add a learned shortcut** → emit a `user_action_tracker` row on
  the action's success path; panel auto-ranks. Pinned items persist
  via `PinnedStorage`.
- **Surface degraded state** → render `<DegradedBanner reason={...}
  />` on any page when LLM is down; consumes a shared marker.
- **Voice + blackboard** → use `voice/` hooks; blackboard subscribes
  to the kernel's `<artifact>` SSE tags.

## Anti-patterns to avoid

- Never compute mastery score inside a component — call
  `lib/user-mastery/computeMasteryLevel()`; deterministic + testable.
- Never bypass MasteryGate for "just-this-once" — adds the surface
  to expert UI by accident.
- Pinned shortcuts must be user-scoped (not tenant-scoped) —
  shortcuts are personal preferences.
- Never duplicate the panel logic in an app — consume
  `useLearnedShortcuts`.

## Related codemaps

- [dynamic-sections.md](./dynamic-sections.md) — section evaluator
  uses mastery score
- [central-intelligence.md](./central-intelligence.md) — affect /
  mind-state source
- [database.md](./database.md) — `user_action_tracker` + section
  layouts
