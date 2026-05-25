#!/usr/bin/env bash
# Build & push all 8 BORJIE container images to GHCR (or any other
# registry configured in values.yaml), then update the Helm values
# file with the new SHA tag.
#
# Usage:
#   ./k8s/scripts/build-and-push.sh                   # build + push, default registry, current branch
#   ./k8s/scripts/build-and-push.sh --dry-run         # show what would happen, no docker push, no values write
#   ./k8s/scripts/build-and-push.sh --tag custom-rc1  # additional explicit tag (still also tagged with SHA)
#   REGISTRY=123.dkr.ecr.eu-central-1.amazonaws.com/borjie ./k8s/scripts/build-and-push.sh
#
# Env vars:
#   REGISTRY   — default ghcr.io/georgemwiki/borjie
#   PLATFORM   — default linux/amd64,linux/arm64
#   VALUES     — default k8s/helm/borjie/values.yaml
#   PARALLELISM — default 4 (concurrent docker builds via xargs)
#
# Tags applied to each image:
#   <registry>/<service>:<git-sha>
#   <registry>/<service>:<branch>
#   <registry>/<service>:latest         (only on main)
set -euo pipefail

# ── Config defaults ──────────────────────────────────────────────────
REGISTRY="${REGISTRY:-ghcr.io/georgemwiki/borjie}"
PLATFORM="${PLATFORM:-linux/amd64,linux/arm64}"
VALUES="${VALUES:-k8s/helm/borjie/values.yaml}"
PARALLELISM="${PARALLELISM:-4}"
DRY_RUN=0
EXTRA_TAG=""

# ── Args ─────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)  DRY_RUN=1; shift ;;
    --tag)      EXTRA_TAG="$2"; shift 2 ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2 ;;
  esac
done

# ── Workspace detection ──────────────────────────────────────────────
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

if [[ ! -f "$VALUES" ]]; then
  echo "FATAL: values file not found at $VALUES" >&2
  exit 1
fi

GIT_SHA="$(git rev-parse --short=12 HEAD)"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
IS_MAIN=0
[[ "$GIT_BRANCH" == "main" ]] && IS_MAIN=1

echo "==> borjie image build"
echo "    registry:    $REGISTRY"
echo "    platform:    $PLATFORM"
echo "    git_sha:     $GIT_SHA"
echo "    git_branch:  $GIT_BRANCH"
echo "    values:      $VALUES"
[[ -n "$EXTRA_TAG" ]] && echo "    extra_tag:   $EXTRA_TAG"
[[ "$DRY_RUN" -eq 1 ]] && echo "    DRY-RUN:     no docker push, no values write"
echo

# ── Image manifest ───────────────────────────────────────────────────
# Each line: <service-name>:<dockerfile-path>:<build-context>
# Dockerfile paths follow the BORJIE monorepo convention. Adjust if
# your repo layout differs.
IMAGES=(
  "customer-app:apps/customer-app/Dockerfile:."
  "estate-manager-app:apps/estate-manager-app/Dockerfile:."
  "owner-portal:apps/owner-portal/Dockerfile:."
  "admin-platform-portal:apps/admin-platform-portal/Dockerfile:."
  "api-gateway:services/api-gateway/Dockerfile:."
  "payments-ledger:services/payments-ledger/Dockerfile:."
  "reports:services/reports/Dockerfile:."
  "notifications:services/notifications/Dockerfile:."
)

# ── Login (skipped on dry-run) ───────────────────────────────────────
if [[ "$DRY_RUN" -eq 0 ]]; then
  if [[ "$REGISTRY" == ghcr.io/* ]]; then
    if [[ -z "${GHCR_TOKEN:-}" ]]; then
      echo "==> reusing existing docker login (no GHCR_TOKEN env present)"
    else
      echo "==> logging in to ghcr.io"
      echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-georgemwiki}" --password-stdin
    fi
  fi
fi

# ── Build + push each image ──────────────────────────────────────────
build_one() {
  local entry="$1"
  IFS=: read -r name dockerfile context <<<"$entry"
  local img="$REGISTRY/$name"
  local sha_tag="$img:$GIT_SHA"
  local branch_tag="$img:$GIT_BRANCH"
  local latest_tag="$img:latest"

  echo "==> [$name]  building"
  echo "    dockerfile: $dockerfile"
  echo "    context:    $context"
  echo "    tags:       $sha_tag"
  echo "                $branch_tag"
  [[ "$IS_MAIN" -eq 1 ]] && echo "                $latest_tag"
  [[ -n "$EXTRA_TAG" ]]  && echo "                $img:$EXTRA_TAG"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "    DRY-RUN: skipping docker buildx build/push"
    return 0
  fi

  local tag_args=(-t "$sha_tag" -t "$branch_tag")
  [[ "$IS_MAIN" -eq 1 ]] && tag_args+=(-t "$latest_tag")
  [[ -n "$EXTRA_TAG" ]]  && tag_args+=(-t "$img:$EXTRA_TAG")

  docker buildx build \
    --platform "$PLATFORM" \
    --file "$dockerfile" \
    "${tag_args[@]}" \
    --push \
    "$context"
}

export -f build_one
export REGISTRY PLATFORM GIT_SHA GIT_BRANCH IS_MAIN EXTRA_TAG DRY_RUN

printf '%s\n' "${IMAGES[@]}" | xargs -I{} -P "$PARALLELISM" bash -c 'build_one "$@"' _ {}

# ── Update values.yaml ───────────────────────────────────────────────
echo
echo "==> updating $VALUES: image.tag → $GIT_SHA"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "    DRY-RUN: would run yq write or sed substitution"
else
  if command -v yq >/dev/null 2>&1; then
    yq -i ".image.tag = \"$GIT_SHA\"" "$VALUES"
  else
    # Fallback: sed. Match `  tag: <anything>` on the first occurrence
    # under the top-level `image:` block.
    awk -v sha="$GIT_SHA" '
      BEGIN { in_image=0; done=0 }
      /^image:/        { in_image=1 }
      /^[^[:space:]]/ && !/^image:/ { in_image=0 }
      in_image && !done && /^[[:space:]]+tag:/ {
        sub(/tag:.*/, "tag: " sha)
        done=1
      }
      { print }
    ' "$VALUES" > "$VALUES.tmp" && mv "$VALUES.tmp" "$VALUES"
  fi
  echo "    values.yaml updated"
fi

echo
echo "==> done. ready to deploy with:"
echo "    helm upgrade --install borjie ./k8s/helm/borjie \\"
echo "      --namespace borjie-staging --create-namespace \\"
echo "      -f ./k8s/helm/borjie/values-staging.yaml \\"
echo "      --set image.tag=$GIT_SHA \\"
echo "      --atomic --timeout 10m"
