# Runbook — Deploy to Staging

## When to use

You're shipping a new image (CI built a SHA-tagged container) and need
it on the staging cluster. Use this when:

- A feature branch has been merged to `main` and CI built the image.
- You want to validate end-to-end behaviour against real Postgres /
  Redis before promoting to production.
- You're testing a Helm values change (new resource limits, new env var).

> **This is a scaffolding runbook.** Replace every `TODO` and verify
> commands against your real cluster before relying on it.

## Prerequisites

- `kubectl` configured against the staging cluster context
  (`kubectl config use-context borjie-staging`).
- `helm` 3.14+ installed.
- Push access to the container registry (`gcr.io/borjie-staging`
  or `ghcr.io/georgemwiki`).
- Membership in the `borjie-deploy` Slack channel (deploy alerts
  land here).

## Step 1 — Confirm the image exists

```bash
GIT_SHA=$(git rev-parse --short HEAD)
docker manifest inspect ghcr.io/georgemwiki/borjie/customer-app:$GIT_SHA > /dev/null \
  && echo "OK: image present" \
  || { echo "FAIL: image not built — re-run the CI workflow"; exit 1; }
```

Repeat the check for each of the 8 workloads (`customer-app`,
`estate-manager-app`, `owner-portal`, `admin-web`,
`api-gateway`, `payments-ledger`, `reports`, `notifications`).

## Step 2 — Smoke-test the image locally

```bash
docker run --rm -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:5432/borjie_dev \
  ghcr.io/georgemwiki/borjie/customer-app:$GIT_SHA
curl -fsS http://localhost:3000/api/health || { echo "FAIL: /api/health"; exit 1; }
```

Stop the container after the health check succeeds.

## Step 3 — Helm dry-run

```bash
helm upgrade --install --dry-run --debug \
  borjie ./k8s/helm/borjie \
  --namespace borjie-staging \
  -f ./k8s/helm/borjie/values-staging.yaml \
  --set image.tag=$GIT_SHA \
  | less
```

Read the diff carefully. Look for:
- Replica count changes (sudden jumps mean a values misconfig).
- New ConfigMap/Secret keys without matching app env-var consumers.
- NetworkPolicy edits — these break cross-pod traffic if wrong.

## Step 4 — Apply

```bash
helm upgrade --install \
  borjie ./k8s/helm/borjie \
  --namespace borjie-staging \
  -f ./k8s/helm/borjie/values-staging.yaml \
  --set image.tag=$GIT_SHA \
  --atomic \
  --timeout 10m
```

`--atomic` auto-rolls-back on failure. Combined with `--timeout 10m`
this gives every workload a fair chance to come up. If you've got
StatefulSet changes pending, allow more time.

## Step 5 — Verify

```bash
# All pods Ready?
kubectl -n borjie-staging get pods
# Expected: every Deployment + StatefulSet replica in 1/1 Ready

# All Ingresses got TLS certs?
kubectl -n borjie-staging get ingress
# Look for "True" under READY and a populated ADDRESS column.

# Public endpoints respond?
for host in tenant manager owner admin; do
  curl -fsS --max-time 5 https://$host.staging.borjie.example.com/api/health
done
```

## Step 6 — Run the staging E2E suite

```bash
# From repo root:
PLAYWRIGHT_BASE_URL=https://tenant.staging.borjie.example.com \
  pnpm --filter @borjie/e2e test:staging
```

Expected: all green. Any red blocks promotion to prod.

## Step 7 — Promote to prod (optional)

If everything in step 6 is green and you've held the build for 30 min
without alerts, repeat with `values-prod.yaml` against the prod context.

## If something goes wrong

See `rollback.md`.

## TODOs before this runbook is real

- [ ] Replace `borjie-staging` with the actual namespace.
- [ ] Replace registry hostnames with the production values.
- [ ] Create `values-staging.yaml` and `values-prod.yaml` files.
- [ ] Wire CI to set `GIT_SHA` for every push to `main`.
- [ ] Verify each app actually exposes `/api/health`.
