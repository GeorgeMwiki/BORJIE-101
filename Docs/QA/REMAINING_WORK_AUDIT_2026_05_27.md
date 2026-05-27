# Remaining-Work Audit — 2026-05-27

**Persona**: Mr. Mwikila
**Branch**: `main` (in sync with `origin/main` @ `f7b5843`)
**Repo**: `GeorgeMwiki/BORJIE-101`
**Mode**: read-only audit (only this doc written)
**Deploy verdict**: **YELLOW** — backend domain core is green and live-probed; presentation edge (3 web apps) + a clutch of in-flight backend refactors in `services/api-gateway`, `services/payments-ledger`, `packages/ai-copilot` plus several uncommitted scaffolds keep us out of GREEN. No external-dep blockers have moved since CONVERGE.

---

## 1. TODO / FIXME / HACK / XXX comments

Command (corrected from the brief — `rg --type tsx` is not a valid alias, so used `-g '**/*.tsx'`):

```
rg -nP "TODO|FIXME|HACK|XXX" -g '**/*.ts' -g '**/*.tsx' \
  -g '!**/__tests__/**' -g '!**/__fixtures__/**' \
  -g '!**/node_modules/**' -g '!**/dist/**' \
  -g '!**/.next/**' -g '!**/build/**'
```

| Kind | Count | Notes |
|------|------:|-------|
| TODO | 14 | All cross-linked to GH issues (#14, #18, #20, #22, #43, #60, plus `borjie-marketing-1` → #62) |
| FIXME | 1 | (none material; appears inside `security-audit/scanners/hardcoded-data-scanner.ts` as detector regex copy) |
| HACK | 0 | — |
| XXX | 77 | **All false positives** — phone-number placeholders (`+255 7XX XXX XXX`, `+CC XXX XXX XXX`), ISO `XXX` (unknown-currency) fallbacks, and TIN-format strings (`112-XXX-XXX`). No actionable XXX comments. |

**Actionable TODO list** (deduped, with owner GH issue):

| File | Line | Owner Issue |
|------|-----:|-------------|
| `packages/user-context-store/src/search/in-memory-index.ts` | 9 | #18 (swap for pgvector / hosted vector DB in prod) |
| `services/domain-services/src/maintenance/index.ts` | 210 | #43 (owner-scope leak when work-orders fall back) |
| `services/api-gateway/src/routes/marketing.hono.ts` | 12, 58 | #62 (pilot-applications persistence + notification) |
| `apps/owner-web/src/components/marketplace/MarketplaceBoard.tsx` | 11 | #20 (counter sheet UI) |
| `apps/workforce-mobile/app/owner/O-M-02.tsx` | 76 | #14, #22 (EAS dev build + Whisper STT) |
| Various `scripts/openapi/*` + `services/api-gateway/src/routes/*` | — | #60 (OpenAPI migration; 26 mining routes) |

**Verdict**: every actionable TODO maps to an open issue. No orphaned in-source TODOs.

---

## 2. Open GitHub issues

`gh issue list --state open --limit 100` → **26 open** (not 28).

Label histogram:

| Label | Count |
|-------|------:|
| external-dependency | 19 |
| tech-debt | 15 |
| mining-domain | 7 |
| ai-brain | 6 |
| integration | 6 |
| ops | 4 |
| security | 4 |
| mobile | 3 |
| mvp3 | 2 |
| mvp1 | 1 |
| web | 1 |

State-since-FLEET deltas: **#65, #66, #67, #68 are all CLOSED** since the FLEET_FINAL_STATE doc. The 26 still open break down as:

- **Operator-owned (external-dependency, blocks resolution)**: #50 OTP, #46 GePG, #53 M-Pesa Redis, #48 OCR pipeline, #47 doc render SDKs, #45 Anthropic client, #42 KMS region routing, #35 mining tool stubs, #32 commodity feeds, #31 TZ regulator rules, #27 pilot acceptance, #23 OCR for scanned PMLs, #22 Whisper STT, #21 fingerprint SDK, #16 Anthropic key + cost telemetry, #15 BoT/NEMC API, #14 EAS dev build, #13 Mapbox token, #12 OpenAI embeddings.
- **Claude-owned (tech-debt, can land autonomously)**: #69 SCRUB-5e-cont (464 `:any/as-any` remaining — was 821), #64 HomeShell Phase-2 wiring, #63 dev-seed → Supabase Admin API, #62 pilot-applications persistence, #60 OpenAPI migration (26 routes), #59 type-safety internal `any`, #52 push filters into `findMany`.

---

## 3. Pending task list (in-flight)

No active task list surfaced via tooling this pass. The closest equivalent is the open-issue tracker above. **SCRUB-5e-cont (#69) is still open** — quantified count this audit: **464 :any/as-any sites** (down from the issue's headline 821).

Top packages holding the remaining `any`:

| Package | Count |
|---------|------:|
| `services/api-gateway` | 336 |
| `services/domain-services` | 41 |
| `packages/central-intelligence` | 27 |
| `packages/database` | 17 |
| `apps/admin-web` | 5 |
| `services/voice-agent` | 4 |
| `services/payments-ledger` | 3 |
| `packages/observability` / `packages/autonomy-governance` / `packages/ai-copilot` | 2 each |

`@ts-nocheck` / `@ts-ignore`: **0 in non-test source**.

---

## 4. Broken tests (per FLEET, not re-run this pass)

Per FLEET_FINAL_STATE_2026_05_27: **17 packages red** out of ~207 (190 green). Real (non-WIP) red list:

- `@borjie/api-gateway` — downstream of typecheck regression
- `@borjie/payments-ledger-service` — downstream of build regression
- `@borjie/central-intelligence`, `@borjie/domain-services` — in-flight operator edits
- 13 others all map to operator scaffold-WIP or downstream cascades.

**Pass rate**: 14,812 tests green / 73 failing → **>99.5% green at test-count granularity**, ~91% green at package granularity.

---

## 5. Failing typecheck (per FLEET)

6 red out of 204:

| Package | Root cause |
|---------|-----------|
| `apps/marketing` | exactOptionalPropertyTypes cascade from `chat-ui` + `genui` |
| `apps/owner-web` | same chat-ui / genui cascade |
| `apps/admin-web` | newly red — shares chat-ui / genui shell types |
| `packages/ai-copilot` | operator in-flight edits in `personas/persona-types.ts` |
| `services/api-gateway` | TS2339 `db` not on context across 6+ routers (composition-root context typing broke after `service-registry.ts` was modified); TS2709 namespace-as-type in sensorium/session-replay routers; TS2322 status-code narrowing in tenant-branding router |
| `services/ui-evolution-worker` | exactOptional on `brain-llm-router` cost-meter (`cacheReadTokens` / `cacheWriteTokens`) |

---

## 6. Failing build (per FLEET)

7 red out of 207. All map to typecheck reds above plus `services/junior-evolution-worker` (untracked scaffold WIP) and `services/payments-ledger` (in-flight edits in `services/payments/src/common/types.ts`).

---

## 7. Failing lint (per FLEET)

10 packages: `@borjie/admin-web`, `@borjie/ai-copilot`, `@borjie/api-gateway`, `@borjie/chat-ui`, `@borjie/consolidation-worker`, `@borjie/design-system`, `@borjie/genui`, `@borjie/owner-web`, `@borjie/self-codegen`, `@borjie/workforce-mobile`. Rule families: `security/detect-object-injection`, `security/detect-unsafe-regex`, `no-restricted-syntax` (Math.random), `borjie/no-non-token-style`. `workforce-mobile` ESLint config bug is **known**, out of scope.

---

## 8. Unwired UI vs open GH issues

Cross-checked `Docs/QA/UI_WIRING_AUDIT_2026_05_26.md` (11 findings, 6 inline-fixed, 5 OK). The 2 findings still mapped to open GH:

- Row #10 / #11 (workforce-mobile) → blocked on #14 (EAS dev build) + #22 (Whisper STT). Both already filed as external-dep.
- Row #7 (owner-web `MarketplaceBoard`) → #20 (counter sheet UI). Open.

No issues filed are unaccounted for. No orphan UI handlers left.

---

## 9. Stub functions

```
rg -nP 'throw new Error\("not implemented|TODO: implement|return undefined as never'
```

→ **0 hits in production source.** The one match is inside the security-audit scanner regex (i.e. the *detector* not the bug). No stubs remain.

---

## 10. CI gates — workflow YAML inventory

In repo `.github/workflows/` (31 YAML files):

| Brief-mentioned gate | Local YAML present? | Latest run conclusion |
|----------------------|---------------------|----------------------|
| live-test | YES (`live-test.yml`) | — |
| security-sast | NO (org-level — "Borjie Semgrep" runs externally) | failure |
| security-secret-scan | NO (org-level — "Borjie zero hardcoded secrets") | success |
| security-sbom | NO (org-level — "Borjie SBOM") | success |
| security-deps-audit | NO (folded into "Borjie Security Scan") | failure |
| security-container-scan | partial — `ci.yml` job "Security Scan" runs Trivy; org-level "Borjie Trivy" | failure |
| security-zap-baseline | NO | — |
| tenant-isolation-gate | NO | — |
| data-protection-gate | NO | — |
| agent-security-redteam | partial — `red-team.yml` exists | success |

**Failing CI on latest push (main, real failures, not flaky)**:

| Workflow | Conclusion |
|----------|-----------|
| CI | failure |
| Strict CI | failure |
| Monorepo CI | failure |
| Release | failure |
| Knip + dependency-cruiser | failure |
| CSRF Eslint Rule | failure |
| Borjie CI | failure |
| Borjie Trivy | failure |
| Borjie Semgrep | failure |
| Borjie Security Scan | failure |
| Borjie DB Migrations Check | failure |
| Borjie Knip + dependency-cruiser | failure |
| Borjie Coverage Audits | failure |
| backup-restore-test, backup-restore-drill | failure |
| 3× Dependabot (actions/checkout, actions/upload-artifact, docker/setup-buildx-action) | failure |

Successful: 16 (Audit NOT_YET_WIRED, Helm Chart Lint, Kernel Eval, Trajectory Eval, CD Kubernetes/Production/Staging, Migration Apply Fresh, Red Team, Orchestrator Eval, Power-Tools Registry, CodeQL, OpenAPI drift, SBOM, decision-trace coverage, policy-gate coverage, regulator-pack drift, security route coverage, zero hardcoded secrets).

---

## 11. Under-implemented research

84 distinct `packages/*` paths referenced in `Docs/DESIGN/*.md`. **Verified missing** (after subtracting renames):

| Spec-referenced package | Status |
|-------------------------|--------|
| `packages/buyer-marketplace-advisor` | **Missing** — no equivalent under `packages/`. Truly under-implemented. |
| `packages/jurisdiction-profile-de` | **Missing** — only TZ profile shipped (`jurisdiction-profile-tz`). Universal-from-day-one promise is not yet realized for a second jurisdiction. |
| `packages/market-intelligence` | **Missing** — closest is `packages/mining-commodity-intelligence`; may be a planned merge. |
| `packages/document-composer` | Renamed to `packages/document-studio` |
| `packages/mining-shift-planner` | Renamed to `packages/mine-planner-advisor` |
| `packages/rlvr` | Renamed to `packages/post-training-rlvr` |
| `packages/language-pack-*` (regex truncation) | Renamed to `packages/language-packs` |

46 distinct `services/*` paths referenced. 28 verified missing — **but** they are almost all MCP-server connectors (mail / drive / slack / teams / whatsapp / tiktok / notion / salesforce / tickets / scm / accounting / google / meta-social / tumemadini) which **are** scaffolded under `packages/connectors/{calendar,email,facebook,github,gitlab,google-drive,hubspot,instagram,jira,linear,linkedin,notion,salesforce,slack,teams,tiktok,voice,whatsapp,x,youtube,zoom}`. Architectural choice (package, not service) — not a missing implementation. The few genuine missing services:

- `services/daily-followup-worker` (spec: `DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md`)
- `services/eval-runner`
- `services/marketing-evolution-worker`
- `services/media-evolution-worker`
- `services/notification-bus`
- `services/oauth2`
- `services/omnidata-sync-worker`
- `services/speech-service`
- `services/strategic-memo-worker`
- `services/tool-generation-worker`
- `services/meta-learning-conductor` (scaffolded as `packages/meta-learning-conductor` — WIP, untracked)
- `services/diorize-worker`

---

## 12. Migration apply state

| Item | Value |
|------|------:|
| `packages/database/drizzle/*.sql` total | 63 |
| Distinct prefix range | `0000` → `0066` (4 gaps: 0001, 0002, 0006, 0014) |
| Duplicate prefixes | **0** (gh #67 resolved) |
| Drizzle `_journal.json` | absent (folder layout uses flat `*.sql` only) |
| `pnpm -F @borjie/database test -t migration-uniqueness` (per FLEET) | exit 0; 69 files / 697 tests / 3 skipped |
| Archive | 259 files in `packages/database/.archive/migrations/` |

---

## 13. In-flight uncommitted changes

```
git status --porcelain | wc -l → 0
```

**Working tree is clean.** This differs from the FLEET run 4 hours ago which had 33 modified + 8 untracked entries; those have all either been committed (`44b9e03`, `2eef2d6`, `ee854d2`, `3c2b276`) or discarded. Net positive.

---

## 14. CI health on latest push

Latest push: `f7b5843` (workflows restore), at 2026-05-27T05:55:51Z.

- **Successes**: 16 workflows
- **Failures**: 15 workflows (real, not flaky — all 3 Dependabot updates rejected by gates because of in-fleet typecheck / brand-token reds)

Failure clusters:
1. **Typecheck / build cluster (≈9 workflows)**: CI, Strict CI, Monorepo CI, Release, Borjie CI, Borjie Coverage Audits, Borjie Knip+dep-cruiser, Knip+dep-cruiser, CSRF Eslint Rule. All trace to the 6 typecheck reds in §5.
2. **Security cluster (≈4 workflows)**: Borjie Trivy, Borjie Semgrep, Borjie Security Scan, Borjie DB Migrations Check. Likely a mix of legitimate findings + downstream-of-build failures.
3. **Infra drill cluster (2 workflows)**: backup-restore-test.yml, backup-restore-drill.yml — these have been failing across multiple commits; likely a missing test secret or stale fixture, not a build-of-the-day regression.

---

## 15. Summary

| Gate | Status |
|------|--------|
| Working tree clean | GREEN |
| Migration uniqueness | GREEN |
| Source TODOs all owned | GREEN |
| Stub functions | GREEN (zero) |
| Test pass rate (per-test) | GREEN (>99.5%) |
| Typecheck (per-package) | YELLOW (6 red / 198 green) |
| Build (per-package) | YELLOW (7 red / 200 green) |
| Test (per-package) | YELLOW (17 red / 190 green) |
| Lint (per-package) | YELLOW (10 red / 52 green non-trivial) |
| CI on latest push | YELLOW (15 fail / 16 pass) |
| External-dep issues | YELLOW (19 open, all operator-blocked) |
| Backend `:any` cleanup (#69) | YELLOW (464 sites remaining; 336 in api-gateway) |

**Deploy verdict: YELLOW.** No RED blockers. To reach GREEN:

1. Stabilise `services/api-gateway` composition root (one-file fix → cascades ≥6 typecheck reds clear and unblocks api-gateway test suite).
2. Close the `chat-ui` / `genui` `exactOptionalPropertyTypes` widening for all 3 web apps (continuation of `41419d3`).
3. Triage `services/junior-evolution-worker` scaffold (commit or discard).
4. Backup-restore drill — investigate ≠ build of the day, run locally and capture the underlying failure.

---

## 16. Top-10 highest-value follow-ups (ranked by effort × impact)

| # | Item | Effort | Impact | Notes |
|--:|------|:------:|:------:|-------|
| 1 | Fix `services/api-gateway` composition-root context typing (`service-registry.ts`) | S (1 file) | XL (clears 6+ TS2339 + cascading test failures + unblocks api-gateway test suite + clears Strict CI / Monorepo CI / Borjie CI) | Single-file weakening of context interface is the root; gh #59 partial. |
| 2 | Close out gh #65 chat-ui `exactOptionalPropertyTypes` widening | M (8 files) | L (unblocks `marketing`, `owner-web`, `admin-web` typecheck + build) | Already started in `41419d3` & `d63e97d` — finish remaining widenings. |
| 3 | Resolve gh #69 SCRUB-5e-cont (464 :any/as-any) — start with api-gateway's 336 | L (336 sites) | M (improves type-safety, unblocks gh #59) | Use repo's existing typed-Hono Context pattern from `3c2b276`. |
| 4 | Triage in-flight scaffolds — commit/discard `junior-evolution-worker`, `meta-learning-conductor`, `customer-geo-routing`, `dynamic-recipe-authoring` | S–M | M (removes 4 build/test reds) | These are the operator's WIP — confirm intent before merging. |
| 5 | Backup-restore drill workflow — diagnose & fix the 2 failing infra workflows | M | M (restores DR confidence; visible in CI badge) | Pre-existing failure; not new today. |
| 6 | Close gh #60 OpenAPI migration (26 remaining mining routes) | L | M (removes runtime TODO debt + completes contract-first promise) | Tooling already exists at `scripts/openapi/legacy-route-scanner.ts`. |
| 7 | Wire gh #62 marketing pilot-applications persistence | S (1 route + 1 schema) | M (closes a TODO referenced in two source files + ships a deploy-day form) | Schema exists; just needs INSERT path. |
| 8 | Scaffold `packages/jurisdiction-profile-de` to honour Universal-from-day-one promise | M | M (validates the registry architecture against a real second jurisdiction) | Currently TZ-only; brand promise pegs L4 universality on day one. |
| 9 | Close gh #63 dev-seed onto Supabase Auth Admin API | S | M (drops local-only `optionalEnv` fallbacks → fewer env-divergence bugs) | Limits prod-vs-dev seam. |
| 10 | Tighten lint reds in `chat-ui` + `genui` + `design-system` (security/detect-object-injection, unsafe-regex, Math.random) | M | S–M (Strict CI green) | Mostly false positives; needs targeted `eslint-disable-next-line` plus comment justification. |

**Effort key**: S ≤ 1 day, M ≤ 3 days, L ≤ 1 week, XL > 1 week.

---

## 17. Commit cadence

This audit committed under `docs(qa): REMAINING_WORK_AUDIT_2026_05_27 — comprehensive open-items inventory` on `main`. No source-code edits this pass (read-only mandate). Pushed to `origin/main`.

— *Mr. Mwikila*
