# External Secrets — BORJIE

Three backends, one ExternalSecret manifest. No real secret values live in this
repo; every backend pulls credentials from a managed store at sync time.

## Backends

| Backend                  | When to pick it                                          | Auth path        |
|--------------------------|----------------------------------------------------------|------------------|
| GCP Secret Manager       | Production on GKE — preferred                            | Workload Identity|
| AWS Secrets Manager      | Production on EKS                                        | IRSA             |
| Sealed Secrets (kubeseal)| Offline / air-gapped / dev clusters — GitOps-only path  | In-cluster cert  |

Note: kubeseal is **not** an ESO `SecretStore` backend — it's a separate Bitnami
controller that decrypts `SealedSecret` CRs in-cluster. We support it as a
fallback because some environments cannot reach a cloud secret API.

## Files

| File                                          | Purpose                                                                        |
|-----------------------------------------------|--------------------------------------------------------------------------------|
| `secret-store-gcp.yaml`                       | `SecretStore` + `ServiceAccount` with Workload Identity binding for GCP        |
| `secret-store-aws.yaml`                       | `SecretStore` + `ServiceAccount` with IRSA annotation for AWS                  |
| `secret-store-kubeseal.yaml`                  | Namespace + meta `ConfigMap` pinning controller version for the kubeseal path  |
| `external-secret-borjie-app.yaml`         | `ExternalSecret` pulling 6 named refs into `borjie-secrets`                |
| `seed-secrets.sh`                             | Bootstraps the chosen backend; idempotent; prompts silently for missing values |

## Six secrets pulled

| App env var              | Remote key                          |
|--------------------------|-------------------------------------|
| `DATABASE_URL`           | `borjie/database-url`           |
| `ANTHROPIC_API_KEY`      | `borjie/anthropic-api-key`      |
| `OPENAI_API_KEY`         | `borjie/openai-api-key`         |
| `DEEPSEEK_API_KEY`       | `borjie/deepseek-api-key`       |
| `MPESA_CONSUMER_SECRET`  | `borjie/mpesa-consumer-secret`  |
| `MPESA_PASSKEY`          | `borjie/mpesa-passkey`          |

All six land in a single `Secret` named `borjie-secrets` (Opaque), consumed
by the app `Deployment` via `envFrom: [{ secretRef: { name: borjie-secrets }}]`.

## Backend selection per environment

| Env       | Backend     | `external-secret-borjie-app.yaml` `secretStoreRef.name` |
|-----------|-------------|-------------------------------------------------------------|
| `prod`    | GCP or AWS  | `borjie-gcp` or `borjie-aws`                        |
| `staging` | GCP or AWS  | same as prod                                                |
| `dev`     | kubeseal    | (use `SealedSecret` CR instead — do not apply ExternalSecret)|

Change `secretStoreRef.name` per env (`kustomize` patch or Helm `--set`).

## Required env vars + IAM bindings

### GCP

| Need                  | Value                                                                            |
|-----------------------|----------------------------------------------------------------------------------|
| Env: `GCP_PROJECT`    | GCP project hosting Secret Manager                                               |
| API enabled           | `secretmanager.googleapis.com`                                                   |
| Cluster feature       | Workload Identity (`--workload-pool=$GCP_PROJECT.svc.id.goog`)                   |
| GCP service account   | `borjie-eso@$GCP_PROJECT.iam.gserviceaccount.com`                            |
| IAM role on secrets   | `roles/secretmanager.secretAccessor` on each `borjie/*` secret               |
| WI binding            | `roles/iam.workloadIdentityUser` on the GSA for KSA `borjie/borjie-eso`  |

### AWS

| Need                       | Value                                                                       |
|----------------------------|-----------------------------------------------------------------------------|
| Env: `AWS_REGION`          | e.g. `us-east-1` (matches `SecretStore.spec.provider.aws.region`)           |
| Env: `AWS_ACCOUNT_ID`      | 12-digit account; used in IRSA role ARN                                     |
| Env: `EKS_CLUSTER`         | EKS cluster name for OIDC binding                                           |
| OIDC provider              | `eksctl utils associate-iam-oidc-provider`                                  |
| IAM policy                 | `secretsmanager:GetSecretValue` + `DescribeSecret` on `borjie/*`        |
| IAM role                   | `BossnyumbaESORole` trusted by the cluster OIDC, mapped to KSA via IRSA    |

### kubeseal

| Need                            | Value                                          |
|---------------------------------|------------------------------------------------|
| Env: `SEALED_SECRETS_VERSION`   | optional, defaults to `v0.27.1`                |
| Env: `SEALED_SECRETS_CERT`      | optional path, defaults to `.sealed-secrets/pub-cert.pem` |
| Local CLI                       | `kubeseal` (`brew install kubeseal`)           |
| Cluster controller              | `sealed-secrets-controller` in `kube-system`   |

## Runbook

### One-time bootstrap

```bash
chmod +x k8s/external-secrets/seed-secrets.sh

# GCP
GCP_PROJECT=my-proj ./k8s/external-secrets/seed-secrets.sh --backend=gcp

# AWS
AWS_REGION=us-east-1 AWS_ACCOUNT_ID=123456789012 \
  ./k8s/external-secrets/seed-secrets.sh --backend=aws

# kubeseal
./k8s/external-secrets/seed-secrets.sh --backend=kubeseal
```

The script probes existence before creating, so **re-running is a no-op** for
secrets that already exist. Use `--dry-run` to preview without prompting.

### Apply the SecretStore + ExternalSecret

```bash
# Pick ONE backend (GCP shown)
kubectl apply -f k8s/external-secrets/secret-store-gcp.yaml
kubectl apply -f k8s/external-secrets/external-secret-borjie-app.yaml
```

### Rotation

| Backend     | Procedure                                                                               |
|-------------|-----------------------------------------------------------------------------------------|
| GCP         | `gcloud secrets versions add borjie/<key> --data-file=-` → ESO picks up at refresh  |
| AWS         | `aws secretsmanager put-secret-value --secret-id borjie/<key> --secret-string <v>`  |
| kubeseal    | Re-run `seed-secrets.sh --backend=kubeseal` → new `sealed-borjie-secrets.yaml`; commit |

The `ExternalSecret` polls every `refreshInterval: 1h`; force an immediate
re-sync with `kubectl annotate externalsecret borjie-app force-sync=$(date +%s) --overwrite`.

### Verify a synced secret

```bash
# ExternalSecret reports the last sync status and remote backend version.
kubectl -n borjie get externalsecret borjie-app -o wide
kubectl -n borjie describe externalsecret borjie-app

# Confirm the target Secret exists with all 6 keys (values not displayed).
kubectl -n borjie get secret borjie-secrets -o jsonpath='{.data}' \
  | jq 'keys'

# Sanity check: pod sees the env var (mask the value).
kubectl -n borjie exec deploy/borjie-app -- \
  sh -c 'printf "DATABASE_URL length: %s\n" "${#DATABASE_URL}"'
```

## Idempotency contract

- `seed-secrets.sh` probes `gcloud secrets describe` / `aws secretsmanager describe-secret`
  before creating; if the secret exists, the script logs `exists` and skips.
- `kubectl apply -f controller.yaml` is intrinsically idempotent.
- The cert fetch overwrites the local file; the controller's keypair is stable
  unless rotated server-side.
- All `SecretStore` / `ExternalSecret` manifests are pure `kubectl apply` —
  re-applying with no diff produces no change.

## Security guardrails

- No real secret values land in this repo. The seed script prints `created` or
  `exists` but never the value.
- `kubeseal`-encrypted secrets are safe to commit — they decrypt **only** in
  the target cluster's controller, never locally.
- Rotate the GCP/AWS IAM bindings annually; rotate the kubeseal controller
  keypair every 30 days (the controller does this automatically by default).
