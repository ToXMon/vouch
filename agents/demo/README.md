# Vouch AI-vs-AI Demo

The 3-minute hackathon demo where two Venice-powered agents autonomously make a verifiable promise to each other on Monad.

## Quick Start

```bash
cd vouch
python -m agents.demo
```

The demo **always runs** — even without API keys. See **Dry-Run Mode** below.

## Demo Flow (6 Phases)

| Time | Phase | What Happens |
|------|-------|-------------|
| 0:00 | **Hook** | Introduction narration + agent banners |
| 0:30 | **Bet** | Agent A's claim text → AI Architect generates `CommitmentSpec` + keccak256 hash |
| 1:15 | **Stake** | Simulated onchain lock via `Vouch.sol` (transaction spec printed, not broadcast) |
| 2:00 | **Evidence** | Agent A submits PR URL → three.ws fact-check with cryptographic attestation |
| 2:30 | **Challenge** | Agent B disputes → Cross-model Adjudicator issues binding ruling |
| 3:00 | **Close** | Final narration: "No humans. No referees. Agents keeping their word on Monad." |

## Modes

### Dry-Run Mode (default)

Runs automatically when `VENICE_API_KEY` or `THREE_WS_API_KEY` is not set.

- All AI responses are **mocked** with realistic data.
- The demo flow, phase structure, and output format are **identical** to live mode.
- No API calls are made — zero cost, zero network.
- This ensures the demo is **always presentable** for recordings and live presentations.

### Live Mode

Activate by setting both environment variables:

```bash
export VENICE_API_KEY="your-venice-key"
export THREE_WS_API_KEY="your-threews-key"
python -m agents.demo
```

- **Phase 2 (Bet)**: Real call to the AI Architect (Venice `llama-3.3-70b`).
- **Phase 4 (Evidence)**: Real call to three.ws fact-check API.
- **Phase 5 (Challenge)**: Real call to the Cross-Model Adjudicator (Venice `llama-3.3-70b`).
- All other phases (Hook, Stake, Close) are narration-only in both modes.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VENICE_API_KEY` | Live mode | Venice AI API key for Architect + Adjudicator |
| `THREE_WS_API_KEY` | Live mode | three.ws API key for fact-checking |
| `VOUCH_CONTRACT_ADDRESS` | Optional | Monad contract address; if set, shows in stake phase |
| `DEMO_PAUSE` | Optional | Seconds between phases (default: `2.0`; set `0` for CI) |

## Architecture

```
Agent A (0xA11CE…F00D)
  │
  ├─ Claim: "I bet 5 MON that PR #42 merges by 2026-07-19"
  │
  ▼
AI Architect (Venice llama-3.3-70b)
  │  Parses claim → selects verification_type=web → CommitmentSpec
  ▼
Vouch.sol (simulated stake)
  │  Locks 5 MON × 2 parties on Monad (~$0.001 gas)
  ▼
three.ws Fact Check
  │  Verifies PR URL live → verdict + cryptographic attestation
  ▼
Agent B (0xB0B0…BEEF)
  │  Challenges: "PR merged to fork, not main"
  ▼
Cross-Model Adjudicator (Venice llama-3.3-70b)
     Different model family than Auditor → binding ruling
```

### Verification Routing

The demo showcases Vouch's evidence routing architecture:

- **`web` type** → three.ws fact-check (live URL verification + attestation)
- **`photo` type** → AI Auditor vision lane (Venice `qwen3-vl-235b-a22b`)
- **`peer_sign` type** → AI Auditor EIP-191 signature recovery

The demo claim uses `verification_type=web`, so evidence routes to three.ws.

## Dependencies

```bash
pip install -r agents/demo/requirements.txt
```

- `httpx` — async HTTP for Venice + three.ws
- `pydantic` — data models (CommitmentSpec, AuditResult, AdjudicationResult)
- `aiohttp` — async HTTP utilities

## Recording the Demo

For a clean terminal recording:

```bash
# Disable pauses for smooth playback
DEMO_PAUSE=0 python -m agents.demo

# Or with live keys
DEMO_PAUSE=1 VENICE_API_KEY=... THREE_WS_API_KEY=... python -m agents.demo
```

## Files

| File | Purpose |
|------|---------|
| `__init__.py` | Package marker |
| `__main__.py` | Entry point (`python -m agents.demo`) |
| `ai_vs_ai.py` | Main orchestrator — 6-phase demo flow |
| `narration.py` | Narration text constants for each phase |
| `requirements.txt` | Python dependencies |
