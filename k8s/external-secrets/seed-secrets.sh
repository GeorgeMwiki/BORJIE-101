#!/usr/bin/env bash
#
# BORJIE — Seed secrets into the chosen ESO backend (or kubeseal fallback).
#
# Idempotent: re-running the script with the same args is a no-op for already-
# created secrets. We probe-then-create for every secret name, and the
# kubeseal controller install uses `kubectl apply` which is intrinsically
# idempotent.
#
# Usage:
#   ./seed-secrets.sh --backend=gcp [--dry-run]
#   ./seed-secrets.sh --backend=aws [--dry-run]
#   ./seed-secrets.sh --backend=kubeseal [--dry-run]
#
# The script will NEVER print a secret value. If a secret is missing from the
# env, it prompts via `read -rs` (silent).
#
set -euo pipefail

readonly SECRET_NAMES=(
  "DATABASE_URL"
  "ANTHROPIC_API_KEY"
  "OPENAI_API_KEY"
  "DEEPSEEK_API_KEY"
  "MPESA_CONSUMER_SECRET"
  "MPESA_PASSKEY"
)

# Map env var name -> remote secret name expected by external-secret-borjie-app.yaml.
readonly REMOTE_PREFIX="borjie"

BACKEND=""
DRY_RUN="false"

log()  { printf "[seed-secrets] %s\n" "$*" >&2; }
fail() { printf "[seed-secrets][ERROR] %s\n" "$*" >&2; exit 1; }

usage() {
  cat >&2 <<EOF
Usage: $0 --backend=gcp|aws|kubeseal [--dry-run]

Required env vars per backend:
  gcp       GCP_PROJECT
  aws       AWS_REGION (default us-east-1), AWS_ACCOUNT_ID
  kubeseal  (none — pulls SEALED_SECRETS_VERSION optional, default v0.27.1)

Secrets pulled from env (prompts silently if missing):
  ${SECRET_NAMES[*]}
EOF
  exit 2
}

# Parse flags.
for arg in "$@"; do
  case "$arg" in
    --backend=*) BACKEND="${arg#*=}" ;;
    --dry-run)   DRY_RUN="true" ;;
    -h|--help)   usage ;;
    *)           fail "Unknown arg: $arg (run --help)" ;;
  esac
done

[[ -z "$BACKEND" ]] && usage
case "$BACKEND" in
  gcp|aws|kubeseal) ;;
  *) fail "Backend must be one of: gcp, aws, kubeseal" ;;
esac

# Prompt for missing env values (silent, never echoed).
prompt_secret() {
  local name="$1"
  local val="${!name:-}"
  if [[ -z "$val" ]]; then
    printf "Enter value for %s (input hidden): " "$name" >&2
    read -rs val
    printf "\n" >&2
  fi
  [[ -z "$val" ]] && fail "$name is required"
  printf "%s" "$val"
}

# kebab-case of the env-var name -> remote secret id.
to_remote_id() {
  printf "%s/%s" "$REMOTE_PREFIX" "$(echo "$1" | tr '[:upper:]_' '[:lower:]-')"
}

# ---------- GCP Secret Manager ----------
seed_gcp() {
  command -v gcloud >/dev/null || fail "gcloud CLI not found"
  : "${GCP_PROJECT:?GCP_PROJECT is required}"
  log "Backend: GCP Secret Manager (project=$GCP_PROJECT)"

  for env_name in "${SECRET_NAMES[@]}"; do
    local remote_id; remote_id="$(to_remote_id "$env_name")"
    if gcloud secrets describe "$remote_id" --project="$GCP_PROJECT" >/dev/null 2>&1; then
      log "exists  : $remote_id (no-op — add new version manually if rotating)"
      continue
    fi
    if [[ "$DRY_RUN" == "true" ]]; then
      log "dry-run : would create $remote_id"
      continue
    fi
    local value; value="$(prompt_secret "$env_name")"
    printf "%s" "$value" \
      | gcloud secrets create "$remote_id" \
          --project="$GCP_PROJECT" \
          --replication-policy="automatic" \
          --data-file=- >/dev/null
    log "created : $remote_id"
  done
}

# ---------- AWS Secrets Manager ----------
seed_aws() {
  command -v aws >/dev/null || fail "aws CLI not found"
  local region="${AWS_REGION:-us-east-1}"
  : "${AWS_ACCOUNT_ID:?AWS_ACCOUNT_ID is required}"
  log "Backend: AWS Secrets Manager (region=$region account=$AWS_ACCOUNT_ID)"

  for env_name in "${SECRET_NAMES[@]}"; do
    local remote_id; remote_id="$(to_remote_id "$env_name")"
    if aws secretsmanager describe-secret \
         --region="$region" --secret-id="$remote_id" >/dev/null 2>&1; then
      log "exists  : $remote_id (no-op — use put-secret-value to rotate)"
      continue
    fi
    if [[ "$DRY_RUN" == "true" ]]; then
      log "dry-run : would create $remote_id"
      continue
    fi
    local value; value="$(prompt_secret "$env_name")"
    aws secretsmanager create-secret \
      --region="$region" \
      --name="$remote_id" \
      --secret-string="$value" >/dev/null
    log "created : $remote_id"
  done
}

# ---------- Sealed Secrets (kubeseal) ----------
seed_kubeseal() {
  command -v kubectl   >/dev/null || fail "kubectl not found"
  command -v kubeseal  >/dev/null || fail "kubeseal CLI not found (brew install kubeseal)"
  local version="${SEALED_SECRETS_VERSION:-v0.27.1}"
  local cert_path="${SEALED_SECRETS_CERT:-.sealed-secrets/pub-cert.pem}"
  log "Backend: Sealed Secrets controller=$version"

  if [[ "$DRY_RUN" == "true" ]]; then
    log "dry-run : would apply controller $version + fetch sealing cert"
    log "dry-run : would seal ${#SECRET_NAMES[@]} keys into borjie-secrets"
    return 0
  fi

  # `kubectl apply` is idempotent — re-runs are safe.
  kubectl apply -f \
    "https://github.com/bitnami-labs/sealed-secrets/releases/download/${version}/controller.yaml"

  # Wait until controller is Ready (idempotent — no-op if already Ready).
  kubectl -n kube-system rollout status deploy/sealed-secrets-controller --timeout=120s

  mkdir -p "$(dirname "$cert_path")"
  kubeseal --controller-namespace=kube-system --fetch-cert > "$cert_path"
  log "cert    : refreshed at $cert_path"

  # Build a Secret manifest from env (or prompts), pipe through kubeseal.
  local literals=()
  for env_name in "${SECRET_NAMES[@]}"; do
    local value; value="$(prompt_secret "$env_name")"
    literals+=("--from-literal=${env_name}=${value}")
  done

  local out="k8s/external-secrets/sealed-borjie-secrets.yaml"
  kubectl create secret generic borjie-secrets \
    --namespace=borjie \
    "${literals[@]}" \
    --dry-run=client -o yaml \
    | kubeseal --cert="$cert_path" --format=yaml > "$out"
  log "sealed  : $out (commit this file — values are encrypted)"
}

case "$BACKEND" in
  gcp)      seed_gcp ;;
  aws)      seed_aws ;;
  kubeseal) seed_kubeseal ;;
esac

log "Done."
