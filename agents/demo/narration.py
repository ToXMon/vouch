"""Narration constants for the Vouch AI-vs-AI demo.

Each constant is the printed narration for a demo phase, timed to
the 3-minute hackathon demo script. Timestamps correspond to the
locked brief's demo recording markers.
"""

# ── Phase Timestamps (from locked demo script) ──────────────────────

TS_HOOK      = "[0:00]"
TS_BET       = "[0:30]"
TS_STAKE     = "[1:15]"
TS_EVIDENCE  = "[2:00]"
TS_CHALLENGE = "[2:30]"
TS_CLOSE     = "[3:00]"

# ── Narration Text ───────────────────────────────────────────────────

PHASE_1_HOOK = """\
What if AI agents could make promises — and the blockchain enforced them?

No humans. No lawyers. No referees.
Just two AI agents, a smart contract, and their word.

This is Vouch: AI-vs-AI verifiable commitments on Monad."""

PHASE_2_BET = """\
Agent A proposes a bet to Agent B.

The AI Architect (Venice-powered) parses the natural-language
claim, selects a verification gate, and produces a deterministic
CommitmentSpec ready for onchain locking."""

PHASE_3_STAKE = """\
The CommitmentSpec is hashed and locked onchain via Vouch.sol.

Both agents stake 5 MON. The gas cost? About $0.001.
This is Monad: sub-cent transactions, sub-second finality."""

PHASE_4_EVIDENCE = """\
Agent A submits evidence: a GitHub PR URL.

The AI Auditor checks — web evidence routes to three.ws for
live fact-checking with a cryptographic attestation.
No human review. Just AI verifying AI."""

PHASE_5_CHALLENGE = """\
Agent B disputes the verdict.

A cross-model Adjudicator — a DIFFERENT Venice model than the
Auditor — reviews the evidence and the challenge independently.
Its ruling is binding. The smart contract enforces it."""

PHASE_6_CLOSE = """\
No humans. No referees. Agents keeping their word on Monad.

This is Vouch — where AI promises are enforced by code."""

# ── Agent Introductions ─────────────────────────────────────────────

AGENT_A_BANNER = """
┌─────────────────────────────────────────────────────┐
│  AGENT A  │  Venice AI  │  0xA11CE…F00D  │  Creator │
└─────────────────────────────────────────────────────┘"""

AGENT_B_BANNER = """
┌─────────────────────────────────────────────────────┐
│  AGENT B  │  Venice AI  │  0xB0B0…BEEF  │  Challenger │
└─────────────────────────────────────────────────────┘"""

# ── Demo Claim & Evidence (used by both live and dry-run modes) ─────

CLAIM_TEXT = (
    "I bet Agent B 5 MON that I will successfully merge "
    "PR #42 (Add reentrancy guard) to "
    "github.com/vouch/contracts by 2026-07-19T23:59:59Z."
)

PR_URL = "https://github.com/vouch/contracts/pull/42"

CHALLENGE_ARGUMENT = (
    "The PR shows 'merged' but the commit history reveals it was "
    "squash-merged into a fork branch, not the main repository. "
    "The base SHA differs from main HEAD. This constitutes "
    "evidence manipulation — the merge did not land on main."
)

# ── Dry-Run Banner ──────────────────────────────────────────────────

DRY_RUN_BANNER = """\
┋ DRY RUN MODE ┋ No API keys detected — using mocked AI responses.
┋               The demo flow is identical; only the AI outputs are simulated.
┋               Set VENICE_API_KEY and THREE_WS_API_KEY for live mode."""

LIVE_BANNER = """\
✦ LIVE MODE ✦ API keys detected — real Venice + three.ws calls."""
