# Runbook — First-Time Deploy (Brand-New Cluster)

## When to use

You're bringing up a **brand-new Kubernetes cluster** (your own, a
customer's, or a fresh staging environment) and need to install the
BORJIE Helm chart from zero. Use this when:

- A new sovereign-cloud customer wants their own cluster.
- You're spinning up a new staging / pre-prod environment.
- Disaster recovery: rebuilding from scratch after a cluster loss.

For routine deploys against an already-bootstrapped cluster, see
`deploy-to-staging.md` instead — that runbook skips the platform
component installs.

## What you'll install (in order)

| Order | Component                  | Purpose                                              |
| ----- | -------------------------- | ---------------------------------------------------- |
| 1     | kube-prometheus-stack      | Metrics + Grafana + Alertmanager (HPA depends on it) |
| 2     | ingress-nginx              | Public ingress + TLS termination                     |
| 3     | cert-manager               | Let's Encrypt certs for the 4 portal hosts           |
| 4     | external-secrets-operator  | Pulls secrets from cloud KMS at runtime              |
| 5     | KEDA (+ HTTP add-on)       | Scale-to-zero for low-traffic portals                |
| 6     | borjie (Helm chart)    | The application                                      |

## Prerequisites

- A Kubernetes cluster **>= 1.31**, RBAC enabled, default StorageClass set.
- `kubectl` configured against the new context, `kubectl auth can-i '*' '*'` returns `yes`.
- `helm >= 3.14`.
- DNS for the 4 portal hosts pointing at the cluster's ingress LB (you
  can set this **after** Step 2 once the LB is up).
- A secrets backend with the BORJIE secret names seeded (see
  `templates/secrets-external.yaml` for the full list).
- Cloud-platform IAM: for AWS, an IRSA-able OIDC provider attached to
  the cluster; for GCP, Workload Identity Federation enabled.

## Step 0 — Configure DNS placeholders

Decide the 4 portal hostnames up-front and put them in
`values-<env>.yaml`. Example for staging:

```yaml
hosts:
  customerApp: customer.staging.borjie.dev
  estateManagerApp: manager.staging.borjie.dev
  ownerPortal: owner.staging.borjie.dev
  adminPlatformPortal: admin.staging.borjie.dev
```

DNS A-records can wait until after Step 2 (you'll need the ingress LB
hostname/IP first).

## Step 1 — Install kube-prometheus-stack

The HorizontalPodAutoscaler templates need metrics-server. The full
kube-prometheus-stack also gives you Grafana + Alertmanager out of the box.

```bash
kubectl create namespace monitoring
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
helm install kube-prom prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --version 65.5.0 \
  --set grafana.adminPassword=changeme \
  --wait --timeout 10m
```

Verify:

```bash
kubectl -n monitoring get pods
kubectl get apiservices.apiregistration.k8s.io v1beta1.metrics.k8s.io
# Expected: AVAILABLE = True
```

## Step 2 — Install ingress-nginx

```bash
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx \
  --namespace ingress-nginx --create-namespace \
  --version 4.11.3 \
  --set controller.service.type=LoadBalancer \
  --set controller.config.use-forwarded-headers="true" \
  --wait --timeout 10m
```

Grab the LB hostname:

```bash
kubectl -n ingress-nginx get svc ingress-nginx-controller \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Point your DNS records at that hostname now. Wait for propagation
(typically 5-10 min for staging subdomains).

## Step 3 — Install cert-manager

```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.crds.yaml
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.16.1 \
  --set crds.enabled=false \
  --wait --timeout 5m
```

The `letsencrypt-prod` and `letsencrypt-staging` ClusterIssuers are
shipped by the BORJIE chart itself (Step 6).

## Step 4 — Install External Secrets Operator

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets --create-namespace \
  --version 0.10.5 \
  --set installCRDs=true \
  --wait --timeout 5m
```

Then seed your secrets backend. **Skip a secret here = pods CrashLoop
later.** Use the list in `helm/borjie/templates/secrets-external.yaml`
as the source of truth.

```bash
# AWS example
for key in NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY DATABASE_URL \
           REDIS_URL FIELD_ENCRYPTION_MASTER_KEY HASH_CHAIN_PEPPER \
           STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET MPESA_CONSUMER_KEY \
           TWILIO_AUTH_TOKEN RESEND_API_KEY; do
  aws secretsmanager create-secret --name "$key" --secret-string "REPLACE_ME"
done
```

(Replace each with the real value before Step 6.)

## Step 5 — Install KEDA

```bash
helm repo add kedacore https://kedacore.github.io/charts
helm install keda kedacore/keda \
  --namespace keda --create-namespace \
  --version 2.16.0 \
  --wait --timeout 5m

# Optional: HTTP add-on for true scale-to-zero on portals
helm install keda-http kedacore/keda-add-ons-http \
  --namespace keda \
  --version 0.10.0 \
  --wait --timeout 5m
```

## Step 6 — Install BORJIE

```bash
# From repo root
NAMESPACE=borjie-staging
ENV=staging
GIT_SHA=$(git rev-parse --short=12 HEAD)

helm install borjie ./k8s/helm/borjie \
  --namespace $NAMESPACE --create-namespace \
  -f ./k8s/helm/borjie/values-$ENV.yaml \
  --set image.tag=$GIT_SHA \
  --atomic --timeout 15m \
  --wait
```

`--atomic` rolls back automatically if any pod fails to become Ready
within the timeout. The pre-upgrade migration Job runs first; if it
fails, the install aborts before any app pod starts.

## Step 7 — Smoke test

```bash
# All pods Ready?
kubectl -n $NAMESPACE get pods

# Run the Helm-managed smoke tests (postgres, redis, api-gateway, frontend→gateway)
helm test borjie -n $NAMESPACE --logs

# Hit every portal
for host in customer manager owner admin; do
  curl -fsS --max-time 5 https://$host.staging.borjie.dev/api/health
  echo "  ↳ $host OK"
done
```

## Step 8 — Hand off

- Capture the Grafana admin password and rotate it.
- Add the Sentry DSN to the secrets backend so error reporting is live.
- Add the cluster context name to your team's wiki.
- Schedule a load-test (see `scale-to-100-tenants.md`) before opening
  to real tenants.

## Troubleshooting

| Symptom                                      | Likely cause                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `ImagePullBackOff` on every pod              | `borjie-pull` Secret missing — `kubectl create secret docker-registry`   |
| `ExternalSecret SecretSyncedError`           | IRSA / Workload Identity not attached to the `borjie` ServiceAccount      |
| Ingress shows `<pending>` ADDRESS for >5 min | Cloud LB quota; check `kubectl describe svc -n ingress-nginx`                 |
| `ContainerCreating` stuck on postgres-0      | StorageClass mismatch — check `kubectl get pvc` and adjust `values.yaml`     |
| cert-manager `Order` in `pending`            | DNS not propagated; verify with `dig customer.staging.borjie.dev`         |
| HPA shows `<unknown>` for CPU                | metrics-server not Ready; retry Step 1                                        |

If `--atomic` rolled the release back: read `helm history borjie -n
$NAMESPACE`, inspect the failed revision with `helm get manifest
borjie -n $NAMESPACE --revision <N>`, and consult `rollback.md`.
