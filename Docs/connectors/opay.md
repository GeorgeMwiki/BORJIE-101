# OPay Business real adapter

`OpayRealAdapter` (`services/mcp-server-opay/src/adapter-real.ts`) is
the production-grade client for Nigeria's OPay Business Merchant API.
Drop-in replacement for the existing `MockOpayAdapter`.

## Endpoints covered

| OPay endpoint                                      | Adapter method            |
| -------------------------------------------------- | ------------------------- |
| `POST /api/v3/payment/initialize`                  | `initiatePayment(...)`    |
| `GET  /api/v3/payment/status/{ref}`                | `verifyPayment(...)`      |
| `GET  /api/v3/account/balance?phone=&from=&to=`    | `cashflowLookup(...)`     |

## Auth

Each request carries:

- `Authorization: Bearer <publicKey>`
- `MerchantId: <merchantId>`
- `Signature: <HMAC-SHA512(body || path, privateKey)>` (hex)

The signature is computed via Node's built-in `crypto.createHmac` — no
third-party deps.

## Environment variables

| Var                  | Required for     | Notes                                       |
| -------------------- | ---------------- | ------------------------------------------- |
| `OPAY_ENV`           | env switch       | `sandbox` (default) or `production`         |
| `OPAY_BASE_URL`      | optional         | Overrides default base URL                  |
| `OPAY_MERCHANT_ID`   | all calls        | OPay merchant id                            |
| `OPAY_PUBLIC_KEY`    | all calls        | Used as Bearer token                        |
| `OPAY_PRIVATE_KEY`   | all calls        | HMAC-SHA512 secret                          |
| `OPAY_TIMEOUT_MS`    | optional         | Default `12000`                             |

## Sandbox vs production switch

`OPAY_ENV=sandbox` (default) routes to `https://sandboxapi.opaycheckout.com`.
`OPAY_ENV=production` routes to `https://liveapi.opaypayments.com`.

## Composition root selection

```typescript
const opay = env.OPAY_MERCHANT_ID && env.OPAY_PUBLIC_KEY && env.OPAY_PRIVATE_KEY
  ? new OpayRealAdapter({
      env: env.OPAY_ENV === 'production' ? 'production' : 'sandbox',
      credentials: {
        merchantId: env.OPAY_MERCHANT_ID,
        publicKey: env.OPAY_PUBLIC_KEY,
        privateKey: env.OPAY_PRIVATE_KEY,
      },
      timeoutMs: env.OPAY_TIMEOUT_MS ? Number(env.OPAY_TIMEOUT_MS) : undefined,
    })
  : new MockOpayAdapter(); // mock fallback
```

## Status mapping

| OPay upstream status | Adapter status |
| -------------------- | -------------- |
| `SUCCESS` / `PAID`   | `succeeded`    |
| `PENDING` / `INITIAL` / `INPROGRESS` | `pending` |
| `REVERSED` / `REFUNDED` | `reversed`  |
| (any other)          | `failed`       |
