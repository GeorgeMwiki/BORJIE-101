# KRA eRITS real adapter

`createKraEritsRealAdapter`
(`packages/connectors/src/adapters/kra-erits-real.ts`) is the
production-grade client for the Kenya Revenue Authority's Electronic
Rental Income Tax System (a.k.a. iTax MRI module).

## Endpoints covered

| KRA endpoint                          | Adapter method        |
| ------------------------------------- | --------------------- |
| `POST /erits/login`                   | (internal, cached)    |
| `GET  /erits/version`                 | `checkSchemaVersion()`|
| `POST /erits/submitMri`               | `submitMri(...)`      |
| `GET  /erits/getReceipt?...`          | `getReceipt(...)`     |
| `POST /erits/cancelFiling`            | `cancelFiling(...)`   |
| (pure) tax-period validation          | `validatePeriod(...)` |

## Environment variables

| Var                          | Required for     | Notes                                                |
| ---------------------------- | ---------------- | ---------------------------------------------------- |
| `KRA_ENV`                    | env switch       | `sandbox` (default) or `production`                  |
| `KRA_BASE_URL`               | optional         | Overrides default base URL                           |
| `KRA_USERNAME`               | all calls        | iTax portal username (typically `<PIN>.<suffix>`)    |
| `KRA_PASSWORD`               | all calls        | iTax password                                        |
| `KRA_ENTITY_PIN`             | optional         | Filing-entity PIN (defaults to username's PIN)       |
| `KRA_API_SCHEMA_VERSION`     | optional         | If set, adapter probes `/erits/version` pre-submit   |
| `KRA_SESSION_TTL_SEC`        | optional         | Default `1800`                                       |

## Sandbox vs production switch

`KRA_ENV=sandbox` (default) routes to `https://itax-sandbox.kra.go.ke`.
`KRA_ENV=production` routes to `https://itax.kra.go.ke`. The
`KRA_BASE_URL` env var (or `baseUrl` factory option) overrides.

## Schema version checking

When `KRA_API_SCHEMA_VERSION` is set, `submitMri` first probes
`/erits/version` and refuses the submission with
`{ kind: 'unconfigured' }` if the upstream version differs. This
prevents tenants from silently submitting against an incompatible
upstream change.

## Period validation

`validateTaxPeriod()` is a pure helper exported alongside the adapter:

- Rejects malformed `YYYY-MM`.
- Rejects a period still open (current month not yet closed).
- Rejects periods >12 months old (callers must use the manual
  amendment workflow).

## Composition root selection

```typescript
const kra = env.KRA_USERNAME && env.KRA_PASSWORD
  ? createKraEritsRealAdapter({
      env: env.KRA_ENV === 'production' ? 'production' : 'sandbox',
      credentials: {
        username: env.KRA_USERNAME,
        password: env.KRA_PASSWORD,
        entityPin: env.KRA_ENTITY_PIN,
        expectedSchemaVersion: env.KRA_API_SCHEMA_VERSION,
      },
      sessionTtlSec: env.KRA_SESSION_TTL_SEC
        ? Number(env.KRA_SESSION_TTL_SEC)
        : undefined,
    })
  : null; // fall back to NotYetWired stub upstream
```
