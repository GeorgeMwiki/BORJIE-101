# k8s/ha — High-Availability manifests

Production HA topology for Postgres and Redis on Kubernetes. Sibling to
`k8s/templates/` (the Helm chart for the single-instance / app workloads).

Closes audit findings A3 + arch-7 from `.audit/deep-audit-2026-05-20.md`.

## What this ships

| Component | Kind | File | Replicas |
|---|---|---|---|
| Patroni Postgres cluster | StatefulSet | `postgres-statefulset.yaml` | 3 |
| etcd DCS for Patroni | StatefulSet | `etcd-statefulset.yaml` | 3 |
| Patroni leader Service | Service | `postgres-services.yaml` | — |
| HAProxy primary discovery | Deployment | `postgres-haproxy.yaml` | 2 |
| Redis primary + replicas | StatefulSet | `redis-statefulset.yaml` | 3 |
| Redis Sentinel | StatefulSet | `redis-sentinel-statefulset.yaml` | 3 |

`kustomization.yaml` bundles them all.

## Deploy

```bash
# 1. Create namespace + secrets out-of-band (DO NOT commit the Secret):
kubectl create namespace borjie-data
kubectl -n borjie-data create secret generic postgres-ha-credentials \
  --from-literal=POSTGRES_PASSWORD=$(openssl rand -base64 32) \
  --from-literal=PATRONI_REPLICATION_PASSWORD=$(openssl rand -base64 32) \
  --from-literal=PATRONI_REWIND_PASSWORD=$(openssl rand -base64 32)
kubectl -n borjie-data create secret generic redis-ha-credentials \
  --from-literal=REDIS_PASSWORD=$(openssl rand -base64 32)
# 2. Bind WAL-archive IAM either via IRSA (preferred) or an AWS_* secret:
kubectl -n borjie-data create secret generic wal-archive-credentials \
  --from-literal=WAL_S3_BUCKET=borjie-prod-wal \
  --from-literal=WAL_S3_PREFIX=patroni/borjie-pg \
  --from-literal=AWS_REGION=eu-west-1 \
  --from-literal=WAL_ENCRYPTION_KEY=alias/borjie-wal

# 3. Apply HA stack
kubectl apply -k k8s/ha/
```

## Required cluster resources

- **StorageClass:** A block-volume class with `WaitForFirstConsumer` binding
  mode (e.g. `gp3` on EKS, `pd-ssd` on GKE, `managed-csi-premium` on AKS).
  Override the class name in `kustomization.yaml` if your cluster uses
  something other than `gp3`.
- **PVC size:** Default 50Gi per Postgres node, 8Gi per etcd node, 16Gi per
  Redis node. Bump in the StatefulSet `volumeClaimTemplates` for larger
  workloads.
- **Pod disruption budgets:** Included — Postgres tolerates 1 down, Sentinel
  tolerates 1 down.
- **Anti-affinity:** Soft (preferred) pod-anti-affinity across `kubernetes.io/hostname`
  so the 3 replicas land on distinct nodes when possible.
- **Namespace:** Manifests target `borjie-data`. Adjust in
  `kustomization.yaml` if you co-locate with app workloads.

## Alternative: zalando/postgres-operator

These manifests are deliberately operator-free so an ops team can `kubectl
apply` them on a bare cluster. If you adopt
[`zalando/postgres-operator`](https://github.com/zalando/postgres-operator),
delete `etcd-statefulset.yaml`, `postgres-statefulset.yaml`, and
`postgres-services.yaml`, install the operator, and replace them with a
single `postgresql.acid.zalan.do/v1` CRD. The Spilo image used here is the
same one the operator deploys, so credential/secret layouts carry over.

## Image pins

| Image | Purpose |
|---|---|
| `ghcr.io/zalando/spilo-16:3.2-p2` | Patroni + Postgres 16 + wal-g |
| `quay.io/coreos/etcd:v3.5.12` | DCS for Patroni |
| `haproxy:2.9-alpine` | Postgres primary discovery |
| `redis:7.2-alpine` | redis-server + redis-sentinel |
