# GePG real adapter

`createGepgRealAdapter` (`packages/connectors/src/adapters/gepg-real.ts`)
is the production-grade client for Tanzania's Government e-Payment Gateway
(GePG v3.5 JSON rail).

## Endpoints covered

| GePG endpoint                                            | Adapter method               |
| -------------------------------------------------------- | ---------------------------- |
| `POST /api/control-numbers/generate`                     | `generateControlNumber(...)` |
| `GET  /api/control-numbers/{id}/status`                  | `inquireStatus(...)`         |
| `POST /api/control-numbers/{id}/cancel`                  | `cancelControlNumber(...)`   |
| `POST /api/reconciliation/daily`                         | `dailyReconciliation(...)`   |

Helpers for the legacy XMLDSig rail are exported separately:
`toGepgBillXml()` and `extractXmlTag()`.

## Environment variables

| Var                          | Required for      | Notes                                       |
| ---------------------------- | ----------------- | ------------------------------------------- |
| `GEPG_ENV`                   | env switch        | `sandbox` (default) or `production`         |
| `GEPG_BASE_URL`              | optional          | Overrides default base URL                  |
| `GEPG_SP_CODE`               | all calls         | SP code assigned by GePG at SP onboarding   |
| `GEPG_API_KEY`               | all calls         | Partner API key (sent as `x-gepg-api-key`)  |
| `GEPG_FORMAT`                | optional          | `json` (default) or `xml`                   |

## Sandbox vs production switch

`GEPG_ENV=sandbox` (default) routes to `https://gepg-sandbox.tz.go`.
`GEPG_ENV=production` routes to `https://gepg.tz.go`.

## Transport

The adapter rides the **JSON** rail by default — GePG v3.5+ partners
get this surface. The XML rail remains exposed as
`toGepgBillXml()` + `extractXmlTag()` for callers that need to sign and
transport the legacy XMLDSig envelope themselves.

## Composition root selection

```typescript
const gepg = env.GEPG_SP_CODE && env.GEPG_API_KEY
  ? createGepgRealAdapter({
      env: env.GEPG_ENV === 'production' ? 'production' : 'sandbox',
      credentials: { spCode: env.GEPG_SP_CODE, apiKey: env.GEPG_API_KEY },
    })
  : null; // fall back to NotYetWired stub upstream
```
