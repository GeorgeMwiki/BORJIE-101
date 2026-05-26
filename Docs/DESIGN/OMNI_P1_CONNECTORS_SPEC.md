# OMNI-P1 — Nine Enterprise Connectors

Wave: OMNI-P1
Owner: Mr. Mwikila (single human principal)
Status: SPEC
Date: 2026-05-26
Cross-spec: `Docs/DESIGN/OMNIDATA_CONNECTOR_INVENTORY.md`, OMNI-P0 (Slack + Email)

## 1. Mission

Borjie is the AI-operated mining estate-management OS for Mr. Mwikila. OMNI-P0 (Slack + Email) gave Mr. Mwikila a window into two communication surfaces. OMNI-P1 expands that window across nine enterprise-class systems that together describe a modern mining business end-to-end:

1. **Salesforce** — accounts, opportunities, contacts, cases.
2. **HubSpot** — contacts, deals, tickets, marketing emails.
3. **Linear** — issues, projects, cycles, comments.
4. **Jira** — issues, epics, sprints, worklogs.
5. **GitHub** — repos, pull requests, issues, releases.
6. **GitLab** — projects, merge requests, issues, pipelines.
7. **Microsoft Teams** — channels, messages, meetings.
8. **Zoom** — meetings, recordings, transcripts.
9. **Twilio Voice** — inbound IVR, outbound notifications, call recordings.

Each connector lives in its own workspace package `packages/connectors/{name}/`, mirrors the OMNI-P0 (`slack` / `email`) shape, and conforms to the `OmnidataConnector<TPayload>` contract from `@borjie/omnidata`.

The Twilio Voice connector intentionally **shares env infrastructure** with the existing `services/wave-resilience-manager` SMS notifier (which uses `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`) but **partitions traffic** by requiring a distinct Twilio sub-account (`TWILIO_VOICE_SUBACCOUNT_SID`) so the per-second voice TPS and per-minute call cost is metered separately from SMS.

## 2. Architectural Invariants

All nine connectors share the same shape so Mr. Mwikila — and the kernel — only learn the pattern once.

- `src/types.ts` — provider-shaped payloads + the connector-local config interface.
- `src/auth/oauth.ts` — OAuth2 authorization-code / client-credentials flows where applicable; Twilio Voice uses Account-SID + Auth-Token basic auth.
- `src/auth/token-refresh.ts` — implements the `OAuth2Refresher` port from `@borjie/omnidata`. Tokens stored encrypted-at-rest via injected `EncryptedStoragePort` stub.
- `src/client/*.ts` — thin HTTP client(s) using an injected `fetcher` port. No global `fetch`. Live tests only — unit tests inject deterministic fakes.
- `src/ingest/poller.ts` — cron-driven sync. Maintains a cursor (last-modified watermark) per `(tenant_id, account, entity_kind)` using the `connector_cursors` table from migration 0042 (referenced; never redeclared).
- `src/ingest/webhook-receiver.ts` — where the provider supports webhooks. Signature verification is mandatory; replay window is provider-specific.
- `src/ingest/normalizer.ts` — raw provider response → canonical `OmnidataIngestedItem<TPayload>` shape.
- `src/redact/pii-redactor.ts` — **salted-hash** redactor: PII values (email, phone, NIDA, TIN, payroll IDs) are replaced with `sha256(salt || value)` so downstream joins / dedup work without leaking the cleartext. Salt is per-tenant, sourced via an injected `SaltProvider` port.
- `src/repositories/*.ts` — in-memory (deterministic tests) + SQL (Postgres) repositories with identical interfaces (`Repository<T>` pattern).
- `src/index.ts` — barrel.

TypeScript strict ON, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. No `@ts-nocheck`. No global state. `createLogger` constructed with a full `TelemetryConfig` (`service`, `level`, `redactFields`, `baseContext`) per LITFIN logging discipline.

## 3. Per-Connector Specs

### 3.1 Salesforce

- **Auth flow**: OAuth 2.0 Web Server Flow with refresh tokens (`https://login.salesforce.com/services/oauth2/authorize`, `…/token`).
- **Scopes**: `api refresh_token offline_access` — the minimum needed to read SObjects and stay alive across the 4-hour access-token lifetime.
- **Polling vs webhook**: **Polling**. Salesforce supports outbound messages and platform events, but the configuration surface (workflow rules, Apex triggers) is out of scope for v1. We use the REST `/services/data/vXX.0/queryAll/?q=SELECT … WHERE LastModifiedDate > :since ORDER BY LastModifiedDate ASC LIMIT 1000` SOQL cursor.
- **Dedup key**: `(tenant_id, account, sobject_type, sobject_id)`.
- **Cursor**: `LastModifiedDate` ISO timestamp watermark per `(account, sobject_type)`.
- **Rate-limit**: 100,000 API calls per 24h per org by default. The connector throttles to 5 req/sec and surfaces 429 with `Retry-After` from the Sforce-Limit-Info header.
- **PII redaction**: `Email`, `Phone`, `MobilePhone`, `MailingStreet`, `Description` (free-text) → salted hash. `Name` is **kept** (Mr. Mwikila needs to recognise account names).
- **Retry**: 3 attempts, exponential backoff 1s / 2s / 4s with 10% jitter. Idempotent on `LastModifiedDate` cursor.
- **Docs cited**: 
  - Salesforce, *OAuth 2.0 Web Server Flow for Web App Integration* — `https://help.salesforce.com/s/articleView?id=sf.remoteaccess_oauth_web_server_flow.htm` (retrieved 2026-05-26).
  - Salesforce, *REST API Developer Guide — Query API* — `https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_query.htm` (retrieved 2026-05-26).
  - Salesforce, *Rate Limits* — `https://developer.salesforce.com/docs/atlas.en-us.salesforce_app_limits_cheatsheet.meta/salesforce_app_limits_cheatsheet/salesforce_app_limits_platform_api.htm` (retrieved 2026-05-26).

### 3.2 HubSpot

- **Auth flow**: OAuth 2.0 with refresh tokens, scopes per-app at install (`https://app.hubspot.com/oauth/authorize`, `https://api.hubapi.com/oauth/v1/token`).
- **Scopes**: `crm.objects.contacts.read crm.objects.deals.read tickets content`.
- **Polling vs webhook**: **Both**. CRM Object polling via `/crm/v3/objects/{objectType}/search?filterGroups[…]` with `hs_lastmodifieddate` watermark; webhooks (`developers.hubspot.com/docs/api/webhooks`) for low-latency updates with HMAC-SHA256 signature verification of `X-HubSpot-Signature-v3` over `method+uri+body+timestamp`.
- **Dedup key**: `(tenant_id, account, object_type, object_id)`.
- **Rate-limit**: 100 req / 10s burst, 250k / day on Professional. Connector throttles to 8 req/sec.
- **PII redaction**: `email`, `phone`, `mobilephone`, `address`, `notes_last_contacted` → salted hash. `firstname`, `lastname`, `company` kept.
- **Retry**: 3 attempts, exp backoff. Idempotent on `hs_lastmodifieddate`.
- **Docs cited**: 
  - HubSpot, *OAuth 2.0 Authentication* — `https://developers.hubspot.com/docs/api/working-with-oauth` (retrieved 2026-05-26).
  - HubSpot, *Webhooks API — Signature validation* — `https://developers.hubspot.com/docs/api/webhooks/validating-requests` (retrieved 2026-05-26).
  - HubSpot, *Rate Limits* — `https://developers.hubspot.com/docs/api/usage-details` (retrieved 2026-05-26).

### 3.3 Linear

- **Auth flow**: OAuth 2.0 (`https://linear.app/oauth/authorize`, `/oauth/token`).
- **Scopes**: `read` (we never write).
- **Polling vs webhook**: **Both**. GraphQL queries (`https://api.linear.app/graphql`) for backfill and reconciliation; webhooks for live updates (signed with HMAC-SHA256 of body using the per-app secret, header `Linear-Signature`).
- **Dedup key**: `(tenant_id, account, entity_kind, entity_id)`.
- **Cursor**: `updatedAt` ISO timestamp.
- **Rate-limit**: 1500 req/hour authenticated. Connector throttles to 0.4 req/sec.
- **PII redaction**: assignee `email`, comment `body` PII tokens → salted hash. Issue title/description **kept** (operational context Mr. Mwikila needs).
- **Retry**: 3 attempts, exp backoff. GraphQL errors with `extensions.code === 'RATELIMITED'` surface as `rate-limited`.
- **Docs cited**: 
  - Linear, *Public API — OAuth Authentication* — `https://developers.linear.app/docs/oauth/authentication` (retrieved 2026-05-26).
  - Linear, *Webhooks* — `https://developers.linear.app/docs/graphql/webhooks` (retrieved 2026-05-26).
  - Linear, *Rate limiting* — `https://developers.linear.app/docs/graphql/working-with-the-graphql-api/rate-limiting` (retrieved 2026-05-26).

### 3.4 Jira

- **Auth flow**: OAuth 2.0 (3LO) via Atlassian (`https://auth.atlassian.com/authorize`, `/oauth/token`). For Server/DC: Personal Access Token (PAT) with Bearer auth.
- **Scopes**: `read:jira-work read:jira-user offline_access`.
- **Polling vs webhook**: **Both**. REST search (`/rest/api/3/search` with JQL `updated >= "$since" ORDER BY updated ASC`) + webhooks signed with HMAC-SHA256 (Connect apps; for OAuth 3LO apps webhook signing is optional — for those we fall back to source-IP allowlist and rely on TLS).
- **Dedup key**: `(tenant_id, account, entity_kind, entity_id)`.
- **Rate-limit**: budget-driven (cost per endpoint); connector caps at 10 req/sec and respects `Retry-After`.
- **PII redaction**: `reporter.emailAddress`, `assignee.emailAddress`, comment bodies → salted hash. Issue summary & status name **kept**.
- **Retry**: 3 attempts, exp backoff.
- **Docs cited**: 
  - Atlassian, *OAuth 2.0 (3LO) apps* — `https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/` (retrieved 2026-05-26).
  - Atlassian, *Jira REST API v3 — Search* — `https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/` (retrieved 2026-05-26).
  - Atlassian, *Webhooks* — `https://developer.atlassian.com/cloud/jira/platform/webhooks/` (retrieved 2026-05-26).

### 3.5 GitHub

- **Auth flow**: GitHub App installation token (preferred for fleet) or OAuth App (`https://github.com/login/oauth/authorize`). The connector accepts both — `auth.oauth.ts` issues the installation JWT-then-token exchange for App installs.
- **Scopes**: `repo` (read), `pull_request:read`, `issues:read`. For GitHub Apps: `Contents:Read`, `Pull requests:Read`, `Issues:Read`, `Metadata:Read`.
- **Polling vs webhook**: **Both**. REST `/repos/{owner}/{repo}/issues?since=…&state=all&sort=updated&direction=asc` for backfill; webhooks with HMAC-SHA256 over body using `X-Hub-Signature-256` header.
- **Dedup key**: `(tenant_id, account, entity_kind, entity_id)`.
- **Rate-limit**: 5,000 req/hour authenticated. Connector reads `X-RateLimit-Remaining` and back-pressures when < 100.
- **PII redaction**: commit `author.email`, comment bodies → salted hash. Repo names / PR titles **kept**.
- **Retry**: 3 attempts, exp backoff; 403 with `X-RateLimit-Remaining: 0` ⇒ `rate-limited`.
- **Docs cited**: 
  - GitHub, *Building a GitHub App* — `https://docs.github.com/en/apps/creating-github-apps` (retrieved 2026-05-26).
  - GitHub, *Securing webhooks* — `https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries` (retrieved 2026-05-26).
  - GitHub, *REST API — Rate limits* — `https://docs.github.com/en/rest/rate-limit/rate-limit` (retrieved 2026-05-26).

### 3.6 GitLab

- **Auth flow**: OAuth 2.0 (`/oauth/authorize`, `/oauth/token`) or Personal Access Token. Self-hosted GitLabs allowed via configurable base URL.
- **Scopes**: `read_api read_repository read_user`.
- **Polling vs webhook**: **Both**. REST `/api/v4/projects/{id}/issues?updated_after=…&sort=asc` for backfill; webhooks with `X-Gitlab-Token` shared-secret header (note: GitLab webhooks use shared-secret comparison, NOT HMAC — the receiver must timing-safe-compare).
- **Dedup key**: `(tenant_id, account, entity_kind, entity_id)`.
- **Rate-limit**: project-tier configurable; default 600 req/min authenticated. Connector caps at 8 req/sec.
- **PII redaction**: author `email`, MR description PII tokens → salted hash.
- **Retry**: 3 attempts, exp backoff.
- **Docs cited**: 
  - GitLab, *OAuth 2.0 Applications* — `https://docs.gitlab.com/ee/api/oauth2.html` (retrieved 2026-05-26).
  - GitLab, *Webhooks* — `https://docs.gitlab.com/ee/user/project/integrations/webhooks.html` (retrieved 2026-05-26).
  - GitLab, *Rate limits* — `https://docs.gitlab.com/ee/administration/instance_limits.html` (retrieved 2026-05-26).

### 3.7 Microsoft Teams

- **Auth flow**: Microsoft Graph OAuth 2.0 (`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`, `…/token`) — Application permissions for unattended ingest.
- **Scopes**: `ChannelMessage.Read.All Team.ReadBasic.All OnlineMeetings.Read.All offline_access`.
- **Polling vs webhook**: **Webhook-preferred** via Graph change-notification subscriptions with a 60-min lifetime that must be renewed. Polling fallback hits `/teams/{id}/channels/{id}/messages?$filter=lastModifiedDateTime gt …`.
- **Dedup key**: `(tenant_id, account, team_id, channel_id, message_id)`.
- **Rate-limit**: per-app + per-tenant throttling (RPS bucket); connector reads `Retry-After` and caps at 4 req/sec.
- **PII redaction**: `from.user.displayName` is **kept** for operational clarity; email/phone in message bodies → salted hash. Attachment URIs **kept** (signed Graph URLs expire).
- **Retry**: 3 attempts, exp backoff. Graph change-notification validation requires echoing the `validationToken` within 10s — handled in the webhook receiver.
- **Docs cited**: 
  - Microsoft, *Microsoft Graph — Change notifications* — `https://learn.microsoft.com/en-us/graph/api/resources/webhooks` (retrieved 2026-05-26).
  - Microsoft, *Microsoft Graph — Channel messages* — `https://learn.microsoft.com/en-us/graph/api/channel-list-messages` (retrieved 2026-05-26).
  - Microsoft, *Throttling guidance* — `https://learn.microsoft.com/en-us/graph/throttling` (retrieved 2026-05-26).

### 3.8 Zoom

- **Auth flow**: Server-to-Server OAuth 2.0 (`https://zoom.us/oauth/token` with `grant_type=account_credentials`) — preferred for organisation-wide ingestion.
- **Scopes**: `meeting:read:admin recording:read:admin user:read:admin`.
- **Polling vs webhook**: **Webhook-preferred**. Events `meeting.ended`, `recording.completed`, `recording.transcript_completed` with HMAC-SHA256 signature verification of header `x-zm-signature = v0=HMAC(secret, "v0:{ts}:{body}")`. Polling fallback uses `/users/{id}/meetings?type=past&from=…&to=…`.
- **Dedup key**: `(tenant_id, account, meeting_id)`.
- **Rate-limit**: Heavy endpoint daily caps; connector throttles to 4 req/sec.
- **PII redaction**: participant `email` → salted hash; participant `name` **kept** (Mr. Mwikila needs to see who attended). Transcript bodies pass through the salted-hash redactor for emails and phone numbers within transcript text.
- **Retry**: 3 attempts, exp backoff.
- **Docs cited**: 
  - Zoom, *Server-to-Server OAuth* — `https://developers.zoom.us/docs/internal-apps/s2s-oauth/` (retrieved 2026-05-26).
  - Zoom, *Webhook signature verification* — `https://developers.zoom.us/docs/api/rest/webhook-reference/#verify-webhook-events` (retrieved 2026-05-26).
  - Zoom, *Rate limits* — `https://developers.zoom.us/docs/api/rest/rate-limits/` (retrieved 2026-05-26).

### 3.9 Twilio Voice

- **Auth flow**: Account SID + Auth Token (HTTP Basic). The voice connector **shares the existing `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` env infrastructure** with `services/wave-resilience-manager` (the SMS notifier) but uses a **distinct Twilio sub-account SID** (`TWILIO_VOICE_SUBACCOUNT_SID`, `TWILIO_VOICE_SUBACCOUNT_AUTH_TOKEN`) so per-second voice TPS, billing, and incident scope are partitioned from SMS.
- **Scopes**: N/A (Account SID grants all). The sub-account scope IS the security boundary.
- **Polling vs webhook**: **Both**. `GET /2010-04-01/Accounts/{Sid}/Calls.json?StartTime>=YYYY-MM-DD` for backfill; status-callback webhooks for in-flight events (`X-Twilio-Signature` HMAC-SHA1 of full URL + sorted POST params concatenated).
- **Dedup key**: `(tenant_id, twilio_account, call_sid)`.
- **Rate-limit**: Account-level TPS (1 default). Connector caps at 1 req/sec.
- **PII redaction**: `from_phone`, `to_phone` → salted hash. Recording URIs **kept** (signed). Transcript text passes through the salted-hash redactor.
- **Retry**: 3 attempts, exp backoff. 429 with `Retry-After` honoured.
- **Docs cited**: 
  - Twilio, *Voice REST API — Call resource* — `https://www.twilio.com/docs/voice/api/call-resource` (retrieved 2026-05-26).
  - Twilio, *Validating Signatures from Twilio* — `https://www.twilio.com/docs/usage/webhooks/webhooks-security` (retrieved 2026-05-26).
  - Twilio, *Sub-accounts* — `https://www.twilio.com/docs/iam/api/subaccounts` (retrieved 2026-05-26).
  - Twilio, *Rate limits* — `https://www.twilio.com/docs/usage/rest/rate-limits` (retrieved 2026-05-26).

## 4. Persistence — Migration 0046

Drizzle migration `packages/database/drizzle/0046_omni_p1.sql` creates nine provider-specific tables. Every table:

- has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`;
- has `tenant_id text NOT NULL` (RLS scope);
- has `account text NOT NULL` (the per-provider workspace identifier — Salesforce org, HubSpot portal, Linear team, Jira site, GitHub org, GitLab group, Teams tenant, Zoom account, Twilio sub-account);
- has `raw jsonb NOT NULL` (immutable upstream payload, salted-hash redacted at ingest boundary);
- has `ingested_at timestamptz NOT NULL DEFAULT now()`;
- has `audit_hash text NOT NULL` (links into `ai_audit_chain`);
- has a UNIQUE compound index on `(tenant_id, account, …entity-key…)` so re-ingest is idempotent;
- has RLS enabled with `current_setting('app.tenant_id', true)` policy.

The shared `connector_credentials` and `connector_cursors` tables come from migration `0042_connector_framework.sql` (planned, not yet landed). Migration 0046 **references** them in comments but does NOT redeclare them; the SQL is robust if 0042 is missing (no hard FK).

## 5. Test Discipline

Each connector ships at least 4 tests:

1. **Auth flow** — OAuth token refresh (or Twilio basic-auth header construction), expiry detection, refresher failure → `unconfigured`.
2. **Normalizer** — provider raw → canonical envelope; field mapping + sourceKind correctness.
3. **Dedup on cursor** — re-ingesting an item with an older `updatedAt` does NOT overwrite; cursor advances monotonically.
4. **Webhook signature verification** (where applicable) — HMAC mismatch rejected; replay outside skew rejected; happy path accepted with timing-safe comparison.

External HTTP is behind injected `fetcher` ports. All tests run against in-memory repositories. Live tests live in `live-test/` directories outside this wave.

## 6. Out of Scope (v1)

- Write-back to any provider (Salesforce update, HubSpot create deal, …). v1 is read-only ingest.
- Per-record encryption beyond the AES-GCM token-at-rest stub (column-level encryption arrives with the `pgcrypto` rotation wave).
- MCP server publication of these connectors (handled in OMNI-P2).
- Cross-connector correlation (e.g. linking a Zoom meeting transcript to a Jira issue) — that is `packages/graph-rag-router/` territory.

## 7. Acceptance Criteria

- All 9 packages typecheck under `tsc --noEmit` with strict.
- All 9 packages' vitest suites pass (`>= 4 tests each`, ≥ 36 total).
- Migration 0046 applies idempotently (re-running is a no-op).
- Drizzle schemas compile and round-trip with their SQL columns.
- The barrel append in `packages/omnidata/src/index.ts` re-exports each connector factory.
- No `@ts-nocheck`, no `any` outside the explicit `eslint-disable` blocks.

---

## § Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md

This section is the immutable reconciliation record of founder-locked SOTA findings affecting connector dispatch policy. Idempotent — re-running the reconcile pass is a no-op once this section exists. Persona: Mr. Mwikila.

### § MCP-first capability check

**Source**: SOTA Finding 2 in `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` — ServiceNow announcement May 2026 opening their system of action to *"every AI agent via Model Context Protocol"*. Reference: https://www.servicenow.com/company/media/press-room/mcp-every-ai-agent.html.

**Policy**: For every connector in this spec, the build-time capability check records whether the provider exposes an official MCP server. The credentials record carries an optional `connector.mcp_server_url` field; when populated, the connector dispatcher MUST prefer MCP RPCs over native REST for the same logical action. Native REST remains as the fallback path only.

**Per-connector MCP-first capability row (as of build time)**:

| Connector | Provider exposes official MCP server? | Default ingress when `mcp_server_url` populated |
|---|---|---|
| Notion | check provider docs at build time | MCP-first |
| Linear | check provider docs at build time | MCP-first |
| Jira | check provider docs at build time | MCP-first |
| Asana | check provider docs at build time | MCP-first |
| ClickUp | check provider docs at build time | MCP-first |
| Monday.com | check provider docs at build time | MCP-first |
| Zoom | check provider docs at build time | MCP-first |
| Google Meet | check provider docs at build time | MCP-first |
| Microsoft Teams | check provider docs at build time | MCP-first |

(The build-time check is recorded in the connector's package readme + the org-legibility map per Wave M5-6, surfacing MCP-vs-native ingress per connector.)

**Rationale**: Founder-locked direction (per Decision SOTA Finding 2): industry convergence on MCP makes "MCP-first, native-API as fallback only" the canonical dispatch policy; this row reminds future connector authors to populate `mcp_server_url` and to default the dispatcher to MCP whenever the provider supports it.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
