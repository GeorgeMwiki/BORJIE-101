# @borjie/agent-platform

> A2A (Agent-to-Agent) protocol implementation for Borjie.
> Exposes Borjie's agents to external agent runtimes (other A2A-
> compliant platforms) and consumes external A2A agents inside
> Borjie workflows.

## Why this package exists

The A2A protocol is the emerging interop standard for autonomous-
agent platforms. Borjie publishes an A2A agent card so partners
can discover + invoke our brain (subject to tier + four-eye gates),
and consumes A2A cards from partner platforms so our brain can
delegate to them.

This package owns:

- The agent-card manifest (`src/agent-card.ts`)
- Agent-to-agent HMAC auth (`src/agent-auth.ts`)
- Idempotency tokens (`src/idempotency.ts`)
- Outbound webhook delivery with retry + DLQ (`src/webhook-delivery.ts`)
- Correlation-id propagation (`src/correlation-id.ts`)
- Error-code mapping (`src/error-codes.ts`)

## The agent card

`GET $PUBLIC_BASE_URL/.well-known/agent.json` serves the public
manifest. Shape (subset):

```json
{
  "schemaVersion": "0.2.0",
  "name": "Borjie",
  "description": "AI-native property management OS — Tanzania-first",
  "version": "1.0.0",
  "endpoints": {
    "invoke": "$PUBLIC_BASE_URL/api/v1/a2a/invoke",
    "stream": "$PUBLIC_BASE_URL/api/v1/a2a/stream"
  },
  "auth": {
    "type": "hmac-sha256",
    "keyHeader": "X-Agent-Key-Id",
    "signatureHeader": "X-Agent-Signature"
  },
  "capabilities": ["chat", "tool-use", "streaming", "tasks"],
  "tools": [/* curated A2A subset of HQ tools */],
  "policies": {
    "rateLimit": { "rpm": 60 },
    "approvalRequired": ["destroy", "billing", "external-comm"]
  }
}
```

External agents read the card, register the credentials side-channel,
and invoke endpoints with HMAC-signed requests.

## Authentication — HMAC

`src/agent-auth.ts` implements per-agent HMAC:

1. Each registered partner agent has a (key_id, secret) pair stored
   server-side in `agent_credentials`.
2. The caller computes `HMAC-SHA256(secret, timestamp + body)`.
3. Headers carry `X-Agent-Key-Id`, `X-Agent-Signature`, `X-Agent-Timestamp`.
4. Server rejects requests with timestamp drift > 5 min (replay defense).
5. Per-key rate limits apply.

Compromise response: revoke the key in `agent_credentials.revoked=true`.

## Idempotency

`src/idempotency.ts` enforces idempotency on mutating A2A operations:

- Caller passes `Idempotency-Key` header (UUID).
- Server stores `(key_id, idempotency_key)` → response for 24h.
- Re-sent identical key returns the original response, never re-executes.
- Different body under same key → 422.

Critical for cross-agent retries; without it, money can move twice.

## Webhook delivery

`src/webhook-delivery.ts` is the outbound webhook engine:

- Per-subscription HMAC signing (`WEBHOOK_DEFAULT_HMAC_SECRET` or per-tenant override)
- Exponential backoff: 1m, 5m, 30m, 2h, 12h
- Dead-letter queue (DLQ) after 5 failed attempts
- SSRF guard: rejects private-IP destinations unless `WEBHOOK_SSRF_ALLOW_PRIVATE=true` (dev only)
- TLS verification (no `rejectUnauthorized: false` in prod)

Inspection:

```sql
SELECT id, status, attempts, last_error, next_retry_at
  FROM webhook_deliveries
 WHERE subscription_id = '<id>'
 ORDER BY created_at DESC LIMIT 50;
```

## Correlation IDs

`src/correlation-id.ts` propagates `traceparent` (W3C trace-context)
across:

- Inbound HTTP → kernel turn → outbound A2A → outbound webhook
- pino logs (`traceId`, `spanId`)
- Sentry breadcrumbs

End-to-end traces visible in OpenTelemetry collector.

## Error codes

`src/error-codes.ts` defines the Borjie A2A error code set,
mapped to HTTP status:

| Code | HTTP | Meaning |
|---|---|---|
| `AGENT_AUTH_INVALID` | 401 | HMAC mismatch or revoked key |
| `AGENT_RATE_LIMITED` | 429 | Per-key RPM exceeded |
| `AGENT_TIER_DENIED` | 403 | Caller tier below required |
| `AGENT_APPROVAL_REQUIRED` | 202 | Destructive op queued for four-eye |
| `AGENT_IDEMPOTENCY_CONFLICT` | 422 | Same key, different body |
| `AGENT_PROVIDER_UNAVAILABLE` | 503 | Downstream LLM provider down |

## Registering an external A2A agent

1. Obtain the partner's agent-card URL.
2. Verify the card with `pnpm -C scripts ts-node verify-agent-card.ts <url>`.
3. Provision a credential pair in `agent_credentials` (manual SQL or
   via the HQ tool `platform.register_external_agent`).
4. Register the agent in the kernel's tool catalog as a remote tool.
5. Test with a `read`-tier invocation first.

## Configuration

```bash
PUBLIC_BASE_URL=https://api.borjie.com    # serves the agent card
WEBHOOK_DEFAULT_HMAC_SECRET=<32-byte secret>
WEBHOOK_SSRF_ALLOW_PRIVATE=false              # true only in dev
```

## Testing

```bash
pnpm -F @borjie/agent-platform test
```

## Related

- `packages/central-intelligence/README.md`
- `packages/mcp-server/README.md` (different protocol, similar surface)
- `Docs/API_SPEC.yaml`
- `Docs/RUNBOOKS/four-eye-approval-review.md`
