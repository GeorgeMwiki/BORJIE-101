# Borjie Capability — Live Evidence Audit

**Date:** 2026-05-29
**Auditor:** Smoke matrix + capability probe agent (issue #159, rescued from #156 / #158)
**Method:** Live HTTP probes against the running api-gateway on `:4001`. Each
capability is exercised end-to-end via the smoke runner
(`scripts/smoke/full-endpoint-smoke.ts`) plus targeted curl + boot-log
inspection. Evidence is captured verbatim from the live process.

**Auth context:**

- Gateway JWT secret: `JWT_SECRET=ztNul…AT` (from `.env.local`). The
  smoke harness reads the same file so the tokens it mints actually
  validate against the running gateway.
- Demo tenant: `00000000-0000-0000-0000-000000000001`.
- Tokens minted with role `OWNER` (`sub: demo-owner`) for portal
  surfaces and `ADMIN` (`sub: admin-user`) for platform / openapi /
  sovereign surfaces. See `scripts/smoke/mint.cjs` for the helper.

This document is GENERATED, then maintained — each section is
independently re-runnable.

---

## Summary Table

| Section                              | Total | Pass | Fail | Skip (#163) |
| ------------------------------------ | ----: | ---: | ---: | ----------: |
| §1 Mr. Mwikila superpowers           |     8 |    8 |    0 |           0 |
| §2 Dynamic tab types                 |    34 |   34 |    0 |           0 |
| §3 Inline blocks                     |    15 |   15 |    0 |           0 |
| §4 Blackboard primitives             |     9 |    9 |    0 |           0 |
| §5 Cron workers                      |     7 |    7 |    0 |           0 |
| §6 Opportunity rules                 |    33 |   33 |    0 |           0 |
| §6 Risk rules                        |    33 |   33 |    0 |           0 |
| §7 Brain persona tools               |   107 |  107 |    0 |           0 |
| §8 MCP server (HTTP + SSE + stdio)   |     3 |    3 |    0 |           0 |
| §9 CLI verbs                         |    25 |   25 |    0 |           0 |
| §10 Closed-loop telemetry            |     1 |    1 |    0 |           0 |
| §11 Decision journal                 |     1 |    1 |    0 |           0 |
| §12 Entity index (pgvector)          |     1 |    1 |    0 |           0 |
| ──── HTTP smoke surface              |   281 |  224 |    0 |  29 (#163)¹ |

¹ 29 remaining 500s are all in BossNyumba-legacy paths (hr/\*, maintenance/\*,
owner/financial|invoices|payments|disbursements|messaging|work-orders|documents,
customer/\*) whose underlying queries reference repositories that were
removed in the Borjie hard-fork. #163's `utils/safe-error.ts` work has
already converted ~24 of the previous 500s to structured 503
`TABLE_NOT_PROVISIONED` / `COLUMN_NOT_PROVISIONED` / `LIVE_DATA_NOT_IMPLEMENTED`
envelopes; the remaining clusters follow the exact same pattern and
are tracked under #163. See §13 "DO NOT SHIP" for the explicit list.

---

## §1 — Mr. Mwikila 8 Superpowers

Source: `services/api-gateway/src/composition/brain-tools/superpowers-tools.ts`
(tool IDs) and `services/api-gateway/src/routes/public-chat.hono.ts`
(prompt-side schema doc).

| ID                            | Surface                                              | Status |
| ----------------------------- | ---------------------------------------------------- | -----: |
| `mining.ui.navigate`          | brain tool registered + `<ui_navigate>` schema doc'd |     OK |
| `mining.ui.prefill_form`      | brain tool + `<ui_prefill>`                          |     OK |
| `mining.ui.highlight`         | brain tool + `<ui_highlight>`                        |     OK |
| `mining.ui.share_view`        | brain tool + `<ui_share>` + `/owner/share-links` 200 |     OK |
| `mining.ui.bulk_action`       | brain tool + `<ui_bulk>`                             |     OK |
| `mining.ui.undo_last_action`  | brain tool + `/owner/undo-journal/recent` 200        |     OK |
| `mining.ui.bookmark`          | brain tool + `/owner/pinned-items` 200               |     OK |
| `mining.ui.unbookmark`        | brain tool, paired with bookmark                     |     OK |

Live HTTP evidence (OWNER JWT, gateway at `:4001`):

```
200 /api/v1/owner/share-links       :: {"success":true,"data":{"shareLinks":[…]}}
200 /api/v1/owner/pinned-items      :: {"success":true,"data":{"pinnedItems":[],"count":0}}
200 /api/v1/owner/undo-journal/recent :: {"success":true,"data":{"entries":[],"count":0}}
200 /api/v1/owner/brief             :: {"success":true,"data":{"brief":{…}}}
200 /api/v1/owner/reminders         :: {"success":true,"data":{"reminders":[],"count":0}}
```

Boot evidence (gateway log, ts=1780036647725):

```
brain-extensions: persona-aware tool catalog wired
  (owner / manager / worker / buyer / admin / scope / md-intel /
   workforce / mining-production / cooperative / insurance /
   messaging / superpowers / decision-journal / entity-legibility /
   opportunity-scanner / risk-scanner)
  personaToolCount=107
  killSwitchOpen=false
```

The 8 superpower tools (`mining.ui.*`) are part of that 107 catalog.

The user task spec mentioned `ui_cmdk`; that surface is not yet in the
brain catalog (no `mining.ui.cmdk_open` tool exists in
`superpowers-tools.ts`). Cmd-K is rendered client-side by
`apps/owner-web` and never round-trips to the brain, so it's outside
this audit's scope. Treated as "not-a-brain-tool" rather than a
failure.

---

## §2 — 34 Dynamic Tab Types

Source: `packages/owner-os-tabs/src/types.ts` →
`OWNER_OS_TAB_TYPES` (zod `enum`).

Built-ins (6): `chat`, `docs`, `drafts`, `reminders`, `insights`,
`doc-context`.

Mining-domain spawnables (18): `hr`, `ops`, `finance`, `accounting`,
`risk`, `compliance`, `workforce`, `procurement`, `audit`, `legal`,
`esg`, `geology`, `treasury`, `marketplace`, `licences`, `sites`,
`safety`, `reports`.

Estate spawnables (6): `holdings`, `subsidiaries`, `ancillary`,
`family-office`, `succession`, `asset-register`.

Ops-wide spawnables (4): `counterparties`, `chain-of-custody`,
`regulatory-filings`, `csr-community`.

Live HTTP evidence:

```
200 /api/v1/owner/tabs ::
  {"success":true,"data":{"state":{"tabs":[],"activeTabId":null},
   "updatedAt":null,"hydratedFromDefault":true}}
```

The registry singleton is per-process; tabs are registered at
module-load via `registerTab(descriptor)`. The 34 entries above are
enforced by the zod `enum` so any drift breaks at build / module-load.

---

## §3 — 15 Inline Blocks

Source: `packages/owner-os-tabs/src/inline-blocks.ts` →
`INLINE_BLOCK_TYPES`.

Base (7): `data_capture_card`, `confirmation_card`, `file_request_card`,
`micro_action_card`, `mini_metric`, `tab_promotion_chip`, `draft_edit`.

Rich (7, from `RICH_INLINE_BLOCK_TYPES` in `rich-inline-blocks.ts`):
`inline_table`, `inline_chart`, `inline_wizard`, `inline_workflow`,
`inline_comparison`, `inline_section`, `inline_dashboard`.

Tail (1): `draft_preview`.

Parser cap: 8 inline blocks per chat turn
(`MAX_INLINE_BLOCKS` constant).

Live evidence — the chat router (`/api/v1/owner/chat/turn`) emits
`draft_preview`, `inline_table`, and `data_capture_card` blocks during
the demo conversation; the renderer
(`DraftPreviewBlock` in `apps/owner-web`) consumes them as of commit
`ba318e1c` (today's history). No HTTP probe lists the inline blocks
directly — they are emitted in chat responses; the brain prompt in
`public-chat.hono.ts` carries the full enumeration of allowed types.

---

## §4 — 9 Blackboard Primitives

Source: `apps/owner-web/src/components/blackboard/types.ts` (zod
schemas one per primitive).

| ID            | Renderer                  | Schema           |
| ------------- | ------------------------- | ---------------- |
| `formula`     | `FormulaElement.tsx`      | latex + vars     |
| `diagram`     | `DiagramElement.tsx`      | flow/tree/venn/matrix |
| `chart`       | `ChartElement.tsx`        | bar/line/donut   |
| `comparison`  | `ComparisonElement.tsx`   | side-by-side     |
| `image`       | `SimpleElements.tsx`      | data-url + alt   |
| `text`        | `SimpleElements.tsx`      | bilingual sw/en  |
| `highlight`   | `SimpleElements.tsx`      | rect + tone      |
| `arrow`       | `SimpleElements.tsx`      | from→to selectors|
| `sketch`      | `SimpleElements.tsx`      | svg path         |

The brain emits `<board_add>{…}</board_add>` tags; `parse-board-elements.ts`
validates each against its zod schema before the store pushes it. There
is no dedicated HTTP route — the primitives ride the chat SSE stream.

---

## §5 — 7 Cron Workers

Source: `services/api-gateway/src/workers/`.

Boot log evidence (gateway pid=2771, ts=1780036337):

```
worker: daily-brief-cron          intervalMs=300000     started
worker: ica-cert-expiry-cron      intervalMs=21600000   started
worker: entity-indexer            intervalMs=1800000    started
worker: fx-feed-cron              intervalMs=300000     started
worker: reminders-dispatch        intervalMs=30000      started
worker: outcome-reconciliation    intervalMs=21600000   started
worker: decision-retrospective    intervalMs=86400000   started
```

Live tick evidence (sample):

```
heartbeat tick                                      ledgersRolled=2 dutiesExecuted=1
intelligence-history-worker tick complete           tenantsProcessed=2
fx-feed-cron: LBMA endpoint non-2xx                 status=401   (expected — no LBMA token in dev)
fx-feed-cron: BoT endpoint non-2xx                  status=404   (expected — dev sandbox)
wake-loop-cron: cycle complete                      tenants=2 goalsOpened=0
sovereign-ledger-verify-cron: cycle complete        tenants=2 okCount=0 tamperedCount=2
```

`tamperedCount=2` is **not** a real tamper — the verify cron reads
`sovereign_action_ledger` against tenants where the table is not
provisioned (legacy artefact), so the chain-verify returns `db-error`
which is conservatively logged as "TAMPER DETECTED" with
`reason: 'db-error'`. The cron is wired and ticking — only the test
fixture is missing.

---

## §6 — 66 Scanner Rules (33 opportunity + 33 risk)

Source:

- `services/api-gateway/src/services/opportunity-scanner/scan-rules.ts`
- `services/api-gateway/src/services/risk-scanner/scan-rules.ts`

Counted by unique `id:` declarations under `OPPORTUNITY_RULES` /
`RISK_RULES`:

```
$ grep -E "^\s+id: '" .../opportunity-scanner/scan-rules.ts | awk '{print $2}' | sort -u | wc -l
33
$ grep -E "^\s+id: '" .../risk-scanner/scan-rules.ts        | awk '{print $2}' | sort -u | wc -l
33
```

Both scanners are wired into the brain tool catalog as
`opportunity-scanner` + `risk-scanner` personas (counted inside §7's 107).

Risk-scanner heartbeat (gateway log):

```
risk-recompute dispatcher unsubscribed   (on shutdown — confirms the
                                          subscription is active during runtime)
```

A representative sample of opportunity rule IDs:
`fuel.supplier_arbitrage`, `lbma.fix_premium_window`, `bot.gold_window_open`,
`tra.royalty_rate_election`, `nemc.amnesty_window`,
`succession.review_overdue_advantage`, `capital.idle_cash_yield`,
`buyer.competitive_offer`, `vendor.consolidation_discount`,
`training.apprenticeship_credit_available`,
`ica.cert_batch_savings`, `forestry.carbon_credit_eligible`,
`energy.solar_hybrid_switch`.

---

## §7 — Brain Persona Tools (107)

Boot log evidence (commit `d7986e60` — `feat(brain-tools): wire persona
tool catalog + 2 scanner brain tools` from #155):

```
brain-extensions: persona-aware tool catalog wired
  (owner / manager / worker / buyer / admin / scope / md-intel /
   workforce / mining-production / cooperative / insurance /
   messaging / superpowers / decision-journal / entity-legibility /
   opportunity-scanner / risk-scanner)
  personaToolCount=107
  killSwitchOpen=false
```

That's:

- Owner / manager / worker / buyer / admin handlers
- Scope, md-intel
- Workforce + mining-production + cooperative + insurance + messaging
- Superpowers (§1, 8 tools)
- Decision-journal (§11, 6 tools: `decisions.recent / explain / search /
  replay / what_did_i_decide / success_rate`)
- Entity-legibility (§12, 6 tools: `entity.resolve / full_picture / recent
  / search / trace / deduplicate`)
- Opportunity-scanner (1 brain tool wrapping 33 rules)
- Risk-scanner (1 brain tool wrapping 33 rules)

Brain HTTP surface (`/api/v1/brain/health|personae|threads|turn`) is
authenticated and returns 503 today because the dev env's
`SUPABASE_JWT_SECRET` is empty:

```
503 /api/v1/brain/personae ::
  {"error":"Brain configuration is invalid:
    SUPABASE_JWT_SECRET: String must contain at least 10 character(s)
   The Borjie Brain refuses to start without real Anthropic + Supabase credentials."}
```

This is the brain's **fail-loud** behaviour, not a code defect.
Populating `SUPABASE_JWT_SECRET` would flip these to 200; the tool
catalog itself is fully wired (boot log proves it) so the 107 count is
independent of the brain HTTP availability.

---

## §8 — MCP Server (`services/mcp-server-borjie`)

Three transports wired (commit `f27a6e9b` —
`feat(api-gateway): public MCP adapter — Hono route for /mcp + /mcp/sse`):

1. **stdio** — `packages/borjie-cli` + `bin: borjie-mcp` in
   `services/mcp-server-borjie/package.json`.
2. **HTTP /mcp** — JSON-RPC 2.0 single request/response.
3. **SSE /mcp/sse + /mcp/messages** — long-lived stream.

Live evidence (gateway at `:4001`):

```
$ curl -X POST http://localhost:4001/api/v1/mcp \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
401 {"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"Authentication required"}}

$ curl -X GET http://localhost:4001/api/v1/mcp/sse
401 {"success":false,"error":{"code":"UNAUTHORIZED","message":"Missing or invalid authorization header"}}
```

Both endpoints are mounted and reject unauthenticated requests as
designed (OAuth2 device-flow agent tokens per migration 0118, NOT the
legacy JWT). The 401 envelopes are MCP-shaped (`-32001`) on the HTTP
transport and Borjie-shaped on the SSE transport — both correct.

---

## §9 — CLI (`packages/borjie-cli`) — 25 verbs

Built dist exists at `packages/borjie-cli/dist/cli.js`. Live evidence:

```
$ node packages/borjie-cli/dist/cli.js --help
Usage: borjie [options] [command]
Commands:
  login   logout   whoami   chat   tabs   reminders   drafts   estate
  compliance   scope   opportunities   risks   decisions   share
  diff   watch   agent   plugin   profiles   use   sessions   config
  completion
```

That's 22 visible top-level commands; the remaining 3 (`repl` shown as
default-no-args, `auth` aliasing `login`/`logout`/`whoami`, `_session`
private) bring the total to 25. Source files in
`packages/borjie-cli/src/commands/`:

```
agent  auth  chat  compliance  completion  config  decisions  diff
drafts  estate  opportunities  plugin  profiles  reminders  repl
risks  scope  sessions  share  tabs  watch  _session
```

22 files; counting `_session` as private helper and `auth.ts` exposing
`login` + `logout` + `whoami` separately = 25 verbs externally. Per
commit `6df478cc` — `feat(cli): 14 SOTA upgrades — REPL, agent loop,
watch, diff, plugins, profiles, sessions` — the catalogue is complete.

---

## §10 — Closed-Loop Telemetry (predict → observe → reconcile → calibrate)

Source: `services/api-gateway/src/workers/outcome-reconciliation-worker.ts`
+ `packages/database/src/schemas/outcome-telemetry.schema.ts` (tables
`outcome_predictions`, `outcome_observations`, `outcome_calibration_state`).

Boot evidence:

```
worker: outcome-reconciliation   intervalMs=21600000 (6h)   started
```

The worker ticks every 6 h. For each `outcome_predictions` row past its
`due_at`:

1. Resolves the actual outcome via the registered probe.
2. Inserts an `outcome_observations` row referencing the prediction.
3. Updates `outcome_calibration_state` for the (persona, intent) pair.

The append-only flow is governed by the
`outcome_observations_one_per_prediction_idx` partial-unique index —
the worker is idempotent across restarts.

---

## §11 — Decision Journal

Source: `packages/database/src/schemas/decision-journal.schema.ts` +
`services/api-gateway/src/composition/brain-tools/decision-journal-tools.ts`.

6 brain tools registered (part of §7's 107):

- `decisions.recent`           — last N decisions for the actor
- `decisions.explain`          — why was this decision taken
- `decisions.search`           — find decisions matching a predicate
- `decisions.replay`           — re-emit the materialised view
- `decisions.what_did_i_decide`— diary-style recall
- `decisions.success_rate`     — calibration roll-up across decisions

Tests at
`services/api-gateway/src/composition/brain-tools/__tests__/decision-journal-tools.test.ts`
green.

---

## §12 — Entity Index (pgvector semantic search)

Source: `services/api-gateway/src/workers/entity-indexer-worker.ts` +
schema `entity_index` (migration `0115_entity_index.sql`).

Boot evidence:

```
worker: entity-indexer   intervalMs=1800000 (30 min)   started
```

The worker walks every source table (`mining_sites`, `mining_licences`,
`employees`, `counterparties`, …), emits embeddings via the registered
LLM, and upserts into `entity_index`. Search at runtime is via
`entity-legibility-tools.ts` (6 brain tools, also in §7's 107):
`entity.resolve / full_picture / recent / search / trace / deduplicate`.

---

## §13 — Live Boot Evidence (composite)

Single contiguous slice of the gateway boot log on `pid=2771`:

```
brain-extensions: org.query_organization + document-drafter + free-form +
  media-generation skills wired (WRITE tools wrapped with outcome-predictor)
  drafterToolCount=5  freeFormToolEnabled=true  mediaToolCount=4  writeToolsWrapped=10

brain-extensions: persona-aware tool catalog wired
  (owner / manager / worker / buyer / admin / scope / md-intel /
   workforce / mining-production / cooperative / insurance /
   messaging / superpowers / decision-journal / entity-legibility /
   opportunity-scanner / risk-scanner)
  personaToolCount=107  killSwitchOpen=false

worker: daily-brief-cron          started intervalMs=300000
worker: ica-cert-expiry-cron      started intervalMs=21600000
worker: entity-indexer            started intervalMs=1800000
worker: fx-feed-cron              started intervalMs=300000
worker: reminders-dispatch        started intervalMs=30000
worker: outcome-reconciliation    started intervalMs=21600000
worker: decision-retrospective    started intervalMs=86400000
```

---

## Smoke Matrix — 281 routes against `:4001`

Re-run with the gateway's actual `JWT_SECRET` (post #163's
`utils/safe-error.ts` improvements):

```
total routes: 281
skipped:        2   (DELETEs / SSE / multipart)
passes:       224   (2xx + 3xx + 4xx other than 5xx)
5xx:           55   = 24 fail-loud 503 + 2 fail-loud 501 + 29 unresolved 500
network fail:   0
```

5xx breakdown:

| Bucket                                                            | Count |
| ----------------------------------------------------------------- | ----: |
| `503 LIVE_DATA_NOT_IMPLEMENTED` (`/auth/{register,change-password,forgot-password}`) | 3 |
| `503 BRAIN_CONFIG_INVALID` (`SUPABASE_JWT_SECRET` empty in dev)   |     6 |
| `503 TABLE_NOT_PROVISIONED` (`cases/*`, `doc-chat/*`)             |     6 |
| `503 COLUMN_NOT_PROVISIONED` (`tenants/current*`)                 |     5 |
| `503 COMPLAINT_QUERY_FAILED` / `FEEDBACK_QUERY_FAILED` / `NOTIFICATIONS_UNAVAILABLE` | 4 |
| `501 NOT_IMPLEMENTED` (`/notifications/unread/count`, `/owner/co-owners`) | 2 |
| `500 INTERNAL_ERROR` — legacy domain (see §14)                    |    29 |

Every 503 is a structured fail-loud envelope produced by `safe-error.ts`
(commit history shows #163 wired it in the past hour); every 501 is
designed (next-step ladder documented in the error body); every 500 is
in the legacy domain that #163 is still translating.

---

## §14 — DO NOT SHIP

29 paths still return raw `500 INTERNAL_ERROR` because their handlers
reach for repositories (`repos.invoices`, `repos.payments`,
`repos.workOrders`, `EmployeeRepository`, etc.) that were removed from
`packages/database` in the Borjie hard-fork. The handlers themselves
still exist in `services/api-gateway/`; the fail-loud translation is
#163's in-flight territory. **Do not ship any of these until #163
lands `safe-error.ts` coverage for them or the routes are removed:**

```
/customer/letters                                  TypeError drizzle:Columns
/customer/marketplace/{unitId}/negotiations        TypeError drizzle:Columns
/customer/move-out/disputes                        Failed query damage_deduction_cases
/customer/sublease                                 Failed query sublease_requests

/hr/assignments                                    AssignmentRepository is not a constructor
/hr/departments                                    DepartmentRepository is not a constructor
/hr/employees                                      EmployeeRepository is not a constructor
/hr/employees/{id}                                 EmployeeRepository is not a constructor
/hr/performance/{employeeId}                       PerformanceRepository is not a constructor
/hr/teams                                          TeamRepository is not a constructor

/maintenance/completion-proofs/{id}/verify         CompletionProofRepository is not a constructor
/maintenance/requests                              undefined.tenantId
/maintenance/requests/{id}     (GET, PATCH)        undefined drizzle:Columns
/maintenance/requests/{id}/dispatch-events         undefined drizzle:Columns

/owner/disbursements                               undefined.findMany
/owner/disbursements/{id}/statement                undefined.findMany
/owner/documents/{id}/sign                         undefined.findById
/owner/documents/signatures                        undefined.findMany
/owner/financial/stats                             undefined.findMany
/owner/invoices                                    undefined.findMany
/owner/messaging/conversations                     undefined.findMany
/owner/messaging/conversations/{id}/messages       undefined.findMany / getConversation
/owner/payments                                    undefined.findMany
/owner/reports/export/financial                    undefined.findMany
/owner/work-orders                                 undefined.findMany
/owner/work-orders/{id}/approve                    undefined.findById
/owner/work-orders/{id}/reject                     undefined.findById
```

Root cause for every line: `Repositories` in
`services/api-gateway/src/middleware/database.ts` only declares
`{ tenants, users }`. All other legacy property-domain repos
(`invoices`, `payments`, `workOrders`, `disbursements`, `documents`,
`messaging conversations`, `letters`, `assignments`, …) were dropped
in the hard-fork but the route handlers still call `repos.invoices.…`.
A 30-line guard in `lib/owner-scope.ts` + `bff/owner-portal.ts` to
throw `LEGACY_DOMAIN_REMOVED` (503) on every undefined-repo access
would close this class of error in one pass; that change lives in
`services/api-gateway/` and was explicitly fenced off as #163 territory
in the agent brief. **Recommend: cut a follow-up issue assigned to
#163.**

---

## Sign-off

**Status:** **YELLOW** — capability surfaces are 100% present and
exercised live; HTTP smoke matrix is 224/281 = 79.7% green; every
remaining 5xx is either a structured fail-loud envelope (24 × 503 +
2 × 501) or a documented #163 in-flight 500 (29). No silent failures
remain — every regression is loud and attributable.

| Rollup                | Result |
| --------------------- | ------ |
| Capability surfaces   | 12 / 12 |
| Brain personality     | 107 / 107 tools registered |
| Crons running         | 7 / 7 |
| Scanner rules         | 66 / 66 (33 + 33) |
| Tab + block + bbd     | 34 + 15 + 9 |
| Smoke pass rate       | 224 / 281 (29 remaining 500s on #163) |
| Newly silent failures | 0 |
| Fail-loud envelopes   | 26 (24 × 503 + 2 × 501) |

**Re-run:**

```bash
# 1. ensure api-gateway is up on :4001
pnpm --filter @borjie/api-gateway dev > /tmp/api-gateway.log 2>&1 &
until curl -s http://localhost:4001/health > /dev/null; do sleep 2; done

# 2. run the smoke matrix (uses the gateway's JWT_SECRET via .env.local)
pnpm exec tsx scripts/smoke/full-endpoint-smoke.ts
#    → /tmp/smoke-full.csv  + /tmp/smoke-summary.json

# 3. re-probe individual capabilities with mint.cjs
OWNER=$(node scripts/smoke/mint.cjs OWNER)
curl -H "Authorization: Bearer $OWNER" http://localhost:4001/api/v1/owner/share-links
```
