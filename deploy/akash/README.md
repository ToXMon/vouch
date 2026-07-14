# Vouch Agent Runtime — Akash Deployment

End-to-end runbook for deploying the Vouch FastAPI agent runtime
(`agents/runtime/`) to the Akash decentralized compute network.

The runtime orchestrates Venice AI agents and the three.ws Fact Check API.
Secrets (`VENICE_API_KEY`, `THREE_WS_API_KEY`) are injected as environment
variables **at deploy time** from your local environment — they are never
baked into the Docker image or committed to the SDL.

```
vouch/deploy/akash/
├── deploy.yml           # Akash SDL template (placeholders for image + secrets)
├── build-and-push.sh    # Build image from agents/runtime/Dockerfile → push GHCR
├── deploy-akash.sh      # Validate wallet → deploy → lease → manifest → health
├── .env.example         # Placeholder env vars (copy to .env, fill in)
└── README.md            # This file
```

## Architecture

```
┌──────────────┐   pull    ┌──────────────────────────┐
│  GHCR        │◄──────────│  Akash provider           │
│  vouch-image │           │  ┌─────────────────────┐  │
└──────────────┘           │  │ vouch-runtime (uvm) │  │  :8000 → :80 global
                           │  │ FastAPI + uvicorn   │──┼──► /api/health
        deploy-akash.sh    │  │ env: VENICE_API_KEY │  │
        ───────────────►   │  │      THREE_WS_API_KEY│ │
        injects secrets    │  └─────────────────────┘  │
                           └──────────────────────────┘
```

## Prerequisites

1. **Akash CLIs** — `akash` (node ops) and `provider-services` (deploy ops).
   Install from <https://github.com/akash-network/node/releases>.
2. **Funded wallet** — an Akash key in your keyring with:
   - **AKT** (uakt) for gas fees (≥ 5 AKT recommended).
   - **ACT** (uact) for deployment escrow. Mint from AKT:
     ```bash
     akash tx bme mint-act 5000000uakt --from wallet -y
     ```
3. **Certificate** — a client certificate in `$AKASH_HOME`. The deploy script
   creates one if missing; otherwise:
   ```bash
   provider-services tx cert create client --from wallet
   ```
4. **Docker** — for building the image locally.
5. **GitHub PAT** — a token with `write:packages` scope for pushing to GHCR.

## Step 1 — Configure environment

```bash
cd vouch/deploy/akash
cp .env.example .env
# Edit .env: set GHCR_USER, CR_PAT, VENICE_API_KEY, THREE_WS_API_KEY
```

Source it (or export the vars in your shell):
```bash
set -a; . ./.env; set +a
```

## Step 2 — Build and push the image to GHCR

```bash
# Build from agents/runtime/Dockerfile and push to ghcr.io/$GHCR_USER/vouch-runtime
./build-and-push.sh sha-$(git rev-parse --short HEAD)
```

**Make the package public.** Akash providers cannot pull private images:
- Go to `https://github.com/<GHCR_USER>?tab=packages`
- Open `vouch-runtime` → **Package settings** → **Danger Zone** →
  **Change visibility** → **Public**.

**Verify the image is pullable** before deploying:
```bash
# Anonymous pull check (works for public packages)
curl -s "https://ghcr.io/v2/${GHCR_USER}/vouch-runtime/manifests/${IMAGE_TAG}" \
  -H "Authorization: Bearer $(curl -s "https://ghcr.io/token?scope=repository:${GHCR_USER}/vouch-runtime:pull" | jq -r .token)" \
  -H "Accept: application/vnd.oci.image.manifest.v1+json" \
  | jq .config.digest
```

## Step 3 — Deploy to Akash

```bash
export IMAGE_TAG=sha-$(git rev-parse --short HEAD)   # immutable tag, NOT latest
./deploy-akash.sh
```

The script:
1. Validates your key, wallet balance (AKT + ACT), and certificate.
2. Renders `deploy.yml` into a temporary SDL with the real image ref and
   secrets **injected from your environment** (the template is never mutated).
3. Creates the deployment, waits for bids, accepts the first lease, sends
   the manifest.
4. Captures the **DSEQ**, provider address, and ingress URI into
   `.lease-<DSEQ>.txt`.
5. Probes `<ingress>/api/health`.

### Resource profile (cost-optimized)

| Resource | Value  |
|----------|--------|
| CPU      | 0.5    |
| Memory   | 512Mi  |
| Storage  | 5Gi    |
| Payment  | uact   |

## Step 4 — Verify the deployment

```bash
# Service status (ready_replicas should be 1)
provider-services service-status \
  --dseq <DSEQ> --provider <PROVIDER> \
  --service vouch-runtime --from wallet

# Health endpoint
curl -sf "<INGRESS_URI>/api/health"

# Logs
provider-services lease-logs \
  --dseq <DSEQ> --provider <PROVIDER> \
  --service vouch-runtime --from wallet | tail -40
```

## Step 5 — Point the frontend at the runtime

Update `frontend/.env`:
```bash
NEXT_PUBLIC_AGENT_URL=<INGRESS_URI>
```

## Secrets handling

- `deploy.yml` contains **placeholder tokens only** (`__VENICE_API_KEY__`,
  `__THREE_WS_API_KEY__`, `__GHCR_USER__`, `__IMAGE_TAG__`).
- `deploy-akash.sh` performs `sed` replacement into a **temporary** SDL kept
  in `$TMPDIR`, which is deleted on exit. Real secrets never touch the repo.
- The Docker image is built without any secrets — all secrets come from
  `os.environ` at container runtime (see `agents/runtime/main.py`).

## Managing the deployment

```bash
# List your deployments
provider-services query deployment list --owner $(akash keys show wallet -a)

# Close a deployment (stops escrow burn)
provider-services tx deployment close \
  --dseq <DSEQ> --from wallet \
  --gas auto --gas-adjustment 2.0 --fees 8000uakt -y
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `ready_replicas: 0` | Image tag wrong/private, or app exits. Run `lease-logs`. Ensure bulletproof keep-alive in the app. |
| No bids after 30s | Close stale deployments (bid starvation); wait, then redeploy once. |
| `no uact balance` | `akash tx bme mint-act <uakt> --from wallet` (ACT needed since Mainnet-17). |
| Image pull fails on provider | Package is private. Set it to Public in GitHub package settings. |
| SDL validation error | Run `provider-services sdl-to-manifest deploy.yml`. Ensure image tag is immutable (not `latest` in prod). |

> **Note on readiness probes:** Akash SDL v2.0 has no native readiness/liveness
> probe field. `/api/health` is verified post-deploy by `deploy-akash.sh` and
> should be monitored externally (uptime checker, Prometheus blackbox, etc.).
