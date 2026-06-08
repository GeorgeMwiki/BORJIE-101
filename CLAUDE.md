# How to navigate this codebase (LLM guide)

**Last Updated:** 2026-05-25
**Audience:** Claude Code, Cursor, and any other LLM-based coding
assistant working in this repo.

This file is the entry point for any LLM acting on this repository.
Read the documents in this order before answering or editing.

## About Borjie

**Borjie is an AI-native mining estate operating system. Mr. Mwikila
is its brain layer.**

The product is purpose-built for Tanzanian (and pan-African)
artisanal-to-mid-tier mining — licences, royalty, workforce, treasury,
compliance, marketplace, holdings, subsidiaries, ancillary businesses,
family office, succession, and the full asset register, all orchestrated
end-to-end by Mr. Mwikila — the brain layer within Borjie, an AI-native
mining estate operating system.

The product surfaces are four:
- `apps/admin-web` — Borjie team's internal console (port 3020)
- `apps/owner-web` — mining owner's strategic cockpit (port 3010)
- `apps/workforce-mobile` — Expo app, role-gated for owner / manager / employee
- `apps/buyer-mobile` — Expo app for mineral buyers, off-takers, marketplace

The mining corpus (specs, regulations, mineral processing playbooks)
lives **outside this repo** at the path set by
`BORJIE_MINING_CORPUS_PATH` (default:
`/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/Boji project/Docs/`).
The first-boot ingestion job
(`services/consolidation-worker/src/tasks/borjie-corpus-ingest.ts`)
upserts every chunk into `intelligence_corpus_chunks` with
`tenant_id = NULL` so every tenant inherits the same ground truth.

## Required reads (in order)

1. [`Docs/MEMORY.md`](./Docs/MEMORY.md) — long-lived invariants,
   wave state, hard rules. Load every session.
2. [`Docs/CODEMAPS/INDEX.md`](./Docs/CODEMAPS/INDEX.md) — module-
   level maps for the spine, brain, apps.
3. [`Docs/ARCHITECTURE.md`](./Docs/ARCHITECTURE.md) — developer-
   facing architecture synthesis.
4. [`Docs/MODULAR_MONOLITH.md`](./Docs/MODULAR_MONOLITH.md) —
   package boundaries and import discipline.
5. [`PROJECT_BOUNDARY.md`](./PROJECT_BOUNDARY.md) — this repo is
   Borjie only; do not conflate with any other project.

## Routing table — where things live

| Topic | Codemap | Source |
|-------|---------|--------|
| 12-agent brain kernel (think-pipeline, sensors, debate, LATS) | [`Docs/CODEMAPS/central-intelligence.md`](./Docs/CODEMAPS/central-intelligence.md) | `packages/central-intelligence/` |
| Personas, copilots, predictions, governance, audit-trail | [`Docs/CODEMAPS/ai-copilot.md`](./Docs/CODEMAPS/ai-copilot.md) | `packages/ai-copilot/` |
| Hono BFF, auth, composition root, route handlers | [`Docs/CODEMAPS/api-gateway.md`](./Docs/CODEMAPS/api-gateway.md) | `services/api-gateway/` |
| Drizzle schemas, 214 migrations (142 forward-only deltas in `src/migrations/` + 72 Drizzle baseline files in `drizzle/`), RLS, pgvector | [`Docs/CODEMAPS/database.md`](./Docs/CODEMAPS/database.md) | `packages/database/` |
| Double-entry ledger, M-Pesa/Stripe providers, statements | [`Docs/CODEMAPS/payments-ledger.md`](./Docs/CODEMAPS/payments-ledger.md) | `services/payments-ledger/` |
| Agent-to-agent auth, webhooks, idempotency, error codes | [`Docs/CODEMAPS/agent-platform.md`](./Docs/CODEMAPS/agent-platform.md) | `packages/agent-platform/` |
| OTel, audit, Sentry, logging, eval, red-team | [`Docs/CODEMAPS/observability.md`](./Docs/CODEMAPS/observability.md) | `packages/observability/` + `evals/` |
| Adaptive layout engine (UI-1) — sections rearrange themselves | [`Docs/CODEMAPS/dynamic-sections.md`](./Docs/CODEMAPS/dynamic-sections.md) | `packages/dynamic-sections/` |
| ProactiveHint (UI-2), MasteryGate (UI-3), LearnedShortcutsPanel (UI-5) | [`Docs/CODEMAPS/chat-ui.md`](./Docs/CODEMAPS/chat-ui.md) | `packages/chat-ui/` |
| Borjie internal admin web (Next.js — port 3020, 20 screens) | (codemap pending) | `apps/admin-web/` |
| Owner cockpit web (Next.js — port 3010, 22 screens, 8 CEO modes) | (codemap pending) | `apps/owner-web/` |
| Workforce mobile app (Expo, role-gated owner/manager/employee, 47 screens) | (codemap pending) | `apps/workforce-mobile/` |
| Buyer mobile app (Expo, mineral buyers + marketplace, 12 screens) | (codemap pending) | `apps/buyer-mobile/` |

## Hard rules (NEVER violate)

- **Money path goes through `LedgerService.post()`** in
  `services/payments-ledger/`. Direct ledger writes break the
  immutable double-entry invariant.
- **RLS is FORCE-enabled** on every tenant-scoped table. The
  `app.current_tenant_id` GUC is bound by api-gateway middleware.
  Never disable RLS or double-filter from app code.
- **Supabase JWT is canonical auth.** No Clerk imports anywhere.
- **Kill-switch fail-closed.** Never catch + ignore its errors.
- **Webhook delivery is at-least-once.** Consumers MUST be
  idempotent via `Idempotency-Key`.
- **AI audit chain is hash-chained, append-only.** No mutation.
- **Predictions APPEND to rule-based decisions.** Never replace.
- **Migrations are immutable.** Never edit a shipped numbered file —
  append a new one.
- **HIGH-risk policy prefixes** (sovereign / kill_switch / four_eye
  / policy_rollout) must hit literal policy rules; no reason-
  resolver generalisation.
- **OTel bootstrap runs first** in `services/api-gateway/src/index.ts`
  before any module emits spans.
- **Multi-currency, TZS at launch · expandable.** Tanzania is the
  starting jurisdiction at launch; Kenya / Uganda / Nigeria are
  planned expansion markets. Every money render uses
  `formatCurrency(amount, currencyCode)`. Domestic non-TZS contracts
  are rejected at the API layer (post 27-Mar-2026 USD-cliff
  remediation mode) for TZ-jurisdiction tenants only — KE/UG/NG
  tenants honor their own primary currency. Never hard-code TZS /
  USD / KES / UGX / NGN in code paths.
- **English default · bilingual sw/en.** Default user language is
  `en`. Tanzanian users can toggle to `sw` (Swahili) in settings;
  toggle is ABSOLUTE — when `en` selected zero Swahili appears
  anywhere (chat, surfaces, greetings, errors, toasts) and vice
  versa. Owner personas, junior prompts, and UI copy must have
  complete EN and SW translations; greetings strictly single-language
  per active locale (no "Habari! Hello there" mixing — ever).
- **Evidence-required AI output.** Every junior recommendation cites
  ≥1 `evidence_id` from LMBM or intelligence corpus. The Auditor
  Agent rejects responses with empty evidence chains.
- **No `console.log` in services.** Pino logger only — it handles
  redaction.
- **No reflective CORS.** Origin allowlist only.
- **No raw HTML interpolation.** DOMPurify wraps required.
- **No reading `process.env` outside bootstrap.** Dotenv loads once
  in `services/api-gateway/src/index.ts`.

## When uncertain

- Layout / location → [`Docs/CODEMAPS/INDEX.md`](./Docs/CODEMAPS/INDEX.md)
- Tier behaviour / policy → `packages/central-intelligence/src/kernel/
  policy-gate.ts` and `inviolable.ts`
- Recent changes → [`CHANGELOG.md`](./CHANGELOG.md)
- Known issues → [`Docs/KNOWN_ISSUES.md`](./Docs/KNOWN_ISSUES.md)
- Production readiness → [`Docs/PRODUCTION_READINESS.md`](./Docs/PRODUCTION_READINESS.md)
- Boundary / scope → [`PROJECT_BOUNDARY.md`](./PROJECT_BOUNDARY.md)

## Workflow conventions

- Conventional commits (`feat:`, `fix:`, `refactor:`, `chore:`,
  `docs:`). 1-2 sentence body focuses on the "why".
- TDD encouraged; 80%+ test coverage required.
- File size <800 lines, function <50 lines, nesting ≤4.
- Immutability; zod for runtime validation.
- Drizzle ORM only.
- New routes: `*.hono.ts`; older `*.router.ts` deprecated.
- For full conventions see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## CI workflow inventory

All GitHub Actions workflows live in `.github/workflows/`. Source of
truth for the primary CI orchestration is `ci.yml` (with `pr-check.yml`
and `strict-ci.yml` as the PR-gate / blocking variants). The legacy
BossNyumba workflows were pruned during the property→mining migration;
only the `borjie-*`-prefixed security/eval workflows below retain that
naming. Property-domain or BossNyumba-specific workflows must not be
reintroduced.

### Core CI / quality gates

| Workflow                          | Purpose                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `ci.yml`                          | Primary CI: lint, typecheck, test, build, e2e (PR + push)    |
| `ci-monorepo.yml`                 | Faster parallel monorepo CI reusing one install artifact     |
| `pr-check.yml`                    | Enforced PR quality gates                                     |
| `strict-ci.yml`                   | Blocking lint/typecheck/test/build/e2e (canonical-in-waiting)|
| `knip-dep-cruiser.yml`            | Knip dead-code + dependency-cruiser graph audit              |
| `csrf-eslint-rule.yml`            | Runs the `require-csrf-headers` eslint rule on Next.js apps  |
| `power-tools-registry-shape.yml`  | Validates the typed power-tools registry shape on PRs        |
| `audit-not-yet-wired.yml`         | Audits `NOT_YET_WIRED` markers                               |

### Database / migrations

| Workflow                          | Purpose                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `migration-apply-check.yml`       | Apply every migration on a fresh Postgres 17 in lex order    |
| `migration-apply-fresh.yml`       | Fresh-apply verifier on Postgres 16 + pgvector               |
| `migration-safety-check.yml`      | Pre-deploy NOT NULL backfill-hazard validator                |
| `backup-restore-drill.yml`        | Weekly encrypted-backup end-to-end restore drill             |

### Security / supply chain

| Workflow                          | Purpose                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `borjie-codeql.yml`               | CodeQL static analysis                                        |
| `borjie-semgrep.yml`              | Semgrep curated + Borjie custom rules                        |
| `borjie-security.yml`             | Dependency audit + secret scan                              |
| `ai-bom-attest.yml`               | AI Bill of Materials generate + Sigstore-sign (release/nightly)|

### Brain evals / red-team / probes

| Workflow                          | Purpose                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `kernel-eval.yml`                 | central-intelligence kernel regression eval (stub sensor)    |
| `eval-orchestrator-scenarios.yml` | Orchestrator intent-router / handoff / tool-dispatcher eval  |
| `lats-search-eval.yml`            | LATS tree-search vs ToT beam planner eval                   |
| `trajectory-eval.yml`             | Asserts agent tool-path matches optimal within tolerance     |
| `red-team.yml`                    | Adversarial probe of the central-intelligence kernel         |
| `borjie-redteam.yml`              | Promptfoo adversarial red-team gate (LP-13)                 |
| `defection-probe.yml`             | Paired audit/unaudited defection-marker contrast            |
| `sycophancy-probe.yml`            | Nightly affirmation-rate gate against live brain endpoint    |
| `reflexion-sleep-canary.yml`      | 4-pass nightly sleep-consolidation canary                   |
| `sandbox-load-test.yml`           | isolated-vm sandbox load harness (1000 concurrent runs)      |

### Deploy / release / infra

| Workflow                          | Purpose                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| `cd.yml`                          | Continuous deployment (Kubernetes via Kustomize + ghcr.io)   |
| `cd-staging.yml`                  | CD to staging environment                                    |
| `cd-production.yml`               | CD to production (blue/green + rollback)                     |
| `deploy-staging.yml`              | Staging deploy on push to main                              |
| `deploy-production.yml`           | Production deploy on release publish                         |
| `release.yml`                     | Automated release pipeline for main                          |
| `helm-chart-lint.yml`             | `helm lint` + `helm template` on `k8s/helm/borjie/`         |
| `live-test.yml`                   | Manual full happy-path E2E vs test Supabase + gateway        |

Adding a workflow: document the new entry in the appropriate table
above. New security/eval workflows should keep the `borjie-` prefix on
both the filename and the `name:` field. Property-domain or
BossNyumba-specific workflows must not be reintroduced.
