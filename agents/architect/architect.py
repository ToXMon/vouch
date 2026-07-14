"""Vouch AI Promise Architect — core implementation.

Takes a natural-language claim, forces verification-type selection,
and returns a deterministic CommitmentSpec ready for keccak256 hashing
and onchain locking in Vouch.sol.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from .models import CommitmentSpec, Parties, VerificationType
from .prompts import SYSTEM_PROMPT, VERIFICATION_TYPES, build_user_prompt

logger = logging.getLogger("vouch.architect")

# ---------------------------------------------------------------------------
# Configuration (all from environment — never hardcoded).
# ---------------------------------------------------------------------------

VENICE_BASE_URL = os.environ.get(
    "VENICE_BASE_URL", "https://api.venice.ai/api/v1/chat/completions"
)
VENICE_MODEL = os.environ.get("VENICE_MODEL", "llama-3.3-70b")
VENICE_TIMEOUT = float(os.environ.get("VENICE_TIMEOUT", "30"))
VENICE_MAX_RETRIES = int(os.environ.get("VENICE_MAX_RETRIES", "3"))
VENICE_RETRY_BACKOFF = float(os.environ.get("VENICE_RETRY_BACKOFF", "1.5"))


class ArchitectError(Exception):
    """Base error for all Architect failures."""


class MissingApiKeyError(ArchitectError):
    """VENICE_API_KEY is not set in the environment."""


class RateLimitError(ArchitectError):
    """Venice API returned 429 and retries are exhausted."""


class VeniceTimeoutError(ArchitectError):
    """Venice API request timed out."""


class MalformedResponseError(ArchitectError):
    """Venice API returned an unparseable response."""


class InvalidVerificationTypeError(ArchitectError):
    """LLM returned a verification_type outside the allowed set."""


# ---------------------------------------------------------------------------
# Core function
# ---------------------------------------------------------------------------


async def generate_spec(
    claim_text: str,
    creator_address: str,
    counterparty_address: str,
) -> CommitmentSpec:
    """Transform a natural-language claim into a structured CommitmentSpec.

    Parameters
    ----------
    claim_text
        The user's natural-language claim or bet.
    creator_address
        Checksum address of the party making the claim.
    counterparty_address
        Checksum address of the counterparty.

    Returns
    -------
    CommitmentSpec
        A validated, deterministic-serializable specification. The
        caller can call ``spec.to_deterministic_json()`` and keccak256
        the result for onchain locking.

    Raises
    ------
    MissingApiKeyError
        VENICE_API_KEY not in os.environ.
    RateLimitError
        Venice API rate-limited (429) after all retries.
    VeniceTimeoutError
        Request exceeded the configured timeout.
    MalformedResponseError
        Response could not be parsed into the expected JSON shape.
    InvalidVerificationTypeError
        LLM returned an invalid verification_type.
    """

    # --- 1. Resolve API key from environment ONLY --------------------------
    api_key = os.environ.get("VENICE_API_KEY")
    if not api_key:
        raise MissingApiKeyError(
            "VENICE_API_KEY not found in environment. Set it before calling generate_spec."
        )

    # --- 2. Build request --------------------------------------------------
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": build_user_prompt(
                claim_text, creator_address, counterparty_address
            ),
        },
    ]

    payload: dict[str, Any] = {
        "model": VENICE_MODEL,
        "messages": messages,
        "temperature": 0.1,  # Low temperature for deterministic-ish output
        "max_tokens": 800,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # --- 3. Call Venice with retry on 429 ----------------------------------
    raw_content = await _call_venice(payload, headers)

    # --- 4. Parse JSON from LLM response -----------------------------------
    spec_data = _extract_json(raw_content)

    # --- 5. Validate verification gate -------------------------------------
    vtype = spec_data.get("verification_type", "")
    if vtype not in VERIFICATION_TYPES:
        raise InvalidVerificationTypeError(
            f"LLM returned verification_type={vtype!r}; "
            f"must be one of {list(VERIFICATION_TYPES.keys())}"
        )

    # Log reasoning (not part of the onchain spec).
    reasoning = spec_data.get("reasoning", "")
    if reasoning:
        logger.info(
            "Architect selected verification_type=%s for claim. Reasoning: %s",
            vtype,
            reasoning,
        )

    # --- 6. Build CommitmentSpec (parties injected, not from LLM) ----------
    spec = CommitmentSpec(
        claim_text=spec_data["claim_text"],
        verification_type=VerificationType(vtype),
        parties=Parties(
            creator=creator_address,
            counterparty=counterparty_address,
        ),
        deadline_iso=spec_data["deadline_iso"],
        stake_amount_mon=spec_data["stake_amount_mon"],
        spec_version=spec_data.get("spec_version", "1.0.0"),
    )

    logger.info(
        "CommitmentSpec generated: type=%s deadline=%s stake=%s MON",
        spec.verification_type.value,
        spec.deadline_iso,
        spec.stake_amount_mon,
    )
    return spec


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _call_venice(
    payload: dict[str, Any], headers: dict[str, str]
) -> str:
    """Send the chat completion request to Venice with retry logic.

    Retries on 429 with exponential backoff. Raises typed errors on
    timeout and unexpected HTTP failures.
    """
    import asyncio

    last_error: Exception | None = None

    for attempt in range(1, VENICE_MAX_RETRIES + 1):
        try:
            async with httpx.AsyncClient(timeout=VENICE_TIMEOUT) as client:
                resp = await client.post(
                    VENICE_BASE_URL, json=payload, headers=headers
                )

            # --- 429: Rate limited — back off and retry --------------------
            if resp.status_code == 429:
                wait = VENICE_RETRY_BACKOFF ** attempt
                logger.warning(
                    "Venice 429 rate limit (attempt %d/%d). Retrying in %.1fs...",
                    attempt,
                    VENICE_MAX_RETRIES,
                    wait,
                )
                last_error = RateLimitError(
                    f"Venice API rate-limited after {attempt} attempts"
                )
                await asyncio.sleep(wait)
                continue

            # --- Other HTTP errors -----------------------------------------
            if resp.status_code >= 400:
                raise ArchitectError(
                    f"Venice API error {resp.status_code}: {resp.text[:500]}"
                )

            # --- Parse OpenAI-compatible response --------------------------
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            return content

        except httpx.TimeoutException:
            logger.warning(
                "Venice timeout (attempt %d/%d)", attempt, VENICE_MAX_RETRIES
            )
            last_error = VeniceTimeoutError(
                f"Venice API timed out after {VENICE_TIMEOUT}s "
                f"(attempt {attempt}/{VENICE_MAX_RETRIES})"
            )
            await asyncio.sleep(VENICE_RETRY_BACKOFF ** attempt)
            continue

        except httpx.HTTPError as exc:
            last_error = ArchitectError(f"HTTP error calling Venice: {exc}")
            await asyncio.sleep(VENICE_RETRY_BACKOFF ** attempt)
            continue

    # Retries exhausted
    if isinstance(last_error, RateLimitError):
        raise last_error
    if isinstance(last_error, VeniceTimeoutError):
        raise last_error
    raise last_error or ArchitectError("Venice call failed for unknown reason")


def _extract_json(raw: str) -> dict[str, Any]:
    """Extract a JSON object from the LLM's raw text response.

    Handles common LLM output quirks:
    - Wrapped in ```json ... ``` markdown fences
    - Leading/trailing prose
    - Extra whitespace
    """
    raw = raw.strip()

    # Strip markdown code fences if present.
    if raw.startswith("```"):
        # Remove opening fence (```json or ```)
        first_newline = raw.index("\n")
        raw = raw[first_newline + 1 :]
    if raw.endswith("```"):
        raw = raw[: -3]
    raw = raw.strip()

    # Find first { and last } to handle surrounding prose.
    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace == -1 or last_brace == -1:
        raise MalformedResponseError(
            f"No JSON object found in LLM response: {raw[:200]!r}"
        )

    json_str = raw[first_brace : last_brace + 1]

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise MalformedResponseError(
            f"Failed to parse LLM JSON output: {exc}. Raw: {json_str[:200]!r}"
        ) from exc
