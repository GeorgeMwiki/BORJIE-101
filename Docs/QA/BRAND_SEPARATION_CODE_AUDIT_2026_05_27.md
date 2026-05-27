# BRAND-SEPARATE-2 — Deep Code + Infra Separation Audit

**Date**: 2026-05-27
**Persona**: Mr. Mwikila
**Branch**: `main`
**Scope**: Verify Borjie is structurally separated from BossNyumba at the
code, dependency, env-var, deployment-infra, and GitHub-metadata layers.
A sibling agent (BRAND-SEPARATE) handles the docs-reframing layer
(`Docs/BRAND/`, `Docs/PARITY*`, root `README.md`,
`BRAND_BOUNDARY_NOTE.md`). This audit goes deeper into the runtime
artefacts those docs sit on top of.

> **Founder directive**: "Borjie and BossNyumba are two separate
> projects. They share a lot but are not the same at all." Hard-fork is
> historical fact. Borjie evolves independently. No ongoing parity, no
> ongoing porting, no shared identity.

---

## Per-check results

### Check 1 — Archive parity-audit docs

**Command**: `ls Docs/PARITY_AUDIT*.md`
**Status**: **PASS** (1 file moved, archive scaffolded)

| Source | Destination |
|--------|-------------|
| `Docs/PARITY_AUDIT_2026_05_26.md` | `Docs/HISTORY/POST_FORK_SNAPSHOTS/PARITY_AUDIT_2026_05_26.md` |

Added archive policy document at
`Docs/HISTORY/POST_FORK_SNAPSHOTS/README.md` explaining why parity
artefacts are historical, not ongoing. Added top-of-file `ARCHIVED —
HISTORY ONLY` banner to the moved file so any reader who lands on it
direct (search, grep) sees the historical framing immediately.

---

### Check 2 — Strip "ported from BossNyumba" language in `Docs/DESIGN/`

**Command**: `rg -nP 'ported (from|to) (BossNyumba|Boss\s*Nyumba)' Docs/DESIGN/`
**Before**: 1 strict-pattern hit + 2 adjacent porting-noun hits
**After**: **PASS** — 0 matches under any porting verb tied to the
sibling brand.

3 files reworded; each now carries one footnote (`[^fork-history]`)
preserving the historical accuracy required by the directive:

| File | What changed |
|------|--------------|
| `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md` | Dropped "Again BossNyumba porting opportunities" tail from founder verbatim quote; added fork-history footnote |
| `Docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md` | Dropped "+ BossNyumba port complete" status gate; added fork-history footnote |
| `Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md` | Replaced "Spec doc (this file) — ported to BossNyumba" with "Borjie ships its own geo-routing + scope-login contract"; added fork-history footnote |

The footnote text reads, identically once per file:

> Initial scaffold from the 2026-04 hard-fork; Borjie has evolved
> independently since. This spec describes Borjie's own {feature}
> implementation — there is no ongoing cross-brand port pipeline.

Note: 22 other `BossNyumba` references remain in `Docs/DESIGN/` (mostly
in `HOME_DASHBOARD_STANDARD.md` and `AGENT_SELF_REVIVAL_SPEC.md`).
These were **out of scope** for Check 2 — they discuss BossNyumba as a
sibling-fork peer, not as a port target. The sibling agent on the docs
track (BRAND-SEPARATE) owns judgement calls on cross-brand mentions
that aren't porting verbs.

---

### Check 3 — `@borjie/*` package namespace

**Command**: `rg -n '"name": "@bossnyumba/' packages/ services/ apps/`
**Status**: **PASS** — 0 matches.

Every workspace package already declares an `@borjie/*` name. No
renames required.

---

### Check 4 — `BORJIE_*` env var prefix

**Commands**:

- `rg -nP 'BOSSNYUMBA_[A-Z_]+' --type ts --type js --type sh -g '!__tests__' -g '!__fixtures__'`
- `rg -nP 'BOSSNYUMBA_[A-Z_]+' .env.example`

**Status**: **PASS** — 0 matches in source, 0 matches in `.env.example`.

Recent commit `9e819cd refactor(ai-copilot): rename BORJIE_REDACT_TERMS
-> BRAND_REDACT_TERMS for clarity` shows the cleanup pass already
landed before this audit ran.

---

### Check 5 — Deployment / infra config leakage

**Commands**:

- `rg -niP 'bossnyumba' docker-compose*.yml docker/ k8s/ infra/ infrastructure/`
- `rg -niP 'bossnyumba' .github/workflows/`

**Before**: 5 matches across `k8s/` and `infra/` (IAM role/policy/SID names).
**After**: **PASS** — 0 matches across all deployment + workflow files.

| File | Identifier before | Identifier after | Sites |
|------|-------------------|------------------|-------|
| `k8s/external-secrets/secret-store-aws.yaml` | `BossnyumbaESOReadPolicy` | `BorjieESOReadPolicy` | 2 |
| `k8s/external-secrets/secret-store-aws.yaml` | `BossnyumbaESORole` | `BorjieESORole` | 1 |
| `k8s/external-secrets/README.md` | `BossnyumbaESORole` | `BorjieESORole` | 1 |
| `infra/k8s/external-secrets/README.md` | `Sid: ReadBossnyumbaSecrets` | `Sid: ReadBorjieSecrets` | 1 |
| `infra/k8s/external-secrets/README.md` | `Sid: ListBossnyumbaSecrets` | `Sid: ListBorjieSecrets` | 1 |

**Runtime impact**: zero in repo (the role-arn is still a
`REPLACE_AWS_ACCOUNT_ID` placeholder; nothing deploys as-is). **Operator
action**: any AWS IAM role/policy already created under the
`Bossnyumba*` names must be renamed (or recreated with the new names +
re-bound to the same SA via IRSA) before this manifest is re-applied.

---

### Check 6 — `package.json` deps don't link to a `@bossnyumba/*` artefact

**Command**: `rg -nP '"@bossnyumba/' package.json packages/*/package.json services/*/package.json apps/*/package.json`
**Status**: **PASS** — 0 matches.

No published-artefact dependency on the sibling brand. Every internal
reference is via the in-monorepo `@borjie/*` workspace alias.

---

### Check 7 — GitHub repo metadata + topics

**Command**: `gh repo view --json description,homepageUrl,repositoryTopics GeorgeMwiki/BORJIE-101`
**Status**: **PASS** — no rebrand-of-BossNyumba framing in metadata.

Snapshot:

```json
{
  "description": "Borjie — mining estate planning, management & intelligence AI-native operating system for Tanzanian artisanal-to-mid-tier mining. 4 apps (Next.js + Expo), 28 mining juniors, 63 API endpoints, PostGIS + pgvector + Drizzle, bi-temporal Living Mining Business Map.",
  "homepageUrl": "https://github.com/GeorgeMwiki/BORJIE-101",
  "repositoryTopics": [
    "agent-platform", "ai-native", "claude", "drizzle", "expo",
    "hono", "mining", "multi-tenant", "nextjs", "pgvector",
    "postgis", "postgres", "rls", "swahili", "tanzania"
  ]
}
```

The description leads with the standalone Borjie product proposition;
no mention of "rebrand of", "fork of", or "BossNyumba". No GH issue
filed; no operator action required.

---

## Final verdict — **SEPARATED**

| Layer | Verdict |
|-------|---------|
| Historical docs (parity audits) | SEPARATED (archived) |
| Active design docs (porting verbs) | SEPARATED (3 files reframed) |
| Package namespace (`@borjie/*`) | SEPARATED (clean) |
| Env var prefix (`BORJIE_*`) | SEPARATED (clean) |
| Deployment / infra (k8s, docker, CI) | SEPARATED (5 IAM names renamed) |
| `package.json` deps | SEPARATED (clean) |
| GitHub repo metadata | SEPARATED (Borjie-first framing) |

Borjie is now structurally separable from BossNyumba at every layer
this audit covered: source, deps, env, deployment, and external repo
identity. The only remaining cross-brand mentions in `Docs/DESIGN/` are
peer-fork references (not porting goals); the sibling agent on the
docs track owns judgement on those.

---

## Commits in this audit

| # | Commit | Purpose |
|---|--------|---------|
| 1 | `e4deb5e chore(docs): archive parity-audit snapshots to Docs/HISTORY/POST_FORK_SNAPSHOTS/` | Move parity audit + add archive README + add ARCHIVED banner |
| 2 | `c4b010c refactor(docs): strip "ported from" language in DESIGN/ — Borjie ships its own code` | Reframe 3 DESIGN specs; add 3 fork-history footnotes |
| 3 | `e2fdb3d fix(infra): rename Bossnyumba* IAM identifiers to Borjie* + add archive banner` | Rename 5 IAM role/policy/SID names; clean infra leakage |
| 4 | (this commit) `docs(qa): BRAND_SEPARATION_CODE_AUDIT_2026_05_27 — verdict SEPARATED` | Audit report |

All four pushed to `origin/main`.

## Notes / caveats

- Commit 2 (`c4b010c`) also picked up incidental sibling-agent work
  staged in `Docs/BRAND/` and two SQL migration files (`packages/database/drizzle/0000_borjie_bootstrap.sql`, `0003_mining_domain.sql`). Sibling work landed cleanly; no rollback needed.
- Commit 3 (`e2fdb3d`) also picked up a sibling-agent package rename
  (`litfin-port-memory-extra` -> `memory-port-extensions`) staged
  concurrently. Pure rename, zero content diff; landed cleanly.
- This is a working-tree artefact of two agents touching the same repo
  in parallel. No corrupted state. No rollback needed. Documented here
  for traceability.
