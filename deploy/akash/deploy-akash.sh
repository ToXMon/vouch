#!/usr/bin/env bash
# deploy-akash.sh — Deploy the Vouch agent runtime to Akash Network.
#
# Reads ALL configuration from environment variables (see .env.example).
# No wallet address, mnemonic, private key, or API key is hardcoded.
#
# Flow:
#   1. Validate env + wallet + balance + certificate.
#   2. Template deploy.yml: inject image ref + secrets into a temp SDL.
#   3. Create deployment, wait for bids, accept first lease, send manifest.
#   4. Capture DSEQ, provider URI, lease status.
#   5. Probe /api/health on the ingress URI.
#
# Usage:
#   AKASH_KEY_NAME=wallet VENICE_API_KEY=... THREE_WS_API_KEY=... \
#     GHCR_USER=you IMAGE_TAG=sha-a1b2c3d ./deploy-akash.sh
#
# This script does NOT execute anything irreversible without printing the
# plan first. It does NOT close existing deployments automatically.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDL_TEMPLATE="${SCRIPT_DIR}/deploy.yml"
SDL_RENDERED="$(mktemp -t vouch-deploy.XXXXXX.yml)"
trap 'rm -f "${SDL_RENDERED}"' EXIT

# ---------------------------------------------------------------------------
# Configuration (all from environment, with sane defaults).
# ---------------------------------------------------------------------------
AKASH_KEY_NAME="${AKASH_KEY_NAME:-wallet}"
AKASH_CHAIN_ID="${AKASH_CHAIN_ID:-akashnet-2}"
AKASH_NODE="${AKASH_NODE:-https://rpc.akashnet.net:443}"
AKASH_KEYRING_BACKEND="${AKASH_KEYRING_BACKEND:-test}"
AKASH_HOME="${AKASH_HOME:-${HOME}/.akash}"
AKASH_BROADCAST_MODE="${AKASH_BROADCAST_MODE:-block}"

export AKASH_CHAIN_ID AKASH_NODE AKASH_KEYRING_BACKEND AKASH_HOME AKASH_BROADCAST_MODE

# Gas flags that work consistently (per akash-deploy-workflow skill).
GAS_FLAGS=(--gas auto --gas-adjustment 2.0 --fees 8000uakt)

# ---------------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()  { echo -e "${GREEN}==>${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️ ${NC} $*"; }
die()  { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    die "environment variable ${name} is required but not set (see .env.example)."
  fi
}

need_binary() {
  local bin="$1"
  command -v "${bin}" >/dev/null 2>&1 || die "${bin} not found. Install: https://github.com/akash-network/node/releases"
}

# ---------------------------------------------------------------------------
# 1. Validate prerequisites.
# ---------------------------------------------------------------------------
log "Pre-flight checks"

need_binary akash
need_binary provider-services

require_env GHCR_USER
require_env IMAGE_TAG
require_env VENICE_API_KEY
require_env THREE_WS_API_KEY

# Resolve the deployer address from the keyring.
DEPLOYER_ADDRESS="$(akash keys show "${AKASH_KEY_NAME}" -a 2>/dev/null)" \
  || die "key '${AKASH_KEY_NAME}' not found in keyring backend '${AKASH_KEYRING_BACKEND}'."
log "Deployer address: ${DEPLOYER_ADDRESS}"

# Check balances — need AKT for gas and ACT (uact) for escrow.
log "Checking wallet balances"
BALANCES="$(akash query bank balances "${DEPLOYER_ADDRESS}" 2>&1)"
echo "${BALANCES}" | grep -E 'amount:|denom:' || true

echo "${BALANCES}" | grep -q 'uakt' \
  || warn "No uakt (AKT) balance detected — you need AKT for gas fees."
echo "${BALANCES}" | grep -q 'uact' \
  || warn "No uact (ACT) balance detected — mint ACT first: akash tx bme mint-act <uakt> --from ${AKASH_KEY_NAME}"

# Certificate — required to communicate with providers.
if ! ls "${AKASH_HOME}"/*.pem >/dev/null 2>&1; then
  warn "No certificate found in ${AKASH_HOME}. Creating one..."
  provider-services tx cert create client --from "${AKASH_KEY_NAME}" -y
fi

# ---------------------------------------------------------------------------
# 2. Render the SDL with injected image + secrets.
# ---------------------------------------------------------------------------
log "Rendering SDL from template (secrets injected from environment)"

cp "${SDL_TEMPLATE}" "${SDL_RENDERED}"

# Replace placeholder tokens. printf avoids sed delimiter issues with URIs/keys.
render_token() {
  local token="$1" value="$2"
  # Use | as delimiter; values are single-line.
  local esc
  esc="$(printf '%s' "${value}" | sed -e 's/[\\/&|]/\\&/g')"
  sed -i "s|${token}|${esc}|g" "${SDL_RENDERED}"
}

render_token '__GHCR_USER__'      "${GHCR_USER}"
render_token '__IMAGE_TAG__'      "${IMAGE_TAG}"
render_token '__VENICE_API_KEY__' "${VENICE_API_KEY}"
render_token '__THREE_WS_API_KEY__' "${THREE_WS_API_KEY}"

# Validate the rendered SDL.
provider-services sdl-to-manifest "${SDL_RENDERED}" >/dev/null \
  || die "rendered SDL failed validation."

# Sanity: ensure no placeholder tokens leaked through.
grep -qE '__[A-Z_]+__' "${SDL_RENDERED}" \
  && die "unresolved placeholder token remains in rendered SDL." || true

log "SDL valid. Image: ghcr.io/${GHCR_USER}/vouch-runtime:${IMAGE_TAG}"

# ---------------------------------------------------------------------------
# 3. Create the deployment.
# ---------------------------------------------------------------------------
log "Creating deployment on ${AKASH_CHAIN_ID}"

CREATE_OUT="$(provider-services tx deployment create "${SDL_RENDERED}" \
  --from "${AKASH_KEY_NAME}" "${GAS_FLAGS[@]}" -y 2>&1)" || {
  echo "${CREATE_OUT}" >&2
  die "deployment creation failed."
}

DSEQ="$(printf '%s' "${CREATE_OUT}" | grep -oE 'dseq: ?"?[0-9]+' | grep -oE '[0-9]+' | head -1)"
[[ -n "${DSEQ}" ]] || die "could not parse DSEQ from deployment output."
log "Deployment created. DSEQ=${DSEQ}"

# ---------------------------------------------------------------------------
# 4. Wait for bids and accept the first open bid.
# ---------------------------------------------------------------------------
log "Waiting 15s for provider bids..."
sleep 15

BID_OUT="$(provider-services query market bid list \
  --owner "${DEPLOYER_ADDRESS}" --dseq "${DSEQ}" --state open 2>&1)"

echo "${BID_OUT}"

PROVIDER="$(printf '%s' "${BID_OUT}" | grep -oE 'akash1[a-z0-9]{38,39}' | head -1)"
[[ -n "${PROVIDER}" ]] || die "no open bids found for DSEQ=${DSEQ}."

log "Accepting first bid from provider: ${PROVIDER}"
provider-services tx market lease create \
  --dseq "${DSEQ}" --provider "${PROVIDER}" \
  --from "${AKASH_KEY_NAME}" "${GAS_FLAGS[@]}" -y

# ---------------------------------------------------------------------------
# 5. Send the manifest.
# ---------------------------------------------------------------------------
log "Sending manifest to provider (waiting 5s for lease to settle)"
sleep 5

provider-services send-manifest "${SDL_RENDERED}" \
  --dseq "${DSEQ}" --provider "${PROVIDER}" \
  --from "${AKASH_KEY_NAME}"

log "Waiting 30s for the container to start..."
sleep 30

# ---------------------------------------------------------------------------
# 6. Verify status and probe the health endpoint.
# ---------------------------------------------------------------------------
log "Service status"
STATUS_OUT="$(provider-services service-status \
  --dseq "${DSEQ}" --provider "${PROVIDER}" \
  --service vouch-runtime --from "${AKASH_KEY_NAME}" 2>&1)"

echo "${STATUS_OUT}"

# Capture the ingress URI.
INGRESS_URI="$(printf '%s' "${STATUS_OUT}" | grep -oE 'http://[a-z0-9.-]+\.ingress\.[a-z0-9.-]+' | head -1)"

LEASE_FILE="${SCRIPT_DIR}/.lease-${DSEQ}.txt"
cat > "${LEASE_FILE}" <<EOF
# Vouch runtime lease — DSEQ ${DSEQ}
DSEQ=${DSEQ}
PROVIDER=${PROVIDER}
OWNER=${DEPLOYER_ADDRESS}
INGRESS_URI=${INGRESS_URI}
CHAIN_ID=${AKASH_CHAIN_ID}
IMAGE=ghcr.io/${GHCR_USER}/vouch-runtime:${IMAGE_TAG}
CREATED_AT=$(date -u +%FT%TZ)
EOF

log "Lease details written to ${LEASE_FILE}"

if [[ -n "${INGRESS_URI}" ]]; then
  log "Probing health endpoint: ${INGRESS_URI}/api/health"
  if curl -sf -m 30 "${INGRESS_URI}/api/health"; then
    echo ""
    log "✅ /api/health responded. Deployment is live."
  else
    warn "/api/health did not respond within 30s. Check logs:"
    warn "  provider-services lease-logs --dseq ${DSEQ} --provider ${PROVIDER} --service vouch-runtime --from ${AKASH_KEY_NAME}"
  fi
else
  warn "Could not parse ingress URI from service-status. Read the output above."
fi

cat <<EOF

${GREEN}=== Deployment Summary ===${NC}
  DSEQ:        ${DSEQ}
  Provider:    ${PROVIDER}
  Owner:       ${DEPLOYER_ADDRESS}
  Ingress:     ${INGRESS_URI:-<pending>}
  Lease file:  ${LEASE_FILE}

Update the frontend env:
  NEXT_PUBLIC_AGENT_URL=${INGRESS_URI:-http://<your-provider-ingress>}

Close this deployment when done:
  provider-services tx deployment close --dseq ${DSEQ} --from ${AKASH_KEY_NAME} ${GAS_FLAGS[*]} -y
EOF
