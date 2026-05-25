# M-Pesa Daraja real adapter

`createMpesaRealAdapter` (`packages/connectors/src/adapters/mpesa-real.ts`)
is the production-grade Safaricom Daraja v2.0 client. Tests inject `fetch`;
no real network in CI.

## Endpoints covered

| Daraja endpoint                              | Adapter method            |
| -------------------------------------------- | ------------------------- |
| `GET  /oauth/v1/generate?...`                | (internal, cached)        |
| `POST /mpesa/stkpush/v1/processrequest`      | `stkPush(...)`            |
| `POST /mpesa/c2b/v2/registerurl`             | `registerC2bUrl(...)`     |
| C2B confirmation webhook                     | `parseC2bCallback(body)`  |
| `POST /mpesa/b2c/v3/paymentrequest`          | `payB2c(...)`             |
| `POST /mpesa/transactionstatus/v1/query`     | `queryTransactionStatus(...)` |
| `POST /mpesa/accountbalance/v1/query`        | `queryAccountBalance(...)`|

## Environment variables

| Var                                | Required for          | Notes                                              |
| ---------------------------------- | --------------------- | -------------------------------------------------- |
| `MPESA_ENV`                        | env switch            | `sandbox` (default) or `production`                |
| `MPESA_CONSUMER_KEY`               | all calls             | OAuth client id issued by Daraja                   |
| `MPESA_CONSUMER_SECRET`            | all calls             | OAuth client secret                                |
| `MPESA_SHORT_CODE`                 | STK / C2B / B2C       | Paybill / till number                              |
| `MPESA_PASS_KEY`                   | STK push only         | Lipa-na-M-Pesa Online pass-key                     |
| `MPESA_INITIATOR_NAME`             | B2C / status / balance| Operator initiator name                            |
| `MPESA_SECURITY_CREDENTIAL`        | B2C / status / balance| RSA-encrypted password (per Daraja docs)           |
| `MPESA_BASE_URL`                   | optional override     | Wins over `MPESA_ENV` when set                     |

## Sandbox vs production switch

`MPESA_ENV=sandbox` (default) routes to `https://sandbox.safaricom.co.ke`.
`MPESA_ENV=production` routes to `https://api.safaricom.co.ke`. A
caller-supplied `baseUrl` overrides the env default.

## OAuth token caching

The adapter caches the bearer token returned by `/oauth/v1/generate`
until `expires_in - 60s` before refresh. The base connector's oauth2
auth mode also triggers a single refresh attempt on a 401 response.

## Composition root selection

```typescript
const mpesa = env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET && env.MPESA_SHORT_CODE
  ? createMpesaRealAdapter({
      env: env.MPESA_ENV === 'production' ? 'production' : 'sandbox',
      credentials: {
        consumerKey: env.MPESA_CONSUMER_KEY,
        consumerSecret: env.MPESA_CONSUMER_SECRET,
        shortCode: env.MPESA_SHORT_CODE,
        passKey: env.MPESA_PASS_KEY,
        initiatorName: env.MPESA_INITIATOR_NAME,
        securityCredential: env.MPESA_SECURITY_CREDENTIAL,
      },
    })
  : createMpesaAdapter(); // stub fallback
```
