# Dynamic UI — SOTA Research (2026-05-29)

Owner: dynamic-ui audit agent. Wave: DU. Status: complete.

This document captures the 2026 state-of-the-art for adaptive,
self-rearranging, persona-aware UI surfaces, as evidence for the Borjie
DYNAMIC UI audit. Each section names the canonical reference, the
mechanism the reference uses, and the matching Borjie surface so the
audit can verify parity (or surpassing).

## 1. Linear (linear.app)

Source: Linear changelog 2026-03 UI refresh + "A calmer interface for a
product in motion" (linear.app/now).

Mechanism:
- Project insights surfaces "what changed since you last looked" as the
  primary surface, not a static list of tickets.
- Theme + accent are user-selected; contrast tuned per user.
- Triage view re-orders by recency and recent assignee activity.
- Cmd-K palette re-ranks by usage (frecency).

Borjie parity:
- `dynamic-sections/lib/adaptive-layout/policies/recency-policy.ts`
  pins top-3 most-recently-used sections (matches "what changed since
  you last looked").
- `owner-tabs-store.ts` `spawnOrAugment` dedups + augments tabs
  in-place with a "+N updates" badge (matches Linear's project insights
  "changes since last visit" affordance).

## 2. Notion AI (notion.so)

Source: Fazm blog Notion AI updates 2026 (March 2026 release).

Mechanism:
- AI Blocks (`/ai`) embed dynamic blocks INSIDE a page that pull live
  context from linked pages, relations, and synced blocks.
- 50-page rolling context window per AI block (up from 20).
- Cross-page AI blocks reference and synthesize from other pages so
  "dashboard-style summary pages" are first-class.
- Inline AI suggestions: as you type, AI proposes completions inline
  (Tab to accept).

Borjie parity:
- `packages/owner-os-tabs/src/inline-blocks.ts` declares a 16-kind
  discriminated union of inline blocks the brain emits inside the chat
  bubble. EVERY block has a real renderer at
  `apps/owner-web/src/components/home-chat/inline-blocks/<Kind>Block.tsx`.
- `parseInlineBlocks` is multi-block aware (cap 8/turn) — matches
  Notion's inline-AI-block model.
- `inline_dashboard` + `inline_section` are RECURSIVE (children are
  themselves blocks) — matches Notion's nested-block dashboard.

## 3. Raycast (raycast.com)

Source: Raycast `useFrecencySorting` hook docs + manual search-bar
section.

Mechanism:
- Root Search is FRECENCY-ranked (frequency × recency, combined).
- The exact algorithm is hidden but the API exposes `visitItem(id)`
  every time a command is invoked; the hook returns a stable sort.
- Reset Ranking is one-tap, restoring defaults — escape hatch.

Borjie parity:
- `packages/chat-ui/src/lib/learned-shortcuts/ranker.ts` ranks
  shortcuts by `recency × frequency × confirmation-rate`. Mastery
  threshold (3 distinct actions on a route) gates the panel — matches
  Raycast's "no rank without data".
- The hook calls `visitItem` semantics via the `user_action_tracker`
  table (migration 0183) so every action is counted O(1).

## 4. Superhuman (superhuman.com)

Source: Blakecrosley "Speed as the Product" + julian.digital
"Productivity Meta-Layer" + Superhuman 2026 review.

Mechanism:
- Split Inbox: the main inbox is reserved for the most important
  emails; other categories get their own split inboxes (per user).
- Command Palette (Cmd-K) shows the keyboard shortcut beside every
  command — passive learning of mastery.
- Snippet templates personalised per user.

Borjie parity:
- `apps/owner-web/src/components/owner-os/OwnerOSShell.tsx` ships
  Cmd+T / Cmd+W / Cmd+1..9 / Cmd+Shift+T (last-closed) shortcuts —
  matches Superhuman's keyboard-first model.
- The "+" spawn menu lists keyboard hints next to commands
  (`SpawnTabMenu.tsx`).
- `OwnerOSChatPanel` + bonus side-panels mimic Superhuman's "main
  surface + split panes" model.

## 5. Apple Spotlight Intelligence (Apple Intelligence)

Source: Public WWDC 2024 + 2025 sessions, recap blogs.

Mechanism:
- Spotlight Intelligence ranks suggestions by app usage, time-of-day,
  location, and device-local activity log. Order is deterministic per
  user.
- Privacy-preserving: NO usage data leaves the device unless the user
  opts in. The ranker is on-device.

Borjie parity:
- `useLearnedShortcuts` reads `user_action_tracker` rows scoped by
  `(tenant_id, user_id)`. The ranker (`rankActions`) runs CLIENT-SIDE
  in the browser — privacy-preserving by construction.
- Pinned-state lives in `localStorage` keyed by user+route. No
  cross-tenant leakage by RLS on the table.

## 6. Asana "My Tasks" / Monday Inbox

Source: Asana 2025 product docs + Monday.com inbox patterns.

Mechanism:
- "My Tasks" reorders by due-date proximity, owner-assigned priority,
  and recent collaboration signals.
- Reordering rules are user-configurable per workspace.

Borjie parity:
- `recency-policy.ts` + `intent-policy.ts` + `role-mastery-policy.ts`
  are configurable per-tenant via the registry seed. Operators can
  add a new policy (e.g. "due-date proximity for licences") by
  shipping a single file under `policies/`.

## Practical takeaways

The Muzli "Mobile App Design Trends 2026" piece distills the principle:

> Layout personalization: apps that restructure their interface based on
> how you actually use them. Start with time-of-day and frequency data
> before reaching for anything more complex. Most of the value comes
> from surfacing the user's most common action first.

Borjie's adaptive layout engine already exceeds this baseline:

| Capability                          | Borjie | SOTA refs |
|-------------------------------------|--------|-----------|
| Frecency-ranked shortcuts           | yes    | Raycast   |
| Recency-pinned sections (top-3)     | yes    | Linear    |
| Frustration-aware help bubble-up    | yes    | (none)    |
| Mastery-gated advanced features     | yes    | Superhuman|
| Intent-pinned section (chat input)  | yes    | Notion AI |
| Inline-block dispatch (16 kinds)    | yes    | Notion AI |
| Tab dedup + augment-in-place        | yes    | Linear    |
| Persona-aware default tab strip     | partial| Apple SI  |
| Per-user persistent layout          | yes    | Linear    |

The "partial" entry on persona-aware defaults is the surface this
audit will close: every persona (owner, manager, employee, buyer)
should see a different default tab strip and the recency policy should
fold persona into its weighting.

## What 2026 brings beyond static SOTA

- Agentic UI: brain emits inline blocks that ACT (data_capture,
  confirmation, file_request) — Borjie ships this.
- Adaptive layout: layout regenerates per render context — Borjie ships
  this in `decideLayout`.
- Ambient computing: the surface reshapes itself when affective state
  changes — Borjie ships `frustration-policy.ts` for this.

The remaining SOTA frontier is REAL-TIME WIRING: the engine + the
panels + the telemetry loop must all be connected end-to-end so a
user's action on Tab N changes the order of Tab N+1 within the same
session, deterministically.

## Sources

- Linear UI refresh — https://linear.app/changelog/2026-03-12-ui-refresh
- Linear "calmer interface" — https://linear.app/now/behind-the-latest-design-refresh
- Notion AI updates 2026 — https://fazm.ai/blog/notion-ai-updates-2026
- Notion changelog — https://developers.notion.com/page/changelog
- Raycast useFrecencySorting — https://developers.raycast.com/utilities/react-hooks/usefrecencysorting
- Raycast manual search bar — https://manual.raycast.com/search-bar
- Superhuman speed as product — https://blakecrosley.com/guides/design/superhuman
- Superhuman meta-layer — https://julian.digital/2020/01/17/superhuman-the-productivity-meta-layer/
- Mobile design trends 2026 — https://muz.li/blog/whats-changing-in-mobile-app-design-ui-patterns-that-matter-in-2026/
- Progressive disclosure NN/G — https://www.nngroup.com/articles/progressive-disclosure/
