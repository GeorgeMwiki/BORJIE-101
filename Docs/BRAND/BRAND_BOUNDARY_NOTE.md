# Brand Boundary Note

**Owner:** Mr. Mwikila (Managing Director)
**Scope:** All `Docs/**/*.md` and root `PROJECT_BOUNDARY.md`

Borjie is a sibling fork of BossNyumba: Borjie covers mining operations
while BossNyumba covers property management. The two repositories
share architectural ancestry but operate as independent products with
independent tenants, brands, and runtime stacks. Because of that
shared ancestry, several `Docs/` files deliberately mention BossNyumba
by name — these are not stale product-marketing leaks but load-bearing
boundary documentation. The intentional references fall into three
categories: (1) the boundary spec itself (`PROJECT_BOUNDARY.md`,
`Docs/BOSSNYUMBA_SPEC.md`, `Docs/BOSSNYUMBA_PRD.md`) which exists to
record the parent project's API surface and the cross-repo contract;
(2) parity-audit reports (`Docs/PARITY_AUDIT_*.md`, `Docs/SOTA_PARITY_AUDIT_*.md`,
`Docs/LITFIN_PARITY_AUDIT_*.md`) which compare Borjie capability
coverage against the parent BossNyumba baseline and must name both
sides; and (3) design/strategy specs under `Docs/DESIGN/` and
`Docs/STRATEGY/` that explicitly mark which sections port across to
the sibling fork (for example `MEDIA_GENERATION_SPEC.md` and
`DOCUMENT_COMPOSITION_SPEC.md` both carry a "Cross brand" clause
stating that Borjie recipes never produce non-Borjie artefacts and
BossNyumba operates its own recipe registry). All three categories
are correct and should remain unchanged. Code-level brand strings in
runtime modules and test fixtures have been swept separately and now
use brand-agnostic names (`BRAND_REDACT_TERMS`, `sibling-brand`); the
runtime stack contains no BossNyumba references outside the
documented boundary docs listed above. If a future contributor finds
a non-deliberate BossNyumba reference in `Docs/` (i.e. not in the
three categories above), they should rebrand it to Borjie and update
this note to keep the boundary documented.
