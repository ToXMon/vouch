#!/usr/bin/env bash
# build-and-push.sh — Build the Vouch agent runtime image and push to GHCR.
#
# The Dockerfile build context is the vouch/ repo root (see the header of
# agents/runtime/Dockerfile), because sibling agent packages are COPYed in.
#
# Usage:
#   GITHUB_USER=you CR_PAT=ghp_xxx ./build-and-push.sh [image_tag]
#
# Required env:
#   GITHUB_USER   GitHub username or org that owns the GHCR package.
#   CR_PAT        GitHub Personal Access Token with `write:packages` scope.
#
# Optional env:
#   IMAGE_TAG     Tag to push (default: latest).
#                 For reproducible Akash deploys, pass an immutable tag
#                 such as `sha-$(git rev-parse --short HEAD)`.
#
# This script NEVER reads or embeds VENICE_API_KEY / THREE_WS_API_KEY —
# those are injected at deploy time only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Repo root is two levels up: deploy/akash/ -> vouch/
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
DOCKERFILE="${REPO_ROOT}/agents/runtime/Dockerfile"
IMAGE_NAME="vouch-runtime"

# ---------------------------------------------------------------------------
# Validate required environment.
# ---------------------------------------------------------------------------
require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: environment variable ${name} is required but not set." >&2
    echo "       See deploy/akash/.env.example." >&2
    exit 1
  fi
}

require_env GITHUB_USER
require_env CR_PAT

IMAGE_TAG="${1:-${IMAGE_TAG:-latest}}"
REGISTRY="ghcr.io"
FULL_IMAGE="${REGISTRY}/${GITHUB_USER}/${IMAGE_NAME}"

# ---------------------------------------------------------------------------
# Preflight checks.
# ---------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is not installed or not on PATH." >&2
  exit 1
fi

if [[ ! -f "${DOCKERFILE}" ]]; then
  echo "ERROR: Dockerfile not found at ${DOCKERFILE}" >&2
  exit 1
fi

if [[ ! -f "${REPO_ROOT}/agents/runtime/main.py" ]]; then
  echo "ERROR: agents/runtime/main.py not found — wrong repo root?" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Build.
# ---------------------------------------------------------------------------
echo "==> Building ${FULL_IMAGE}:${IMAGE_TAG}"
echo "    context:  ${REPO_ROOT}"
echo "    dockerfile: ${DOCKERFILE}"

docker build \
  -t "${FULL_IMAGE}:${IMAGE_TAG}" \
  -f "${DOCKERFILE}" \
  "${REPO_ROOT}"

# Always tag `latest` as well so the placeholder SDL resolves during dev.
if [[ "${IMAGE_TAG}" != "latest" ]]; then
  docker tag "${FULL_IMAGE}:${IMAGE_TAG}" "${FULL_IMAGE}:latest"
fi

# ---------------------------------------------------------------------------
# Log in to GHCR and push.
# ---------------------------------------------------------------------------
echo "==> Logging in to ${REGISTRY} as ${GITHUB_USER}"
printf '%s' "${CR_PAT}" | docker login "${REGISTRY}" \
  --username "${GITHUB_USER}" \
  --password-stdin

echo "==> Pushing ${FULL_IMAGE}:${IMAGE_TAG}"
docker push "${FULL_IMAGE}:${IMAGE_TAG}"

if [[ "${IMAGE_TAG}" != "latest" ]]; then
  echo "==> Pushing ${FULL_IMAGE}:latest"
  docker push "${FULL_IMAGE}:latest"
fi

# ---------------------------------------------------------------------------
# IMPORTANT: make the package public.
# ---------------------------------------------------------------------------
cat <<EOF

✅ Pushed: ${FULL_IMAGE}:${IMAGE_TAG}

⚠️  Akash providers cannot pull PRIVATE images. Go to:
      https://github.com/${GITHUB_USER}?tab=packages
    open the package → Package settings → Danger Zone →
    Change visibility → PUBLIC.

Next: set IMAGE_TAG=${IMAGE_TAG} and run deploy-akash.sh.
EOF
