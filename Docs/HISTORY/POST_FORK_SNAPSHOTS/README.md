# Post-Fork Snapshots — Historical Archive

This directory contains historical snapshots taken near the
**hard-fork day** when Borjie split off from its sibling property-management
codebase (`BOSSNYUMBA101`). The documents preserved here measure, compare,
or otherwise relate the two trees at a single fixed moment in time.

## Why this is HISTORY, not ongoing tracking

Borjie and BossNyumba are **two separate projects**. They share fork-day
origin and a meaningful amount of scaffolding, but:

- Borjie's roadmap, juniors, schema, OpenAPI surface, and mobile apps are
  **not constrained by, mirrored against, or steered toward** BossNyumba.
- BossNyumba's continued evolution is **not blocked on, or informed by**,
  Borjie's progress.
- There is no ongoing parity goal. There is no porting pipeline. There is
  no shared identity. The codebases evolve independently.

The documents in this folder are kept solely so that the **fork-day
diff** remains discoverable for engineering archaeology — to answer
"what did we inherit?" rather than "what should we still mirror?".

## What lives here

| File | Snapshot taken | Purpose |
|------|----------------|---------|
| `PARITY_AUDIT_2026_05_26.md` | 2026-05-26 | Surface-area metric comparison at fork-day; line counts, package counts, service overlap. |

## What does NOT live here

- Active roadmap docs (those live in `Docs/DESIGN/`, `Docs/ROADMAP*`,
  `Docs/WAVES/`).
- Brand-boundary notes for ongoing legal / IP separation (those live in
  `Docs/BRAND/`, `BRAND_BOUNDARY_NOTE.md`, `PROJECT_BOUNDARY.md`).
- Anti-leak guardrails (those live in code: ESLint rules,
  `BORJIE_REDACT_TERMS`, CI checks).

## Update policy

**Do not add new comparison documents here unless they are a one-off
historical snapshot.** Ongoing engineering work belongs in active design
docs that reason about Borjie on its own terms. If you find yourself
writing a new "BossNyumba vs Borjie" comparison, stop and ask whether
the comparison is load-bearing for the Borjie roadmap — almost certainly
the answer is no.
