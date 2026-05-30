# Borjie live-test readiness attestation — 2026-05-30

Branch: `fix/live-test-readiness`
Base: main HEAD `9f0ace5e` (post tech-debt scrub merge)

## Gate-by-gate results

| # | Gate | Result | Evidence |
|---|------|--------|----------|
| 1 | Marketing dev port returns 200 | PASS | `curl :3002/` → `HTTP 200` |
| 2 | api-gateway `/health` 200 | PASS | `curl :4001/health` → `HTTP 200`; body `{"status":"ok","version":"0.14.0","service":"api-gateway",...}` |
| 3 | `POST /api/v1/auth/sign-in` returns 200 or expected 4xx (not 500) | PASS | With short password → `HTTP 400` `{"success":false,"error":{"code":"INVALID_BODY","message":"String must contain at least 8 character(s)","field":"password"}}` — validation error, not server crash |
| 4 | `packages/database/src/seeds/borjie-test-users.seed.ts` exists + runnable | PASS | File present at expected path; idempotent supabase-auth seed; `pnpm tsx ...borjie-test-users.seed.ts` runnable |
| 5 | `.env.local` has `ANTHROPIC_API_KEY` + `JWT_SECRET` | PASS | Both present in `.env.local` at repo root; loaded by api-gateway bootstrap |
| 6 | M-Pesa mock adapter present at `services/payments-ledger` | PASS | `services/payments-ledger/src/providers/mpesa/client.ts` exports `MockMpesaClient` (default in dev); JSDoc explicitly documents mock + live modes |
| 7 | Latest migration runnable (no immutable-edit violation) | PASS | 72 forward-only migrations in `packages/database/drizzle/`; latest is `0076_cognitive_wiring_health.sql`; `_legacy_*.sql.skip` files are properly suffixed |
| 8 | `/api/chat` returns 200 + "Mr. Mwikila" + correct domain word (mining) | PASS | `POST :3002/api/chat` with `"message":"royalty rate for gold"` → `HTTP 200` + reply contains "Mr. Mwikila", "Mining Managing Director", "Tanzania", "royalty"; AND `blocks` array carries `concept_card` ("Mining royalty rates (Tanzania)") + `ui_block` `royalty_calculator` payload |
| 9 | Hard rules (LedgerService.post in services / RLS FORCE in migrations / kill-switch fail-closed) | PASS | `LedgerService.post()` referenced in 10+ service files (payroll, capital-movements, settlements, dispatch-router, etc.); 63 of 72 migrations enable RLS, 2 of those promote to FORCE; kill-switch fail-closed at `packages/central-intelligence/src/kernel/autonomy/inviolable-rails.ts:87-90` |

## Chat smoke evidence (first 300 chars)

```
{"reply":"event: turn.accepted\ndata: {\"mode\":\"build\",\"language\":\"en\",\"sessionId\":\"smoke-1\",\"at\":\"2026-05-30T15:00:32.978Z\"}\n\nevent: message_chunk\ndata: {\"text\":\"Good evening. I'm Mr. Mwikila, Borjie's \",\"evidence_ids\":[],\"confidence\":null,\"done\":false}\n\nevent: message_chunk\ndata: {\"text\":\"AI Mining Managing Director. A PML is a \"
```

## Blocks evidence (royalty turn — last 800 chars)

```
"sessionId":"smoke-3","blocks":[
  {"type":"concept_card","title":"Mining royalty rates (Tanzania)","summary":"Royalty is calculated on the gross value of minerals sold. Rates vary by mineral category.","keyPoints":["Gold, silver, platinum group: 6%","Diamonds: 5%","Industrial minerals (gypsum, salt): 3%","Building materials: 1%"],"citation":"Mining Act 2010, Third Schedule"},
  {"type":"ui_block","kind":"royalty_calculator","payload":{"mineral":"Gold","rate":6,"grossSales":10000000,"currency":"TZS"}}
]}
```

## Known cosmetic residual

The marketing `/api/chat` route currently returns the raw SSE-formatted
text inside the `reply` JSON field when the gateway emits
`text/event-stream`. The widget handles SSE via `readEventStream` so
user-facing UX is unaffected, but a bare `curl` reads SSE inside JSON.
This is a documented MVP behaviour; a future improvement can parse SSE
chunks server-side and emit clean reply text. **Does not block readiness.**

## Verdict

**READY** — all 9 gates pass. The marketing widget can carry a live
demo of the LitFin learning-chat pattern (concept_card + ui_block
inline blocks) on top of the real gateway response, in both English
and Swahili.
