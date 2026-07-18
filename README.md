# Vouch

> **Polymarket for personal claims.** AI-verified betting on Monad. Two AI agents make a verifiable promise to each other — the blockchain enforces it.

```text
"I bet @sarah 5 MON I'll ship my startup by Q4."
   ↓ AI Architect drafts the spec
   ↓ Stake locks onchain (Vouch.sol)
   ↓ Evidence submitted → three.ws fact-checks
   ↓ Dispute? Cross-model Adjudicator rules
   ↓ Settlement enforced by code
```

---

## 🌐 Live Deployment

| Service | URL | Status |
|---------|-----|--------|
| **Frontend (React)** | https://vouch.tolu-a-shekoni.workers.dev | ✅ Live (React 18 + Vite) |
| **Agent Runtime** | https://vouch.tolu-a-shekoni.workers.dev | ✅ Live |
| **API Docs (Swagger)** | https://vouch.tolu-a-shekoni.workers.dev/docs | ✅ Live |
| **Health Check** | https://vouch.tolu-a-shekoni.workers.dev/api/health | ✅ Live |
| **Contract** | `0x5d763316Df16Ee9083168D323519A354856Be0f1` on Monad Testnet (10143) | ✅ Deployed |

> ⚠️ Akash providers use self-signed TLS certs. Your browser will show a security warning — click "Advanced" → "Proceed" to access the app.


## 🎬 Live Demo

The AI-vs-AI demo runs end-to-end with **real Venice + three.ws API calls**:

```bash
# Set API keys (get them from Venice.ai and three.ws)
export VENICE_API_KEY="..."
export THREE_WS_API_KEY="..."
export VOUCH_CONTRACT_ADDRESS="0x5d763316Df16Ee9083168D323519A354856Be0f1"

# Run the 6-phase demo (~3 minutes)
cd agents
demo_pause=1 python -m demo
```

**What happens:** Two Venice-powered agents autonomously make a verifiable commitment on Monad. The AI Architect drafts a spec, three.ws fact-checks the evidence, and a cross-model Adjudicator (different Venice model family) issues a binding ruling.

---

## 🏗️ Architecture

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Frontend   │─────│ Agent Runtime│─────│  Vouch.sol   │
│ React + Para │     │  FastAPI     │     │   Monad      │
└──────────────┘     └──────┬───────┘     └──────────────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
         ┌─────────┐ ┌─────────┐ ┌─────────────┐
         │Architect│ │Auditor  │ │Adjudicator  │
         │(Venice) │ │(Venice+ │ │(Venice,     │
         │         │ │three.ws)│ │ cross-model)│
         └─────────┘ └─────────┘ └─────────────┘
```

### Agent Roles

| Agent | Model | Role |
|-------|-------|------|
| **Architect** | Venice (Qwen) | Parses natural-language claim → structured CommitmentSpec (forced verification gate) |
| **Auditor** | Venice (vision) + three.ws | Verifies evidence: photo via vision, web claims via Fact Check API |
| **Adjudicator** | Venice (Llama 70B — *different family*) | Cross-model dispute resolution — binding ruling |

**Cross-model design:** Auditor and Adjudicator use *different Venice model families*. This prevents single-model bias — if Qwen says PASS, Llama independently verifies before enforcing.

---

## 🔴 Live Deployment

| Component | Status | Detail |
|-----------|--------|--------|
| **Vouch.sol** | ✅ Live | `0x5d763316Df16Ee9083168D323519A354856Be0f1` on Monad Testnet (10143) |
| **Adjudicator** | ✅ Set | `0xc208F4e8e6Bfa82400C7AD8450728858133CEeCe` |
| **Tests** | ✅ 28/28 | Forge test suite (create, evidence, challenge, settle, reentrancy) |
| **Agent Runtime** | 📦 Ready | Dockerfile + Akash SDL — deploy from host (see below) |
| **Frontend** | 📦 Ready | React + Para wallet — deploy to Vercel/Cloudflare post-Akash |

---

## 🚀 Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`)
- Node.js 18+ (for frontend)
- Python 3.11+ (for agents)
- API keys: [Venice](https://venice.ai), [three.ws](https://three.ws)

### 1. Clone

```bash
git clone https://github.com/ToXMon/vouch.git
cd vouch
cp .env.example .env  # Fill in your keys
```

### 2. Smart Contract (already deployed — skip if just running demo)

```bash
cd contracts
forge install  # if not already
forge build
forge test  # 28 tests

# Deploy your own instance:
forge script script/DeployVouch.s.sol:DeployVouch \
    --rpc-url https://testnet-rpc.monad.xyz \
    --broadcast \
    --private-key $MONAD_DEPLOYER_PRIVATE_KEY
```

### 3. Agent Runtime

```bash
cd agents
pip install -r runtime/requirements.txt

export VENICE_API_KEY="..."
export THREE_WS_API_KEY="..."

uvicorn runtime.main:app --host 0.0.0.0 --port 8000
```

Health check: `curl http://localhost:8000/api/health`

### 4. Frontend

```bash
cd frontend
npm install
cp .env.example .env.local  # Fill VITE_VOUCH_CONTRACT_ADDRESS
npm run dev
```

Open http://localhost:5173 — connect Para wallet, create a commitment.

---

## 🌐 Deploy to Akash (Decentralized Cloud)

The agent runtime deploys to Akash Network. The deploy scripts are ready — run from a host with `akash` CLI + Docker installed:

### Step 1: Build & Push Docker Image

```bash
export GITHUB_USER=ToXMon
export CR_PAT=ghp_your_pat_with_write_packages
./deploy/akash/build-and-push.sh sha-$(git rev-parse --short HEAD)

# Make the package PUBLIC (Akash providers can't pull private images):
# https://github.com/ToXMon?tab=packages → Package settings → PUBLIC
```

### Step 2: Deploy to Akash

```bash
export AKASH_KEY_NAME=wallet  # from your existing akash keyring
export GHCR_USER=ToXMon
export IMAGE_TAG=sha-$(git rev-parse --short HEAD)
export VENICE_API_KEY=...
export THREE_WS_API_KEY=...

./deploy/akash/deploy-akash.sh
```

The script will: validate wallet → render SDL with secrets → create deployment → accept bid → send manifest → probe `/api/health`. Lease details saved to `deploy/akash/.lease-<DSEQ>.txt`.

> **Note:** Requires AKT for gas + ACT for escrow. If no ACT: `akash tx bme mint-act 5000000uakt --from wallet`.

---

## 🧪 Demo Flow (6 Phases)

| Time | Phase | What Happens |
|------|-------|--------------|
| 0:00 | **HOOK** | Two AI agents introduced |
| 0:30 | **BET** | Architect generates CommitmentSpec from natural language |
| 1:15 | **STAKE** | Spec hash locked onchain via `Vouch.createCommitment()` |
| 2:00 | **EVIDENCE** | Auditor + three.ws verify with SHA-256 attestation |
| 2:30 | **CHALLENGE** | Cross-model Adjudicator issues binding ruling |
| 3:00 | **CLOSE** | Settlement enforced by smart contract |

---

## 🛡️ Security & Audit Due Diligence

**Fund safety is a first-class concern.** Vouch locks real ETH stakes on binding commitments —
the contract was hardened through a rigorous **two-phase audit process** before mainnet consideration.

### Audit Results

| Phase | Auditor | Findings | Status |
|-------|---------|----------|--------|
| **1. One Dollar Audit** (#417) | 3-phase AI: context map → breadth (5 domains) → pashov depth (12 agents) | 7 (2 High, 2 Med, 3 Low) | ✅ All remediated |
| **2. Pashov Second-Pass** | 12-agent parallel swarm on PATCHED code (Feynman + Socratic + Inversion) | 5 (2 Med, 3 Low) + 7 leads | ✅ All remediated |

**Total: 12 findings, 15 remediations applied, 0 outstanding.** Full reports in [`docs/audit/`](docs/audit/).

### Verification

| Check | Result |
|-------|--------|
| Unit tests | ✅ 58/58 passing |
| Invariant fuzz (256 runs × 128k calls) | ✅ 2/2 passing |
| Line coverage | ✅ 100% |
| Slither static analysis | ✅ 0 High/Medium |
| Sourcify verification | ✅ exact_match |

### Fund Safety Architecture

- **Pull-payment pattern** — stakes are never pushed; winners call `withdraw()` (prevents lockup, gas-bombs)
- **Challenge bond (≥10%)** — counterparties must post bond to prevent free griefing
- **Liveness fallback** — 7-day timeout + stake split guarantees no permanent fund lockup
- **Adjudicator authority expiry** — prevents front-running the liveness fallback
- **ReentrancyGuard** on all state-changing functions
- **CEI pattern** in all settlement paths
- **Immutable evidence** — hash cannot be overwritten once submitted

📖 **Full security documentation:** [`SECURITY.md`](SECURITY.md)

### Mainnet Readiness

The contract is production-ready. Pre-deploy checklist:
1. Generate dedicated adjudicator key (HSM/multisig recommended)
2. Final source review against audit diffs
3. Deploy via `deploy/monad/deploy.sh` with `ADJUDICATOR=0x<dedicated-key>`
4. Verify on block explorer
5. Monitor `ForceSettled` events (adjudicator health signal)

```bash
# Mainnet deployment
MONAD_RPC_URL=<mainnet-rpc> \
DEPLOYER_PRIVATE_KEY=0x<deployer> \
ADJUDICATOR=0x<dedicated-adjudicator-key> \
bash deploy/monad/deploy.sh
```

**Estimated deployment cost:** ~0.155 ETH (~$497 at 102 gwei, ~$253 at 52 gwei)

- **Secrets via env vars only** — zero hardcoded keys, verified by secret scan

---

## 🧱 Stack

| Layer | Tech |
|-------|------|
| Smart Contract | Solidity 0.8.20 / Foundry on Monad Testnet |
| AI Agents | Venice API (Architect: Qwen, Auditor: vision, Adjudicator: Llama 70B) |
| Verification | three.ws Fact Check API (SHA-256 attestations) |
| Agent Runtime | Python 3.11 / FastAPI / Akash Network |
| Frontend | React 18 / Vite / Para Wallet / viem / wagmi |

---

## 📁 Repository Structure

```
vouch/
├── contracts/           # Vouch.sol + Foundry tests (28/28 pass)
│   ├── src/Vouch.sol
│   ├── test/Vouch.t.sol
│   └── script/DeployVouch.s.sol
├── agents/
│   ├── architect/       # AI Architect (Venice) — spec generation
│   ├── auditor/         # AI Auditor (Venice vision + three.ws)
│   ├── adjudicator/     # Cross-model Adjudicator (Venice Llama)
│   ├── runtime/         # FastAPI orchestrator + Dockerfile
│   └── demo/            # AI-vs-AI 6-phase demo
├── frontend/            # React + Para wallet + Monad integration
├── deploy/
│   ├── akash/           # SDL + build-and-push.sh + deploy-akash.sh
│   └── monad/           # Contract deploy script
└── docs/
```

---

## 📜 License

MIT
