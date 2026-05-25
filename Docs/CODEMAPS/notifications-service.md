# Notifications Service Codemap

**Last Updated:** 2026-05-22
**Module:** `services/notifications/`
**Public entry:** `services/notifications/src/index.ts`
**Tier scope:** platform spine (multi-channel notifications)

## Purpose

Multi-channel notification dispatcher. Supports WhatsApp Business
API (Meta), SMS via Africa's Talking, email via SendGrid/SES/SMTP,
push via Firebase, and in-app notifications. Provides per-user
delivery preferences, queue-based async dispatch, template-driven
rendering, and provider failover. Used by domain-services for
lease-renewal, payment, and incident notifications.

## Entry points

- `src/index.ts` — barrel.
- `src/dispatcher.ts` — main `dispatch(notification)` entry.
- `src/config.ts` — provider config schema.
- `src/preferences/` — per-user delivery preferences.
- `src/providers/` — provider adapters (WhatsApp, SES, SendGrid).
- `src/queue/` — Redis-backed delivery queue.
- `src/repositories/` — preference + delivery persistence.
- `src/sms/` — Africa's Talking client.
- `src/storage/` — historical delivery log.
- `src/templates/` — Handlebars-style templates.
- `src/logger.ts` — service-local logger.

## Internal structure

- `providers/` — per-channel adapters with a uniform interface.
- `queue/` — at-least-once with idempotency keys.
- `templates/` — rendered with locale + tenant brand.

## Dependencies

- Upstream: `@borjie/observability`, `@borjie/config`,
  `@borjie/domain-models`, ioredis.
- Downstream: domain-services, reports, webhooks.

## Common workflows

- **Send a notification** → `dispatcher.send({ to, channel, template, vars })`.
- **Honour preferences** → preferences lookup before channel pick.
- **Render** → template + tenant locale + brand colours.
- **Fail over** → provider chain (e.g. SendGrid → SES).

## Anti-patterns to avoid

- Never send without checking user preferences.
- Never log full notification body — may contain PII.
- Never bypass the queue for "urgent" — use higher priority lane.
- Never share provider creds across tenants.

## Related codemaps

- [reports-service.md](./reports-service.md) — primary caller
- [observability.md](./observability.md) — delivery metrics
- [domain-services.md](./domain-services.md) — lease/payment hooks
