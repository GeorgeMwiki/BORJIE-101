# OMNI Phase 2 — Social-Platform Connectors

> "Six surfaces. Instagram for the brand, Facebook for the village,
> TikTok for the youth, X for the regulators, LinkedIn for the buyers,
> YouTube for the documentary. All six behind the same ingest
> substrate Mr. Mwikila already speaks." — Founder, OMNI-P2 wave plan.

Status: SPEC — Wave **OMNI-P2**.
Owners: `packages/connectors/instagram/`, `packages/connectors/facebook/`,
`packages/connectors/tiktok/`, `packages/connectors/x/`,
`packages/connectors/linkedin/`, `packages/connectors/youtube/`.

Cross-spec:
- [`OMNIDATA_CONNECTOR_INVENTORY.md`](./OMNIDATA_CONNECTOR_INVENTORY.md)
- [`OMNI_P0_BATCH2_CONNECTORS_SPEC.md`](./OMNI_P0_BATCH2_CONNECTORS_SPEC.md)
- [`SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md`](./SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md)
- `packages/omnidata/src/index.ts`

Sibling-wave dependency: Phase 0 ships `connector_credentials` and
`connector_cursors` (migration `0042`). Migration `0047` for this wave
declares them idempotently with `CREATE TABLE IF NOT EXISTS` so the
wave is independently applyable.

Persona: Mr. Mwikila. Brand: Borjie.

---

## 1. Thesis — Every public mention of the estate lands in cognitive memory

The estate's owner does not log into six dashboards. The owner reads
one weekly report. To produce that report, Mr. Mwikila must see what
the estate's accounts (and the accounts that mention it) produced
across all six platforms. Phase 2 ships the connectors that turn six
external surfaces into one substrate.

The discipline mirrors Phase 0/1: every connector ships a typed
client, a poller (default) plus an optional webhook receiver
(platform permitting), a redactor, a normaliser, an idempotent
repository, and an audit-chain link. The cognitive-memory layer reads
the normalised rows.

---

## 2. Per-connector summary

### 2.1 Instagram (`packages/connectors/instagram/`)

- **Source-kind in omnidata:** `instagram_business`.
- **Auth:** Facebook OAuth2 with `instagram_basic`,
  `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`
  scopes. Long-lived page tokens (60 days), refreshed on expiry.
- **Webhooks:** Yes, via Meta's Graph API webhook system —
  `comments`, `mentions` events. Signature: HMAC-SHA256 of body with
  `app_secret`.
- **Polling fallback:** Default 6h poll for `/{ig-user-id}/media` to
  reconcile missed webhooks. Cursor: `before/after` from Graph paging.
- **PII handling:** Comment authors' usernames are salted-hashed
  before persistence (so dedup across sources works); free-text
  comment bodies pass through the omnidata PII redactor.
- **Reference:** [Instagram Graph API — Overview](https://developers.facebook.com/docs/instagram-api/) —
  title: "Instagram Graph API", Meta for Developers, accessed
  2026-05-25. Webhook docs:
  [Instagram Webhooks](https://developers.facebook.com/docs/instagram-api/guides/webhooks) —
  title: "Webhooks for Instagram", accessed 2026-05-25.

### 2.2 Facebook (`packages/connectors/facebook/`)

- **Source-kind:** `facebook_page`.
- **Auth:** Same Facebook OAuth2 broker as Instagram. Scopes:
  `pages_show_list`, `pages_read_engagement`,
  `pages_manage_metadata`, `read_insights`.
- **Webhooks:** Page-level webhooks — `feed` events fire on new
  posts, comments, reactions. HMAC-SHA256 sig as above.
- **Polling fallback:** 6h for `/{page-id}/posts` and
  `/{page-id}/insights`. Cursor: paging tokens.
- **PII handling:** Same salted-hash pattern for commenter usernames.
- **Reference:** [Facebook Graph API — Pages](https://developers.facebook.com/docs/graph-api/reference/page/) —
  title: "Page — Graph API Reference", Meta for Developers, accessed
  2026-05-25.

### 2.3 TikTok (`packages/connectors/tiktok/`)

- **Source-kind:** `tiktok_business`.
- **Auth:** TikTok Business API OAuth2 with `user.info.basic`,
  `video.list`, `video.insights` scopes. Token lifetimes: 24h
  access, 1y refresh; refresher rotates the encrypted-at-rest blob.
- **Webhooks:** Sandbox-only at time of writing — production rolls
  out by region. Connector ships both a webhook receiver and a 6h
  poller; webhook is opt-in via `WEBHOOK_ENABLED=1`.
- **Polling fallback:** Default `GET /v2/video/list/` every 6h.
  Cursor: `cursor` token returned by API.
- **PII handling:** Captions can contain TikTok usernames (`@xxx`);
  the redactor salts-hashes any `@`-prefixed token.
- **Reference:** [TikTok for Business — API](https://business-api.tiktok.com/portal/docs?id=1738455508553729) —
  title: "TikTok Business API", accessed 2026-05-25.

### 2.4 X — formerly Twitter (`packages/connectors/x/`)

- **Source-kind:** `twitter`.
- **Auth:** X API v2 — OAuth 2.0 with PKCE. Scopes:
  `tweet.read`, `users.read`, `offline.access` (for refresh tokens),
  `tweet.write` is *not* requested in P2 (read-only).
- **Webhooks:** v2 *Activity Streams* available on enterprise tier;
  the standard tier uses *Filtered Stream* WebSocket. P2 ships only
  the polling client; the stream client is a follow-up wave.
- **Polling fallback:** Default poll of the authenticated user's
  timeline + mentions every 15min via `/2/users/:id/tweets` and
  `/2/users/:id/mentions`. Cursor: `pagination_token`.
- **PII handling:** Tweet bodies pass through the omnidata redactor;
  mentioned usernames are salted-hashed.
- **Reference:** [X API v2 — Documentation](https://developer.x.com/en/docs/x-api) —
  title: "X API v2", X Developer Platform, accessed 2026-05-25.

### 2.5 LinkedIn (`packages/connectors/linkedin/`)

- **Source-kind:** `linkedin_page`.
- **Auth:** LinkedIn OAuth2 with `r_organization_social`,
  `r_organization_admin`, `w_member_social` is *not* requested in P2
  (read-only). Token lifetime: 60 days; long-lived tokens
  available on partner-program tier only — non-partner tenants
  re-auth every 60 days.
- **Webhooks:** None on the standard Marketing API tier. Pure
  polling.
- **Polling fallback:** Default 1h poll for
  `/rest/posts?author=urn:li:organization:...`. Cursor: `start`/`count`
  paging.
- **PII handling:** LinkedIn URNs for commenters are salted-hashed;
  free-text comment bodies pass through the redactor.
- **Reference:** [LinkedIn Marketing API — Overview](https://learn.microsoft.com/en-us/linkedin/marketing/) —
  title: "LinkedIn Marketing API", Microsoft Learn, accessed
  2026-05-25.

### 2.6 YouTube (`packages/connectors/youtube/`)

- **Source-kind:** `youtube_channel`.
- **Auth:** Google OAuth2 with `youtube.readonly` and
  `yt-analytics.readonly` scopes. Token lifetimes: 1h access, refresh
  tokens never expire (until revoked).
- **Webhooks:** Google PubSubHubbub (PuSH) push-notification feed for
  `channels` topic — connector exposes a webhook receiver that
  validates the HMAC challenge.
- **Polling fallback:** 6h poll of `videos.list?part=statistics`
  per video to refresh view/like/comment counts (PuSH only fires on
  new uploads).
- **PII handling:** Commenter channel IDs (if comments ingested) are
  salted-hashed; descriptions pass through the redactor.
- **Reference:** [YouTube Data API v3](https://developers.google.com/youtube/v3) —
  title: "YouTube Data API (v3)", Google Developers, accessed
  2026-05-25. PuSH docs:
  [YouTube Subscribed Push](https://developers.google.com/youtube/v3/guides/push_notifications) —
  title: "Push Notifications", accessed 2026-05-25.

---

## 3. Shared substrate

Every connector implements the same five-method surface, mirroring
Phase 0/1:

```ts
interface SocialConnector {
  startOAuth(req: OAuthStartRequest): Promise<{ authorizationUrl: string }>;
  completeOAuth(req: OAuthCallbackRequest): Promise<void>;
  refreshToken(tenantId: string): Promise<void>;
  poll(req: PollRequest): Promise<PollResult>;
  handleWebhook?(headers: Headers, body: string): Promise<WebhookResult>;
}
```

Plus a shared dependency contract:

```ts
interface ConnectorDeps {
  fetcher: Fetcher;                          // injected for live-test
  credentialsRepo: ConnectorCredentialsRepo; // encrypted-at-rest
  cursorRepo: ConnectorCursorsRepo;
  itemsRepo: ConnectorItemsRepo;             // provider-specific
  redactor: PIIRedactor;
  auditChain: AuditChainPort;
  clock: ClockPort;
  uuid: UuidPort;
  logger: Logger;
}
```

The `fetcher` port is the single injection point for HTTP. Tests pass
a deterministic stub. Production composition passes a `fetch`
wrapper with retry / circuit-breaker semantics from
`@borjie/connectors`.

---

## 4. PII handling

Three classes of PII appear across the six surfaces:

1. **Account identifiers** (page IDs, channel IDs, X user IDs,
   LinkedIn URNs) — *not* redacted; these are the join keys.
2. **Commenter / liker identifiers** (usernames, channel handles) —
   salted-hashed with a per-tenant salt loaded from the encrypted
   credential store. Deterministic hashing preserves dedup across
   sources.
3. **Free-text bodies** (captions, descriptions, comments) — pass
   through the omnidata PII redactor (NIDA, phone, email patterns
   blanked).

The salt is rotated on tenant-credential rotation. Old salts are
retained in `connector_credentials.legacy_salts` (JSON array) so the
redactor can recognise pre-rotation identities.

---

## 5. Storage

Seven provider tables in migration `0047`:

- `instagram_posts(id, tenant_id, account, post_id, kind, caption,
  media_urls, metrics, posted_at, raw, ingested_at, audit_hash)`
- `facebook_posts(... same shape ...)`
- `tiktok_posts(... same shape ...)`
- `x_posts(... same shape, column "text" for tweet body)`
- `linkedin_posts(... same shape ...)`
- `youtube_videos(id, tenant_id, channel_id, video_id, title,
  description, duration_s, view_count, like_count, comment_count,
  published_at, raw, ingested_at, audit_hash)`

All tables are tenant-scoped with RLS via the canonical
`current_setting('app.tenant_id', true)` GUC. UNIQUE
`(tenant_id, account_or_channel, post_or_video_id)` enforces
idempotency.

---

## 6. Auth + token refresh

Two auth families across the six connectors:

- **Facebook family** (Instagram + Facebook): shared Facebook
  OAuth2 broker. One refresh-token rotation procedure.
- **Per-platform** (TikTok, X, LinkedIn, YouTube): each has its
  own OAuth2 broker.

Tokens are encrypted-at-rest by the `EncryptionPort` stub from
`@borjie/database`. The connector never sees the raw ciphertext —
the credentials repo handles encrypt/decrypt internally.

Refresh policy: each connector exposes `refreshToken(tenantId)` and
runs it lazy-on-401 plus a 1h proactive refresh cron. On refresh
failure, the credential is marked `auth-failed`; the next poll
becomes a no-op and the owner sees the failure in the connector-health
dashboard.

---

## 7. Polling vs webhook decision matrix

| Connector | Webhook | Poll (fallback) | Default mode |
|---|---|---|---|
| Instagram | yes (Graph webhooks) | 6h | webhook + 6h reconciliation poll |
| Facebook | yes (Page webhooks) | 6h | webhook + 6h reconciliation poll |
| TikTok | yes (sandbox + rolling prod) | 6h | poll only (P2 default); webhook opt-in |
| X | enterprise-only stream | 15min | poll only |
| LinkedIn | none | 1h | poll only |
| YouTube | yes (PuSH) | 6h | webhook (PuSH) + 6h count-refresh poll |

The brief makes the conservative choice: every connector ships a
poller, four of the six also ship a webhook receiver behind an
explicit feature flag.

---

## 8. Live-test discipline

- No real HTTP. Every test injects a `fetcher` stub.
- Webhook-signature tests use real HMAC-SHA256 + real
  Ed25519 (where applicable) against deterministic fixture bodies.
- Token-refresh tests verify the credential repo rotates the
  encrypted blob on success and marks the credential `auth-failed`
  on refresh rejection.
- Poller tests verify cursor advancement on success, retention on
  error, and idempotency on repeated poll of the same cursor.
- Normaliser tests verify the canonical shape regardless of upstream
  JSON quirks (camelCase vs snake_case, missing fields, extra
  fields).

---

## 9. Failure modes + mitigations

| Failure mode | Mitigation |
|---|---|
| Webhook duplicates | UNIQUE `(tenant_id, account, post_id)` makes ingest idempotent. |
| Webhook drops | 6h reconciliation poll catches anything the webhook missed. |
| Rate limit | Per-platform backoff in the client; the orchestrator (`@borjie/connectors`) wraps every call in a token-bucket. |
| Token expiry | Lazy-on-401 refresh + 1h proactive cron. |
| Auth revocation | `auth-failed` marker + owner notification; poller becomes no-op. |
| Schema drift | Normalisers are pure functions; new fields land in `raw` JSONB and the schema migration in a follow-up wave. |
| PII leak | Two-stage redaction: salted hash for joinable identifiers, blanking for free-text patterns. Test suite includes a redaction-coverage assertion. |

---

## 10. Reference index

- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api/)
  — title: "Instagram Graph API", Meta for Developers,
  accessed 2026-05-25.
- [Instagram Webhooks](https://developers.facebook.com/docs/instagram-api/guides/webhooks)
  — title: "Webhooks for Instagram", Meta for Developers,
  accessed 2026-05-25.
- [Facebook Page Graph API](https://developers.facebook.com/docs/graph-api/reference/page/)
  — title: "Page — Graph API Reference", Meta for Developers,
  accessed 2026-05-25.
- [TikTok Business API](https://business-api.tiktok.com/portal/docs?id=1738455508553729)
  — title: "TikTok Business API", TikTok for Business, accessed
  2026-05-25.
- [X API v2](https://developer.x.com/en/docs/x-api)
  — title: "X API v2", X Developer Platform, accessed 2026-05-25.
- [LinkedIn Marketing API](https://learn.microsoft.com/en-us/linkedin/marketing/)
  — title: "LinkedIn Marketing API", Microsoft Learn,
  accessed 2026-05-25.
- [YouTube Data API v3](https://developers.google.com/youtube/v3)
  — title: "YouTube Data API (v3)", Google Developers,
  accessed 2026-05-25.
- [YouTube PubSubHubbub Push](https://developers.google.com/youtube/v3/guides/push_notifications)
  — title: "Push Notifications", Google Developers,
  accessed 2026-05-25.
- [OAuth 2.0 RFC 6749](https://datatracker.ietf.org/doc/html/rfc6749)
  — title: "The OAuth 2.0 Authorization Framework", IETF RFC 6749,
  2012-10-01.

---

## 11. Open questions resolved

- **Why six and not all twelve?** Six is the right batch size for one
  wave: two Facebook-family + four single-provider. The other six on
  Mr. Mwikila's wishlist (Pinterest, Reddit, Telegram, Discord,
  Mastodon, Bluesky) land in OMNI-P3.
- **Why read-only?** Posting authority is a separable concern.
  P2 wires the *ingest* substrate; the *publish* substrate lands when
  the strategic-layer's approval-policy engine is ready (Wave
  CONTENT-PUB).
- **Why salted-hash usernames and not plain text?** Cognitive memory
  needs to dedup the same commenter across sources. Plain text is
  PII; salted hashing preserves dedup *and* anonymity.
- **Why does X not ship a stream client?** The enterprise filtered-stream
  tier is not in our budget for P2. The polling client meets the
  weekly-report requirement.
- **Why per-package and not one mega `social-connector`?** Each
  provider has its own auth quirks, webhook signature scheme, and
  rate-limit semantics. Per-package keeps the upstream code surface
  honest and lets us version-bump (or kill) one without touching the
  others.
- **Why does TikTok ship a webhook receiver even though prod webhooks
  are still rolling out?** Region rollout is unpredictable; we want
  the receiver ready so the tenant in question can flip the flag.

---

## § Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md

This section is the immutable reconciliation record of founder-locked SOTA findings affecting social-connector dispatch policy. Idempotent — re-running the reconcile pass is a no-op once this section exists. Persona: Mr. Mwikila.

### § MCP-first capability check

**Source**: SOTA Finding 2 in `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` — ServiceNow announcement May 2026 opening their system of action to *"every AI agent via Model Context Protocol"*. Reference: https://www.servicenow.com/company/media/press-room/mcp-every-ai-agent.html.

**Policy**: For every social connector in this spec, the build-time capability check records whether the provider exposes an official MCP server. The credentials record carries an optional `connector.mcp_server_url` field; when populated, the connector dispatcher MUST prefer MCP RPCs over native REST/Graph API for the same logical action. Native API remains as the fallback path only.

**Per-connector MCP-first capability row (as of build time)**:

| Connector | Provider exposes official MCP server? | Default ingress when `mcp_server_url` populated |
|---|---|---|
| LinkedIn | check provider docs at build time | MCP-first |
| X / Twitter | check provider docs at build time | MCP-first |
| Facebook / Meta | check provider docs at build time | MCP-first |
| Instagram | check provider docs at build time | MCP-first |
| TikTok | check provider docs at build time | MCP-first |
| YouTube | check provider docs at build time | MCP-first |
| Reddit | check provider docs at build time | MCP-first |
| Pinterest | check provider docs at build time | MCP-first |
| Mastodon / Bluesky | check provider docs at build time | MCP-first |

(The build-time check is recorded in the connector's package readme + the org-legibility map per Wave M5-6, surfacing MCP-vs-native ingress per connector.)

**Rationale**: Founder-locked direction (per Decision SOTA Finding 2): industry convergence on MCP applies equally to social connectors; this row reminds future connector authors to populate `mcp_server_url` and to default the dispatcher to MCP whenever the provider supports it.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
