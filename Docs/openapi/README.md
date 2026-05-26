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
files scanned:    26
paths:            49
endpoints:        63
tags:             26
schemas resolved: 34
```

---

## How it works (Option B — pragmatic)

We considered two approaches:

1. **Option A (purist):** Convert every `.hono.ts` route to `OpenAPIHono`
   + `createRoute` registrations. Schemas, request bodies, and responses
   would all derive from Zod via `@hono/zod-openapi`. The result would
   be 100 % accurate but the refactor touches all 26 mining files and
   carries behavioural risk (Hono's `OpenAPIHono` has subtle handler-
   signature differences vs the plain `Hono` class today).
2. **Option B (pragmatic — what we ship):** A small Node script regex-
   parses each `.hono.ts` file, extracts:
   - `app.<method>('<path>', ...)` registrations,
   - any adjacent `zValidator('json', <SchemaName>)` call,
   - the nearest preceding `//` or `/* */` comment as a `summary`,

   and emits an OpenAPI 3.1 YAML document. Schemas referenced by name
   (`<SchemaName>`) are resolved against a hand-written JSON-Schema
   catalog in `scripts/openapi-component-schemas.mjs`.

The generator is purely a build-time tool — it never executes any
gateway code and has no runtime dependencies beyond Node's built-ins
(no `js-yaml`, no `@asteasolutions/zod-to-openapi`).

---

## Known gaps (do not trust the spec blindly)

The spec is **best-effort** and reflects the static surface of the
mining routes. The following gaps are explicitly known:

1. **Response shapes are generic.** Every operation declares the same
   four-or-five response codes (`200`, `201` on POST, `400`, `401`,
   `404`) all returning either `ApiSuccessEnvelope` or
   `ApiErrorEnvelope`. The actual `data` payload shape (`{ success:
   true, data: <Row> }`) is **not** reflected — we would need either
   Drizzle row-type introspection or a manual mapping for that.
2. **Query parameters are not enumerated.** Handlers that read
   `c.req.query('foo')` are not surfaced as `parameters: in: query`
   entries. Only path params (`:id` → `{id}`) are emitted. Hits on a
   `zValidator('query', ...)` are flagged via the
   `x-query-zod-schema` extension instead.
3. **Schema drift.** `scripts/openapi-component-schemas.mjs` is hand-
   maintained. When a `.hono.ts` file changes its Zod schema, you
   must update the matching entry in the catalog. The generator
   warns about any `zValidator('json', <Name>)` whose `<Name>` is
   not in the catalog (logged as `unmapped zValidator schemas` in
   the build output; flagged in the spec via
   `x-zod-schema-unmapped: <Name>`).
4. **SSE endpoints look like normal JSON.** `/mining/chat` is a
   Server-Sent Events stream; the spec lists it as a regular POST
   returning `application/json`. Treat the OpenAPI entry as a
   discovery hint; refer to `chat.hono.ts` for the actual frame
   format.
5. **Auth, RLS, and tenant scoping are not in scope.** Every operation
   carries `security: BearerAuth`. Per-role gating
   (`requireRole(SUPER_ADMIN)` on `/internal/*`) and per-tenant RLS
   are documented in the source but not encoded in the spec.
6. **The generator is regex-based.** It will silently miss exotic
   call patterns — for example, dynamically-built paths
   (`app.get(buildPath('/x'), ...)`), routes registered inside
   helper functions, or schemas constructed inline
   (`zValidator('json', z.object({ ... }))`). The mining sub-API
   does not use any of these today, but a future refactor could
   introduce them.

If you need a fully-accurate spec for a partner integration, the
right move is Option A: migrate the specific router to `OpenAPIHono`
and let `@asteasolutions/zod-to-openapi` derive the schemas. The
existing global gateway spec (mounted at `/api/v1/openapi.json` +
`/api/v1/docs`) already follows that pattern and is the longer-term
target for the mining routes too.

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
