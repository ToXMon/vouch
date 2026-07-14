"""Vouch Adjudicator \u2014 cross-model binding dispute resolution.

Uses a DIFFERENT Venice model than the Auditor to prevent single-model bias.
Considers the auditor's verdict AND the challenger's argument independently
before rendering a binding ruling.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from typing import Any

# -- Shared Venice client import -------------------------------------------------
# The adjudicator reuses the runtime's Venice client for API calls, retry
# logic, and key management. The path is resolved relative to this file
# so it works regardless of the caller's working directory.
_RUNTIME_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "runtime")
)
if _RUNTIME_PATH not in sys.path:
    sys.path.insert(0, _RUNTIME_PATH)

from venice_client import VeniceError, chat_completion  # noqa: E402

from .models import AdjudicationResult, Ruling  # noqa: E402
from .prompts import (  # noqa: E402
    ADJUDICATION_SYSTEM_PROMPT,
    build_adjudication_user_prompt,
)

logger = logging.getLogger(__name__)

# Default model MUST differ from the Auditor's model family to enforce
# cross-model adjudication. The Auditor uses a Qwen-family vision model
# (qwen3-vl-235b-a22b), so the Adjudicator defaults to a Llama-family
# text model to maximize architectural diversity. Override via env.
# See README.md "Cross-Model Design" section.
DEFAULT_MODEL = "llama-3.3-70b"


def _get_model() -> str:
    """Return the configured Venice model for adjudication.

    Reads from the ADJUDICATOR_MODEL env var, falling back to the default
    (``llama-3.3-70b``) which is intentionally a different model family
    than the Auditor's Qwen-family vision model.
    """
    return os.environ.get("ADJUDICATOR_MODEL", DEFAULT_MODEL)


def _extract_json(raw: str) -> dict[str, Any]:
    """Extract a JSON object from a raw LLM response.

    Handles responses wrapped in markdown code fences or surrounded by
    extra text.
    """
    # Strip markdown code fences if present.
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned).strip()

    # Try direct parse first.
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Fallback: find the first {...} block.
    match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    raise VeniceError(
        f"Could not parse JSON from adjudicator response: {raw[:500]}"
    )


def _parse_ruling(ruling_str: str) -> Ruling:
    """Parse the ruling value from the LLM response with fuzzy fallback."""
    normalized = ruling_str.lower().strip()
    try:
        return Ruling(normalized)
    except ValueError:
        pass

    # Fuzzy match for non-standard responses.
    if "creator" in normalized:
        return Ruling.CREATOR_WINS
    if "challenger" in normalized:
        return Ruling.CHALLENGER_WINS
    if "insufficient" in normalized:
        return Ruling.INSUFFICIENT_EVIDENCE

    raise VeniceError(f"Unrecognized ruling value: {ruling_str!r}")


async def adjudicate(
    commitment_spec: dict[str, Any],
    evidence: dict[str, Any],
    auditor_verdict: dict[str, Any],
    challenge_argument: str,
) -> AdjudicationResult:
    """Render a binding adjudication on a disputed commitment.

    Uses a different Venice model than the Auditor to prevent single-model
    bias. Considers the auditor's verdict AND the challenger's argument
    independently before rendering a ruling.

    Args:
        commitment_spec: The original commitment specification
            (see ``architect/models.py`` for the ``CommitmentSpec`` shape).
        evidence: The evidence submitted by the claim creator.
        auditor_verdict: The Auditor's verdict on the evidence.
        challenge_argument: The challenger's argument against the
            auditor's verdict.

    Returns:
        ``AdjudicationResult`` with a binding ruling, confidence,
        reasoning, and model info.

    Raises:
        VeniceError: If the Venice API call fails after all retries or
            the response is unparseable.
    """
    model = _get_model()

    user_prompt = build_adjudication_user_prompt(
        commitment_spec=commitment_spec,
        evidence=evidence,
        auditor_verdict=auditor_verdict,
        challenge_argument=challenge_argument,
    )

    messages = [
        {"role": "system", "content": ADJUDICATION_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt},
    ]

    logger.info("Adjudicating dispute with model=%s", model)

    raw_response = await chat_completion(
        model=model,
        messages=messages,
        temperature=0.3,  # Low temperature for consistent, reasoned rulings
    )

    parsed = _extract_json(raw_response)

    ruling = _parse_ruling(parsed.get("ruling", ""))

    # Clamp confidence to [0.0, 1.0].
    confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0.5))))

    reasoning = parsed.get("reasoning", "")
    if not reasoning:
        reasoning = "No reasoning provided by adjudicator model."

    result = AdjudicationResult(
        ruling=ruling,
        confidence=confidence,
        reasoning=reasoning,
        model_used=model,
    )

    logger.info(
        "Adjudication complete: ruling=%s confidence=%.2f model=%s",
        result.ruling.value,
        result.confidence,
        result.model_used,
    )

    return result
