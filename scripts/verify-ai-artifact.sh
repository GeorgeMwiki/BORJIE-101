#!/usr/bin/env bash
#
# Verify an AI artifact signed by scripts/sign-ai-artifact.sh.
#
# Usage:
#   ./scripts/verify-ai-artifact.sh ai-bom.json
#
# Exit 0 if signature + Rekor log entry verify against the expected
# OIDC issuer + identity (BORJIE's GitHub Actions workflow).

set -euo pipefail

ARTIFACT="${1:-ai-bom.json}"
EXPECTED_ISSUER="${EXPECTED_OIDC_ISSUER:-https://token.actions.githubusercontent.com}"
EXPECTED_IDENTITY_REGEX="${EXPECTED_IDENTITY_REGEX:-^https://github.com/GeorgeMwiki/BORJIE101/\.github/workflows/ai-bom-attest\.yml@.+$}"

if [[ ! -f "${ARTIFACT}" || ! -f "${ARTIFACT}.sig" || ! -f "${ARTIFACT}.pem" ]]; then
  echo "[verify-ai] ERROR: missing ${ARTIFACT}, ${ARTIFACT}.sig, or ${ARTIFACT}.pem" >&2
  exit 1
fi

if ! command -v cosign >/dev/null 2>&1; then
  echo "[verify-ai] ERROR: cosign not installed" >&2
  exit 1
fi

echo "[verify-ai] verifying ${ARTIFACT}..."

COSIGN_EXPERIMENTAL=1 cosign verify-blob \
  --signature "${ARTIFACT}.sig" \
  --certificate "${ARTIFACT}.pem" \
  --certificate-oidc-issuer "${EXPECTED_ISSUER}" \
  --certificate-identity-regexp "${EXPECTED_IDENTITY_REGEX}" \
  "${ARTIFACT}"

echo "[verify-ai] OK — ${ARTIFACT} signature valid + identity matches"
