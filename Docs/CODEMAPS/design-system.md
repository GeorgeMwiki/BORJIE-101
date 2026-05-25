# Design System Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/design-system/`
**Public entry:** `packages/design-system/src/index.ts`
**Tier scope:** user surface (shared UI primitives)

## Purpose

The shadcn/Radix-based component library + Borjie brand system
shared across the four web apps (owner-portal, estate-manager-app,
customer-app, admin-platform-portal, marketing). Provides Tailwind
v4 + OKLCH tokens, semantic colour roles, typography pairings, the
logomark/wordmark, base primitives (Button, Input, Textarea, Modal,
Drawer, Table, Card), and the `ScannerCamera` device-API wrapper.

## Entry points

- `src/index.ts` — barrel exporting `Button`, `Input`, `Textarea`,
  `cn`, brand constants, and ~50 other primitives.
- `src/brand/` — wordmark, logomark, colour tokens, brand constants.
- `src/components/` — leaf primitives.
- `src/styles/` — Tailwind layers + global CSS.
- `src/lib/utils.ts` — `cn()` class-merger.
- `src/ScannerCamera.tsx` — camera-API React component (KYC + scan).

## Internal structure

- `components/Button/` — variants + `buttonVariants` cva.
- `components/Input/` — `Input + Textarea`.
- `brand/` — token + asset exports.
- `utils/` — formatting helpers.
- Storybook files (`*.stories.tsx`) for the camera and primitives.

## Dependencies

- Upstream: Tailwind v4, Radix, class-variance-authority, lucide-react.
- Downstream: every web app.

## Common workflows

- **Add a new primitive** → drop in `components/<Name>/`, export
  from `index.ts`, write a story.
- **Use semantic colour** → reference token (e.g. `bg-card-fg`)
  instead of raw `bg-zinc-800`.
- **Render the brand mark** → `<Logomark size="md" />`.

## Anti-patterns to avoid

- Never put product-specific code here (only reusable primitives).
- Never hardcode hex colours — use OKLCH tokens.
- Never import from `lib/utils` at deep path — use the barrel.
- Never override Radix accessibility behaviour silently.

## Related codemaps

- [chat-ui.md](./chat-ui.md) — composes design-system primitives
- [genui.md](./genui.md) — GenUI cards built on design-system
- [owner-portal.md](./owner-portal.md), [customer-app.md](./customer-app.md), [estate-manager-app.md](./estate-manager-app.md)
