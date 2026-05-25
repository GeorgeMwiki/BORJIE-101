# Admin Portal Codemap (deprecated)

**Last Updated:** 2026-05-22
**Module:** `apps/admin-portal/` (DEPRECATED — see `DEPRECATED.md`)
**Public entry:** `apps/admin-portal/src/main.tsx`

## Purpose

Legacy Vite+React admin SPA superseded by the Next.js
`admin-platform-portal`. Kept in-repo for historical reference and
to provide a build target while the migration completes. New
features should land in `admin-platform-portal`; this app should
not grow new functionality.

## Entry points

- `src/main.tsx` — Vite entrypoint.
- `src/App.tsx` — root component.
- `index.html` — Vite HTML shell.

## Internal structure

- Minimal: `App.tsx`, `main.tsx`, `index.css`.
- `dist/` — built artefacts.
- `DEPRECATED.md` — migration notice.

## Dependencies

- Upstream: React 18, ReactDOM.
- Downstream: none beyond a build target.

## Common workflows

- **Build** → `pnpm -F @borjie/admin-portal build`.
- **Migrate a route** → reimplement in `admin-platform-portal/src/app/<route>/page.tsx`.

## Anti-patterns to avoid

- Never add new routes here — add them in `admin-platform-portal`.
- Never wire new APIs here — superseded.
- Never delete without confirming all routes ported.

## Related codemaps

- [admin-platform-portal.md](./admin-platform-portal.md) — successor
- [design-system.md](./design-system.md) — shared primitives
