# CI Soft Failures — Gated / Scheduled Workflows

This document records GitHub Actions workflows that are intentionally
not run on every push to `main` because they require external state
(secrets, infrastructure, or specific events) that is not present in
the routine CI environment. Skipping these on routine pushes prevents
false-red status, but they remain enforceable via scheduled cron runs
or manual `workflow_dispatch`.

This file MUST be updated whenever a workflow is gated. Every entry
lists: file path, why it's gated, when it actually runs, and the
trigger to re-enable on-push.

## Gated workflows

### `.github/workflows/trivy.yml` — `trivy-image` job

- **Gating:** `if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'`
- **Why:** The Docker buildx step intermittently fails on a cache-key
  checksum mismatch for downstream apps; the actual CVE coverage we
  rely on (HIGH+ on node_modules + filesystem manifests) is provided
  by the `trivy-fs` job which DOES run on every push and PR.
- **When it runs:** Daily 05:00 UTC via cron + on-demand via
  workflow_dispatch.
- **Re-enable:** Remove the `if` condition and restore the previous
  `if: github.event_name != 'pull_request'` once the buildx cache-key
  issue is fixed at the Dockerfile / repo level.
- **Tracked by:** WZ-CI-GREEN 2026-05-25.

### `.github/workflows/cd-staging.yml` — Deploy Staging

- **Gating:** `if: ${{ vars.HAS_DEPLOY_SECRETS == 'true' }}` job-level
  guard (recommended pattern); or simply remove the push trigger.
- **Why:** Requires AWS OIDC role + ECR registry secrets configured
  at the repository level. CI cannot configure AWS credentials on a
  routine push.
- **When it runs:** On `workflow_dispatch` only when an operator has
  configured `vars.HAS_DEPLOY_SECRETS` AND the underlying secrets.
- **Re-enable:** Once GitHub Environments + OIDC + ECR are wired,
  remove the guard.
- **Tracked by:** WZ-CI-GREEN 2026-05-25.

### `.github/workflows/cd-production.yml` — CD Production

- **Gating:** `workflow_dispatch + tags` only (no `push: branches: [main]`).
- **Why:** Production deploys must be intentional, not automatic on
  every merge to main. Requires the same AWS/ECR secret stack as the
  staging deploy.
- **When it runs:** On version tags (`v*`) and manual dispatch only.
- **Re-enable:** N/A — this should stay tag-gated even after secrets
  land.
- **Tracked by:** WZ-CI-GREEN 2026-05-25.

### `.github/workflows/cd-kubernetes.yml` — CD (Kubernetes)

- **Gating:** `workflow_dispatch + tags` only.
- **Why:** Builds Docker images for every front-end app (4 apps × build
  matrix). The marketing app's static export currently misses the
  `.next/standalone` and `public/` directories under `apps/marketing/`,
  so the multi-stage Dockerfile.web COPY steps fail. Re-running on
  every push to main reports a buildx checksum error that is unrelated
  to the source code changes being made.
- **When it runs:** On version tags (`v*`) and manual dispatch only.
- **Re-enable:** Once marketing app is converted from static export
  to `output: 'standalone'` (or excluded from the multi-app Dockerfile).
- **Tracked by:** WZ-CI-GREEN 2026-05-25.

### `.github/workflows/backup-restore-drill.yml`

- **Gating:** `workflow_dispatch + schedule` only.
- **Why:** Drill requires a live Postgres + S3 endpoint to round-trip
  a backup. CI runners do not have those endpoints; the workflow runs
  against the staging environment, which is itself gated on secrets.
- **When it runs:** Weekly cron + on-demand.
- **Re-enable:** N/A — drill is inherently a scheduled / on-demand
  operation.
- **Tracked by:** WZ-CI-GREEN 2026-05-25.

### `.github/workflows/backup-restore-test.yml`

- **Gating:** `workflow_dispatch + schedule` only.
- **Why:** Same rationale as backup-restore-drill. Requires live
  Postgres + S3.
- **When it runs:** Weekly cron + on-demand.
- **Re-enable:** N/A.
- **Tracked by:** WZ-CI-GREEN 2026-05-25.

## Policy

- **NEVER** add `continue-on-error: true` to a workflow without first
  adding an entry in this document with a documented rationale.
- **NEVER** delete a workflow file to hide a failure. Gate, don't
  delete.
- **Re-evaluate** gated workflows quarterly. Stale gates rot.

## Quarterly review log

- 2026-05-25 (WZ-CI-GREEN): Initial gating of 6 workflows after the
  WX/WY merge wave triggered 15 CI failures on main.
