# Brand Boundary Note

**Owner:** Mr. Mwikila (Managing Director)
**Scope:** All `Docs/**/*.md` and root `PROJECT_BOUNDARY.md`

## 1. Borjie is a sovereign product

Borjie is a sovereign product that was hard-forked from a sibling
property-management codebase (BossNyumba). Shared ancestry is a
historical fact; shared identity is not. From the fork day forward
Borjie evolves on its own track:

- Borjie's vertical is Tanzanian artisanal-to-mid-tier mining.
- Borjie's persona is **Mr. Mwikila** (Managing Director).
- Borjie's jurisdictional plan starts in Tanzania and spreads through a
  universal pluggable vertical-profile substrate (TZ → KE → NG → universal).
- Borjie's roadmap, schema, OpenAPI surface, mobile apps, regulator pack,
  marketing surface, and CI pipeline are independent of BossNyumba.

## 2. Where the parent-project name appears at all

The parent-project name (BossNyumba) appears in this repository in
exactly two places. Both are deliberate; neither is a runtime path,
production code, persona, schema, or marketing surface.

1. **Audit and ancestry-snapshot docs** that record what was inherited
   at the fork day. These live in
   `Docs/HISTORY/POST_FORK_SNAPSHOTS/` and named parity files in
   `Docs/` (`SOTA_PARITY_AUDIT_*.md`, `LITFIN_PARITY_AUDIT_*.md`,
   `CLAUDE_CODE_PARITY_*.md`). They are read-only engineering
   archaeology, not ongoing tracking artefacts.

2. **The `BRAND_REDACT_TERMS` anti-leak utility** in
   `packages/ai-copilot/src/eval/judge-panel.ts`. This list contains
   the parent-project brand strings so that the redactor strips them
   from any text shown to LLM jurors — without this, an LLM juror
   could recognise the brand lineage and skew its score. Removing
   parent terms from this list would weaken the eval integrity
   guarantee. The list stays.

No other runtime path, production code, persona, database column,
marketing copy, or surface in this repo names the parent project.

## 3. Explicit non-relationships

Borjie and BossNyumba do NOT share:

- **A persona.** Mr. Mwikila is Borjie-only. He has never been ported
  to BossNyumba and never will be. Any text in this repo that implies
  Mr. Mwikila is the persona for a BossNyumba surface is a bug —
  delete the BossNyumba reference, do not migrate the persona.

- **A vertical.** Borjie is mining. BossNyumba is property. Property
  domain concepts (buildings, units, leases, occupancy, arrears,
  tenants-as-renters) do not belong in Borjie code, docs, or config.

- **A jurisdictional architecture.** Borjie launches in Tanzania and
  spreads through the universal-vertical-profile substrate
  (`packages/regulatory-tz-mining`, `Docs/regulator-pack/tz/`, plus
  pluggable profiles for KE, NG, etc.). BossNyumba's territorial
  reach is its own concern; the two systems do not share a regulator
  registry, regulator-pack drift CI, or schema.

- **A code evolution trajectory.** Borjie's wave plan, milestones,
  ADRs, OpenAPI surface, mobile apps, juniors (28 mining juniors),
  database schema (48 mining tables on the `0000` + `0003` bootstrap),
  and CI workflows evolve independently. There is no porting pipeline,
  no parity goal, no shared release train.

## 4. Code-level brand-name swept clean

Runtime modules and test fixtures have been swept and now use
brand-agnostic names (`BRAND_REDACT_TERMS`, `sibling-brand` fixture
names). SQL migration comments use brand-agnostic
"legacy property-domain" phrasing. The runtime stack contains no
parent-project name references outside the two deliberate locations
documented in section 2.

## 5. If you find a non-deliberate reference

If a future contributor finds a non-deliberate parent-project
reference in `Docs/` (i.e. not an audit/parity document and not the
anti-leak utility), they should:

1. Rebrand it to Borjie if the surface is owned by Borjie.
2. Delete the reference if the surface is not owned by Borjie (e.g.
   persona routing tables should not list BossNyumba surfaces — those
   are not in this repo).
3. Update this note if a new category of deliberate reference is
   created.

The 2026-05-27 separation audit at
`Docs/BRAND/SEPARATION_AUDIT_2026_05_27.md` captures the grep results
that backed the current state of the repo.
