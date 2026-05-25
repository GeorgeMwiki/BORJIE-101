#!/usr/bin/env bash
#
# Sign an AI artifact (ai-bom.json or any model-related JSON/blob) with
# Sigstore cosign, keyless OIDC via Fulcio. Pushes the attestation to
# the Rekor transparency log.
#
# Run only in CI (GitHub Actions) where OIDC tokens are available, OR
# locally with `cosign login` having an interactive browser flow.
#
# Usage:
#   ./scripts/sign-ai-artifact.sh ai-bom.json
#   ./scripts/sign-ai-artifact.sh dist/some-model-bundle.tar.gz
#
# Output: <input>.sig and <input>.pem alongside the input file, plus a
# transparency-log entry visible at https://search.sigstore.dev/.
#
# Refs:
#   - https://docs.sigstore.dev/
#   - https://slsa.dev/spec/v1.0/requirements

set -euo pipefail

ARTIFACT="${1:-ai-bom.json}"

if [[ ! -f "${ARTIFACT}" ]]; then
  echo "[sign-ai] ERROR: artifact not found: ${ARTIFACT}" >&2
  exit 1
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "[sign-ai] ERROR: cosign not installed. https://docs.sigstore.dev/system_config/installation/" >&2
  exit 1
fi

echo "[sign-ai] signing ${ARTIFACT} with keyless OIDC (Fulcio)..."

# COSIGN_EXPERIMENTAL=1 is required for keyless on older cosign versions;
# 2.x has it on by default but harmless to set.
COSIGN_EXPERIMENTAL=1 cosign sign-blob \
  --yes \
  --output-signature "${ARTIFACT}.sig" \
  --output-certificate "${ARTIFACT}.pem" \
  "${ARTIFACT}"

echo "[sign-ai] wrote:"
echo "[sign-ai]   ${ARTIFACT}.sig    (signature)"
echo "[sign-ai]   ${ARTIFACT}.pem    (Fulcio cert)"
echo "[sign-ai] Verify with: ./scripts/verify-ai-artifact.sh ${ARTIFACT}"
