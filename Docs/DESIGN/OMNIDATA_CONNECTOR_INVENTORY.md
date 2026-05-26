# Omnidata Connector Inventory — Design Specification

> The catalogue of every external source Borjie will ingest into Mr.
> Mwikila's awareness. Pillar 1 of [`CAPABILITY_BOOST_VISION.md`](../STRATEGY/CAPABILITY_BOOST_VISION.md).
> Sibling specs:
> [`TACIT_KNOWLEDGE_HARVESTING_SPEC.md`](./TACIT_KNOWLEDGE_HARVESTING_SPEC.md),
> [`CAPABILITY_CATALOGUE_SPEC.md`](./CAPABILITY_CATALOGUE_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`DATA_ONBOARDING_SPEC.md`](./DATA_ONBOARDING_SPEC.md),
> [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md).

Brand: Borjie. Persona: Mr. Mwikila — Borjie's autonomous Managing
Director for Tanzanian mining operators. Status: design-spec. The
package scaffold lands in this wave under `packages/omnidata/`.

---

## 1. Vision — Why Omnidata Matters

The founder, verbatim:

> "MD is aware of every data point — no knowledge missed, used or
> unanalysed organisation-wide. Utilisation of all this — information
> historically in different areas such as Slack, email, Notion,
> Instagram, WhatsApp, Facebook, TikTok, Salesforce etc — or heads of
> people — by stitching them into domain knowledge for the
> organisation."

Every business already runs on a dozen tools. Slack for ops. Gmail or
Outlook for everything external. WhatsApp for everyone Tanzanian.
Notion for written knowledge. Google Drive / OneDrive / Dropbox for
attachments. Salesforce or HubSpot for buyer relationships. Linear /
Jira / Asana for tickets. GitHub / GitLab for engineering. Zoom /
Meet for the recordings nobody re-watches. Instagram, Facebook,
TikTok, LinkedIn for the marketing surface. M-Pesa, NBC, CRDB for the
money. QuickBooks or Xero for the accounting. And — uniquely for
Borjie's domain — Tumemadini, NEMC, TRA, BoT for the regulatory anchor.

Mr. Mwikila cannot be a real Managing Director until he sees them all.
This document is the contract for how each source enters his awareness.

---

## 2. Connector Field Definitions

Every entry below carries the same eight fields:

- **Connector kind** — OAuth 2.0 REST API / IMAP / Webhook / Browser
  automation / Manual export / MCP server (Anthropic spec).
- **Data shape ingested** — messages, files, contacts, events, posts,
  transcripts, ledger entries, regulator filings, etc.
- **Auth flow** — OAuth 2.0 (which scopes), API key (env var), Webhook
  secret (HMAC), Browser session (cookie jar via Playwright), Manual
  upload (signed URL).
- **Refresh cadence** — real-time (webhook-driven) / hourly / daily
  delta / on-demand only.
- **PII handling** — boundary-redact (`packages/observability/pii-redactor.ts`),
  hash-salt-on-store (NIDA, TIN), encrypt at rest (Supabase Vault),
  consent-gated retention.
- **Volume class** — light (<10 MB/day), medium (10 MB–1 GB/day),
  heavy (>1 GB/day).
- **Phase** — P0 (Month 1), P1 (Months 2–4), P2 (Months 5–6), P3
  (selective per-tenant demand).
- **MCP server opportunity** — ship as an MCP server under
  `services/mcp-server-<source>/`? Yes / No / Already-shipped.

---

## 3. P0 — Critical Connectors (Month 1, ships with `packages/omnidata/`)

These six are the minimum surface area for capability boost to feel
like a real organisational brain. Every Tanzanian SMB has at least
two; most have three or four.

### 3.1 Slack

- **Connector kind:** OAuth 2.0 REST API + Events API (webhook).
- **Data shape ingested:** channel messages, thread replies, DM
  messages (consent-gated, off by default), file attachments,
  user / channel metadata, reactions, pinned items, app events.
- **Auth flow:** OAuth 2.0; Enterprise Grid orgs require org-level
  install with `is_enterprise_install=true` per
  [api.slack.com / enterprise / developing](https://api.slack.com/enterprise/developing).
  Scopes: `channels:history`, `groups:history`, `im:history` (gated),
  `files:read`, `users:read`, `team:read`.
- **Refresh cadence:** real-time (Events API push); scheduled hourly
  backfill via `conversations.history` for resilience to missed events.
- **PII handling:** boundary-redact emails / phones / KRA-PIN / NIDA /
  TIN before storage; DM ingestion is opt-in per-user.
- **Volume class:** medium (10 MB–1 GB/day, depending on tenant size).
- **Phase:** P0.
- **MCP server opportunity:** Yes — `services/mcp-server-slack/`. Slack
  is also one of the named MCP launch partners
  ([anthropic.com / news / model-context-protocol](https://www.anthropic.com/news/model-context-protocol)).

### 3.2 Gmail / Outlook

- **Connector kind:** OAuth 2.0 REST API (Gmail API / Microsoft Graph)
  + IMAP fallback for legacy mailboxes.
- **Data shape ingested:** message headers + body + attachments,
  thread structure, labels / categories, contacts, calendar invites.
- **Auth flow:** OAuth 2.0; Gmail scopes `gmail.readonly`,
  `gmail.metadata`; Graph scopes `Mail.Read`, `Contacts.Read`,
  `Calendars.Read`.
- **Refresh cadence:** push notifications (Gmail Pub/Sub watch;
  Graph webhook subscriptions); daily delta as fallback.
- **PII handling:** boundary-redact + hash-salt PII inside body text
  before LLM ingestion; attachments route through existing
  `packages/document-analysis/` for OCR + PII strip.
- **Volume class:** medium.
- **Phase:** P0.
- **MCP server opportunity:** Yes — combined `services/mcp-server-mail/`
  abstracting Gmail and Outlook.

### 3.3 Google Calendar / Outlook Calendar

- **Connector kind:** OAuth 2.0 REST API (Calendar API / Graph).
- **Data shape ingested:** events, attendees, recurring rules,
  attached meeting links (Zoom / Meet / Teams URLs).
- **Auth flow:** shares the Gmail / Outlook OAuth bundle from §3.2;
  `Calendars.Read` Graph scope; `calendar.readonly` Google scope.
- **Refresh cadence:** Calendar push notifications; real-time.
- **PII handling:** attendee emails redacted on store; only org-
  internal attendees retain readable values.
- **Volume class:** light.
- **Phase:** P0.
- **MCP server opportunity:** Yes — folded into `services/mcp-server-mail/`.

### 3.4 WhatsApp Business Cloud API

- **Connector kind:** OAuth-issued long-lived access token + Webhook
  (Meta Cloud API). Per [chatarmin.com — WhatsApp Cloud API guide 2026](https://chatarmin.com/en/blog/whatsapp-cloudapi)
  the Cloud API has been Meta's only path since October 2025; the
  on-prem API is deprecated.
- **Data shape ingested:** inbound + outbound messages, media (image,
  audio, document, video), reactions, template responses, contact
  cards, status read-receipts.
- **Auth flow:** Meta system-user access token + webhook HMAC secret
  per phone number.
- **Refresh cadence:** real-time (webhook); no backfill API for
  history older than the webhook stream — capture forward only.
- **PII handling:** phone numbers hash-salted; media downloaded into
  Supabase Storage with boundary-PII strip; consent-gated per
  contact.
- **Volume class:** medium.
- **Phase:** P0.
- **MCP server opportunity:** Yes — `services/mcp-server-whatsapp/`.
  Critical for Tanzania: WhatsApp is the default channel for buyer
  negotiations and supplier coordination.

### 3.5 Notion

- **Connector kind:** OAuth 2.0 REST API.
- **Data shape ingested:** pages, blocks (paragraph, heading, list,
  toggle, callout, code, image, file, embed), databases (rows +
  properties), workspace metadata.
- **Auth flow:** OAuth 2.0; workspace-level grant.
- **Refresh cadence:** daily delta via `last_edited_time` filter;
  on-demand re-sync triggered by chat-detected page mentions.
- **PII handling:** boundary-redact on page content; preserve page
  IDs and titles for citation back-linking.
- **Volume class:** medium.
- **Phase:** P0.
- **MCP server opportunity:** Yes — `services/mcp-server-notion/`.
  Listed in many of the agentic-AI surveys as the single most
  requested MCP connector for knowledge workers
  ([fountaincity.tech — Agent Memory Systems 2026](https://fountaincity.tech/resources/blog/agent-memory-knowledge-systems-compared/)).

### 3.6 Google Drive / OneDrive / Dropbox

- **Connector kind:** OAuth 2.0 REST API (Drive API / Graph / Dropbox API).
- **Data shape ingested:** file metadata + content (filtered by file
  type), folder structure, sharing acls, version history.
- **Auth flow:** OAuth 2.0; user opt-in per folder (not whole-drive
  by default — explicit consent regime).
- **Refresh cadence:** push notifications + nightly delta sweep.
- **PII handling:** content routes through existing
  `packages/document-analysis/` OCR + PII strip pipeline; file
  metadata stored separately from content.
- **Volume class:** heavy.
- **Phase:** P0.
- **MCP server opportunity:** Yes — combined `services/mcp-server-drive/`
  abstracting Google Drive, OneDrive, Dropbox.

---

## 4. P1 — High-Value Connectors (Months 2–4)

### 4.1 Microsoft Teams

- **Kind:** OAuth 2.0 (Microsoft Graph) + Webhook subscriptions.
- **Data:** channel messages, chat DMs, meeting recordings + transcripts
  (when retention permits), files.
- **Auth:** Graph scopes `ChannelMessage.Read.All`, `Chat.Read`,
  `OnlineMeetingRecording.Read.All`.
- **Refresh:** real-time webhook + hourly backfill.
- **PII:** standard boundary redaction; meeting transcripts route
  through existing `@borjie/audio-capture`.
- **Volume:** medium.
- **MCP:** Yes — `services/mcp-server-teams/`.

### 4.2 Salesforce

- **Kind:** OAuth 2.0 REST API + Streaming / CDC.
- **Data:** Accounts, Contacts, Opportunities, Activities, Tasks,
  Cases, Custom Objects (per-tenant config).
- **Auth:** Connected App with OAuth 2.0 user flow; refresh tokens
  rotated.
- **Refresh:** Streaming API push for real-time + daily delta via
  `LastModifiedDate`.
- **PII:** standard boundary redaction; preserve record IDs.
- **Volume:** medium.
- **MCP:** Yes — Salesforce is an MCP launch partner
  ([anthropic.com / model-context-protocol launch](https://www.anthropic.com/news/model-context-protocol)).
  Wire `services/mcp-server-salesforce/`.

### 4.3 HubSpot

- **Kind:** OAuth 2.0 REST API + Webhooks.
- **Data:** Contacts, Companies, Deals, Tickets, Engagements
  (emails, calls, meetings).
- **Auth:** OAuth 2.0; HubSpot app with `crm.objects.contacts.read`,
  `crm.objects.deals.read`, etc.
- **Refresh:** webhook real-time + daily delta.
- **PII:** standard.
- **Volume:** medium.
- **MCP:** Yes.

### 4.4 Linear / Jira / Asana

- **Kind:** OAuth 2.0 REST API + Webhooks.
- **Data:** issues / tickets / tasks, comments, status transitions,
  attachments, sprint / milestone metadata.
- **Auth:** OAuth 2.0; per-vendor scopes.
- **Refresh:** webhook real-time.
- **PII:** light — task content is mostly internal; preserve assignee
  identity unredacted (consent-gated workspace-wide).
- **Volume:** light.
- **MCP:** Yes — three separate servers OR a single
  `services/mcp-server-tickets/` with a kind discriminator.

### 4.5 GitHub / GitLab

- **Kind:** OAuth 2.0 REST + GraphQL + Webhooks.
- **Data:** PRs / MRs, commits, issues, comments, CI status, code
  review threads. **Filtered by repo** — owner opts repos in
  individually.
- **Auth:** OAuth 2.0; per-vendor scopes.
- **Refresh:** webhook real-time.
- **PII:** light — code itself stays in the source-control vendor;
  Borjie indexes metadata + comments, not source files.
- **Volume:** medium.
- **MCP:** Yes — GitHub is widely available as an MCP server already
  (multiple community implementations); Borjie ships a domain-aware
  variant under `services/mcp-server-scm/`.

### 4.6 Zoom / Meet Recordings

- **Kind:** OAuth 2.0 REST API + Webhooks.
- **Data:** meeting metadata, recording URLs, transcripts. Recordings
  are auto-transcribed via existing `@borjie/audio-capture` Whisper
  pipeline.
- **Auth:** OAuth 2.0; Zoom scopes `recording:read:admin`; Meet via
  Google Drive (recordings land in Drive).
- **Refresh:** webhook on `recording.completed`.
- **PII:** transcripts route through boundary redactor.
- **Volume:** heavy (audio + video files).
- **MCP:** No — recordings are large blobs; better routed through the
  drive connector + audio-capture pipeline.

### 4.7 Phone Calls (Vapi / Retell / Twilio)

- **Kind:** Webhook + REST API.
- **Data:** call recordings, transcripts, call metadata (duration,
  caller-ID, outcome).
- **Auth:** API key; webhook HMAC secret.
- **Refresh:** real-time webhook on `call.ended`.
- **PII:** caller phone numbers hash-salted; transcripts boundary-redacted.
- **Volume:** light per call; medium per tenant.
- **MCP:** No — already covered by the existing
  `services/voice-agent/` integration; surface as a connector facade.

---

## 5. P2 — Public Social Connectors (Months 5–6, marketing-side)

These power the marketing-side capabilities (campaigns, audience
intelligence, brand monitoring) per
[`MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md).

- **Instagram Business** — Meta Graph API; DMs, comments, posts,
  insights. OAuth 2.0; webhooks for new comments / DMs.
  Volume: medium. MCP: Yes — `services/mcp-server-meta-social/`.
- **Facebook Pages** — Meta Graph API; page posts, comments, reactions,
  Page Inbox messages. Shares the Meta OAuth bundle with Instagram.
  Volume: medium. MCP: combined with Instagram.
- **TikTok for Business** — TikTok API for Business; posts, comments,
  view-metrics. OAuth 2.0; webhooks. Volume: light. MCP: Yes —
  `services/mcp-server-tiktok/`.
- **Twitter / X** — paid X API tier (Basic / Pro); tweets, replies,
  DMs (DM scope is restricted). OAuth 2.0. Volume: light. MCP: Yes.
- **LinkedIn Page** — LinkedIn Marketing API; page posts, comments,
  follower analytics. OAuth 2.0. Volume: light. MCP: Yes.
- **YouTube Channel** — YouTube Data API; videos, comments, analytics.
  OAuth 2.0 (Google Auth bundle). Volume: light. MCP: Yes — folded
  into `services/mcp-server-google/`.

---

## 6. P3 — Specialised Connectors (Per-Tenant Demand)

- **Tumemadini / NEMC / TRA / BoT regulator portals** — browser
  automation via Playwright session capture + scheduled scrape.
  Some endpoints already have MCP servers
  ([`services/mcp-server-tra`](../../services/mcp-server-tra),
  [`services/mcp-server-tumemadini`](../../services/mcp-server-tumemadini));
  others require browser automation until the regulator ships APIs.
  Auth: browser session via `@borjie/browser-perception`. Volume:
  light. MCP: Already-shipped for TRA + Tumemadini; build NEMC + BoT
  variants.
- **Bank statements (M-Pesa, NBC, CRDB)** — Stitch / Mono / Pngme
  aggregator APIs where available; OFX file upload + parse where not.
  Auth: aggregator OAuth + tenant-specific credentials in Supabase
  Vault. Volume: light. MCP: optional; wire through
  `@borjie/connectors`.
- **QuickBooks / Xero** — OAuth 2.0 REST API. Data: chart-of-accounts,
  journal entries, invoices, bills. Refresh: hourly delta. Volume:
  light. MCP: Yes — `services/mcp-server-accounting/`.
- **ERP (SAP, Oracle)** — REST APIs where available; rare in
  Tanzanian SMB market. Reserved for tenant-specific rollouts.

---

## 7. The MCP (Model Context Protocol) Opportunity

Anthropic's MCP — donated to the Agentic AI Foundation under the Linux
Foundation in December 2025 ([en.wikipedia.org / Model_Context_Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol))
— is now the de-facto open standard for AI ↔ external-system bindings.
~10,000+ active MCP servers run in production per WorkOS's 2026 survey
([workos.com — MCP in 2026](https://workos.com/blog/everything-your-team-needs-to-know-about-mcp-in-2026)).
Borjie's strategic position:

1. **All P0 + P1 + most P2 connectors ship as MCP servers** under
   `services/mcp-server-<source>/`, following the contract already
   established by [`mcp-server-tra`](../../services/mcp-server-tra/src/mcp.ts)
   and [`mcp-server-tumemadini`](../../services/mcp-server-tumemadini).
   This means a single connector implementation serves both the
   Borjie kernel AND any third-party Claude-compatible agent the
   tenant brings.
2. **The `@borjie/omnidata` package wraps the MCP server in the
   omnidata connector contract** — adding sync scheduling, PII
   redaction, provenance stamping, audit-hash-chain integration. The
   kernel sees a uniform `OmnidataConnector` interface; downstream
   MCP clients see a uniform MCP tools surface. One source of truth.
3. **Borjie publishes its MCP servers to the MCP Registry** so the
   Tanzanian developer ecosystem can compose Borjie connectors into
   their own Claude apps — a network-effect play.

The connector framework already lives in `@borjie/connectors`
(rate-limit, circuit-breaker, retry, audit, event bus, Zod validation).
The `packages/omnidata/` scaffold adds the abstraction layer that
binds connectors to:

- the cognitive-memory cell substrate
  ([`UNIFIED_COGNITIVE_MEMORY_SPEC.md`](./UNIFIED_COGNITIVE_MEMORY_SPEC.md));
- the data-onboarding pipeline
  ([`DATA_ONBOARDING_SPEC.md`](./DATA_ONBOARDING_SPEC.md));
- the audit-hash-chain (`@borjie/audit-hash-chain`);
- the PII redactor (`packages/observability/src/pii-redactor.ts`);
- the sync scheduler (new — runs in `services/omnidata-sync-worker/`).

---

## 8. The Sync Scheduler — Cadence + Backpressure

Every connector declares a `RefreshPolicy`:

```typescript
export type RefreshPolicy =
  | { readonly kind: 'realtime'; readonly webhookSecret: string }
  | { readonly kind: 'pushed'; readonly subscriptionToken: string }
  | { readonly kind: 'cron'; readonly cron: string; readonly maxRowsPerRun: number }
  | { readonly kind: 'on-demand' };
```

The scheduler (`services/omnidata-sync-worker/`) honours per-connector
rate-limits via the existing `@borjie/connectors` token-bucket and
backs off automatically on `429` / `503` upstream. Failed syncs are
logged into the `omnidata_sync_audit` table and surfaced in the
owner's daily briefing.

---

## 9. Provenance + Audit

Every ingested item carries an `OmnidataIngestedItem` envelope:

```typescript
export interface OmnidataIngestedItem<T = unknown> {
  readonly id: string;                                 // uuid
  readonly tenant_id: string;
  readonly connector_id: string;                       // e.g. 'slack:T01ABC'
  readonly source_kind: OmnidataSourceKind;            // 'slack' | 'gmail' | ...
  readonly source_record_id: string;                   // upstream id (slack msg ts, email id)
  readonly retrieved_at: string;                       // ISO timestamp
  readonly payload: T;                                  // typed by source_kind
  readonly redaction_applied: ReadonlyArray<string>;   // PII fields scrubbed
  readonly consent_record_id: string | null;           // links to consent_records
  readonly audit_hash: string;                         // hash-chain anchor
}
```

The `audit_hash` is computed by `@borjie/audit-hash-chain.appendEntry`
against the prior tenant-scoped chain head. A regulator audit (TRA,
NEMC, Tumemadini) can verify the chain forward from genesis. The
`consent_record_id` is non-null when the source is a DM-scoped
mailbox, a private Slack DM, a WhatsApp message — anywhere we hold
user-level consent rather than workspace-level.

---

## 10. Anti-Patterns

Things Mr. Mwikila MUST NOT do at the omnidata layer:

1. **Ingest without scope.** No "give me everything" sweeps. Every
   connector enumerates the channels / folders / mailboxes the owner
   has explicitly opted in.
2. **Cross PII to LLM unredacted.** Every payload passes through the
   boundary redactor before any LLM call. The redactor is enforced at
   the `OmnidataConnector.ingest` contract level — not at the call site.
3. **Store DMs without per-user consent.** Slack DMs, WhatsApp 1:1
   threads, Gmail personal mail — all require an explicit consent
   record before ingestion. Consent revocation triggers a tombstone
   sweep within 30 days.
4. **Skip audit-hash anchoring.** Every ingested item gets a hash-chain
   entry. If the chain is broken, the connector refuses subsequent
   ingest until the chain is reconciled.
5. **Ignore rate-limits.** Every connector wraps the existing
   `@borjie/connectors` token-bucket. Hitting a `429` should
   automatically widen the next-sync interval, not retry-bomb the
   upstream.
6. **Fabricate source identifiers.** Every ingested item carries the
   upstream `source_record_id` exactly as the upstream gave it. No
   reformatting, no normalisation, no client-side IDs that pretend
   to be upstream IDs.

---

## 11. Schema Additions

New migration `0029_omnidata.sql` (lands with the package):

- `omnidata_connectors` — registry of installed connectors per tenant
  (id, tenant_id, source_kind, display_name, refresh_policy,
  consent_scope, created_at, last_synced_at, status).
- `omnidata_ingested_items` — every ingested envelope (per §9 schema),
  partitioned by tenant_id + retrieved_at month.
- `omnidata_sync_audit` — sync attempt log (success / partial /
  failure, latency, items_ingested, error_message, retry_count).
- `omnidata_consent_records` — per-user (or per-channel) consent
  grants and revocations.

Indexes: `(tenant_id, connector_id, retrieved_at DESC)`,
`(tenant_id, source_kind, source_record_id)` unique.

---

## 12. Cross-Spec Integration Map

- **Tacit knowledge:** harvested `KnowHowArtifact`s reference
  `OmnidataIngestedItem`s in their `evidence_citations` field — a
  Slack thread that triggered the follow-up interview is captured as
  the citation.
- **Capability catalogue:** capability measurements pull from
  `omnidata_ingested_items` aggregations (e.g. "buyer-response-time
  p50" derived from Gmail thread timings).
- **Self-improving loops:** cross-tenant federation reads (PII-stripped,
  differential-privacy-bounded) aggregates of `omnidata_ingested_items`
  to surface multi-tenant patterns.
- **Cognitive memory:** new `MemoryKind = 'connector_signal'` lets the
  unified-memory store learn "buyer X tends to ask about provenance
  first in Slack threads" as a first-class memory cell.
- **Data onboarding:** when a connector first activates, the
  initial backfill flows through the 7-stage onboarding pipeline so
  the schemas are reconciled against the tenant's existing tables.

This is the connector inventory. The package scaffold is in
`packages/omnidata/`. Real implementations follow in dedicated
sub-waves per source.
