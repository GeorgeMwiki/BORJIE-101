# Marketing Site Codemap

**Last Updated:** 2026-05-22
**Module:** `apps/marketing/`
**Public entry:** `apps/marketing/src/app/page.tsx`
**Port:** 3010 (Next.js)

## Purpose

The public-facing Borjie marketing site. Renders the home page,
pricing, brand story, and feeds the lead-capture funnel via
`marketing-brain`. Built on Next 15.5 + Tailwind v4 + the shared
design system; minimal client-side JS so Core Web Vitals stay
green.

## Entry points

- `src/app/page.tsx` — home page.
- `src/app/layout.tsx` — root layout with shared header/footer.
- `src/app/error.tsx` — error boundary.
- `src/app/not-found.tsx` — 404.
- `src/app/globals.css` — global styles.

## Internal structure

- `src/components/` — marketing-only components.
- `public/` — brand assets, OG images.
- Tailwind + PostCSS + design-system tokens.

## Dependencies

- Upstream: `@borjie/design-system`, `lucide-react`, Next 15.5,
  React 18.
- Downstream: api-gateway (lead capture), marketing-brain.

## Common workflows

- **Edit copy** → `src/app/page.tsx` + sub-routes.
- **Add a section** → component in `src/components/`, import in page.
- **Capture a lead** → form posts to api-gateway lead endpoint.
- **Deploy** → static export friendly when no SSR features used.

## Anti-patterns to avoid

- Never bloat client JS — keep Core Web Vitals green.
- Never bake env-specific URLs into the static page — use env.
- Never bypass the lead-capture API — keeps qualifier in the loop.
- Never use server actions for high-frequency form posts.

## Related codemaps

- [design-system.md](./design-system.md) — primitives + brand
- [marketing-brain.md](./marketing-brain.md) — funnel backend
- [api-gateway.md](./api-gateway.md) — lead route
