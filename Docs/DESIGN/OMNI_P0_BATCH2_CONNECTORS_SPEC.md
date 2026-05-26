# OMNI Phase 0 — Batch 2 Connectors (WhatsApp / Notion / Google Drive)

> "Three connector packages. WhatsApp for the village, Notion for the
> knowledge graph, Drive for every gdoc the founder ever wrote. All
> three behind the same ingest substrate Mr. Mwikila already speaks." —
> Founder, OMNI-P0 wave plan.

Status: SPEC — Wave **OMNI-P0-BATCH-2**.
Owner: `packages/connectors/whatsapp/`, `packages/connectors/notion/`,
`packages/connectors/google-drive/`.
Sibling: Wave **OMNI-P0-BATCH-1** (Slack / Email / Calendar) ships
migration `0042`. This batch ships migration `0043` and the three
provider-specific tables described below. `connector_credentials` and
`connector_cursors` are owned by Batch 1 (migration 0042); this batch
references them and never redeclares.

Cross-spec: `packages/omnidata/src/index.ts` (Wave 18CC source-kind
catalogue + ingestion ports). `packages/cognitive-memory/src/index.ts`
is the downstream consumer of every ingested item.

---

## 1. Why these three sources, now

The OMNI Phase-0 vision is simple: every external surface the Borjie
estate touches should land in the cognitive memory the same way an
internal kernel turn does — typed, redacted, audit-stamped, idempotent,
RLS-scoped. Phase 0 picks the six highest-value sources and ships them
in two batches of three. Batch 1 wires the comms+calendar stack
(Slack, Gmail/Outlook, Google/Outlook calendar). Batch 2 wires the
remaining three Phase-0 sources Mr. Mwikila already talks to every
day:

- **WhatsApp Business Cloud** — every Tanzanian counterparty (vendors,
  Tumemadini officers, drivers, contracted geologists, village leaders)
  pings the company WhatsApp first. The founder reads it on the phone;
  Mr. Mwikila must read it in the kernel.
- **Notion** — the founder's working second brain. Specs, contracts,
  meeting notes, partner SOWs. Notion pages are the canonical
  knowledge graph the company already has — the cognitive memory layer
  should treat Notion blocks as first-class memory cells.
- **Google Drive** — the receipt of record. PDFs of licences, scanned
  bank statements, gsheet rosters, gdocs of the latest five-year plan.
  Drive is where artefacts settle once they outgrow Notion.

Each connector lives in its own package so the upstream-quirk surface
(WhatsApp webhook verification, Notion search pagination, Drive change
feed tokens) stays isolated from the others and from the orchestrator.
All three implement `OmnidataConnector` from
`@borjie/omnidata` so the registry / scheduler / audit-chain code
already in production stays untouched.

---

## 2. Package shape (identical for all three)

Each of the three packages ships:

```
packages/connectors/<provider>/
├── package.json                    @borjie/connector-<provider>
├── tsconfig.json                   extends ../../../tsconfig.base.json
├── vitest.config.ts
└── src/
    ├── index.ts                    barrel
    ├── types.ts                    provider-specific domain types
    ├── auth/
    │   ├── oauth.ts                provider-specific OAuth/setup
    │   └── token-refresh.ts        refresh + bytea-encrypted store stub
    ├── client/
    │   └── http-client.ts          thin HTTP wrapper over injected fetcher
    ├── ingest/
    │   ├── poller.ts               cursor-based polling
    │   ├── webhook-receiver.ts     (WhatsApp only — Notion+Drive stub)
    │   └── normalizer.ts           upstream → canonical OmnidataIngestedItem
    ├── redact/
    │   └── pii-redactor.ts         salted sha256(tenant_id:field_id:value)
    ├── extract/
    │   └── text-extractor.ts       (Drive only — gdoc/sheet/slide export)
    ├── repositories/
    │   ├── in-memory.ts            reference repository
    │   └── sql.ts                  Drizzle-backed repository (stub)
    └── __tests__/                  ≥ 6 tests per package
```

All external HTTP runs through an injected `fetcher` port so the live-
test discipline holds; tests never touch the network.

---

## 3. WhatsApp Business Cloud API

### 3.1 Auth

WhatsApp Business Cloud uses **System User tokens** issued from the
Meta Business Manager. The token never expires unless rotated; there
is no refresh-token flow. The connector therefore stores the token
encrypted-at-rest (`bytea` in `connector_credentials.access_token`,
sealed with a tenant-bound DEK) and surfaces a token-rotation hook
the operator triggers manually. The `phone_number_id` and `waba_id`
(WhatsApp Business Account id) live in the same row as `metadata`.

Reference:
- Meta — "Get Started with Cloud API"
  (https://developers.facebook.com/docs/whatsapp/cloud-api/get-started),
  visited 2026-05-26.

### 3.2 Webhook vs poll

Inbound messages arrive via **webhook**, not polling. Meta POSTs to
the configured callback URL with a signed payload; the connector
verifies the `X-Hub-Signature-256` header (HMAC-SHA256 of the raw
request body, keyed with the `App Secret`). Two flows:

- **Realtime path** — `webhook-receiver.ts` validates the signature,
  normalises the inbound message, persists into `whatsapp_messages`
  with `direction='inbound'`, and emits an `OmnidataIngestedItem`.
- **Reconciliation path** — `poller.ts` runs every 6h, walks recent
  conversations via the WhatsApp Business Cloud API
  `/messages` endpoint (only available for outbound history), and
  fills any gaps the webhook missed (e.g. delivery outages). The
  poll cursor is stored in `connector_cursors`.

Reference:
- Meta — "Cloud API Webhooks Reference"
  (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks),
  visited 2026-05-26.

### 3.3 Dedup, rate-limit, PII

- Dedup key: `(tenant_id, waba_id, wa_message_id)` UNIQUE in
  `whatsapp_messages`. Replays from Meta (which retry up to 7 days)
  are no-ops.
- Rate limit: Cloud API enforces a per-phone-number-id messaging tier
  (Tier 1 / 10 / 100K, increased automatically). The connector
  respects the 80% safety margin and emits `rate-limited` with
  `retryAfterMs` derived from the `Retry-After` header on 429.
- PII: phone numbers, names, contact-card fields, message bodies are
  all redacted via `sha256(tenantId + ':' + fieldPath + ':' + value)`
  with a tenant-scoped salt. The hash list is returned in
  `redaction_applied`. Raw upstream JSON is retained in the `raw`
  column for legal hold; access is RLS-scoped.

### 3.4 Attachments

Media URLs in inbound payloads are short-lived (~5 min). The
connector resolves the URL to bytes through the
`/media/{media_id}` endpoint, stores the binary in the canonical
object store (port; default in-memory), and replaces the URL with the
internal asset id in `media` JSON.

### 3.5 Error retry

Retries are exponential-backoff (max 5 attempts, jitter, cap 60s)
on transport-error and 5xx. 4xx other than 429 fail fast.

---

## 4. Notion

### 4.1 Auth

Notion uses a **public OAuth 2.0** flow. The connector receives the
`access_token` (no expiry as of 2026 — Notion treats the token as a
long-lived bearer credential) plus the `workspace_id`,
`workspace_icon`, `workspace_name`, and `bot_id`. Token is stored
encrypted-at-rest. The token-refresh port returns the same token
unchanged unless the operator triggers a manual rotation.

Reference:
- Notion — "Authorization"
  (https://developers.notion.com/docs/authorization), visited
  2026-05-26.

### 4.2 Cursor-based poll

Notion publishes a **`/v1/search`** endpoint that supports filtering
by object type (`page` / `database`) and sorting by
`last_edited_time`. The connector polls every 15 min:

1. Fetch pages sorted by `last_edited_time desc`, paginating until
   the cursor (last seen `last_edited_time`) is reached.
2. For each new/updated page, fetch its blocks via
   `/v1/blocks/{block_id}/children` (recursive — Notion blocks are a
   tree). Persist pages into `notion_pages`, blocks into
   `notion_blocks`.
3. Update cursor in `connector_cursors`.

### 4.3 Dedup, rate-limit, PII

- Dedup: `(tenant_id, workspace_id, page_id)` and
  `(tenant_id, workspace_id, block_id)` UNIQUE.
- Rate limit: Notion enforces 3 requests/sec average per integration.
  The HTTP client wraps every call in a token-bucket gate and falls
  back to `rate-limited` on 429.
- PII: title, rich-text properties, person mentions are redacted via
  the same salted-hash scheme. Database property values that look
  like emails / phones get the hash treatment regardless of property
  type.

### 4.4 Block normalization

Notion block kinds (`paragraph`, `heading_*`, `to_do`, `toggle`,
`callout`, `code`, `quote`, `equation`, `table`, `bulleted_list_item`,
`numbered_list_item`, `image`, `video`, `file`, `pdf`, `bookmark`,
`embed`, `divider`, `breadcrumb`, `child_page`, `child_database`,
`synced_block`, `template`, `column_list`, `column`, `link_preview`,
`link_to_page`, `table_of_contents`, `table_row`) collapse into a
small set in the canonical `notion_blocks.kind` column:
`text | heading | list | quote | code | image | file | embed | structural`.

### 4.5 Comments

Notion comments live on blocks. The connector ingests them via
`/v1/comments?block_id=` and stores them as additional `notion_blocks`
rows with `kind='comment'`, parent pointing at the host block.

Reference:
- Notion — "Working with comments"
  (https://developers.notion.com/docs/working-with-comments), visited
  2026-05-26.

### 4.6 Error retry

Identical exp-backoff schedule to WhatsApp.

---

## 5. Google Drive

### 5.1 Auth

Google Drive uses **OAuth 2.0** with the
`https://www.googleapis.com/auth/drive.readonly`,
`drive.metadata.readonly`, and `drive.activity.readonly` scopes.
Tokens carry a 1-hour `expires_in`; the connector refreshes 5 min
ahead of expiry through `oauth2.googleapis.com/token`.

Reference:
- Google — "OAuth 2.0 for Web Server Applications"
  (https://developers.google.com/identity/protocols/oauth2/web-server),
  visited 2026-05-26.
- Google — "Drive API v3 — Authentication and authorization"
  (https://developers.google.com/workspace/drive/api/guides/about-auth),
  visited 2026-05-26.

### 5.2 Change feed

Drive exposes a **changes feed** at `/v3/changes`. The connector
follows this canonical pattern:

1. On first sync, call `/v3/changes/startPageToken`, store the token
   in `connector_cursors`.
2. On every subsequent sync (every 5 min), call
   `/v3/changes?pageToken={token}` with `includeItemsFromAllDrives=true`
   and `supportsAllDrives=true`. Paginate.
3. For each changed file, fetch metadata via `/v3/files/{fileId}`
   and (for native gdocs/gsheets/gslides) the exported plain text
   via `/v3/files/{fileId}/export?mimeType=text/plain`.
4. Persist into `drive_files`. Update cursor.

Reference:
- Google — "Drive API — Track changes for users"
  (https://developers.google.com/workspace/drive/api/guides/manage-changes),
  visited 2026-05-26.

### 5.3 Dedup, rate-limit, PII

- Dedup: `(tenant_id, account, file_id)` UNIQUE. Drive `fileId` is
  stable across renames.
- Rate limit: Drive enforces a per-user 1,000 requests / 100s quota.
  The HTTP client gates at 800/100s and emits `rate-limited` on 429.
- PII: file owners, last-modifying-user, sharing-permission emails are
  redacted via the salted-hash scheme.

### 5.4 Extracted text

For **native Google formats** (`application/vnd.google-apps.document`,
`application/vnd.google-apps.spreadsheet`,
`application/vnd.google-apps.presentation`), the connector calls
`/v3/files/{fileId}/export?mimeType=text/plain` and stores the result
in `drive_files.extracted_text`. For other mime types (PDF, docx,
images), `extracted_text` is `null` — the file-ingest pipeline
(`packages/file-ingest`) handles those out-of-band.

Reference:
- Google — "Drive API — Export Google Workspace documents"
  (https://developers.google.com/workspace/drive/api/guides/manage-downloads#export),
  visited 2026-05-26.

### 5.5 Comments

Drive comments live at `/v3/files/{fileId}/comments`. The connector
fetches them and persists into `drive_files.raw->>'comments'` (jsonb
array). A future migration will lift them into a dedicated table once
volume warrants.

### 5.6 Error retry

Identical exp-backoff schedule. Token-refresh failures are escalated
to `auth-failed` immediately.

---

## 6. Migration 0043 — schema overview

Migration `0043_omni_p0_batch2.sql` creates **four** new tables:

- `whatsapp_messages` — inbound + outbound message ledger.
- `notion_pages` — page metadata + property bag.
- `notion_blocks` — recursive block tree (incl. comments).
- `drive_files` — file metadata + extracted text.

Every table is tenant-scoped, RLS-policied via
`current_setting('app.tenant_id', true)`, idempotent (`IF NOT EXISTS`),
and stamped with `audit_hash` for cross-walk into the
`@borjie/audit-hash-chain`.

Connector credential rows live in `connector_credentials` and cursors
in `connector_cursors`, both owned by Batch 1's migration `0042`. This
migration's comment declares that dependency:

```sql
-- Uses connector_credentials, connector_cursors from 0042.
```

If `0042` lands after `0043` in CI, the references in the schema
files (which are pure Drizzle type imports) tolerate the order — the
SQL migration itself does not declare a foreign key to those tables
so Postgres applies cleanly regardless of arrival order.

---

## 7. Open questions resolved

- **Why per-package and not one mega-package?** Each provider has its
  own auth quirks, webhook signature scheme, and rate-limit
  semantics. Per-package keeps the upstream code surface honest and
  lets us version-bump (or kill) one without touching the others.
- **Why `connector_credentials` shared and not per-provider?** One
  row per `(tenant_id, provider)` is the natural shape. The shared
  table also gives the orchestrator a single index for "every
  connector this tenant has configured."
- **Why salted-hash PII redaction instead of envelope encryption?**
  The cognitive-memory layer needs to **deduplicate** semantically
  identical mentions across sources (e.g. the same vendor in Notion
  and Drive). Deterministic salted hashing preserves that property;
  envelope encryption would not.
- **Why webhook + reconciliation poll for WhatsApp?** Meta's
  webhook delivery is best-effort. The 6h reconciliation poll is the
  belt-and-braces guarantee that no message is silently lost.

---

## 8. Live-test discipline

- No real HTTP from tests. Every provider client takes an injected
  `fetcher: (req: Request) => Promise<Response>` port. Tests pass
  a deterministic stub.
- The webhook-signature test for WhatsApp uses a **real HMAC-SHA256**
  computed over a fixture body — no mocking of `crypto`.
- The token-refresh test for Notion + Drive verifies the connector
  rotates the encrypted-at-rest blob in the credential store on
  success and surfaces `auth-failed` on refresh rejection.

---

## 9. Persona

Every log line uses persona "**Mr. Mwikila**" so structured logs across
the platform attribute ingest activity to the unified persona. No
provider-specific persona overrides.

---

## 10. Consent, audit, and downstream wiring

Every ingest run flows through the existing
`@borjie/omnidata` substrate, which means:

- **Consent.** WhatsApp uses `ConsentScope.kind = 'per-user-dm'`
  (one row per village counterparty), Notion uses
  `ConsentScope.kind = 'workspace'`, and Google Drive uses
  `ConsentScope.kind = 'folder'`. The orchestrator refuses to invoke
  `sync` if the consent registry returns `granted=false`. Operators
  grant consent through the omnidata install UI shipped in Wave 18CC.
- **Audit hash chain.** Every persisted row carries an `audit_hash`
  column computed by `@borjie/audit-hash-chain` over the canonical
  payload + `tenant_id`. The orchestrator appends the matching link
  to `ai_audit_chain` before commit; a discrepancy between the
  in-row hash and the chain hash trips the wave-resilience manager.
- **Provenance stamping.** Each `OmnidataIngestedItem` carries
  `source_kind`, `source_record_id`, `retrieved_at`, and the
  `redaction_applied` field list. Downstream consumers (cognitive
  memory `observe`, deep-research router, briefing composer) all
  read those fields to attribute citations back to the canonical
  upstream.
- **Cognitive-memory observation.** A small companion adapter (lands
  in a follow-up wave, not in this batch) maps each ingested item to
  a `CognitiveMemoryCell` via `createObserve` from
  `@borjie/cognitive-memory`. The mapping is one-to-one for WhatsApp
  messages and Notion blocks, and one-to-many for Drive files (one
  cell per ~512-token chunk of `extracted_text`).

---

## 11. Failure modes the spec explicitly accepts

- **WhatsApp webhook outage.** Up to 6 hours of inbound messages may
  surface only via reconciliation poll. Recovered messages are
  flagged `raw->>'meta'->>'recovered_via'='reconciliation'` so
  downstream analytics can adjust latency expectations.
- **Notion block-tree depth.** The block fetcher caps recursion at 20
  levels. Pages with deeper trees emit `upstream-error` with
  `status=507` (Insufficient Storage) and surface a structured log
  line — extremely rare in practice.
- **Drive change-token expiry.** Drive change tokens expire after
  ~7 days of inactivity. On `404 Not Found` from `/v3/changes` the
  connector resets the cursor via `/v3/changes/startPageToken`,
  emits a structured warning, and proceeds with a full re-scan.

---

## 12. Provenance + observability tags

Every structured log emitted by these connectors carries:

- `connector: 'whatsapp' | 'notion' | 'google-drive'`
- `tenantId: <hashed>`
- `correlationId: <uuid>`
- `persona: 'Mr. Mwikila'`
- `phase: 'P0'`
- `wave: 'OMNI-P0-BATCH-2'`

Pino redaction paths cover `accessToken`, `refreshToken`,
`appSecret`, `webhookSecret`, plus the wildcard `*.token` /
`*.secret` paths. This matches the project-wide policy in
`packages/observability/src/logging/logger.ts`.

---

## 13. References (consolidated)

1. Meta — "Get Started with Cloud API",
   https://developers.facebook.com/docs/whatsapp/cloud-api/get-started,
   visited 2026-05-26.
2. Meta — "Cloud API Webhooks Reference",
   https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks,
   visited 2026-05-26.
3. Meta — "Sample app secret signature",
   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#payload,
   visited 2026-05-26.
4. Notion — "Authorization",
   https://developers.notion.com/docs/authorization, visited
   2026-05-26.
5. Notion — "Working with comments",
   https://developers.notion.com/docs/working-with-comments, visited
   2026-05-26.
6. Notion — "Search",
   https://developers.notion.com/reference/post-search, visited
   2026-05-26.
7. Google — "OAuth 2.0 for Web Server Applications",
   https://developers.google.com/identity/protocols/oauth2/web-server,
   visited 2026-05-26.
8. Google — "Drive API v3 — Authentication and authorization",
   https://developers.google.com/workspace/drive/api/guides/about-auth,
   visited 2026-05-26.
9. Google — "Drive API — Track changes for users",
   https://developers.google.com/workspace/drive/api/guides/manage-changes,
   visited 2026-05-26.
10. Google — "Drive API — Export Google Workspace documents",
    https://developers.google.com/workspace/drive/api/guides/manage-downloads#export,
    visited 2026-05-26.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
