# infrastructure/k8s/services — drift cleanup

Removed on 2026-04-21 as part of DEPLOY blocker B:

- `notifications-deployment.yaml` — referenced `borjie/notifications:latest`.
  No Dockerfile produces that image; `services/notifications` has no HTTP
  server bootstrap (`listen(` / `serve(` / `hono.fetch`) — it is a pure
  library consumed in-process by `api-gateway`.
- `payments-deployment.yaml` — referenced `borjie/payments:latest`.
  Same story: pure library under `services/payments`, no Dockerfile, no
  HTTP entrypoint. Consumed in-process.
- `reports-deployment.yaml` — referenced `borjie/reports:latest`.
  The only HTTP surface in `services/reports` is `src/scheduler/scheduler-runner.ts`,
  which is already shipped as the separate `borjie/scheduler:latest` image
  via `docker/Dockerfile.scheduler`. The `reports` image is orphan.
- `kustomization.yaml` — empty after the three deployments were removed.
  The parent `infrastructure/k8s/kustomization.yaml` was updated to drop
  the `services` entry.

Authoritative statement on library services lives in `docker/Dockerfile.service`
(top comment) and `docker-compose.yml` (lines 96-117). Adding these services
back as standalone deployables requires a thin HTTP wrapper (hono/express)
exposing `/healthz` plus a Dockerfile — tracked as a known gap.

## Update 2026-05-25 — P98 K8s sweep

The current authoritative K8s manifests live under `infra/k8s/` (note: the
sibling directory, NOT this `infrastructure/k8s/` legacy path). The P98
sweep added per-service trees for:

- **Singleton-loop workers** (Deployment + NetworkPolicy + ExternalSecret):
  `consolidation-worker`, `outbox-processor`, `proactive-triggers-worker`
- **Stdio MCP servers** (Deployment + NetworkPolicy + ExternalSecret, no
  Service since transport is stdio):
  `mcp-server-firs`, `mcp-server-nin`, `mcp-server-nggis`,
  `mcp-server-opay`, `mcp-server-process-intel`
- **HTTP service** (full Deployment + Service + HPA + PDB + NetworkPolicy
  + ServiceMonitor + ExternalSecret): `payments-ledger` on port 3001
  (the only `services/*` member with an actual `app.listen()` call —
  see `services/payments-ledger/src/server.ts`)

`payments-ledger` is the renamed successor to the orphaned
`borjie/payments:latest` image referenced above. It owns the
double-entry ledger (CLAUDE.md hard rule: every credit/debit goes
through `LedgerService.post()`).

`services/notifications`, `services/payments`, `services/reports`,
`services/document-intelligence`, `services/identity`,
`services/webhooks`, `services/domain-services` remain pure
in-process libraries imported by api-gateway and ship no standalone
K8s manifest.
