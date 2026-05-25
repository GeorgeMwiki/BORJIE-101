# Browser Perception Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/browser-perception/`
**Public entry:** `packages/browser-perception/src/index.ts`
**Tier scope:** cognitive core (computer-use grounding)

## Purpose

The "see + act" layer that lets the Brain pilot legacy LPMS portals
through a browser. Snapshots the accessibility tree (`axtree-snapshot`),
diffs across steps (`axtree-diff`), and drives Playwright through the
`legacy-portal-driver`. This is the substrate behind the
"legacy-migration" admin feature where customers import from
incumbent property-management portals.

## Entry points

- `src/index.ts` — barrel.
- `src/axtree-snapshot.ts` — Playwright a11y tree capture.
- `src/axtree-diff.ts` — node-level diff between snapshots.
- `src/legacy-portal-driver.ts` — high-level navigate/fill/extract.

## Internal structure

- `axtree-snapshot.ts` — wraps `page.accessibility.snapshot()` +
  serialiser.
- `axtree-diff.ts` — tree-walker producing add/remove/change deltas.
- `legacy-portal-driver.ts` — driver primitives (login, navigate,
  fillForm, scrape).
- `__tests__/` — golden-tree fixtures.

## Dependencies

- Upstream: Playwright, `@borjie/observability`.
- Downstream: central-intelligence (browser tools), admin-platform-portal
  legacy-migration UI.

## Common workflows

- **Snapshot a page** → `await snapshotAxtree(page)`.
- **Diff two states** → `diffAxtree(prev, next)`.
- **Drive a portal** → `driver.login(...)` → `driver.fillForm(...)`.
- **Emit observability** → every driver action emits an audit event.

## Anti-patterns to avoid

- Never act on a stale snapshot — diff first.
- Never persist credentials in driver state — pass per call.
- Never bypass the audit emitter for headless actions.
- Never run a driver without a circuit breaker around the target.

## Related codemaps

- [central-intelligence.md](./central-intelligence.md) — uses driver
- [observability.md](./observability.md) — audit + traces
- [enterprise-hardening.md](./enterprise-hardening.md) — circuit breaker
