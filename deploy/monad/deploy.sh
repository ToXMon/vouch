#!/usr/bin/env bash
# Deploy Vouch.sol to Monad testnet (chain ID 10143).
#
# Required environment:
#   MONAD_RPC_URL         Monad testnet RPC endpoint
#   DEPLOYER_PRIVATE_KEY  Funded testnet wallet private key (0x-prefixed hex)
#
# Optional:
#   ADJUDICATOR           AI agent wallet address (defaults to deployer if unset)
#
# Usage:
#   MONAD_RPC_URL=https://testnet-rpc.monad.xyz \
#   DEPLOYER_PRIVATE_KEY=0x... \
#   bash deploy/monad/deploy.sh
#
# This script NEVER reads keys from disk and NEVER hardcodes them.
# It only consumes them from the current environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTRACTS_DIR="$REPO_ROOT/contracts"
ADDRESS_FILE="$SCRIPT_DIR/.deployed-address"
DEPLOY_LOG="$SCRIPT_DIR/.deploy.log"

# --- Fail-fast: refuse to run without required env ---------------------
if [[ -z "${MONAD_RPC_URL:-}" ]]; then
  echo "ERROR: MONAD_RPC_URL is not set (e.g. https://testnet-rpc.monad.xyz)" >&2
  exit 1
fi

if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  echo "ERROR: DEPLOYER_PRIVATE_KEY is not set — refusing to run without a key." >&2
  echo "       Export it in your shell; never put it in a committed file." >&2
  exit 1
fi

if [[ "$DEPLOYER_PRIVATE_KEY" != 0x* ]]; then
  echo "ERROR: DEPLOYER_PRIVATE_KEY must be 0x-prefixed hex." >&2
  exit 1
fi

if [[ ! -d "$CONTRACTS_DIR" ]]; then
  echo "ERROR: contracts directory not found at $CONTRACTS_DIR" >&2
  exit 1
fi

# --- Compile first so syntax errors fail fast --------------------------
echo "→ Compiling contracts..."
( cd "$CONTRACTS_DIR" && forge build )

# --- Broadcast + verify ------------------------------------------------
echo "→ Broadcasting deployment to $MONAD_RPC_URL ..."
( cd "$CONTRACTS_DIR" && \
  forge script script/DeployVouch.s.sol:DeployVouch \
    --rpc-url "$MONAD_RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast \
    --verify \
    2>&1 | tee "$DEPLOY_LOG" )

# --- Extract deployed address from console.log output ------------------
DEPLOYED_ADDRESS="$(grep -oE 'Vouch deployed at: 0x[0-9a-fA-F]{40}' "$DEPLOY_LOG" \
                    | head -n1 | awk '{print $NF}')"

if [[ -z "$DEPLOYED_ADDRESS" ]]; then
  # Fallback: parse receipt's contractAddress field
  DEPLOYED_ADDRESS="$(grep -oE 'contractAddress.*?0x[0-9a-fA-F]{40}' "$DEPLOY_LOG" \
                      | head -n1 | grep -oE '0x[0-9a-fA-F]{40}')"
fi

if [[ -z "$DEPLOYED_ADDRESS" ]]; then
  echo "ERROR: could not extract deployed address from forge output." >&2
  echo "       Inspect $DEPLOY_LOG manually." >&2
  exit 1
fi

# --- Persist address (gitignored) --------------------------------------
echo "$DEPLOYED_ADDRESS" > "$ADDRESS_FILE"

# --- Cleanup transient log ---------------------------------------------
rm -f "$DEPLOY_LOG"

# --- Next steps --------------------------------------------------------
echo ""
echo "✓ Vouch deployed at: $DEPLOYED_ADDRESS"
echo "  Address written to: $ADDRESS_FILE (gitignored)"
echo ""
echo "Next steps:"
echo "  1. Update frontend/.env (local, gitignored):"
echo "       VOUCH_CONTRACT_ADDRESS=$DEPLOYED_ADDRESS"
echo "       NEXT_PUBLIC_VOUCH_CONTRACT_ADDRESS=$DEPLOYED_ADDRESS"
echo "       NEXT_PUBLIC_MONAD_RPC_URL=$MONAD_RPC_URL"
echo "  2. Update repo-root .env (used by agents):"
echo "       VOUCH_CONTRACT_ADDRESS=$DEPLOYED_ADDRESS"
echo "  3. Verify on Monad testnet explorer:"
echo "       https://testnet.monadscan.com/address/$DEPLOYED_ADDRESS"
echo "  4. (Optional) Re-run with ADJUDICATOR=0x... to bind a specific AI wallet."
