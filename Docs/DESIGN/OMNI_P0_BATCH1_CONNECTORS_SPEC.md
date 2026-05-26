# Omnidata P0 — Batch 1: Slack + Email + Calendar Connectors

> **Status**: design-locked
> **Wave**: OMNI-P0-BATCH-1
> **Owner**: Mr. Mwikila platform team
> **Companion packages**: `@borjie/connector-slack`, `@borjie/connector-email`, `@borjie/connector-calendar`
> **Companion migration**: `0042_omni_p0_batch1.sql`
> **Builds on**: `@borjie/omnidata` (Wave 18CC — source-kind catalogue), `@borjie/cognitive-memory` (Wave 18AA — ingest sink)
> **Cross-spec**: `Docs/DESIGN/OMNIDATA_CONNECTOR_INVENTORY.md`

---

## 1. Why this exists

Mr. Mwikila — the autonomous reasoner Borjie ships into the mining
estate operator's chair — works alongside a team that already runs on
three external surfaces: chat (Slack), mail (Gmail + Outlook) and
diaries (Google Calendar + Outlook Calendar). Every artefact that
matters operationally — a permit-window reminder, an extraction-team
status update, a regulator's email — first lands in one of those three
surfaces. If Mr. Mwikila cannot ingest from them, he is a research
demo, not an operating system.

The omnidata layer already declares all three source kinds in the
`OmnidataSourceKind` catalogue (`slack`, `gmail`, `outlook_mail`,
`google_calendar`, `outlook_calendar`) and ships the auth-broker / sync
scheduler / boundary PII redactor / provenance stamper. Wave
OMNI-P0-BATCH-1 lights up three concrete connector packages that bind
to those provider APIs and feed canonical rows into the cognitive
memory substrate via the omnidata ingestion ports.

P0 cadence — meaning we do not wait for the inventory's later phases
(Notion, WhatsApp, Drive, Salesforce …) before turning these three on.
Every estate that hires us will need at least one of the three running
on day one.

## 2. Scope of Batch 1

Three packages, identical shape:

| Package | Source-kinds covered | Auth | Refresh policy |
|---------|---------------------|------|----------------|
| `@borjie/connector-slack` | `slack` | OAuth2 (Slack app install) | Realtime (Events API) + cron backfill |
| `@borjie/connector-email` | `gmail`, `outlook_mail` | OAuth2 (Google + Microsoft) | Pushed (Gmail watch + Graph subscription) + cron backfill |
| `@borjie/connector-calendar` | `google_calendar`, `outlook_calendar` | OAuth2 (Google + Microsoft) | Pushed (Calendar push + Graph subscription) + cron backfill |

Out of scope this wave: webhook subscription registration (manual op
playbook), KMS wiring (production tenants configure their own DEK; the
encryption helper is a port that throws unless wired), per-tenant
admin UI (lives behind the existing data-onboarding wizard).

## 3. Connector contracts

Every package exports a normaliser that maps the provider payload to a
canonical row that the migration tables enforce. The packages keep
external HTTP behind an injected `fetcher` port so tests can run
against synthetic fixtures offline. Production wires the real
`globalThis.fetch`; tests inject a deterministic stub. The fixtures
live in `__tests__/` and are clearly labelled as test-only data — they
are **not** importable from any production path.

### 3.1 Common shape

```
src/
  types.ts                  # connector-specific types
  auth/oauth.ts             # provider OAuth code → token exchange
  auth/token-refresh.ts     # refresh-token handling
  client/<provider>.ts      # thin HTTP client(s) per provider
  ingest/poller.ts          # cursor-based incremental ingest
  ingest/normalizer.ts      # provider payload → canonical row
  redact/pii-redactor.ts    # boundary PII strip / salted hash
  repositories/messages.ts
  repositories/credentials.ts
  repositories/cursors.ts
  index.ts                  # barrel
```

The repositories ship both in-memory and SQL flavours behind the same
port. In-memory is the test default; SQL implementations bind to the
`connector_credentials`, `connector_cursors`, and the connector-
specific table from migration 0042.

### 3.2 Boundary PII redaction

Every connector wraps the canonical-row normaliser with the boundary
PII redactor. The redactor follows the
`packages/session-mirror/src/field-capture/pii-redactor.ts` pattern:
`sha256(tenant_id ':' field_id ':' value)`. The salt is
`tenant_id + field_id`, so the same value in a different tenant or a
different field is unlinkable. Email addresses, phone numbers, NIDA
numbers, KRA PINs and the like are hashed at the boundary; the raw
string never reaches the canonical row. The hashed-vs-clear decision
is per-field, declared in `redact/pii-redactor.ts` per package.

## 4. Per-connector spec

### 4.1 `@borjie/connector-slack`

**Scopes requested** (Slack app install):

`channels:history`, `channels:read`, `groups:history`, `groups:read`,
`im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`,
`reactions:read`, `files:read`, `team:read`.

**Auth flow**: Slack OAuth v2. Slack returns a bot token (`xoxb-…`)
plus optional user token (`xoxp-…`). Bot token is used for nearly all
reads; user token is only used when the install user asks for DM
inclusion. Tokens are stored encrypted in `connector_credentials`.

**Polling vs webhook**: Realtime via the Slack Events API
(`message`, `reaction_added`, `reaction_removed`, `file_shared`,
`message.channels`, `message.groups`, `message.im`, `message.mpim`).
Cron backfill via `conversations.history` per channel, cursor =
`oldest` timestamp. Backfill runs on first install and once per day
for missed events. Events are HMAC-verified against the signing
secret per Slack's `v0` scheme.

**Dedup key**: `(workspace_id, channel_id, ts)`. Slack timestamps are
microsecond-precision and stable across deliveries.

**Rate-limit handling**: Slack returns `429` with `Retry-After`.
Connector applies the header verbatim; `Retry-After` over 60s yields
back to the scheduler. Backoff is exponential with jitter for
non-`Retry-After` transport errors (3 retries; max 30s).

**PII redaction strategy**: User mentions normalised to `user:U…`
hashes; raw email addresses, phone numbers and Tanzanian NIDA numbers
detected in message text are replaced with salted-sha256 hashes.
Attachments are downloaded once, hashed (sha256 of bytes), and
streamed into MinIO at `slack/{tenantId}/{workspaceId}/{channelId}/
{ts}/{fileName}`. Only the storage URL + content hash leave the
connector boundary.

**Attachment storage path**: `slack/{tenantId}/{workspaceId}/
{channelId}/{ts}/{fileName}`. The MinIO bucket name is read from the
tenant's `connector_credentials.connector_account` field.

**Error retry policy**: Auth-failed → return `auth-failed` result,
let the auth broker schedule a refresh attempt. Upstream-error (5xx)
→ retry 3× with exponential backoff. Transport-error → 1 retry.
After exhaustion, return `transport-error` / `upstream-error` and
surface to the orchestrator. The orchestrator is the only writer to
audit chain on failure.

**Provider docs cited**:
- "Slack Web API methods" — https://api.slack.com/methods — accessed
  2026-05-26.
- "Slack Events API" — https://api.slack.com/apis/connections/events-api — accessed 2026-05-26.
- "Slack OAuth v2 install flow" — https://api.slack.com/authentication/oauth-v2 — accessed 2026-05-26.
- "Slack rate-limit tiers" — https://api.slack.com/docs/rate-limits —
  accessed 2026-05-26.
- "Slack request signing" — https://api.slack.com/authentication/verifying-requests-from-slack — accessed 2026-05-26.

### 4.2 `@borjie/connector-email`

**Scopes requested**:

Gmail: `https://www.googleapis.com/auth/gmail.readonly` (default),
`https://www.googleapis.com/auth/gmail.metadata` (when the tenant
opts into metadata-only mode), `https://www.googleapis.com/auth/gmail.labels`.

Outlook Graph: `Mail.Read`, `Mail.ReadBasic`, `MailboxSettings.Read`,
`User.Read` plus `offline_access`.

**Auth flow**: OAuth2 authorisation-code flow for both providers.
Refresh tokens are stored encrypted; access tokens are refreshed on
demand by `auth/token-refresh.ts`. Google's refresh tokens may rotate
on refresh — the connector replaces both tokens after refresh.

**Polling vs webhook**: Pushed.
- Gmail: `users.watch` registers a Cloud Pub/Sub topic; events arrive
  as `historyId` deltas. The connector uses `users.history.list` to
  diff against the stored `historyId` cursor.
- Outlook: Graph subscriptions to `/me/mailFolders('Inbox')/messages`
  with a renewal cron (Graph subscriptions expire after 3 days).
  Events arrive as `subscription` deliveries; the connector
  acknowledges with the validation token.

Cron backfill via Gmail `users.messages.list` or Graph
`/me/messages` with `$delta` cursor — runs on first install and once
per day. Both providers paginate by token; the connector stores the
last cursor in `connector_cursors`.

**Label scoping**: Each tenant declares a label set on install
(`label:Borjie`, `label:Mining`, `label:Permits`, etc.). The
connector filters with Gmail's `q=label:Borjie` and Outlook's
`$filter=categories/any(c:c eq 'Borjie')`. Only matching messages
reach the canonical row.

**Dedup key**: `(provider, account, message_id)`. Provider message
IDs are stable across replays.

**Rate-limit handling**:
- Gmail: `429` / `userRateLimitExceeded` → exponential backoff with
  jitter, max 5 retries, max wait 60s.
- Outlook: `429` with `Retry-After` header — honoured verbatim;
  `503` with `Retry-After` — honoured.

**PII redaction strategy**: `from_addr`, `to_addrs`, `cc_addrs`,
`bcc_addrs` are hashed via the salted-sha256 redactor. Subject and
body text pass through a value-pattern redactor that finds and
hashes embedded emails, phone numbers, NIDA numbers, KRA PINs,
IBANs, M-Pesa transaction codes. Body HTML is sanitised to strip
remote-content beacons before persistence.

**Attachment storage path**: `email/{tenantId}/{provider}/
{account}/{messageId}/{attachmentName}`. Sha256 content hash and
MinIO key land in the `attachments` jsonb column.

**Error retry policy**: same shape as Slack — auth-failed → return
to broker, upstream/transport → exponential retry. Connector never
deletes messages on the provider side; ingest is strictly read-only.

**Provider docs cited**:
- "Gmail API Users.messages: list" — https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list — accessed 2026-05-26.
- "Gmail push notifications" — https://developers.google.com/workspace/gmail/api/guides/push — accessed 2026-05-26.
- "Gmail API quotas + limits" — https://developers.google.com/workspace/gmail/api/reference/quota — accessed 2026-05-26.
- "Microsoft Graph mail overview" — https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview — accessed 2026-05-26.
- "Microsoft Graph change notifications" — https://learn.microsoft.com/en-us/graph/change-notifications-overview — accessed 2026-05-26.
- "Microsoft Graph throttling" — https://learn.microsoft.com/en-us/graph/throttling — accessed 2026-05-26.

### 4.3 `@borjie/connector-calendar`

**Scopes requested**:

Google Calendar: `https://www.googleapis.com/auth/calendar.readonly`
plus `https://www.googleapis.com/auth/calendar.events.readonly` for
event detail and `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.

Outlook Calendar via Graph: `Calendars.Read`, `Calendars.Read.Shared`,
`User.Read`, `offline_access`.

**Auth flow**: OAuth2 authorisation-code flow, identical structure to
the email connector. The shared `auth/oauth.ts` and
`auth/token-refresh.ts` modules differ only in scope strings and the
provider's token endpoint.

**Polling vs webhook**: Pushed.
- Google Calendar: `events.watch` registers a webhook channel with a
  TTL (max 30 days for primary calendar). The connector renews the
  channel on a cron 24h before expiry. Events arrive with a `sync`
  resourceState and a `nextSyncToken` — the connector follows up with
  `events.list?syncToken=…` to diff.
- Outlook Calendar: Graph subscriptions to `/me/calendars/{id}/events`
  with the same renewal cadence as the mail subscription.

Cron backfill via `events.list?timeMin=now-30d` (Google) /
`/me/calendars/{id}/calendarView` (Graph) on first install and once
per day.

**Dedup key**: `(provider, account, calendar_id, event_id)`. Recurring
events: each instance is normalised separately with its
`originalStartTime` baked into `event_id` to keep dedup stable across
edits.

**Rate-limit handling**:
- Google Calendar: `403` with `userRateLimitExceeded` →
  exponential backoff. `429` → `Retry-After`.
- Outlook: same as Outlook Mail (`429` + `Retry-After`).

**PII redaction strategy**: Attendee email addresses hashed via the
salted-sha256 redactor. Event title and description pass through the
value-pattern redactor. Location is preserved (operational signal —
we want to know which mine site a meeting is at), but free-text
joined-call URLs are sanitised to remove embedded auth tokens.

**Attachment storage path**: Calendar events occasionally carry
attached files (Google `attachments[]`, Graph `attachments` collection).
Same MinIO pattern as email — `calendar/{tenantId}/{provider}/
{account}/{calendarId}/{eventId}/{attachmentName}`.

**Error retry policy**: identical to Slack and email — auth-failed
returned to broker, upstream/transport with exponential retry. Sync-
token reset (Google `410 Gone`) triggers a full backfill on next run;
the connector logs a `sync-token-reset` audit row.

**Provider docs cited**:
- "Google Calendar API: events.list" — https://developers.google.com/calendar/api/v3/reference/events/list — accessed 2026-05-26.
- "Google Calendar API: events.watch (push)" — https://developers.google.com/calendar/api/guides/push — accessed 2026-05-26.
- "Google Calendar API: sync tokens" — https://developers.google.com/calendar/api/guides/sync — accessed 2026-05-26.
- "Microsoft Graph calendar overview" — https://learn.microsoft.com/en-us/graph/api/resources/calendar — accessed 2026-05-26.
- "Microsoft Graph: subscribe to calendar events" — https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions — accessed 2026-05-26.

## 5. Persistence layer

Migration `0042_omni_p0_batch1.sql` adds five tenant-scoped tables:

- `connector_credentials` — per-tenant per-account OAuth state.
  Tokens are `bytea`, written only after passing through the host-
  wired encryption helper. The column comment marks them as
  encrypted-at-rest; the migration ENABLE ROW LEVEL SECURITY with the
  standard `app.tenant_id` GUC predicate.
- `connector_cursors` — per `(tenant_id, connector_kind, account)`
  cursor for the incremental poller. Primary key on the triple.
- `slack_messages` — canonical Slack row with `UNIQUE(tenant_id,
  workspace_id, channel_id, ts)` for idempotent ingest.
- `email_messages` — canonical Gmail + Outlook mail row with
  `UNIQUE(tenant_id, provider, account, message_id)`.
- `calendar_events` — canonical Google + Outlook calendar event row
  with `UNIQUE(tenant_id, provider, account, calendar_id, event_id)`.

Every table carries `audit_hash text NOT NULL` for the audit chain
linkage. Every table is RLS-protected. The migration is idempotent —
all `CREATE TABLE … IF NOT EXISTS`, all constraints guarded by `DO`
blocks, all `DROP POLICY IF EXISTS` before re-create.

## 6. Encryption-at-rest port

`connector_credentials.access_token_enc` and `refresh_token_enc` are
`bytea`. The connector packages depend on an injected
`CredentialCipher` port:

```ts
export interface CredentialCipher {
  readonly seal: (plaintext: string) => Promise<Uint8Array>;
  readonly open: (ciphertext: Uint8Array) => Promise<string>;
}
```

The production wiring binds this to a KMS-backed AES-GCM helper
(tenant-bound DEK). For local dev and tests, the connector ships a
stub cipher that throws on `seal` unless explicitly opted-in — never
silently storing tokens in plaintext. CI live-test environments wire
a sealed test KEK; unit tests inject the in-memory cipher with a
clearly named `dev-only` flag.

## 7. Observability

Every connector uses `createLogger` from `@borjie/observability` with
a full `TelemetryConfig`: service name, version, environment, log
level, redact fields (always include `access_token`, `refresh_token`,
`authorization`, `Bearer`, `cookie`). The package never `console.log`s
— the lint rule enforces it.

Each sync emits structured log lines:
- `connector.sync.start` — connector_kind, account, since
- `connector.sync.batch` — items, next_cursor, latency_ms
- `connector.sync.end` — items_total, status (`ok` /
  `rate-limited` / `auth-failed` / `upstream-error` /
  `transport-error`)
- `connector.attachment.stored` — storage_key, content_hash

## 8. Failure modes

| Mode | Detection | Action |
|------|-----------|--------|
| Refresh token revoked | 400 invalid_grant | Return `auth-failed`; broker notifies the tenant admin |
| Rate limited | 429 with Retry-After | Honour header; if > 60s, defer to next scheduler tick |
| Channel removed (Slack) | 404 channel_not_found | Mark cursor stale, log audit row, continue with next channel |
| Sync-token reset (Google Calendar) | 410 Gone | Reset cursor → full backfill |
| Mailbox label deleted | 404 / 412 | Log audit row, mark connector unconfigured |
| Provider downtime | 5xx persistent | Exponential backoff; after 5 retries, return `upstream-error` |

## 9. Test plan

Each connector package ships ≥ 6 tests:

1. OAuth flow — code → tokens via injected fetcher fixture.
2. Token refresh — expiry threshold + rotation handling.
3. Normaliser — provider payload → canonical row golden test.
4. Cursor dedup — re-running poller with same cursor yields zero new
   items.
5. PII redactor — embedded email + phone hashed; raw never leaves
   boundary.
6. Repository — in-memory put / get round-trip.

The fixtures live under `src/__tests__/fixtures/` and carry a header
comment marking them as test-only data, never imported from
production paths. Live-test discipline is preserved: no live network
calls during `pnpm test`.

## 10. Non-goals

- We do **not** ship a UI for OAuth install in this wave; tenants
  configure via the existing data-onboarding wizard.
- We do **not** write to Slack / email / calendar — ingest only.
- We do **not** decrypt attachments (PDFs, docs); they live in MinIO
  for downstream document-analysis to pick up.
- We do **not** index into the embedding store directly — the
  cognitive-memory `observe` operation is the only write path.

## 11. Open questions

- How does the data-onboarding wizard route the user through the
  Microsoft tenant-admin consent screen? Tracked in
  `Docs/DESIGN/DATA_ONBOARDING_SPEC.md` (#admin-consent).
- Slack Enterprise Grid orgs surface multiple workspaces under one
  install. Batch 2 will fan-out per workspace; Batch 1 ingests only
  the install workspace.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
