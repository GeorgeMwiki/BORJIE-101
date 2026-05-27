# Borjie ≠ BossNyumba — Separation Audit

**Date:** 2026-05-27
**Owner:** Mr. Mwikila (Managing Director)
**Scope:** Repo-wide audit verifying that Borjie evolves independently from
its parent codebase. The two products share ancestry (hard-fork day) but
do not share identity, roadmap, persona, schema, or marketing surface.

---

## 0. Founder directive

> *"borji from boss nyumba they share alot but not the same at all"*

Translation for engineering: shared lineage is a historical fact. Going
forward each product is sovereign. Borjie launches in Tanzanian mining,
with Mr. Mwikila as the front-door persona, and spreads jurisdictionally
via pluggable profiles (TZ → universal). BossNyumba's product surface is
its own concern; this repo neither tracks it nor mirrors it.

---

## 1. The five dimensions of separation

| # | Dimension | Borjie identity | Different from BossNyumba |
|---|-----------|-----------------|---------------------------|
| 1 | Vertical | Tanzanian artisanal-to-mid-tier mining (sites, licences, drill-holes, ore parcels, FX/treasury, regulator drafting) | Property management is BossNyumba's domain, never Borjie's. |
| 2 | Persona | **Mr. Mwikila** — Managing Director, full MD, public mode, 8 CEO modes (Build, Strategy, Operations, Document, Finance, Risk, Board-Investor, Compliance) | Mr. Mwikila is Borjie-only. He has never been ported to BossNyumba and never will be. BossNyumba's personas live in BossNyumba and never appear in Borjie production code. |
| 3 | Jurisdictional architecture | Borjie launches with `regulatory-tz-mining` + a universal pluggable profile substrate (TZ → KE → NG → universal). | BossNyumba's territorial reach is its own. The two systems do not share a regulator registry, a regulator-pack drift CI, or a regulator schema. |
| 4 | Code evolution trajectory | Borjie's roadmap, juniors (28 mining juniors), database schema (48 mining tables), OpenAPI surface (`Docs/openapi/borjie-mining.yaml`), and four product surfaces (admin-web, owner-web, workforce-mobile, buyer-mobile) evolve independently. | No porting pipeline exists. No parity goal exists. No shared dependency upgrade cadence. Each repo's CI, lockfile, and release train is its own. |
| 5 | Runtime / production code coupling | ZERO. Borjie's production runtime contains no BossNyumba strings outside the deliberate anti-leak utility. | The BossNyumba name only appears in: (a) audit/parity docs preserved as historical snapshots, (b) the `BRAND_REDACT_TERMS` anti-leak list which strips parent-project brand strings before LLM jurors see text. |

---

## 2. Grep results table (snapshot 2026-05-27)

Each row is a verbatim grep run, recorded for reproducibility.

| Category | Command | Hits | Verdict |
|----------|---------|-----:|---------|
| Runtime TS production code | `rg -n 'bossnyumba\|BossNyumba' -g '*.ts' -g '*.tsx' -g '!**/__tests__/**' -g '!**/__fixtures__/**' -g '!**/node_modules/**' -g '!**/.next/**' -g '!**/dist/**'` | 2 | PASS — both hits are comments in `packages/ai-copilot/src/eval/judge-panel.ts` explaining the `BRAND_REDACT_TERMS` anti-leak list. No runtime path references the parent. |
| Database migrations | `rg -n 'bossnyumba\|BossNyumba' --type sql packages/database/drizzle/` | 3 (pre-fix) → **0 (post-fix, see Commit 2)** | Historical narration in migration comments rewritten to brand-agnostic "legacy property-domain" phrasing. |
| Marketing surface | `rg -nl 'bossnyumba\|BossNyumba' apps/marketing/src/` | 0 | PASS — homepage, About, Pricing, Footer, Pilot Form contain zero parent-project references. SCRUB-3 confirmed and re-confirmed today. |
| Mr. Mwikila persona spread | `rg -n 'Mr\.\s*Mwikila' -g '*.ts' -g '*.tsx' -g '!**/node_modules/**'` | 529 | PASS — persona is everywhere in Borjie code, which is what we want. |
| Mr. Mwikila cross-fork bleed | `rg -nC1 'Mr\.\s*Mwikila' Docs/ \| grep -B1 -A1 BossNyumba` | 1 hit (pre-fix in `Docs/DESIGN/HOME_DASHBOARD_STANDARD.md`) → **0 (post-fix, see Commit 4)** | Persona-routing table had four rows assigning Mr. Mwikila to BossNyumba surfaces. Removed: those surfaces don't live in this repo. |
| Other BossNyumba personas in Borjie code | `rg -ni 'bossy mama\|Bossy-mama' apps/ packages/ services/ -g '!**/node_modules/**'` | 0 | PASS — no parent personas leak into Borjie production. |
| Parity-audit docs framing | `find Docs -iname '*parity*' -type f` | 4 files | RE-FRAMED — see Commit 3. Titles and closing paragraphs now read as historical ancestry snapshots, not ongoing parity goals. |

### 2.1 The two intentional anti-leak references

The two surviving runtime references in `packages/ai-copilot/src/eval/judge-panel.ts` are PRESERVED on purpose:

```text
233: * jurors don't leak the BossNyumba ancestry. The list deliberately
234: * spans both Borjie (current product) and BossNyumba (parent fork)
```

These are inside a docblock that explains why the `BRAND_REDACT_TERMS` list contains parent-project terminology — so the brand-redactor strips it before any LLM juror sees the text. Removing these comments would weaken the rationale for the list and could lead a future contributor to "clean up" the redact terms themselves. The comments stay; the runtime list stays; the parent-project brand strings inside the list stay, because they exist to be redacted, not to be displayed.

---

## 3. Files touched this audit cycle

See companion commits:

1. `docs(brand): SEPARATION_AUDIT_2026_05_27 — Borjie ≠ BossNyumba` — this file + migration comment scrub.
2. `refactor(brand): reframe BRAND_BOUNDARY_NOTE to lead with separation` — `Docs/BRAND/BRAND_BOUNDARY_NOTE.md` rewritten to lead with "sovereign product, hard-forked from a sibling, evolving independently" and add explicit non-relationships.
3. `refactor(brand): rename parity-audit framing to ancestry snapshot` — `Docs/HISTORY/POST_FORK_SNAPSHOTS/PARITY_AUDIT_2026_05_26.md` title + closing paragraph re-framed.
4. `refactor(brand): README + primary docs lead with Borjie identity (BossNyumba in footnote only)` — `README.md` and `PROJECT_BOUNDARY.md` re-framed to lead with Borjie's own identity; ancestry moves to a footnote.

---

## 4. Non-relationships (explicit list)

Borjie and BossNyumba do NOT share:

- A persona. Mr. Mwikila is Borjie-only and will not be re-used in BossNyumba surfaces.
- A vertical. Mining is Borjie's. Property is BossNyumba's.
- A jurisdictional plan. Borjie spreads via the universal-vertical-profile substrate from a TZ baseline. BossNyumba's territorial roadmap is its own.
- A roadmap. Each product's wave plan, milestones, ADRs, and release train are independent.
- A schema. Borjie ships its own 48 mining tables on top of an independent bootstrap (`0000_borjie_bootstrap.sql` + `0003_mining_domain.sql`). BossNyumba owns its own schema.
- A regulator pack. Borjie has `Docs/regulator-pack/tz/` (mining authorities: Tumemadini, TRA, NEMC). BossNyumba's regulator surface is property-domain.
- An OpenAPI surface. Borjie publishes `Docs/openapi/borjie-mining.yaml`. BossNyumba publishes its own.
- A marketing surface. `apps/marketing/` is Borjie-only and contains zero parent-project references.
- A CI pipeline. Borjie's 10 workflows (`borjie-ci`, `borjie-db-migrations-check`, `borjie-codeql`, etc.) are separate from any BossNyumba pipeline.

---

## 5. What we DO keep

Two deliberate cross-references stay:

1. **The brand-redactor anti-leak utility** (`BRAND_REDACT_TERMS` in `packages/ai-copilot/src/eval/judge-panel.ts`). This list contains parent-project terminology so that the redactor can strip it from text shown to LLM jurors. Removing parent terms from this list would let LLM jurors recognize the brand lineage and skew their scores. This is a security/eval-integrity feature, not a marketing surface.

2. **Historical fork-day snapshots** (`Docs/HISTORY/POST_FORK_SNAPSHOTS/`). These capture what was inherited at the point of divergence. They are read-only engineering archaeology, not ongoing tracking artefacts. The `README.md` in that folder is explicit: "Do not add new comparison documents here unless they are a one-off historical snapshot."

Everything else — runtime code, marketing surface, schema, regulator pack, persona, roadmap, CI — is Borjie's own.

---

## 6. Conclusion

Borjie is a sovereign product. The shared ancestry with BossNyumba is a historical fact, recorded honestly in `Docs/HISTORY/POST_FORK_SNAPSHOTS/`. From this point forward Borjie evolves on its own track: Tanzanian mining as the launch vertical, Mr. Mwikila as the MD persona, universal pluggable jurisdictional profiles, and a universe of capabilities the parent project does not need.

**Author:** WL-BRAND-SEPARATE
**Brand:** Borjie. Persona: Mr. Mwikila.
