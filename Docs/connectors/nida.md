# NIDA NIVS real adapter

`createNidaRealAdapter` (`packages/connectors/src/adapters/nida-real.ts`)
is the production-grade client for Tanzania's National Identification
Authority biometric verification service.

## Endpoints covered

| NIDA endpoint                  | Adapter method        |
| ------------------------------ | --------------------- |
| `POST /oauth/token`            | (internal, cached)    |
| `POST /v1/identity/verify`     | `verifyIdentity(...)` |

## Environment variables

| Var                       | Required for       | Notes                                                |
| ------------------------- | ------------------ | ---------------------------------------------------- |
| `NIDA_ENV`                | env switch         | `sandbox` (default) or `production`                  |
| `NIDA_BASE_URL` (legacy)  | optional           | Used by the legacy `createNidaAdapter` fallback only |
| `NIDA_CONSUMER_KEY`       | OAuth2 auth        | NIDA partner OAuth client id                         |
| `NIDA_CONSUMER_SECRET`    | OAuth2 auth        | NIDA partner OAuth client secret                     |
| `NIDA_API_KEY`            | api-key auth       | NIDA partner API key (tier-1 partners)               |
| `NIDA_API_KEY_HEADER`     | optional           | Defaults to `x-api-key`                              |

Composition order in `services/api-gateway/src/composition/hq-tool-port-bindings.ts`:

1. If `NIDA_CONSUMER_KEY` + `NIDA_CONSUMER_SECRET` set → real OAuth2 adapter.
2. Else if `NIDA_ENV` + `NIDA_API_KEY` set → real api-key adapter.
3. Else if `NIDA_GATEWAY_URL` set → legacy `createNidaAdapter`.
4. Else → NOT_YET_WIRED stub.

## Sandbox vs production switch

`NIDA_ENV=sandbox` (default) routes to `https://nivs-sandbox.nida.go.tz`.
`NIDA_ENV=production` routes to `https://nivs.nida.go.tz`.

## Rate-limit handling

NIDA's published cap is 60 calls/min/integration partner with burst 10.
The base connector enforces this client-side. Upstream-429 responses
are translated into `{ kind: 'rate-limited', retryAfterMs: 60000 }` so
callers can back off without parsing `upstream-error`.

## Privacy

- `BiometricHashSchema` enforces SHA-256 hex shape — raw biometric
  templates can never leave the device.
- Optional 8-4-6-2 hyphens are stripped before forwarding to NIDA.
