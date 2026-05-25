# Marketing Brain Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/marketing-brain/`
**Public entry:** `packages/marketing-brain/src/index.ts`
**Tier scope:** cognitive core (marketing + pricing intelligence)

## Purpose

The marketing-side cognitive layer: lead-capture intake, lead
qualification, pricing advisor, blog-engine content generator,
demo-data generator (for sandbox tenants), and waitlist
integrator. Powers the `apps/marketing` site + the lead funnel.
Wired to `market-intelligence` for pricing and to
`central-intelligence` for content generation.

## Entry points

- `src/index.ts` — barrel.
- `src/lead-capture/` — intake adapters.
- `src/lead-qualifier.ts` — scoring + routing.
- `src/pricing-advisor.ts` — comparable-driven pricing.
- `src/blog-engine/` — content generation pipeline.
- `src/sandbox/` + `src/demo-data-generator.ts` — sandbox bootstrap.
- `src/waitlist-integrator.ts` — waitlist sync.
- `src/marketing-persona.ts` + `src/marketing-few-shots.ts` — LLM
  persona + examples.

## Internal structure

- `blog-engine/` — outline → draft → polish.
- `lead-capture/` — webhook + form intake.
- `sandbox/` — synthetic tenant seeding.
- `__tests__/` — pricing + qualification tests.

## Dependencies

- Upstream: `@borjie/market-intelligence`,
  `@borjie/central-intelligence`, `@borjie/observability`.
- Downstream: apps/marketing, admin-platform-portal lead funnel.

## Common workflows

- **Capture a lead** → `leadCapture.ingest({ source, payload })`.
- **Qualify** → `leadQualifier.score(lead)`.
- **Advise price** → `pricingAdvisor.suggest({ unit, comparables })`.
- **Generate a blog post** → `blogEngine.run({ topic, brief })`.

## Anti-patterns to avoid

- Never persist raw lead PII outside the encrypted lead store.
- Never publish a blog post without four-eye if `stakes>=medium`.
- Never use real production data in sandbox seeds.
- Never expose pricing model internals to leads (gameable).

## Related codemaps

- [market-intelligence.md](./market-intelligence.md) — comparables
- [central-intelligence.md](./central-intelligence.md) — content gen
- [observability.md](./observability.md) — lead funnel metrics
