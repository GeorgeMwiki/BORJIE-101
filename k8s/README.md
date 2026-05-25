# BORJIE on Kubernetes

Kubernetes + Helm chart for the BORJIE multi-tenant property
management SaaS. The chart ships 4 frontend portals + 4 backend
services + Postgres + Redis behind a single `helm install`.

> Mirrors the structure used in the LITFIN project's `k8s/` tree but
> adapted to BORJIE's app/service topology.

## Two deployment paths

BORJIE supports two deployment shapes. Pick one per environment.

### Default — PaaS (Vercel + Fly.io + Supabase + Upstash)

For most tenants and for our own SaaS instance we run on managed
PaaS. This is the default and what `docker-compose.*.yml` plus the
GitHub Actions workflows in `.github/workflows/` already deliver. The
k8s manifests here are **not used** in that path.

### Sovereign cloud — Kubernetes (this directory)

When a customer requires data-sovereign hosting on their own cloud
(GCP, AWS, Azure UAE, on-prem k3s, Vultr, Hetzner, Liquid Telecom DCK,
Equinix Metal), the same workloads ship as the Helm chart in
`helm/borjie/`. Use this when:

- Regulator forbids leaving the cloud account / jurisdiction (BoT,
  TCRA, GDPR Art. 49 transfers).
- Tenant requires VPC peering with their own systems.
- Tenant requires their own KMS / HSM for field encryption.
- We need >100 tenants of >1k units each on dedicated infra.

## One-command install

```bash
# Stage 1: bring up platform components (one-time per cluster)
# See runbooks/first-time-deploy.md for the full bootstrap.

# Stage 2: deploy the chart
helm install borjie ./k8s/helm/borjie \
  --namespace borjie-staging --create-namespace \
  -f ./k8s/helm/borjie/values-staging.yaml \
  --set image.tag=$(git rev-parse --short=12 HEAD) \
  --atomic --timeout 15m \
  --wait
```

That's it. The pre-upgrade migration Job runs first; if anything goes
wrong `--atomic` rolls back automatically.

## What ships here

```
k8s/
  README.md                          (this file)
  Tiltfile                           hot-reload dev against k3d
  k3d-cluster.yaml                   3-node local cluster config
  scripts/
    build-and-push.sh                build + push 8 images + update values
  helm/borjie/                   Helm chart wrapping all manifests
    Chart.yaml
    values.yaml                      Per-env override starting point
    templates/
      _helpers.tpl                   Common labels + image ref + SCs
      <app>.deployment.yaml          x4 frontend apps
      <app>.service.yaml             x4 ClusterIP services
      <app>.hpa.yaml                 x4 HPAs (CPU + memory triggers)
      <app>.networkpolicy.yaml       x4 explicit allow rules
      <service>.deployment.yaml      x4 backend services
      <service>.service.yaml         x4 ClusterIP services
      <service>.hpa.yaml             x4 HPAs
      <service>.networkpolicy.yaml   x4 explicit allow rules
      postgres.statefulset.yaml      Postgres 16 with anti-affinity + PDB
      redis.deployment.yaml          Redis 7 (HA Sentinel → /k8s/ha)
      ingress.yaml                   Per-portal public hosts
      secrets-external.yaml          External Secrets Operator binding
      cert-manager-issuer.yaml       Let's Encrypt prod + staging
      serviceaccount.yaml            Per-service SAs (IRSA-ready)
      poddisruptionbudget.yaml       PDB per workload with >1 replica
      configmap-app-config.yaml      Non-secret runtime config
      job-migrate-db.yaml            Pre-upgrade migration Helm hook
      tests/
        test-postgres-connectivity.yaml
        test-redis-connectivity.yaml
        test-api-gateway-health.yaml
        test-frontend-reaches-gateway.yaml
  keda/                              KEDA HTTP scaledobjects (frontends)
  networkpolicy/                     Default-deny + portal-specific rules
  runbooks/
    deploy-to-staging.md             Routine release
    first-time-deploy.md             Brand-new cluster bootstrap
    sovereign-cloud-deploy.md        TZ / BoT-compliant deploy
    rollback.md                      Backout
    scale-to-100-tenants.md          Capacity planning
  external-secrets/                  ESO raw manifests
  cert-manager/                      ClusterIssuer raw
  ha/                                Postgres HA + Redis Sentinel
  templates/                         Generic templates (pre-existing)
```

## Architecture

| Tier | Workload | Visibility | Min replicas | Notes |
|------|----------|------------|--------------|-------|
| Frontend | `customer-app` | PUBLIC (ingress) | 2 (HPA: 2-30) | Tenant-facing portal; stays warm 24/7 |
| Frontend | `estate-manager-app` | PUBLIC (ingress) | 1 (KEDA: 0-20) | Manager portal — scale-to-zero on idle |
| Frontend | `owner-portal` | PUBLIC (ingress) | 1 (KEDA: 0-10) | Property-owner portal |
| Frontend | `admin-web` | PUBLIC (ingress) | 1 (KEDA: 0-5) | Platform admin — low traffic |
| Service | `api-gateway` | INTERNAL only | 3 (HPA: 3-50) | The only route into business logic |
| Service | `payments-ledger` | INTERNAL + STRICT | 2 (HPA: 2-15) | PCI-adjacent — locked-down NetworkPolicy |
| Service | `reports` | INTERNAL only | 1 (HPA: 1-10) | Heavy queries; resource-bound |
| Service | `notifications` | INTERNAL only | 2 (HPA: 2-10) | Outbound mail/SMS/M-Pesa |
| Data | `postgres` | INTERNAL only | 3 (StatefulSet) | Anti-affinity + PDB; HA → `k8s/ha/` |
| Data | `redis` | INTERNAL only | 1 (Deployment) | Baseline; Sentinel → `k8s/ha/` |

## Prereqs

| Requirement                              | Minimum version |
| ---------------------------------------- | --------------- |
| Kubernetes                               | 1.31            |
| Helm                                     | 3.14            |
| kubectl                                  | matches cluster |
| ingress-nginx                            | 4.11            |
| cert-manager                             | 1.16            |
| external-secrets-operator                | 0.10            |
| KEDA (optional)                          | 2.16            |
| metrics-server (HPA dep)                 | any modern      |
| StorageClass with WaitForFirstConsumer   | required        |
| OIDC for cluster (IRSA / WI)             | required        |

See `runbooks/first-time-deploy.md` for the install commands for each
of the platform components.

## Smoke tests

The chart ships 4 Helm tests under `templates/tests/`. Run them after
every release:

```bash
helm test borjie -n borjie-staging --logs
```

Expected output: 4/4 PASSED.

- `test-postgres-connectivity` — verifies Postgres is reachable and
  the `borjie` database exists.
- `test-redis-connectivity` — verifies Redis PINGs back.
- `test-api-gateway-health` — verifies api-gateway returns 200 on
  `/healthz`.
- `test-frontend-reaches-gateway` — wears the customer-app pod label
  and confirms NetworkPolicy allows the frontend→gateway hop.

## Local dev (Tilt + k3d)

```bash
# One-time: create the cluster + local registry
k3d cluster create --config k8s/k3d-cluster.yaml

# Start the dev loop (live-reload on file save)
cd k8s && tilt up
```

Tilt opens `http://localhost:10350` with the workload graph. Edit any
file under `apps/` or `services/` and the corresponding image rebuilds
+ rolls out automatically. Port-forwards:

| Workload                 | URL                       |
| ------------------------ | ------------------------- |
| `customer-app`           | http://localhost:3000     |
| `owner-portal`           | http://localhost:3001     |
| `estate-manager-app`     | http://localhost:3002     |
| `admin-web`  | http://localhost:3003     |
| `api-gateway`            | http://localhost:4000     |

## CI/CD wiring

```bash
# 1. Build + push all 8 images, tagged with git SHA
./k8s/scripts/build-and-push.sh

# 2. Deploy
helm upgrade --install borjie ./k8s/helm/borjie \
  --namespace borjie-staging -f ./k8s/helm/borjie/values-staging.yaml \
  --set image.tag=$(git rev-parse --short=12 HEAD) \
  --atomic --timeout 15m --wait
```

The `build-and-push.sh` script:

- Builds + pushes the 4 frontend apps + 4 backend services in parallel
  (`PARALLELISM=4` by default).
- Tags each image with the SHA, the branch name, and `latest` (on
  `main`).
- Rewrites `values.yaml`'s `image.tag` in place using `yq` (or `sed`
  fallback) so the deploy step picks up the new tag without manual
  surgery.
- `--dry-run` mode prints what would happen without touching the
  registry or values file.

## Hard rules (carried over from BORJIE CLAUDE.md)

- All workloads run as nonroot UID 65532 with read-only root FS.
- All pods drop ALL Linux capabilities and use seccomp `RuntimeDefault`.
- Default-deny NetworkPolicy is in effect; new workloads need an
  explicit allow rule.
- `payments-ledger` is **PCI-adjacent**: separate NetworkPolicy that
  only allows ingress from `api-gateway` and egress only to Postgres,
  Redis, and pinned payment-provider IPs (Stripe + Daraja).
- Secrets never live in git. The External Secrets Operator materialises
  real values at runtime from the configured backend.
- `api-gateway` is the only service exposed to the frontend pods. The
  4 services (`payments-ledger`, `reports`, `notifications`,
  `domain-services` if added later) are reachable only through it.
- Database migrations run as a Helm pre-upgrade hook **before** any
  pod rolls out. A failed migration fails the release atomically.
- Every workload gets its own ServiceAccount so IAM roles can be
  scoped per-service.

## Troubleshooting

| Symptom                              | Diagnose with                                | Fix                                          |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------- |
| `ImagePullBackOff`                   | `kubectl describe pod ...`                   | Check `borjie-pull` Secret exists        |
| `ExternalSecret SyncFailed`          | `kubectl get externalsecret -o yaml`         | IRSA / Workload Identity not bound           |
| Helm test `Pending` forever          | `kubectl logs <pod> -n <ns>`                 | NetworkPolicy too strict — check `helm get manifest` |
| `HPA <unknown>`                      | `kubectl top pod`                            | metrics-server missing — install kube-prom   |
| Pre-upgrade Job fails                | `kubectl logs job/<release>-migrate-<rev>`   | Read the migration error, fix, redeploy      |
| Ingress in `<pending>` >5 min        | `kubectl describe svc ingress-nginx-controller -n ingress-nginx` | Cloud LB quota |
| TLS cert stuck in `Order pending`    | `kubectl describe order -n <ns>`             | DNS hasn't propagated; `dig <host>` to check |

## Validation

Render the full manifest stack to verify no template errors:

```bash
helm lint k8s/helm/borjie/
helm template k8s/helm/borjie/ --debug | head -200
```

Expected: `1 chart(s) linted, 0 chart(s) failed`. The render produces
~76 Kubernetes objects.

## See also

- `runbooks/first-time-deploy.md` — brand-new cluster bootstrap
- `runbooks/deploy-to-staging.md` — routine release
- `runbooks/rollback.md` — back out a bad release
- `runbooks/scale-to-100-tenants.md` — capacity planning
- `runbooks/sovereign-cloud-deploy.md` — TZ/BoT-compliant deploy
- `ha/README.md` — Postgres HA + Redis Sentinel
