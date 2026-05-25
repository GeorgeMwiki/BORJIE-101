# @borjie/api-gateway

BFF / API gateway for BORJIE. Express + Hono. Terminates JWT auth, enforces `@borjie/authz-policy`, fans out to domain services, and exposes the OpenAPI surface documented in `Docs/api/openapi.yaml`.

## Run

```bash
pnpm --filter @borjie/api-gateway dev   # port 4000
```

Routes live in `src/routes/`.
