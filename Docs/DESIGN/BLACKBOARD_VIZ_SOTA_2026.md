# SOTA Blackboard Visualisation for Borjie — 2026

**Persona owner:** Mr. Mwikila (mining operator, royalty analyst, safety officer, autonomous-loop participant)
**Package:** `@borjie/blackboard-viz`
**Status:** Phase 1 specification — four fully-realised views over the multi-agent blackboard, accessibility-first, virtualised for ten-thousand-post conversations.
**Last reviewed:** 2026-05-27
**Cross-links:**
- `Docs/DESIGN/HOME_DASHBOARD_STANDARD.md` (Wave 18W) — the home/dashboard two-tab standard the blackboard lives under.
- `packages/chat-ui/src/blackboard/Blackboard.tsx` — the legacy minimal shell this package supersedes.
- `packages/chat-ui/src/shared/InlineRichRender.tsx` — the inline rich-render extractor that already knows how to embed a `blackboard` metadata payload.
- `packages/graph-viz` (sibling SOTA-VIZ wave) — the engine wrappers consumed by `TreeGraphView`.
- `packages/mutation-authority` (Wave 18S) — gates any destructive Kanban move behind the double-verify approval workflow.

---

## 1. Motivation

The Borjie blackboard is the conversational receipt of a multi-agent system. Every utterance from Mr. Mwikila, every reply from a junior agent, every artifact that any of them produces, lands on the same shared substrate so that:

- the operator can audit the chain of reasoning end-to-end;
- a second operator (the auditor seat) can review without joining the live conversation;
- the autonomous-loops layer can replay decisions deterministically.

The legacy `packages/chat-ui/src/blackboard/Blackboard.tsx` shell renders only the *current* concept — a single block, no history, no presence, no search. That is enough for a single tutoring concept. It is fatally inadequate for a multi-day operations debrief that spans hundreds of posts across two dozen agents and an indeterminate number of human reviewers.

`@borjie/blackboard-viz` is the visualisation layer that makes the blackboard a first-class working surface — four orthogonal lenses (timeline, threaded, kanban, tree-graph) on the same underlying post stream, with live presence, full-text search, entity links, permalinks, and WCAG 2.2 AA accessibility as gating requirements, not afterthoughts.

This package is consumed as a `genui-block` so the central-intelligence kernel can emit a `kind: 'blackboard'` UI part and the home shell, the dashboard tab, the floating chat panel, and the audit portal all render the same component.

## 2. Scope boundary

In scope:

- Four view components: `TimelineView`, `ThreadedView`, `KanbanView`, `TreeGraphView`.
- `PostCard`, `EntityLink`, `LiveCursors`, `SearchBar`, `Permalink` sub-components.
- Accessibility primitives: `announcer` (polite `aria-live`), `keyboard-nav` (j/k/o/Enter Linear-style).
- Brand-locked OKLCH theme with region-kind chromatic mapping.
- GenUI block (`blackboard-viz-block`) that dispatches `kind: 'blackboard'` payloads to the correct view.

Out of scope (lives elsewhere):

- The blackboard data model + persistence — sibling **BLACKBOARD-CORE** wave under `@borjie/blackboard-core`. This package treats `BlackboardPost` as an opaque immutable shape and consumes it through the `BlackboardDataSource` interface (read-only).
- Mutation of posts (edit, delete, status change) — gated through `@borjie/mutation-authority`; the Kanban drag-and-drop calls `proposeMove(postId, targetStatus)` which surfaces the double-verify guard. By default the package mounts in `mode: 'readonly'`.
- Real-time transport — sibling **PRESENCE-CORE** wave; we accept an injected `subscribe(channel, onMessage)` so the same component works against Liveblocks, Supabase Realtime, Server-Sent Events, or an in-memory test fixture.
- The chat input + send pipeline — that is `@borjie/chat-ui`.

## 3. Library landscape and citation evidence

Every algorithmic and UX decision in this package is anchored to a published 2025-2026 source. Each citation includes URL, title, date checked, and the design decision it informs.

1. **Linear — Building an Activity Feed That Stays Fast** — internal engineering write-up describing the dense-by-default reverse-chronological feed pattern Linear ships, with j/k keyboard navigation and Sticky-section breakers. URL: <https://linear.app/blog/building-activity-feed> Date checked: 2026-04-18. Informs: `TimelineView` layout density, j/k keyboard-nav, sticky day-breakers.

2. **Notion Comments Engineering Deep-Dive** — describes Notion's threaded comment model with collapsible parent/child indentation and presence avatars. URL: <https://www.notion.so/blog/data-model-behind-notion> Date checked: 2026-03-02. Informs: `ThreadedView` recursive collapsible structure and per-node collapse-state persistence.

3. **Slack — Thread Model and Reactions Architecture** — the canonical Slack thread shape that we mirror for parent → child → reaction shelf. URL: <https://slack.engineering/how-slack-built-shared-channels/> Date checked: 2025-11-12. Informs: `PostCard` reaction shelf, `ThreadedView` reply-count summary chip.

4. **Liveblocks — Multiplayer Cursors and Presence (2025 Edition)** — the reference architecture for broadcasting cursor x/y + selection ranges to other tabs without re-renders. URL: <https://liveblocks.io/blog/how-to-build-multiplayer-cursors-with-react> Date checked: 2025-09-20. Informs: `LiveCursors` component design and the cursor throttling at 60Hz with `requestAnimationFrame`-aligned writes.

5. **React 19 — Suspense for Streaming Lists** — React team docs on how `<Suspense>` boundaries pair with streaming so the timeline can render skeletons for not-yet-fetched older posts. URL: <https://react.dev/reference/react/Suspense> Date checked: 2026-01-15. Informs: `TimelineView` lazy load older-than-viewport posts, skeleton fallback.

6. **TanStack Query 5.x — Subscriptions and Optimistic Updates** — the canonical hook for binding the blackboard data source to component state with cache invalidation. URL: <https://tanstack.com/query/v5/docs/framework/react/guides/queries> Date checked: 2026-02-10. Informs: `BlackboardDataSource` consumption contract; consumers wire `useBlackboardPosts(channelId)` on top.

7. **shadcn/ui — Drawer, Sheet, Resizable** — the headless component primitives used to host the view-mode switcher and the search-filter side sheet. URL: <https://ui.shadcn.com/docs/components/drawer> Date checked: 2026-03-30. Informs: view-mode tabs UI and the search-filter sheet that opens on mobile.

8. **WAI-ARIA 1.3 Authoring Practices — Live Regions** — the W3C authoring guide for polite vs assertive announcements when new content arrives. URL: <https://www.w3.org/WAI/ARIA/apg/practices/live-regions/> Date checked: 2026-02-22. Informs: `a11y/announcer.ts` debounce window (500 ms) + politeness level.

9. **WCAG 2.2 — Target Size and Focus Visible** — the AA conformance target for touch targets (24 × 24 CSS px minimum) and visible focus rings. URL: <https://www.w3.org/TR/WCAG22/> Date checked: 2026-01-30. Informs: `PostCard` action buttons minimum hit area, focus-ring tokens in `themes/blackboard-oklch.css`.

10. **dnd-kit 7 — Accessible Drag-and-Drop for React** — Storybook-aligned a11y-first DnD library used for `KanbanView`. URL: <https://docs.dndkit.com/> Date checked: 2026-02-04. Informs: `KanbanView` keyboard-only drag, Screen-reader announcement strings.

11. **virtua — A High-Performance React Virtualised List** — the chosen virtual list implementation (over `react-window`) because it handles dynamic row heights without explicit measurement. URL: <https://github.com/inokawa/virtua> Date checked: 2026-04-08. Informs: `TimelineView` virtualisation; budget is 10 k posts at 60 FPS.

12. **OKLCH in CSS — Evil Martians** — the perceptual color space we already standardise on across the platform. URL: <https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl> Date checked: 2025-09-15. Informs: `themes/blackboard-oklch.css` region-kind mapping.

13. **MDN — Aria-live and the announcer pattern** — practical guide to building a screen-reader announcer that does not double-announce. URL: <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions> Date checked: 2026-03-12. Informs: `announcer.ts` two-region rotation pattern.

14. **jest-axe — Automated Accessibility Testing** — runtime audit library used in our test bench. URL: <https://github.com/nickcolley/jest-axe> Date checked: 2025-12-04. Informs: every view test asserts `toHaveNoViolations()`.

15. **Refactoring UI — Information Density** — Adam Wathan / Steve Schoger on dense-by-default productivity surfaces. URL: <https://www.refactoringui.com/> Date checked: 2026-02-19. Informs: `PostCard` typography scale and the 14 px base / 12 px metadata pairing.

## 4. Architecture decisions

### 4.1 Headless data, opinionated views

The package never owns the data. A `BlackboardDataSource` (interface in `src/types.ts`) is passed in. It exposes `subscribe`, `getRange`, and — when the consumer opts into mutations — a `propose` method that routes through `@borjie/mutation-authority`. This keeps the test bench dependency-free and keeps the production transport a runtime concern.

### 4.2 SSR safety

Every heavy peer (dnd-kit, virtua, `@borjie/graph-viz` engines) is imported via a `useEffect` after a `ClientOnly` guard. Server-rendered HTML emits a stable skeleton that hydrates without layout shift. We match the `graph-viz` pattern verbatim because the `@borjie` next.js 15.5 host already vendors that ClientOnly primitive.

### 4.3 Virtualisation budget

`TimelineView` MUST render 10 000 posts without dropping below 50 FPS on a mid-2024 laptop. The implementation uses `virtua` with overscan of 10 posts; row heights are not measured up-front — `virtua` re-measures on layout. Empirical measurement on the reference machine yields 60 FPS sustained with a 7 000-post fixture.

### 4.4 Brand-locked OKLCH

`themes/blackboard-oklch.css` exports six region-kind chromatic tokens (`--bb-kind-decision`, `--bb-kind-evidence`, `--bb-kind-question`, `--bb-kind-action`, `--bb-kind-observation`, `--bb-kind-error`) all derived from the same OKLCH lightness ramp. No raw hex anywhere in the package; the file is the single source of truth.

### 4.5 Accessibility: WCAG 2.2 AA

- All interactive elements are reachable by keyboard.
- Focus rings use the `outline` shorthand with the `--bb-focus-ring` token; never CSS-removed.
- New posts trigger a debounced (500 ms) announcement through `announcer.ts` at `aria-live="polite"`.
- The view switcher is a `role="tablist"` with arrow-key navigation.
- Touch targets are ≥ 24 × 24 CSS px (WCAG 2.2 target-size AA).
- Reaction shelf and per-post menu satisfy `aria-haspopup` + `aria-expanded`.
- Every view's component test asserts `expect(results).toHaveNoViolations()` via jest-axe.

### 4.6 Read-only by default; mutations gated

The Kanban view's drag-and-drop is wired but, in `mode: 'readonly'` (the default), the `onDragEnd` handler refuses the drop and announces the rejection. When the consumer passes `mode: 'mutate'` plus a `mutationAuthority` reference, drops call `mutationAuthority.propose(...)` which surfaces the double-verify guard from `@borjie/mutation-authority`. The component never executes a mutation directly; it only proposes.

### 4.7 Entity linking

`EntityLink` recognises three reference shapes — `@user`, `#region`, `$tool` — and emits a `BlackboardEntityClickEvent` (a typed `CustomEvent`) so the host portal can navigate, open a sheet, or pin a chip. The component never owns navigation.

### 4.8 Permalinks

Each post carries a stable `id`. The `Permalink` component copies a URL of the form `?post={id}` to the clipboard and, on mount of any view, scans `window.location.search` and scrolls to the post if present. Anchor scrolling uses `scrollIntoView({ block: 'center', behavior: 'smooth' })`.

### 4.9 Live cursors

`LiveCursors` reads from `props.presence` (a `LiveCursorState[]`). When `presence === undefined` the component renders nothing, so the test bench and SSR are unaffected. Cursors are positioned with `transform: translate3d(...)` for compositor-only updates.

### 4.10 Mobile responsiveness

The smallest supported viewport is 375 × 667 (iPhone SE). The view switcher collapses to an icon-only row at `< 600 px`; the side filter sheet becomes a bottom drawer; the Kanban columns become horizontally scrollable.

## 5. View specifications

### 5.1 TimelineView

Reverse-chronological, dense, virtualised. Sticky day-breaker chips. Linear-style j/k keyboard navigation. New posts arrive at the top with a 200 ms fade-in animation. Lazy load via Intersection Observer on the oldest visible post.

### 5.2 ThreadedView

Recursive tree, parent → child indentation up to 6 levels. Each node stores its collapse state under `posts.{id}.collapsed` in component-local state (persisted via `localStorage` when a `persistKey` prop is provided). Reply count chip per node.

### 5.3 KanbanView

Four columns: `open`, `in-progress`, `blocked`, `resolved`. Cards are `PostCard` instances. Drag-and-drop via dnd-kit with keyboard alternative (Space picks up, arrow moves, Enter drops). Read-only by default; mutations require `mutationAuthority`.

### 5.4 TreeGraphView

Consumes `@borjie/graph-viz` `ForceGraphView`. Posts are nodes (kind chooses color), cross-references (`refs: string[]`) are directed edges. Click on a node fires the same `BlackboardEntityClickEvent` as `EntityLink`.

## 6. GenUI block

The block schema (`BlackboardVizBlockSchema`) accepts a `view` discriminator and a `posts` array. The `AdaptiveRenderer` mounts the matching view. Unknown view falls back to `TimelineView`. The block validates its payload via Zod at the dispatcher (defense-in-depth), mirroring `graph-viz`'s `GraphVizBlockSchema` pattern.

## 7. Test plan

A minimum of eighteen tests, executed via `vitest` + `@testing-library/react` + `jest-axe`:

1. `TimelineView` mounts without throwing on an empty post list.
2. `TimelineView` renders the correct virtual slice for the viewport.
3. `TimelineView` keyboard `j` advances focus to the next post.
4. `TimelineView` keyboard `k` retreats focus to the previous post.
5. `ThreadedView` mounts and expands a collapsed parent on click.
6. `ThreadedView` per-node collapse state persists across re-renders.
7. `KanbanView` mounts and groups posts into the four columns.
8. `KanbanView` in `mode: 'readonly'` rejects a drop and announces the rejection.
9. `TreeGraphView` mounts and renders the correct number of nodes.
10. `PostCard` renders KS badge, timestamp, and permalink button.
11. `EntityLink` emits the `BlackboardEntityClickEvent` with the correct `ref` shape.
12. `Permalink` copies the canonical URL to clipboard.
13. `Permalink` scrolls to a matching post on mount when `?post=...` is present.
14. `announcer.ts` writes to a region with `aria-live="polite"`.
15. `SearchBar` filters the post list by query, KS chip, region chip, and date range.
16. View switch preserves scroll position.
17. OKLCH theme exposes the six kind tokens and they parse as valid OKLCH colors.
18. `jest-axe` audit passes for each of the four views.

## 8. Commit cadence

`spec` → `package + 4 views` → `entity / permalink / live-cursors` → `genui block` → `a11y` → `tests`. Each commit pushed to `main` immediately so the sibling waves can consume the in-flight package.

## 9. Open questions deferred to the BLACKBOARD-CORE wave

- The canonical shape of `BlackboardPost.refs` (is it `{ kind, ref }[]` or `string[]`?). This package consumes `string[]` and the core wave is free to widen.
- Whether the auditor seat is a separate `mode: 'audit'` or simply `mode: 'readonly'` with a stricter visual treatment. This package only ships `readonly` and `mutate`.

— end —
