# Architecture Decision Records (ADRs)

> ADRs capture significant architectural decisions, their rationale,
> and consequences. Format: Michael Nygard's lightweight ADR. New
> decisions get a new file; old decisions never get rewritten, only
> superseded.

## Index

| # | Status | Title |
|---|---|---|
| [0001](./0001-pnpm-workspace-monorepo.md) | Accepted | pnpm-workspace monorepo |
| [0002](./0002-drizzle-orm-with-pgvector.md) | Accepted | Drizzle ORM with pgvector |
| [0003](./0003-inngest-and-temporal-coexistence.md) | Accepted | Inngest + Temporal coexistence |
| [0004](./0004-supabase-auth-with-native-postgres.md) | Accepted | Supabase Auth with native Postgres |
| [0005](./0005-otel-observability-baseline.md) | Accepted | OpenTelemetry observability baseline |
| [0006](./0006-twelve-agent-kernel.md) | Accepted | Twelve-agent embodied kernel |
| [0007](./0007-supabase-vs-self-hosted.md) | Accepted | Supabase Auth + self-hosted Postgres |
| [0008](./0008-numbered-monotonic-migrations.md) | Accepted | Numbered monotonic migrations |
| [0009](./0009-composition-root-wiring.md) | Accepted | Composition-root wiring in api-gateway |
| [0010](./0010-fail-loud-currency.md) | Accepted | Fail-loud currency on the money path |
| [0011](./0011-three-agent-debate.md) | Accepted | Three-agent debate at stakes >= high |
| [0012](./0012-adaptive-ui-persistence.md) | Accepted | Adaptive UI persistence |
| [0013](./0013-litfin-architecture-imports.md) | Proposed | LITFIN-style architecture-imports lint |

## How to add an ADR

1. Copy the most recent ADR as a template.
2. Number sequentially.
3. Status starts as `Proposed`; flip to `Accepted` after review.
4. Keep ≤ 400 words. Link out for detail.
5. If superseding an old ADR, link both ways.
