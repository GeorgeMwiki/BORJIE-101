# Runbook — Sovereign-Cloud Deploy (Tanzania / BoT)

## Context

The Bank of Tanzania (BoT) and the Tanzania Communications Regulatory
Authority (TCRA) require that certain regulated entities — banks,
SACCOs above a size threshold, payment-service providers, and some
estate-management cooperatives — keep customer personal data and
financial records **inside Tanzania**.

For these tenants the SaaS instance running on Vercel + Supabase
(eu-central) is non-compliant. We instead deploy the BORJIE Helm
chart into an **in-country Kubernetes cluster** with managed data
services that have a Tanzania region.

This runbook covers the deltas vs. the standard `first-time-deploy.md`
flow. Read that first; the steps below are an overlay.

## Approved in-country infra

| Component   | Approved option                                           | Notes                                                |
| ----------- | --------------------------------------------------------- | ---------------------------------------------------- |
| Kubernetes  | Liquid Telecom DCK (Dar es Salaam), Tigo Cloud, Azure UAE | UAE region acceptable for tenants on Azure (BoT 2026 guidance) |
| Postgres    | In-cluster StatefulSet ONLY (no managed offering in TZ)   | Use `k8s/ha/` for HA — 3 replicas, anti-affinity     |
| Object store| Liquid Telecom S3-compatible / on-cluster MinIO           | Bucket names suffixed `-tz`                          |
| KMS         | YubiHSM or SoftHSM in-cluster (regulator-approved)        | Field encryption keys never leave the cluster        |
| Secrets     | HashiCorp Vault in-cluster (NOT cloud KMS)                | `secrets.provider: vault` in values                  |
| DNS         | tcra.go.tz-registered domain (must be `.tz`)              | e.g. `tenant.<co-op>.co.tz`                          |
| Egress      | Allowlist of approved external endpoints (see below)      | Default-deny on all other egress                     |

## Pre-deploy checklist (regulator-facing)

- [ ] Customer's BoT registration number and TCRA hosting permit on file (Compliance team has copies)
- [ ] `data_residency_attestation.pdf` signed by both parties — names the data-centre, the operator, the BoT clauses being honoured, and our liability cap
- [ ] DPO contact added to the runbook (this file) under "Notify on incident"
- [ ] In-country backup retention SLA agreed (BoT requires 7 years for KYC, 5 years for ledger entries)
- [ ] Cross-border data flow declaration filed (TCRA Form CB-1) if any non-PII telemetry leaves TZ
- [ ] Pen-test report less than 90 days old delivered to BoT supervisor
- [ ] **Notify on incident** — DPO, BoT 24h hotline, TCRA security ops (numbers in the customer's secrets backend under `regulator_contacts`)

## Overlay over `first-time-deploy.md`

### Step 2 (ingress-nginx) — same, except

Set `controller.allowSnippetAnnotations: false` and pin the LB to an
in-country public IP block (Liquid Telecom: `196.46.0.0/16` range).

### Step 3 (cert-manager) — same, except

The `letsencrypt-prod` issuer is fine — Let's Encrypt does not store
issued certs. If the regulator objects (rare), switch to a TZ-based
Sectigo reseller and set `certManager.enabled: false`.

### Step 4 (External Secrets Operator) — REPLACED

Skip ESO. Install Vault in-cluster:

```bash
helm repo add hashicorp https://helm.releases.hashicorp.com
helm install vault hashicorp/vault \
  --namespace vault --create-namespace \
  --version 0.28.1 \
  --set server.ha.enabled=true \
  --set server.ha.replicas=3 \
  --set injector.enabled=true \
  --wait --timeout 10m
```

Initialise + unseal once, then store the unseal keys in **physical**
custody (paper, customer's safe). Set `values-tz.yaml`:

```yaml
secrets:
  provider: vault
externalSecrets:
  enabled: false   # using Vault agent injector instead
```

### Step 5 (KEDA) — same

KEDA is fine; it doesn't egress data.

### Step 6 (BORJIE install) — with TZ values

Create a `values-tz.yaml` that locks down everything:

```yaml
domain: <co-op>.co.tz
hosts:
  customerApp: tenant.<co-op>.co.tz
  estateManagerApp: manager.<co-op>.co.tz
  ownerPortal: owner.<co-op>.co.tz
  adminPlatformPortal: admin.<co-op>.co.tz

# Force in-cluster Postgres + Redis — no managed services.
postgres:
  enabled: true
  external:
    enabled: false
  statefulSet:
    replicas: 3
    storage:
      storageClassName: liquid-telecom-ssd   # adjust per provider
      size: 500Gi
redis:
  enabled: true
  external:
    enabled: false

# Egress lockdown — default deny + named allowlist below.
networkPolicy:
  enabled: true
  strictMultiTenant: true

# Currency/locale defaults — TZS only, en-TZ + sw-TZ.
appConfig:
  DEFAULT_CURRENCY: TZS
  DEFAULT_LOCALE: sw-TZ
  SUPPORTED_LOCALES: sw-TZ,en-TZ
  TZ: Africa/Dar_es_Salaam
  # Feature flags
  FEATURE_MOBILE_MONEY: "true"     # M-Pesa, Tigopesa, Airtel Money
  FEATURE_STRIPE: "false"          # International cards disallowed without TCRA permit
  FEATURE_BRAIN_AUTOPILOT: "false" # LLM egress disabled — see below
  LLM_DAILY_COST_CAP_USD: "0"
```

Install:

```bash
helm install borjie ./k8s/helm/borjie \
  --namespace borjie-tz --create-namespace \
  -f ./k8s/helm/borjie/values-tz.yaml \
  --set image.tag=$GIT_SHA \
  --atomic --timeout 20m
```

### Step 6.5 — Pin payments-ledger egress to in-country IPs only

The default `payments-ledger.networkpolicy.yaml` allows egress to
`0.0.0.0/0:443` for Stripe/Daraja. For TZ-sovereign tenants, replace
with an explicit allowlist:

```yaml
# k8s/helm/borjie/values-tz.yaml (overlay)
paymentsEgressAllowlist:
  enabled: true
  cidrs:
    - 196.201.214.0/24    # Safaricom Daraja (M-Pesa)
    - 41.59.0.0/16        # Tigopesa
    - 196.46.0.0/19       # Airtel Money
```

(This requires a small chart edit to render the CIDRs into the
`payments-ledger.networkpolicy.yaml` egress block — left as a follow-up
once the regulator confirms final CIDR ranges.)

### Step 6.6 — LLM egress

The Brain layer makes OpenAI/Anthropic API calls. **These egress
outside TZ.** Two options:

1. **Disable Brain entirely** (`FEATURE_BRAIN_AUTOPILOT: "false"`) and
   serve a "Smart suggestions unavailable in this region" UI banner.
2. **Self-host an LLM** (Llama 3 70B / Qwen 2 72B) in the same cluster
   on a GPU node pool. See `runbooks/llm-on-sovereign.md` (TODO).

Option 1 is the default. Document the choice in the customer's
`data_residency_attestation.pdf`.

## Backups & retention

BoT requires:

- **KYC documents**: 7 years after relationship ends.
- **Ledger entries**: 5 years.
- **Audit logs**: 3 years.
- **Personal data**: deletable on request unless covered by the above.

The chart's nightly backup CronJob (`consolidation-worker-cron.yaml`)
writes to the configured S3 bucket. Set:

```yaml
backups:
  destination: s3://<co-op>-borjie-backups-tz
  retention:
    kyc: 2555d         # 7y
    ledger: 1825d      # 5y
    auditLog: 1095d    # 3y
    other: 90d
  kmsKey: vault://transit/keys/borjie-backups
```

## On-prem disaster recovery

In-country requirement: **secondary site** must also be in Tanzania.
Document:

- Primary: <data-centre 1>, <city>
- Secondary: <data-centre 2>, <city>
- RTO target: 4 hours
- RPO target: 15 minutes (WAL-G streaming to S3 every 15m)

Run a quarterly DR drill: restore from backup into a parallel cluster,
verify all 4 portals come up green via `helm test`. Drill outcomes
land in the BoT annual report.

## Notify on incident

- DPO: `dpo@<co-op>.co.tz`
- BoT 24h hotline: see `regulator_contacts` in Vault
- TCRA security ops: see `regulator_contacts` in Vault
- Our on-call: PagerDuty service `borjie-tz`

Incidents in scope: any unauthorised access to PII, any cross-border
data flow that wasn't pre-declared, any outage > 1h, any payment
discrepancy > TZS 100,000.

## Audit packet (for BoT supervisor visit)

Generate with:

```bash
./k8s/scripts/sovereign-audit-pack.sh --tenant <co-op> --output ./audit-$(date +%Y%m%d).tar.gz
```

Contains: helm manifest, NetworkPolicy graph, secret rotation log,
backup verification log, last 12 months of audit log hash chain.

(Script is a follow-up; for now, gather the equivalent manually:
`helm get manifest`, `kubectl get networkpolicy -o yaml`, Vault
`audit/file/log`.)
