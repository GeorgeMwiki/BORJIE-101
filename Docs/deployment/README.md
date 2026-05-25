# BORJIE Deployment Runbook

This runbook covers two supported deployment targets:

| Target           | Use when                                  | Entry point                          |
|------------------|-------------------------------------------|--------------------------------------|
| Self-hosted VM   | Single-tenant, on-prem, or pilot          | `docker-compose.production.yml`      |
| Kubernetes (K8s) | Multi-tenant SaaS, autoscaling, HA        | `infra/k8s/overlays/{staging,prod}`  |

Phase F.6 ships both. The CD workflow (`.github/workflows/cd.yml`) drives the
K8s path; the docker-compose path is operator-driven.

---

## 1. Self-hosted single-server deployment

### 1.1 Sizing baseline

| Tier           | vCPU | RAM   | Disk   | Tenants supported (P99 < 300 ms) |
|----------------|------|-------|--------|----------------------------------|
| Smoke / pilot  | 4    | 8 GB  | 100 GB | 1                                |
| Small ops      | 8    | 16 GB | 250 GB | 1-25                             |
| Mid-tier       | 16   | 32 GB | 500 GB | 25-200                           |

These assume one Postgres instance, one Redis, one api-gateway replica, and
in-process library services. Beyond ~200 tenants, migrate to K8s.

### 1.2 Boot

```bash
# On the host:
git clone https://github.com/GeorgeMwiki/BORJIE101.git
cd BORJIE101
cp .env.production.example .env.production
chmod 600 .env.production
$EDITOR .env.production              # fill REQUIRED values

# First-pass local rehearsal:
./scripts/test-production-locally.sh

# Real boot:
docker compose --env-file .env.production -f docker-compose.production.yml up -d
docker compose -f docker-compose.production.yml ps
```

### 1.3 TLS bootstrap (Certbot)

```bash
# Initial cert issuance (replace DOMAIN list with yours):
docker compose -f docker-compose.production.yml run --rm certbot certonly \
    --webroot -w /var/www/certbot \
    --email ops@borjie.com --agree-tos --non-interactive \
    -d api.borjie.com -d borjie.com -d www.borjie.com \
    -d admin.borjie.com -d owners.borjie.com -d manage.borjie.com

# Reload nginx to pick up certs:
docker compose -f docker-compose.production.yml exec nginx nginx -s reload
```

The certbot container then auto-renews every 12 h via its long-running
entrypoint.

### 1.4 Migrations

Schema migrations are bundled with each service image. On every deploy:

```bash
# Run BEFORE updating images:
docker compose -f docker-compose.production.yml run --rm api-gateway \
    node dist/scripts/migrate.js up
```

Roll forward only. Rollback strategy is "deploy the previous tag and restore
the most recent backup" (see §3.4).

---

## 2. Kubernetes deployment

### 2.1 Cluster requirements

Minimum versions: Kubernetes 1.28+, kubectl 1.28+, kustomize 5+.

Required operators (install in this order, in their own namespaces):

1. **ingress-nginx** — ingress controller, TLS termination at edge
2. **cert-manager** — `ClusterIssuer` named `letsencrypt-prod`
3. **external-secrets-operator** — secret sync from cloud secret managers
4. **metrics-server** — HPA backbone
5. A CNI that enforces NetworkPolicy (Calico, Cilium, Antrea)

### 2.2 Secret bootstrap

Create the three secret bundles in AWS Secrets Manager (or your manager of
choice):

```
borjie/prod/app        # JWT_SECRET, ANTHROPIC_API_KEY, ...
borjie/prod/postgres   # POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
borjie/prod/redis      # REDIS_PASSWORD
```

Schema mirrors `.env.production.example`.

Then a `ClusterSecretStore` named `borjie-aws` pointing at that backend
with IRSA (AWS) / Workload Identity (GCP) / Managed Identity (Azure).

### 2.3 First deploy

```bash
# Validate
kubectl apply --dry-run=client -k infra/k8s/overlays/staging
kubectl apply --dry-run=client -k infra/k8s/overlays/prod

# Apply
kubectl apply -k infra/k8s/overlays/staging
kubectl -n borjie-staging rollout status deploy/api-gateway --timeout=5m
```

### 2.4 Promotion to prod

Use the `CD (Kubernetes)` workflow with `workflow_dispatch`. Steps:

1. GitHub UI -> Actions -> "CD (Kubernetes)" -> Run workflow
2. Choose `environment: prod`, optional pinned `image_tag`
3. Approve when prompted (required reviewers on the `prod` environment)
4. Workflow does: pin image tags -> `kubectl apply -k overlays/prod` ->
   canary -> smoke -> automatic rollback on failure

---

## 3. Operational concerns

### 3.1 Migrations strategy (K8s)

Run as a pre-deploy `Job` in the target namespace. Image: api-gateway.
Entrypoint: `node dist/scripts/migrate.js up`. The job is idempotent and
fails fast on schema-checksum drift.

```bash
kubectl -n borjie-prod create job migrate-$(date +%s) \
    --image=ghcr.io/georgemwiki/borjie-api-gateway:$TAG \
    --from=cronjob/migrate-template
kubectl -n borjie-prod wait --for=condition=complete \
    job/migrate-$TAG --timeout=10m
```

The CD pipeline calls this BEFORE rolling api-gateway.

### 3.2 Secret management

**Production-grade**: `external-secrets-operator` syncing from
AWS Secrets Manager / Azure Key Vault / GCP Secret Manager. Refresh interval
is 1 h for app secrets, 24 h for DB credentials.

**Rotation**: rotate the upstream secret first; ESO syncs within 1 h. For
faster propagation, `kubectl rollout restart deploy/api-gateway`.

**Never** commit `.env.production` or any populated secret manifest.
`.gitignore` covers `.env*` except the `.example` siblings.

### 3.3 Backups

| Asset    | Cadence            | Tool                          | Retention |
|----------|--------------------|-------------------------------|-----------|
| Postgres | Continuous + 1 h snapshot | pgBackRest / RDS automatic | 30 d      |
| Redis    | Hourly RDB snapshot | redis-cli BGSAVE              | 7 d       |
| Tenant docs | Versioned S3     | S3 versioning + lifecycle     | 90 d hot / Glacier 7 y |
| K8s state | Daily Velero       | Velero -> S3                   | 14 d      |

### 3.4 Disaster recovery — restore drill

Run quarterly. Target RTO 4 h, RPO 1 h.

1. Spin up a clean cluster from `infra/k8s/overlays/prod`
2. Restore Postgres from the most recent snapshot
3. Restore Redis (cold-start acceptable if no snapshot)
4. Re-point DNS once health checks pass
5. Audit-log the entire drill in `Docs/RUNBOOKS/dr-drill-YYYY-Q.md`

### 3.5 Capacity planning baselines

Per-service requests vs. limits drive scheduling and HPA. The defaults in
`infra/k8s/base/*-deployment.yaml` produce:

| Service                | Req cpu/mem      | Limit cpu/mem    |
|------------------------|------------------|------------------|
| api-gateway            | 500m / 512Mi     | 2 / 2Gi          |
| consolidation-worker   | 100m / 128Mi     | 500m / 512Mi     |
| mcp-process-intel      | 250m / 256Mi     | 1 / 1Gi          |
| mcp-{nin,firs,nggis,opay} | 100m / 128Mi  | 500m / 512Mi     |
| document-intelligence  | 250m / 256Mi     | 1 / 1Gi          |
| domain-services        | 250m / 256Mi     | 1 / 1Gi          |
| identity / notifications / webhooks | 100m / 128Mi | 500m / 512Mi |
| payments / reports     | 250m / 256Mi     | 1 / 1Gi          |
| customer-app / estate-manager-app | 100m / 256Mi | 500m / 1Gi |
| owner-portal / admin-platform-portal | 50m / 64Mi | 250m / 256Mi |
| postgres (StatefulSet) | 500m / 1Gi       | 2 / 4Gi          |
| redis                  | 100m / 128Mi     | 500m / 768Mi     |

A 3-replica api-gateway prod baseline requests ~1.5 vCPU + 1.5 GiB; the HPA
ceiling of 50 replicas leaves headroom up to ~25 vCPU + 25 GiB.

### 3.6 Cost estimate (back-of-envelope)

Assumes AWS, eu-west-1, on-demand, 1-year baseline.

| Item                                | $/month |
|-------------------------------------|---------|
| EKS control plane                   | $73     |
| 3x m6i.xlarge (4 vCPU, 16 GiB)      | $475    |
| RDS db.m6g.large (Postgres + pgvector) | $190 |
| ElastiCache cache.r6g.large         | $145    |
| S3 + CloudFront (1 TB egress, 100 GB storage) | $115 |
| NAT + ALB + Route53                 | $90     |
| Observability (CloudWatch + 3rd party stack) | $75 |
| **Total prod baseline**             | **~$1,165/mo** |

Per-tenant amortised: ~$5/mo at 200 tenants, ~$3/mo at 400 tenants.
Marginal cost per tenant beyond compute is dominated by document storage
and AI usage; budget $0.50-$2/mo per active tenant on top of baseline.

---

## 4. Cross-reference

- `docker-compose.production.yml` — self-hosted stack
- `infra/k8s/` — Kustomize manifests + overlays
- `.github/workflows/cd.yml` — Kubernetes CD pipeline
- `.github/workflows/cd-production.yml` — legacy ECS-based CD (kept for
  backwards compatibility with the existing AWS deployment)
- `Docs/SECRETS_ROTATION.md` — manual secret rotation procedure
- `Docs/RUNBOOK.md` — incident runbook
- `Docs/PRODUCTION_READINESS.md` — pre-launch checklist
