# Deploy Vouch to Monad Testnet

End-to-end guide for deploying `Vouch.sol` to Monad testnet (chain ID **10143**).

The deploy is driven by `deploy/monad/deploy.sh`. The script is fully driven by environment variables — it never reads keys from disk and never hardcodes them.

## Prerequisites

1. **Foundry** installed:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash && foundryup
   ```
2. **A funded deployer wallet** with testnet MON (see Step 1).
3. The contract test suite is green:
   ```bash
   cd contracts && forge test
   ```
   (Vouch is currently 28/28 passing.)

## 1. Get testnet MON from the faucet

Monad testnet MON has no real value but is required to pay for deployment gas.

- Visit the **Monad testnet faucet** (linked from `https://testnet.monadscan.com`).
- Paste your deployer wallet address.
- Confirm the balance on `https://testnet.monadscan.com/address/<your-address>`.

You only need a small amount — contract deployment + verification costs well under 0.1 MON.

## 2. Set environment variables

Never commit private keys. Use a local shell session or a gitignored `.env` file that you source manually.

```bash
export MONAD_RPC_URL="https://testnet-rpc.monad.xyz"
export DEPLOYER_PRIVATE_KEY="0x..."        # your funded testnet wallet key
export MONAD_DEPLOYER_ADDRESS="0x..."       # the matching address (for reference / .env)
# Optional: pin an AI adjudicator wallet (defaults to deployer if unset)
# export ADJUDICATOR="0x..."
```

## 3. Run the deploy script

From the repo root:

```bash
bash deploy/monad/deploy.sh
```

The script will:

1. Refuse to run if `DEPLOYER_PRIVATE_KEY` is unset or is not `0x`-prefixed (fail-fast).
2. Compile the contracts via `forge build`.
3. Broadcast the deployment via `forge script ... --broadcast --verify`.
4. Extract the deployed address from `forge` output.
5. Write the address to `deploy/monad/.deployed-address` (gitignored).
6. Print concrete next steps.

If `forge` exits non-zero, the script exits non-zero and leaves a `.deploy.log` next to it for inspection (the log is removed only on success).

## 4. Wire the address into the frontend and agent runtime

After a successful deploy, copy the address out of `.deployed-address`:

```bash
ADDR="$(cat deploy/monad/.deployed-address)"
```

Update `frontend/.env` (gitignored locally):

```bash
VOUCH_CONTRACT_ADDRESS=$ADDR
NEXT_PUBLIC_VOUCH_CONTRACT_ADDRESS=$ADDR
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
```

Update the repo-root `.env` (used by the agent runtime under `agents/`):

```bash
VOUCH_CONTRACT_ADDRESS=$ADDR
```

## 5. Verify on the explorer

Open `https://testnet.monadscan.com/address/<deployed-address>` and confirm:

- The contract source is verified (the **Read Contract** and **Write Contract** tabs are populated with the ABI).
- `adjudicator()` returns the expected AI wallet address.
- `owner()` returns your deployer address (until you transfer it to a multisig).

## Monad-specific notes

These come from the `monskill: gas` and `monskill: wallet` skills and matter for the production path:

- **Gas is charged on `gas_limit`, not gas used.** Set tight, explicit gas limits in the frontend — do not let wallets over-estimate, or users pay for unused gas. For fixed-cost calls (e.g. native transfers) hardcode `21000`.
- **Chain ID:** 10143.
- **Block gas limit:** 200M; per-transaction limit 30M.
- **Base fee floor:** 100 MON-gwei. Base fee adjusts more slowly upward and faster downward than Ethereum.
- **Cold state access is ~3–4× more expensive than Ethereum** (account access 10,100 gas, storage access 8,100 gas). Batch reads that reuse warm slots are unaffected; scattered single-reads cost more.
- **Precompile repricing:** `ecRecover` 2×, `ecMul`/`ecPairing` 5×. Vouch does not currently rely on these, but factor them in if you add signature or ZK verification.

For the deployment itself, `forge script` estimates gas from simulation; the script does not need explicit gas overrides for this single-constructor deploy.

## Security

- **Never commit `DEPLOYER_PRIVATE_KEY`.** The repo's `.gitignore` excludes `.env`, `*.key`, `mnemonic*`, `private*key*`, and `deploy/monad/.deployed-address`.
- The deploy script reads keys **only** from the current environment — it never writes them to disk.
- For production, deploy through a **Safe multisig** (see `monskill: wallet`) and transfer the adjudicator role and contract ownership to it before any real value is at stake.
- The deployer private key should be a dedicated testnet wallet, not reused from mainnet.
