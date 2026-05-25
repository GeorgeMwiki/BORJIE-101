# ADR 0012 — Adaptive UI persistence

- **Status:** Accepted
- **Date:** 2026-04 (UI-1 + BL5)

## Context

The "page rearranges itself" promise of UI-1 only delivers value if
each user's preferred layout (which sections they collapse, which
they pin, which they hide) **persists across sessions and across
devices**. Cookie-only persistence breaks on private browsing +
device switch; pure client-side state breaks on SSR; pure server-
side state forces a round-trip on every page render.

Options considered:

| Option | Verdict |
|---|---|
| Cookie only | Cross-device gap |
| `localStorage` only | Cross-device gap + SSR mismatch |
| Server-only (DB on every render) | Hot-path latency |
| Hybrid: server source-of-truth + cookie hint | Selected |
| Pure SWR/edge KV | Lose audit trail |

## Decision

Server-side state is the source of truth in the `ui_preferences`
table (Drizzle schema). On render, the api-gateway aggregator
preloads the user's preferences. A signed cookie hint mirrors the
last-known state for SSR layout selection without a round-trip;
the cookie is reconciled with the server state on first XHR. All
writes go to the server (via `useDynamicSection` mutation). LITFIN
BL5 mirrors the pattern.

## Consequences

**Positive:**

- Cross-device consistency — open Borjie on laptop + phone and
  see the same layout.
- SSR remains fast (cookie hint avoids one round-trip).
- Preferences are auditable (every change is a row).
- Tier-aware: per-tier defaults seed the row.

**Negative:**

- Two writes on first interaction (server + cookie).
- Cookie can stale → reconciliation logic adds branch.
- Schema migration when adding a new pref kind.

## Alternatives considered

Pure edge KV (Cloudflare KV) had lower latency but lost the audit
trail and risked tenant isolation in a shared KV namespace.

## References

- `packages/database/src/schemas/ui-preferences.ts`
- `packages/dynamic-sections/src/use-dynamic-section.ts`
- UI-1 (task 135) + BL5 (task 160)
- `Docs/CODEMAPS/dynamic-sections.md`
