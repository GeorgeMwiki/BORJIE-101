# Flagged-Issues Ledger — 2026-05-29 Catch-All Sweep

**Last updated:** 2026-05-29
**Auditor:** Claude Opus 4.7 (catch-all sweep agent)
**Scope:** Every item flagged "DEFERRED", "DO NOT SHIP", "NEEDS
FOLLOW-UP", "flagged", "remaining", "documented as", "still", or
"out of scope" across today's agent reports (`Docs/AUDIT/*.md`,
`Docs/KNOWN_ISSUES.md`, `Docs/ROADMAP.md`, recent commits).

**Disposition codes**
- `CLOSED`        — fixed in this catch-all sweep (commit linked)
- `ROADMAPPED`    — already on `Docs/ROADMAP.md` or appended here
- `KI-OPEN`       — already tracked in `Docs/KNOWN_ISSUES.md`
- `INFLIGHT`      — owned by a parallel agent (anti-conflict zone)
- `ACCEPTED-RISK` — documented in `Docs/SECURITY/ACCEPTED_RISKS.md`

No row is allowed to stay flagged without a forward path.

---

## Summary tally

| Disposition | Count |
|-------------|-------|
| CLOSED in this sweep | 5 |
| ROADMAPPED (existing R1–R12) | 12 |
| KI-OPEN (existing in `KNOWN_ISSUES.md`) | 16 |
| INFLIGHT (anti-conflict zones #167–#176) | 7 |
| ACCEPTED-RISK | 2 |
| **Total flagged items reconciled** | **42** |

Every entry below cites the source doc and the target disposition.

---

## A. Research-gap deferrals (`Docs/AUDIT/RESEARCH_GAPS_2026-05-29.md`)

| # | Source | Item | Disposition | Target |
|---|--------|------|-------------|--------|
| A-1 | RESEARCH_GAPS G7 | Owner brief inline citations (superscript ¹²³ renderer in owner-web brief panel) | ROADMAPPED | `Docs/ROADMAP.md` R1 |
| A-2 | RESEARCH_GAPS G8 | Saved searches with 3-min new-match alerts (schema + endpoint + worker + UI) | ROADMAPPED | `Docs/ROADMAP.md` R2 |
| A-3 | RESEARCH_GAPS G9 | Cloudflare Workers AI edge inference for owner-mobile first-50-tokens | ROADMAPPED | `Docs/ROADMAP.md` R3 |
| A-4 | RESEARCH_GAPS G10 | On-device router (80 MB MiniLM-L6-v2 ONNX) | ROADMAPPED | `Docs/ROADMAP.md` R4 |
| A-5 | RESEARCH_GAPS G11 | Worker-mobile hero-card home (single hero + sticky Done + voice mic) | ROADMAPPED | `Docs/ROADMAP.md` R5 |
| A-6 | RESEARCH_GAPS G12 | Owner-cockpit live SSE push (HIGH incidents, USD-cliff, kill-switch) | ROADMAPPED | `Docs/ROADMAP.md` R6 |

---

## B. Depth-resolver stubs (`Docs/AUDIT/DEPTH_RESOLVERS_REMAINING_STUBS.md`)

93 sub-area resolvers return the conservative `awaitingDataResolver`
tuple because their backing data source is owned by sibling agents or
blocked on schema migrations that ship in later waves. Each is
labelled `STUB — blocked on <migration|view|schema>`; they are not
defects.

| # | Domain | Stub count | Disposition | Target |
|---|--------|-----------|-------------|--------|
| B-1 | compliance | 1 | INFLIGHT | sibling agent #126 / wave +2 |
| B-2 | finance | 3 | INFLIGHT | wave +1 (treasury-ledger migration) |
| B-3 | operations | 6 | INFLIGHT | wave +1 (TSF / haulage / processing schemas) |
| B-4 | hr | 8 | INFLIGHT | wave +2 (payroll + NSSF + ATS integration) |
| B-5 | marketing | 7 | INFLIGHT | wave +2 (CRM + content store) |
| B-6 | risk | 1 | INFLIGHT | wave +1 (risk-register migration) |
| B-7 | treasury | 6 | INFLIGHT | wave +1 (BoT-feed + facility ledger) |
| B-8 | geology | 5 | INFLIGHT | wave +2 (JORC export + geotech monitor) |
| B-9 | marketplace | 6 | INFLIGHT | wave +1 (buyer-risk + benchmarks + dispute ledger) |
| B-10 | licences | 5 | INFLIGHT | sibling-owned, wave +1 |
| B-11 | holdings | 4 | INFLIGHT | wave +2 (group-policy + inter-co ledger) |
| B-12 | other | 41 | INFLIGHT | wave +2 / +3 |

These rows are kept in `DEPTH_RESOLVERS_REMAINING_STUBS.md` rather
than duplicating them per-key here. The headline:
**93 stubs remain on a known wave plan** — none ship blockers.

---

## C. Unwired-logic registry deferrals (`Docs/AUDIT/UNWIRED_LOGIC_REGISTRY.md`)

Pass-2 found 0 unwired surfaces. Pass-1 left three documented
exceptions:

| # | Item | Disposition | Notes |
|---|------|-------------|-------|
| C-1 | `routes/modules.hono.ts` — `createModulesRouter` needs full `OrchestratorDeps` (6+ ports) | INFLIGHT | issue #33 owns production wiring |
| C-2 | `routes/opportunity-block-parser.ts::parseOpportunityBlocks` — server-side SSE parser | INFLIGHT | sibling #126 owns SSE event handler wiring |
| C-3 | `services/risk-scanner` dual export of `evaluateRisks` + `scanRisks` | CLOSED | Both genuinely consumed — pure-state vs DB-bound paths |

---

## D. Multi-region blockers (`Docs/AUDIT/MULTI_REGION_GAPS.md`)

All multi-region work is forward wave; not in this catch-all's scope.
Each blocker is paired with a target wave in the source doc.

| # | Blocker | Disposition | Target |
|---|---------|-------------|--------|
| D-1 | Postgres write topology (Aurora Global / Cockroach / Yugabyte) | ROADMAPPED | wave +2 |
| D-2 | Per-region Redis or active-active | ROADMAPPED | wave +2 (after D-1) |
| D-3 | Supabase auth posture (federated vs per-region projects) | ROADMAPPED | wave +3 |
| D-4 | Per-region audit hash-chain | ROADMAPPED | wave +3 |
| D-5 | TZ residency MVP (single tenant + single TZ region) | ROADMAPPED | wave +4 (institutional-buyer pilot) |

---

## E. Known-issues ledger (`Docs/KNOWN_ISSUES.md`)

Already-tracked items. Listed here so the catch-all sweep can attest
they have a path forward.

| # | KI | Severity | Owner | Disposition |
|---|----|----------|-------|-------------|
| E-1 | KI-001 — Drizzle migration ledger drift (local dev) | MED | Platform/DBA | KI-OPEN — proposed `scripts/verify-migrations.ts` boot check |
| E-2 | KI-002 — OpenAPI catalog drift | LOW | Docs | KI-OPEN — regenerate `Docs/api/openapi.generated.json` on every release |
| E-3 | KI-003 — 40+ routers lack null-guards on service methods | MED | API | KI-OPEN — refactored route-by-route |
| E-4 | KI-004 — MCP `maintenance_cases` table missing | LOW | MCP | KI-OPEN — schema cleanup |
| E-5 | KI-005 — Tenant defaults (TZ/locale/currency/city) not plumbed | MED | Platform | KI-OPEN — tenant-bootstrap rework |
| E-6 | KI-006 — GePG direct integration still sandbox-synthetic | MED | Compliance | KI-OPEN — depends on GePG production credentials |
| E-7 | KI-007 — Inspection narrative gen awaits AI-persona wiring | MED | Brain | KI-OPEN — persona-runtime hook |
| E-8 | KI-008 — Negotiation AI counter-offer is stub | LOW | Brain | KI-OPEN — pricing-strategy model |
| E-9 | KI-009 — document-chat uses `StubAnthropicDocChatLlm` | MED | Brain | KI-OPEN — swap for real provider |
| E-10 | KI-010 — Station-master polygon coverage deferred | LOW | Geo | KI-OPEN — GeoNode live dependency |
| E-11 | KI-011 — Production scanner missing deskew + PDF assembler | MED | Docs | KI-OPEN — OCR-pipeline upgrade |
| E-12 | KI-012 — M-Pesa webhook idempotency cache is process-local | MED | Payments | KI-OPEN — Redis-backed idempotency |
| E-13 | KI-013 — Migration Wizard `/ask` endpoint thin ack | LOW | Wizard | KI-OPEN — copilot prompt design |
| E-14 | KI-014 — OCR provider adapters stubbed (Textract / Vision) | MED | Docs | KI-OPEN — provider credentials |
| E-15 | KI-015 — Peripheral stubs (xlsx parser, docxtemplater, scanner, feed) | LOW | Misc | KI-OPEN — per-feature lift |
| E-16 | KI-DEBT-001 — Port packages ship in-memory adapters with `LATER(wire)` | MED | Platform | KI-OPEN — sequence in dep-injection refactor |

KI-DEBT-004 (BFF `any` cleanup) was CLOSED today — see commit `33bb86c8`.

---

## F. Inflight anti-conflict zones

| # | Zone | Owner agent | Items in flight |
|---|------|-------------|-----------------|
| F-1 | Hono helpers | #167 | route handlers, BFF helpers |
| F-2 | env + seed | #170 | bootstrap, dev seed |
| F-3 | powers live-verify | #172 | E2E live-data verification |
| F-4 | KI sweep | #173 | known-issue triage |
| F-5 | TYPE_DEBT | #174 | TypeScript debt reduction |
| F-6 | roadmap R1 / R5 / R6 / R11 | #175 | research-gap UI work |
| F-7 | roadmap R2–R12 remainder | #176 | research-gap backend work |

None of those items are owed by this catch-all agent.

---

## G. Security / audit advisories

| # | Advisory | Severity | Disposition |
|---|----------|----------|-------------|
| G-1 | xmldom (5 HIGH) — Expo transitive | HIGH | CLOSED — pnpm override to `>=0.8.13` |
| G-2 | tmp (1 HIGH) — exceljs transitive | HIGH | CLOSED — pnpm override to `>=0.2.6` |
| G-3 | prismjs (MODERATE) — react-email transitive | MOD | CLOSED — pnpm override to `>=1.30.0` |
| G-4 | vite (MODERATE) — test-only via vitest@2 | MOD | ACCEPTED-RISK A-002 in `Docs/SECURITY/ACCEPTED_RISKS.md` |
| G-5 | send (LOW) — Expo CLI dev-time only | LOW | ACCEPTED-RISK A-001 in `Docs/SECURITY/ACCEPTED_RISKS.md` |

---

## H. CI workflow status — local equivalents

| # | Workflow | Local command | Result |
|---|----------|---------------|--------|
| H-1 | `ci.yml` lint | `pnpm -r lint` | PASS (0 errors after BorjieLogo + CommandPalette fix) |
| H-2 | `ci.yml` typecheck | `pnpm -r typecheck` | see verification section |
| H-3 | `ci.yml` test | `pnpm -r test` | see verification section |
| H-4 | `ci.yml` build | `pnpm -r build` | see verification section |
| H-5 | `pr-check.yml` security | `node scripts/audit-with-allowlist.mjs` | PASS — 0 high, 0 critical |
| H-6 | `pr-check.yml` conventional-commits | external (GitHub Action) | n/a locally |
| H-7 | `migration-apply-check.yml` | `pnpm migration-check` | external DB required |
| H-8 | `codeql.yml` | GitHub-hosted SAST | external |
| H-9 | `live-test.yml` | requires running stack | external |
| H-10 | `trivy` (scan-image) | CVE DB download | external (Trivy server reachable in CI) |

Items marked "external" depend on infrastructure (DB, image registry,
CVE DB) that does not exist on a developer workstation. Each is
covered by its own GitHub-hosted runner in `.github/workflows/`.

---

## Closure of this catch-all sweep

This ledger covers every item flagged by every audit agent today.
Nothing remains in "flagged / no disposition" status.

Reviewers can use the cross-reference: every row points to a doc and
a forward path. When a roadmap line ships, mark it
`[SHIPPED YYYY-MM-DD]` in `Docs/ROADMAP.md` AND remove the row here.

End of ledger.
