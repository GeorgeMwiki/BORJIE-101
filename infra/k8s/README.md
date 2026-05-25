# Kubernetes deployment

Kustomize-based deployment for BORJIE. The base manifests describe a
production-grade topology; each overlay tunes replica counts, resource
envelopes, image tags, and host names per environment.

## Layout

```
infra/k8s/
├── namespaces/                  Namespace manifests (with Pod Security Standards)
├── external-secrets/            ClusterSecretStore + IRSA SA + ghcr-pull ESO fan-out
├── base/                        All-environment shared resources (core 18 services)
├── overlays/
│   ├── staging/                 Smaller envelope, staging hostnames
│   └── prod/                    Full envelope, anti-affinity required, prod hostnames
├── brain-evolution-worker/      Per-service tree (added 2026-05-24, CronJob)
├── apollo-gauntlet-runner/      Per-service tree (CronJob, 02:00 UTC)
├── consolidation-worker/        Per-service tree (Deployment, 1h loop)
├── document-render/             Per-service tree (Deployment)
├── field-capture-service/       Per-service tree (Deployment)
├── mcp-server-firs/             Per-service tree (Deployment, stdio MCP)
├── mcp-server-nggis/            Per-service tree (Deployment, stdio MCP)
├── mcp-server-nin/              Per-service tree (Deployment, stdio MCP)
├── mcp-server-opay/             Per-service tree (Deployment, stdio MCP)
├── mcp-server-process-intel/    Per-service tree (Deployment + pm4py sidecar)
├── onboarding-orchestrator/     Per-service tree (Deployment)
├── outbox-processor/            Per-service tree (Deployment, singleton drainer)
├── outcomes-metering/           Per-service tree (Deployment)
├── parcel-service/              Per-service tree (Deployment)
├── payments-ledger/             Per-service tree (Deployment, port 3001, money path)
├── proactive-triggers-worker/   Per-service tree (Deployment, 1h sweep loop)
├── scientific-discovery-sidecar/ Per-service tree (Deployment)
├── sleep-pass-orchestrator/     Per-service tree (Deployment, port 3040, 60s heartbeat)
└── voice-agent/                 Per-service tree (Deployment, port 8080, WebSocket sticky)
```

Per-service trees follow:
```
<service>/
├── base/                        deployment / service / hpa / pdb /
│                                networkpolicy / servicemonitor / externalsecret
└── overlays/
    ├── staging/                 namespace + image tag + small envelope
    └── prod/                    namespace + image tag + full envelope + anti-affinity
```

Not every service needs every base manifest — the shape depends on the
runtime topology:

| Shape                  | base files                                                    | Examples                                          |
|------------------------|---------------------------------------------------------------|---------------------------------------------------|
| HTTP backend           | deployment + service + hpa + pdb + networkpolicy + servicemonitor + externalsecret | voice-agent, sleep-pass-orchestrator, payments-ledger, field-capture-service, onboarding-orchestrator, outcomes-metering, parcel-service |
| Singleton-loop worker  | deployment + networkpolicy + externalsecret                   | consolidation-worker, outbox-processor, proactive-triggers-worker |
| Stdio MCP server       | deployment + networkpolicy + externalsecret                   | mcp-server-firs, mcp-server-nin, mcp-server-nggis, mcp-server-opay, mcp-server-process-intel |
| Scheduled CronJob      | cronjob  + networkpolicy + externalsecret                     | brain-evolution-worker, apollo-gauntlet-runner    |

Singleton-loop workers use `strategy: Recreate` because their cadence
is driven by `setInterval` and overlapping pod lifetimes during a
rolling update would duplicate claims against the work backlog.

Stdio MCP servers do not expose a Service because the transport is
stdio — api-gateway adapters either spawn the binary as a child
process or wire a separate HTTP/SSE bridge container.

## Image registry convention

Every BORJIE container image is published to GitHub Container Registry
under a single owner with a flat naming scheme:

```
ghcr.io/georgemwiki/borjie-<service>:<tag>
```

- `<service>`   matches the directory name under `services/` or `apps/`
                (e.g. `api-gateway`, `voice-agent`, `brain-evolution-worker`)
- `<tag>`       is the 7-char short SHA in CD, `staging`/`latest` in dev

This is what `.github/workflows/cd.yml` actually publishes (`REGISTRY=ghcr.io`,
`REGISTRY_OWNER=georgemwiki`); every Deployment / CronJob in this directory
references that same path. There is no per-service registry path — keep new
services on this convention so the CD workflow's matrix build keeps working.

The packages are currently private; see `external-secrets/README.md` for the
`ghcr-pull` image-pull secret wiring.

## Prerequisites

The cluster must have these operators installed:

| Operator                    | Purpose                                |
|-----------------------------|----------------------------------------|
| `ingress-nginx`             | L7 ingress (TLS + rate-limit)          |
| `cert-manager`              | Let's Encrypt cert rotation             |
| `external-secrets-operator` | Sync from AWS Secrets Manager / Azure / GCP |
| `metrics-server`            | HPA CPU/memory metrics                  |
| A CNI with NetworkPolicy    | Calico, Cilium, or Antrea               |

Plus a `ClusterSecretStore` named `borjie-aws` pointing at the secrets
backend. This is provisioned by `infra/k8s/external-secrets/` (apply that
overlay once per cluster after installing the ESO Helm chart) — see
`external-secrets/README.md` for the IAM trust + permission policies, the
secret-tree layout, and the `ghcr-pull` Docker config flow.

The schema mirrors `.env.production.example` 1:1, organised as
`borjie/<env>/<service>` plus shared paths like `borjie/<env>/postgres`,
`borjie/<env>/redis`, and `borjie/shared/ghcr-pull-token`.

## Quick start

```bash
# Variables
SERVICES=(
  apollo-gauntlet-runner
  brain-evolution-worker
  consolidation-worker
  document-render
  field-capture-service
  mcp-server-firs
  mcp-server-nggis
  mcp-server-nin
  mcp-server-opay
  mcp-server-process-intel
  onboarding-orchestrator
  outbox-processor
  outcomes-metering
  parcel-service
  payments-ledger
  proactive-triggers-worker
  scientific-discovery-sidecar
  sleep-pass-orchestrator
  voice-agent
)

# Validate
kubectl apply --dry-run=client -k infra/k8s/external-secrets
kubectl apply --dry-run=client -k infra/k8s/overlays/staging
kubectl apply --dry-run=client -k infra/k8s/overlays/prod
for svc in "${SERVICES[@]}"; do
  kubectl apply --dry-run=client -k "infra/k8s/$svc/overlays/staging"
  kubectl apply --dry-run=client -k "infra/k8s/$svc/overlays/prod"
done

# Apply (order matters — cluster-scope secrets first)
kubectl apply -k infra/k8s/external-secrets
kubectl apply -k infra/k8s/overlays/staging
kubectl apply -k infra/k8s/overlays/prod
for svc in "${SERVICES[@]}"; do
  kubectl apply -k "infra/k8s/$svc/overlays/staging"
  kubectl apply -k "infra/k8s/$svc/overlays/prod"
done
```

The CD workflow (`.github/workflows/cd.yml`) drives this with image-tag
pinning and approval gates.

## Security defaults

- **Pod Security Standards**: namespaces enforce `restricted`
- **Non-root**: every pod runs as `runAsNonRoot: true` with a fixed UID
- **Read-only root**: every container has `readOnlyRootFilesystem: true`
  (writable scratch via emptyDir mounts)
- **Capabilities dropped**: `capabilities: { drop: ["ALL"] }` (nginx-based
  frontends add only `NET_BIND_SERVICE`)
- **Seccomp**: `seccompProfile: RuntimeDefault`
- **ServiceAccount**: every deployment has its own SA with
  `automountServiceAccountToken: false`
- **NetworkPolicy**: default-deny + targeted allow-lists (see
  `base/network-policies.yaml`)
- **Secrets**: never committed; pulled at sync time via
  `external-secrets-operator`

## Migrations strategy

Schema migrations run as a pre-deploy `Job` (not bundled here — see the
existing `k8s/templates/migration-job.yaml` Helm template for reference).
Order on rollout:

1. `kubectl apply -k infra/k8s/overlays/prod --prune=false`
2. Wait for the migration Job to succeed
3. CD then rolls api-gateway forward

## Self-hosted alternative

If you want a single-VM deployment instead of K8s, use
`docker-compose.production.yml` at the repo root. See
[docs/deployment/README.md](../../docs/deployment/README.md) for the
operator runbook.
