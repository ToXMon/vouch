"""three.ws Fact Check API client.

Calls POST https://three.ws/api/x402/fact-check for verifiable claim fact-checking.
Returns verdict, confidence, sources, and a SHA-256 attestation.

The API key is read from os.environ['THREE_WS_API_KEY'] only — never hardcoded.
402 Payment Required is handled gracefully by returning an 'insufficient' verdict.
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

THREEWS_BASE_URL = "https://three.ws"
FACT_CHECK_PATH = "/api/x402/fact-check"
DEFAULT_TIMEOUT = 30.0

VALID_VERDICTS = {"supported", "contradicted", "mixed", "insufficient"}


def _insufficient(reason: str) -> dict[str, Any]:
    """Return a canonical insufficient-verdict payload for graceful failures."""
    return {
        "verdict": "insufficient",
        "confidence": 0.0,
        "sources": [],
        "attestation": "",
        "error": reason,
    }


async def fact_check(claim: str, strictness: str = "medium") -> dict[str, Any]:
    """Call three.ws fact-check endpoint.

    Returns a dict with keys: verdict, confidence, sources, attestation.
    On configuration errors, 402 (paid tier required), or transport failures,
    returns an 'insufficient' verdict with an explanatory 'error' field so
    callers can always rely on the same response shape.
    """
    api_key = os.environ.get("THREE_WS_API_KEY")
    if not api_key:
        logger.warning("THREE_WS_API_KEY not set; returning insufficient verdict")
        return _insufficient("THREE_WS_API_KEY not configured")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"claim": claim, "strictness": strictness}
    url = f"{THREEWS_BASE_URL}{FACT_CHECK_PATH}"

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        try:
            resp = await client.post(url, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            logger.error("three.ws fact_check transport error: %s", exc)
            return _insufficient(f"three.ws request failed: {exc}")

    if resp.status_code == 402:
        logger.warning("three.ws 402 Payment Required — paid tier needed for claim: %r", claim[:120])
        return _insufficient("three.ws paid tier required")

    if resp.status_code >= 400:
        logger.error("three.ws fact_check HTTP %d: %s", resp.status_code, resp.text[:300])
        return _insufficient(f"three.ws HTTP {resp.status_code}")

    try:
        data = resp.json()
    except ValueError as exc:
        logger.error("three.ws returned non-JSON body: %s", exc)
        return _insufficient("three.ws returned non-JSON response")

    # Normalize the response shape so downstream code can rely on it.
    verdict = str(data.get("verdict", "insufficient")).lower()
    if verdict not in VALID_VERDICTS:
        logger.warning("three.ws returned unknown verdict %r; treating as insufficient", verdict)
        verdict = "insufficient"

    return {
        "verdict": verdict,
        "confidence": float(data.get("confidence", 0.0)),
        "sources": list(data.get("sources", []) or []),
        "attestation": str(data.get("attestation", "") or ""),
    }
