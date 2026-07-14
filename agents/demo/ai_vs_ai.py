"""Vouch AI-vs-AI Demo — main orchestrator.

Runs the full 3-minute demo flow where two Venice-powered agents
autonomously make a verifiable promise to each other on Monad.

Modes:
    LIVE    — VENICE_API_KEY and THREE_WS_API_KEY are set; real API calls.
    DRY_RUN — keys missing; all AI responses are mocked. Flow is identical.

Usage:
    python -m agents.demo
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from typing import Any

from .narration import (
    AGENT_A_BANNER,
    AGENT_B_BANNER,
    CHALLENGE_ARGUMENT,
    CLAIM_TEXT,
    DRY_RUN_BANNER,
    LIVE_BANNER,
    PHASE_1_HOOK,
    PHASE_2_BET,
    PHASE_3_STAKE,
    PHASE_4_EVIDENCE,
    PHASE_5_CHALLENGE,
    PHASE_6_CLOSE,
    PR_URL,
    TS_BET,
    TS_CHALLENGE,
    TS_CLOSE,
    TS_EVIDENCE,
    TS_HOOK,
    TS_STAKE,
)

# ── Constants ────────────────────────────────────────────────────────

AGENT_A_ADDRESS = "0xA11CE0000000000000000000000000000000F00D"
AGENT_B_ADDRESS = "0xB0B0000000000000000000000000000000000BEEF"
STAKE_AMOUNT_MON = "5"

# Pause between phases for narrative pacing (seconds).
# Set DEMO_PAUSE=0 to disable for CI / automated recording.
PHASE_PAUSE = float(os.environ.get("DEMO_PAUSE", "2.0"))

# Demo contract address placeholder — the real demo would set
# VOUCH_CONTRACT_ADDRESS in the environment.
DEFAULT_CONTRACT = "(not configured — set VOUCH_CONTRACT_ADDRESS)"


# ── Dry-run detection ────────────────────────────────────────────────


def _is_dry_run() -> bool:
    """Return True if any required API key is missing."""
    return not (
        os.environ.get("VENICE_API_KEY") and os.environ.get("THREE_WS_API_KEY")
    )


# ── Mock data (used in DRY_RUN mode) ─────────────────────────────────


def _mock_spec_dict() -> dict[str, Any]:
    """Return a CommitmentSpec-shaped dict matching what the Architect would produce."""
    return {
        "claim_text": CLAIM_TEXT,
        "verification_type": "web",
        "parties": {
            "creator": AGENT_A_ADDRESS,
            "counterparty": AGENT_B_ADDRESS,
        },
        "deadline_iso": "2026-07-19T23:59:59Z",
        "stake_amount_mon": STAKE_AMOUNT_MON,
        "spec_version": "1.0.0",
    }


def _mock_threews_result() -> dict[str, Any]:
    return {
        "verdict": "supported",
        "confidence": 0.87,
        "sources": [
            "https://github.com/vouch/contracts/pull/42",
            "https://api.github.com/repos/vouch/contracts/pulls/42",
        ],
        "attestation": "sha256:" + "a" * 64,
    }


def _mock_adjudication_result() -> dict[str, Any]:
    return {
        "ruling": "challenger_wins",
        "confidence": 0.78,
        "reasoning": (
            "Cross-referencing the PR's merge_commit_sha against the repository's "
            "default branch HEAD reveals a divergence. The PR was merged into a "
            "fork, not the canonical repository. Agent A's evidence, while "
            "technically showing a 'merged' state, does not satisfy the claim's "
            "requirement of merging to github.com/vouch/contracts. The challenger's "
            "argument is substantiated."
        ),
        "model_used": "llama-3.3-70b (mocked)",
    }


# ── Phase helpers ────────────────────────────────────────────────────


def _header(ts: str, title: str) -> None:
    width = 60
    print()
    print("═" * width)
    print(f"  {ts}  {title}")
    print("═" * width)


def _kv(key: str, value: Any, indent: int = 2) -> None:
    print(f"{' ' * indent}{key:<22} {value}")


async def _async_pause() -> None:
    if PHASE_PAUSE > 0:
        await asyncio.sleep(PHASE_PAUSE)


# ── Phase 1: Hook ────────────────────────────────────────────────────


async def phase_1_hook() -> None:
    _header(TS_HOOK, "HOOK")
    print()
    print(PHASE_1_HOOK)
    print()
    print(AGENT_A_BANNER)
    print(AGENT_B_BANNER)
    await _async_pause()


# ── Phase 2: Bet → Architect ─────────────────────────────────────────


async def phase_2_bet(dry_run: bool) -> dict[str, Any]:
    _header(TS_BET, "BET — AI Architect generates CommitmentSpec")
    print()
    print(PHASE_2_BET)
    print()
    print("─" * 60)
    print("Agent A's claim:")
    print(f'  "{CLAIM_TEXT}"')
    print("─" * 60)
    print()

    if dry_run:
        print("▶ [DRY RUN] Architect: mocked CommitmentSpec")
        spec_dict = _mock_spec_dict()
    else:
        from ..architect.architect import generate_spec  # type: ignore

        spec_obj = await generate_spec(
            claim_text=CLAIM_TEXT,
            creator_address=AGENT_A_ADDRESS,
            counterparty_address=AGENT_B_ADDRESS,
        )
        spec_dict = spec_obj.to_deterministic_dict()
        print("▶ [LIVE] Architect returned CommitmentSpec")

    # Compute the keccak256-ready deterministic hash.
    det_json = json.dumps(spec_dict, sort_keys=True, separators=(",", ":"))
    spec_hash = hashlib.sha3_256(det_json.encode()).hexdigest()

    print()
    print("CommitmentSpec:")
    _kv("claim_text", spec_dict["claim_text"][:70] + "...")
    _kv("verification_type", spec_dict["verification_type"])
    _kv("creator", spec_dict["parties"]["creator"])
    _kv("counterparty", spec_dict["parties"]["counterparty"])
    _kv("deadline_iso", spec_dict["deadline_iso"])
    _kv("stake_amount_mon", f'{spec_dict["stake_amount_mon"]} MON')
    _kv("spec_version", spec_dict["spec_version"])
    print()
    _kv("spec_hash (keccak256)", f"0x{spec_hash}")
    print()
    await _async_pause()
    return spec_dict


# ── Phase 3: Stake — simulated onchain lock ──────────────────────────


async def phase_3_stake(spec_dict: dict[str, Any]) -> None:
    _header(TS_STAKE, "STAKE — Onchain Lock via Vouch.sol")
    print()
    print(PHASE_3_STAKE)
    print()

    contract_addr = os.environ.get("VOUCH_CONTRACT_ADDRESS", DEFAULT_CONTRACT)

    # Build the transaction spec (NOT sent — printed for the demo).
    tx_spec = {
        "to": contract_addr,
        "function": "createCommitment(bytes32 specHash)",
        "spec_hash": f"0x{hashlib.sha3_256(json.dumps(spec_dict, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}",
        "stake": f'{spec_dict["stake_amount_mon"]} MON',
        "from": spec_dict["parties"]["creator"],
        "gas_estimate": "~50,000 units",
        "gas_cost_usd": "~$0.001",
        "chain": "monad",
    }

    print("Transaction Spec (simulated — not broadcast):")
    print(json.dumps(tx_spec, indent=2, default=str))
    print()
    if contract_addr == DEFAULT_CONTRACT:
        print("⚠  VOUCH_CONTRACT_ADDRESS not set — printing tx spec only.")
        print("   In production, this would call Vouch.sol.createCommitment().")
    else:
        print(f"✓  Would broadcast to Vouch.sol at {contract_addr}")
    print()
    await _async_pause()


# ── Phase 4: Evidence → three.ws fact-check ──────────────────────────


async def phase_4_evidence(
    dry_run: bool, spec_dict: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    _header(TS_EVIDENCE, "EVIDENCE — AI Auditor + three.ws Verification")
    print()
    print(PHASE_4_EVIDENCE)
    print()
    print("─" * 60)
    print(f"Agent A submits: {PR_URL}")
    print("─" * 60)
    print()

    vtype = spec_dict.get("verification_type", "web")

    # ── Show the routing decision ──
    print(f"Verification type: {vtype}")
    if vtype == "web":
        print("→ Web evidence routes to three.ws for live fact-checking.")
        print("  (AI Auditor handles photo/peer_sign lanes only.)")
    else:
        print(f"→ Would route to AI Auditor for {vtype} lane.")
    print()

    # ── three.ws fact-check ──
    claim_for_fc = (
        f'PR #42 at {PR_URL} was successfully merged into '
        f'the main branch of github.com/vouch/contracts'
    )

    if dry_run:
        print("▶ [DRY RUN] three.ws fact_check: mocked response")
        threews_result = _mock_threews_result()
    else:
        from ..runtime.threews_client import fact_check  # type: ignore

        threews_result = await fact_check(claim_for_fc, strictness="medium")
        print("▶ [LIVE] three.ws fact_check: real response")

    print()
    print("three.ws Verdict:")
    _kv("verdict", threews_result["verdict"])
    _kv("confidence", f'{threews_result["confidence"]:.2f}')
    _kv("sources", len(threews_result.get("sources", [])))
    for src in threews_result.get("sources", []):
        print(f"      • {src}")
    attestation = threews_result.get("attestation", "")
    if attestation:
        _kv("attestation", attestation[:40] + "...")
    else:
        _kv("attestation", "(none)")
    print()

    # Build an auditor-shaped verdict dict for the adjudicator.
    auditor_verdict = {
        "verdict": threews_result["verdict"],
        "confidence": threews_result["confidence"],
        "reasoning": f"three.ws fact-check returned '{threews_result['verdict']}'",
        "evidence_type": "web",
        "source": "three.ws",
    }

    evidence_payload = {
        "type": "web",
        "url": PR_URL,
        "threews_verdict": threews_result["verdict"],
        "threews_attestation": threews_result.get("attestation", ""),
    }

    await _async_pause()
    return evidence_payload, auditor_verdict


# ── Phase 5: Challenge → Adjudicator ─────────────────────────────────


async def phase_5_challenge(
    dry_run: bool,
    spec_dict: dict[str, Any],
    evidence: dict[str, Any],
    auditor_verdict: dict[str, Any],
) -> dict[str, Any]:
    _header(TS_CHALLENGE, "CHALLENGE — Cross-Model Adjudicator")
    print()
    print(PHASE_5_CHALLENGE)
    print()
    print("─" * 60)
    print("Agent B's challenge:")
    print(f'  "{CHALLENGE_ARGUMENT}"')
    print("─" * 60)
    print()

    if dry_run:
        print("▶ [DRY RUN] Adjudicator: mocked ruling")
        result = _mock_adjudication_result()
    else:
        from ..adjudicator.adjudicator import adjudicate  # type: ignore

        adj_result = await adjudicate(
            commitment_spec=spec_dict,
            evidence=evidence,
            auditor_verdict=auditor_verdict,
            challenge_argument=CHALLENGE_ARGUMENT,
        )
        result = {
            "ruling": adj_result.ruling.value,
            "confidence": adj_result.confidence,
            "reasoning": adj_result.reasoning,
            "model_used": adj_result.model_used,
        }
        print("▶ [LIVE] Adjudicator returned ruling")

    print()
    print("Adjudicator Ruling:")
    _kv("ruling", result["ruling"])
    _kv("confidence", f'{result["confidence"]:.2f}')
    _kv("model_used", result["model_used"])
    print()
    print("Reasoning:")
    # Wrap reasoning at 72 chars for terminal readability.
    reasoning = result["reasoning"]
    import textwrap

    for line in textwrap.wrap(reasoning, width=70):
        print(f"  {line}")
    print()

    if result["ruling"] == "challenger_wins":
        print("→ Stake FORFEITED to Agent B (challenger).")
        print("  The smart contract auto-releases 5 MON to Agent B.")
    elif result["ruling"] == "creator_wins":
        print("→ Stake RETURNED to Agent A (creator).")
        print("  The claim is verified. Agent B's challenge fails.")
    else:
        print("→ INSUFFICIENT EVIDENCE — stake remains locked.")
        print("  A manual review or extended deadline may apply.")
    print()
    await _async_pause()
    return result


# ── Phase 6: Close ───────────────────────────────────────────────────


async def phase_6_close() -> None:
    _header(TS_CLOSE, "CLOSE")
    print()
    print(PHASE_6_CLOSE)
    print()
    print("═" * 60)
    print("  Vouch — AI-vs-AI verifiable commitments on Monad")
    print("═" * 60)
    print()


# ── Main orchestrator ────────────────────────────────────────────────


async def run_demo() -> None:
    """Run the full 3-minute AI-vs-AI demo.

    Detects API keys from the environment. If VENICE_API_KEY or
    THREE_WS_API_KEY are missing, runs in DRY_RUN mode with mocked
    responses. The flow and output structure are identical either way.
    """
    dry_run = _is_dry_run()

    # ── Banner ──
    print()
    print("╗" + "═" * 58 + "╗")
    print("║" + "  VOUCH — AI vs AI DEMO".center(58) + "║")
    print("║" + "  Verifiable Agent Promises on Monad".center(58) + "║")
    print("╚" + "═" * 58 + "╝")
    print()
    if dry_run:
        print(DRY_RUN_BANNER)
    else:
        print(LIVE_BANNER)

    # ── Phases ──
    await phase_1_hook()
    spec_dict = await phase_2_bet(dry_run)
    await phase_3_stake(spec_dict)
    evidence, auditor_verdict = await phase_4_evidence(dry_run, spec_dict)
    await phase_5_challenge(dry_run, spec_dict, evidence, auditor_verdict)
    await phase_6_close()
