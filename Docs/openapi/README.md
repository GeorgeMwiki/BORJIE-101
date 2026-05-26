# Borjie Mining API — OpenAPI 3.1 Spec

This directory holds the static OpenAPI 3.1 specification for the
Borjie mining sub-API (`/api/v1/mining/*`).

- Spec: [`borjie-mining.yaml`](./borjie-mining.yaml)
- Generator: [`../../scripts/generate-openapi-spec.mjs`](../../scripts/generate-openapi-spec.mjs)
- Component schemas: [`../../scripts/openapi-component-schemas.mjs`](../../scripts/openapi-component-schemas.mjs)
- Source of truth: `services/api-gateway/src/routes/mining/*.hono.ts`

The spec is regenerated automatically on every api-gateway build (via
the `prebuild` npm script). It is checked in so consumers without a
Node toolchain can read it directly off `main`.

---

## Viewing the spec

### In the running gateway

Boot the api-gateway, then open:

| URL | Purpose |
| --- | --- |
| `http://localhost:3001/api/v1/mining/docs` | Swagger UI (interactive) |
| `http://localhost:3001/api/v1/mining/openapi.yaml` | Raw YAML download |

> The default `PORT` for the api-gateway is `4000`. The spec advertises
> `localhost:3001` per the brief; substitute whatever port your process
> actually bound to.

### Without booting anything

Open `borjie-mining.yaml` in:

- Swagger Editor: <https://editor.swagger.io/> (File → Import file)
- VS Code with the *OpenAPI (Swagger) Editor* extension
- Stoplight Studio, Postman, Bruno, any OpenAPI 3.1 viewer

### Published on GitHub Pages

A static mirror of the spec ships to GitHub Pages on every push to `main`
that touches the spec or the mining route handlers. No checkout, no
api-gateway, no toolchain required — share these URLs with partners and
auditors:

| URL | Purpose |
| --- | --- |
| <https://georgemwiki.github.io/BORJIE-101/> | Landing page (links to all three views) |
| <https://georgemwiki.github.io/BORJIE-101/swagger-ui/> | Swagger UI (interactive try-it-out) |
| <https://georgemwiki.github.io/BORJIE-101/redoc/> | ReDoc (three-pane reference) |
| <https://georgemwiki.github.io/BORJIE-101/borjie-mining.yaml> | Raw YAML download |

The publish pipeline lives in
[`.github/workflows/borjie-publish-docs.yml`](../../.github/workflows/borjie-publish-docs.yml).
It regenerates the spec, builds the static site via
[`scripts/build-pages-site.mjs`](../../scripts/build-pages-site.mjs), and
deploys via `actions/deploy-pages@v4`. Triggers: push to `main` touching
`docs/openapi/**` or `services/api-gateway/src/routes/mining/**`, plus
manual `workflow_dispatch`.

---

## Regenerating

From the repo root:

```bash
node scripts/generate-openapi-spec.mjs
# or
pnpm openapi:generate
```

The generator is also wired into the api-gateway build:

```bash
pnpm -F @borjie/api-gateway build   # runs `prebuild` first, refreshing the spec
```

Stats printed by the generator:

```
paths:                  60
routes migrated:        20
routes pending (regex): 55
schemas:                34
response shapes:        298
```

---

## How it works (issue #19 — migrated to `@hono/zod-openapi`)

The generator was rewritten in issue #19. The previous Option B
regex-only path is preserved as a fallback for un-migrated routes; see
issue #60 for the remaining work.

1. **First-class path:** `scripts/build-mining-openapi-spec.ts`
   imports `migratedRoutes` from
   `services/api-gateway/src/routes/mining/_openapi/route-defs.ts`.
   That module declares each route via `createRoute({ method, path,
   request, responses })`, where `request.body`, `request.params`,
   `request.query`, and every `responses[<status>]` slot carries a
   Zod schema annotated with `.openapi('Name')`. The TS builder
   registers each route on an `OpenAPIRegistry`, then calls
   `OpenApiGeneratorV31.generateDocument(...)` to emit the 3.1
   document with typed request + response shapes.
2. **Regex fallback:** files still marked with
   `// TODO(openapi-migration)` are not in `migratedRoutes` yet. The
   builder walks `services/api-gateway/src/routes/mining/**/*.hono.ts`,
   regex-parses `app.<method>('<path>', ...)` registrations, and emits
   a minimal path item with a generic `ApiSuccessEnvelope` 200 +
   standard 4xx envelopes. These operations carry an
   `x-openapi-migration` extension pointing at the tracking issue.
3. **Wrapper:** `scripts/generate-openapi-spec.mjs` is a thin Node
   wrapper that shells out to `tsx` so the TS builder Just Works in
   the `prebuild` and CI environments.

When every mining route is migrated (issue #60), the regex fallback
and the hand-rolled `scripts/openapi-component-schemas.mjs` will be
removed.

---

## Known gaps (do not trust the spec blindly)

Migrated routes (sites, licences, cockpit, chat, marketplace, bids)
have full typed shapes for request bodies, path params, query strings,
and per-status responses. The remaining 26 route files (tracked in
issue #60) still rely on regex parsing and therefore inherit the gaps
listed below.

1. **Generic response shapes (regex routes only).** Operations from
   un-migrated files declare `200` → `ApiSuccessEnvelope` + standard
   4xx envelopes. Resolve by completing the migration in issue #60.
2. **Query parameters absent (regex routes only).** Handlers that read
   `c.req.query('foo')` without a Zod validator surface no query
   parameters in the spec.
3. **Schema drift.** `scripts/openapi-component-schemas.mjs` is no
   longer consulted by the new generator — it remains in tree for
   reference until the regex fallback is retired.
4. **Auth, RLS, and tenant scoping are not in scope.** Every operation
   carries `security: BearerAuth`. Per-role gating
   (`requireRole(SUPER_ADMIN)` on `/internal/*`) and per-tenant RLS
   are documented in the source but not encoded in the spec.

---

## Why is this not at `/api/v1/docs`?

The brief originally asked for the Swagger UI to live at
`/api/v1/docs`. That path is already owned by the global OpenAPI
router (see `services/api-gateway/src/openapi.ts`), which serves the
full-gateway spec. To avoid colliding with that surface — and to keep
the mining docs grouped with the mining routes — the mining Swagger
UI is mounted under the mining sub-tree:

| What | Path |
| --- | --- |
| Mining Swagger UI | `/api/v1/mining/docs` |
| Mining raw YAML | `/api/v1/mining/openapi.yaml` |
| Full-gateway Swagger UI (pre-existing) | `/api/v1/docs` |
| Full-gateway JSON (pre-existing) | `/api/v1/openapi.json` |
