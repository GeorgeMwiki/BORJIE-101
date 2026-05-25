# Agent-Platform Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/agent-platform/`
**Public entry:** `packages/agent-platform/src/index.ts`
**Tier scope:** all (A2A — agent-to-agent)

## Purpose

Agent-to-agent (A2A) substrate: how external or internal agents
register, authenticate, and exchange typed events with the
Borjie platform. Owns the HMAC signature scheme, scope catalogue,
idempotency keys, correlation IDs, agent cards, and a typed error
catalogue with retryability flags. Used by webhooks, MCP servers,
and the autonomous-actions pipeline.

## Entry points

- `verifyAgentRequest({ headers, body, scopes, secretLookup })` —
  HMAC + nonce + replay-window verification (`agent-auth.ts`).
- `signRequest(canonicalString, secret)` — outbound signer.
- `buildCanonicalString({ method, path, body, ts, nonce })` —
  deterministic string for HMAC.
- `createAgentError(code, message, details?)` — typed error envelope
  with `getErrorHttpStatus` + `isRetryableError`.
- `getCorrelationId(headers)` + `correlationHeaders()` +
  `forwardHeaders()` — trace propagation.
- `WebhookSubscription` + delivery types — webhook fan-out contract.
- `AgentCard` — agent capability discovery card.

## Internal structure

- `agent-auth.ts` — verify + sign.
- `agent-card.ts` — agent capability descriptor.
- `correlation-id.ts` — header propagation.
- `error-codes.ts` — `AgentErrorCode` enum + HTTP map + retry policy.
- `idempotency.ts` — `IdempotencyRecord` write + lookup.
- `types.ts` — `RegisteredAgent`, `AgentScope`, `AgentStatus`,
  `WebhookSubscription`, `WebhookDelivery`,
  `SUBSCRIBABLE_EVENTS`, `ALL_AGENT_SCOPES`.
- `webhook-delivery.ts` — retry + DLQ.

## Dependencies

- Upstream: `services/webhooks` (M-Pesa STK callback, Stripe events),
  `services/mcp-server-*` (FIRS, NGGIS, NIN, OPay, process-intel),
  agent-platform-portal app.
- Downstream: `packages/database` (idempotency table, webhook
  delivery log), `packages/observability` (correlation propagation),
  `services/api-gateway` (verifies inbound + signs outbound).

## Common workflows

- **Register an agent** → admin route writes a `RegisteredAgent`
  with `agentId`, `secretHash` (Argon2id), `scopes`,
  `webhookEndpoint`. Status defaults to `pending`.
- **Verify an inbound webhook** → call `verifyAgentRequest` with
  required scopes; rejects on signature mismatch, replay (ts > 5m
  drift), or nonce reuse.
- **Send an outbound webhook** → `webhook-delivery` queues with
  exponential backoff (1s → 32s) then DLQ. Retry filter uses
  `isRetryableError(code)` (network = retry; auth = no-retry).
- **Idempotent operation** → caller passes `Idempotency-Key`;
  `idempotency.ts` stores response for the TTL window (24h).
- **Add a new error code** → extend `AgentErrorCode` enum + register
  status + retryability in `error-codes.ts`.

## Anti-patterns to avoid

- Never compare HMACs with `==` — `agent-auth.ts` uses
  `crypto.timingSafeEqual`.
- Never widen the replay window beyond 5 minutes — defeats nonce.
- Never store the agent secret in plaintext — Argon2id hash only.
- Webhook delivery is at-least-once; consumers MUST be idempotent
  via the `Idempotency-Key` header.
- Never invent ad-hoc error codes in services — extend the enum.

## Related codemaps

- [api-gateway.md](./api-gateway.md) — verifies inbound
- [observability.md](./observability.md) — correlation propagation
- [database.md](./database.md) — idempotency + delivery log
- [payments-ledger.md](./payments-ledger.md) — webhook flows
