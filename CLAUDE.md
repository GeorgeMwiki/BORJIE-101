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
| Drizzle schemas, 183 migrations, RLS, pgvector | [`Docs/CODEMAPS/database.md`](./Docs/CODEMAPS/database.md) | `packages/database/` |
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

All GitHub Actions workflows live in `.github/workflows/` and are
prefixed `borjie-*`. The legacy BossNyumba workflows (45 files) were
pruned in issue #25; only universally useful infra was retained and
rebranded. Source of truth for CI orchestration is `borjie-ci.yml`.

| Workflow                          | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `borjie-ci.yml`                   | Lint, typecheck, unit tests, build (PR + push main)  |
| `borjie-db-migrations-check.yml`  | Forward-only migration lint + dry-run on empty PG    |
| `borjie-publish-docs.yml`         | Publish API reference / docs                          |
| `borjie-codeql.yml`               | CodeQL static analysis + dependency review           |
| `borjie-semgrep.yml`              | Semgrep curated + Borjie custom rules                |
| `borjie-trivy.yml`                | Filesystem + container-image CVE scan                |
| `borjie-security.yml`             | Dependency audit + gitleaks secret scan              |
| `borjie-sbom.yml`                 | CycloneDX SBOM (regulator + procurement)             |
| `borjie-audit-coverage.yml`       | Universal route / RLS / zod / zero-hardcoded gates   |
| `borjie-knip.yml`                 | Dead-code + dependency-graph audit                   |

Adding a workflow: prefix the filename and `name:` field with `borjie-`
/ `Borjie `, and document the new entry in this table. Property-domain
or BossNyumba-specific workflows must not be reintroduced.
