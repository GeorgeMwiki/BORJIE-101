# NetworkPolicy strict — deny-all-then-allow

Ported from LITFIN `k8s/policies/networkpolicy-strict.yaml` (PO-27).

Apply manifests **in order** (filename prefix sorts correctly):

```bash
kubectl apply -f infra/k8s/networkpolicy-strict/
```

## Layer map

| Prefix | File | Layer |
| --- | --- | --- |
| `00-` | `namespace.yaml` | The `borjie` namespace itself. |
| `10-` | `default-deny-all.yaml` | Baseline: no ingress + no egress for any pod. |
| `20-` | `allow-dns.yaml` | Allow kube-dns so name resolution works. |
| `30-` | `allow-https-egress.yaml` | Allow public HTTPS but block cloud-metadata + RFC1918. |
| `40-` | `allow-api-gateway-ingress.yaml` | Allow ingress-nginx + intra-namespace -> api-gateway. |
| `41-` | `allow-payments-ledger-ingress.yaml` | Allow api-gateway + scheduled-tasks -> payments-ledger. |
| `42-` | `allow-notifications-ingress.yaml` | Allow api-gateway + payments-ledger + scheduled-tasks -> notifications. |
| `50-` | `allow-observability-egress.yaml` | Allow OTel push to observability namespace. |

## Why this layout

- **Defence in depth.** Even when RLS prevents row leakage, a
  compromised pod must not be able to reach a sibling namespace's
  internal endpoints. Cluster-scope isolation is the second wall.
- **No cloud-metadata access.** Block `169.254.169.254` so a
  compromised pod cannot fetch the node's IAM credentials.
- **Explicit allow lists.** Each `41-*` / `42-*` file pins the
  exact upstream services allowed to call its downstream — adding
  a new caller is a single PR, never a global widening.

## Adding a new service

1. Create a new `4N-allow-<service>-ingress.yaml` mirroring the
   shape of `41-allow-payments-ledger-ingress.yaml`.
2. Use `app.kubernetes.io/component: <service>` labels on the pod
   spec so the selector matches.
3. List EACH caller as a separate `podSelector` `from` entry —
   never use an empty selector at this layer.

## Validation

The YAML files are valid Kubernetes NetworkPolicy v1 manifests.
A future CI job should parse + lint via `kubeconform` /
`helm template`.
