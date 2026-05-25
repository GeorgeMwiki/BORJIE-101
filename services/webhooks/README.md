# @borjie/webhooks-service

Outbound + inbound webhook relay. Signs outgoing events (HMAC), verifies inbound provider callbacks (M-Pesa, GePG, Stripe), and persists delivery state with retry/backoff.

## Run

```bash
pnpm --filter @borjie/webhooks-service dev
```
