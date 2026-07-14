"""Vouch AI Evidence Auditor — core implementation.

Verifies submitted evidence against a commitment claim. Two lanes:
  - PHOTO: Venice vision-model analysis (does photo support claim?)
  - PEER-SIGN: EIP-191 signature recovery and address match

The web lane is handled separately by the three.ws runtime; this
module never touches web/location/api verification types.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct

from .models import AuditResult, AuditVerdict
from .prompts import VISION_SYSTEM_PROMPT

# Shared Venice client — has retry-on-429, timeout, and key handling.
# Architect inlines its own caller, but the shared client exists for
# exactly this kind of reuse. Prefer DRY here.
from agents.runtime.venice_client import VeniceError, chat_completion

logger = logging.getLogger("vouch.auditor")

# ---------------------------------------------------------------------------
# Configuration (all from environment — never hardcoded).
# ---------------------------------------------------------------------------

# Venice vision-capable model. qwen3-vl-235b-a22b is Venice's documented
# vision model (see https://docs.venice.ai). Override via env for testing
# or when Venice ships a better vision model.
VENICE_VISION_MODEL = os.environ.get("VENICE_VISION_MODEL", "qwen3-vl-235b-a22b")

# Confidence threshold below which a PASS from the vision model is
# downgraded to UNCERTAIN. The model also self-rates, but this is a
# safety net for overconfident approvals.
PASS_CONFIDENCE_THRESHOLD = float(os.environ.get("AUDITOR_PASS_THRESHOLD", "0.6"))

# Supported verification types — the auditor ONLY handles these two.
# web/location/api are routed elsewhere by the runtime.
SUPPORTED_TYPES = {"photo", "peer_sign"}


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------


async def audit(
    claim_text: str, evidence: dict[str, Any], verification_type: str
) -> AuditResult:
    """Route evidence to the correct audit lane.

    Parameters
    ----------
    claim_text
        The natural-language claim from the CommitmentSpec.
    evidence
        Lane-specific evidence dict:
          - photo lane: ``{"photo_url": "https://..."}``
          - peer_sign lane: ``{"signature": "0x...", "expected_message": "...", "signer_address": "0x..."}``
    verification_type
        One of ``"photo"`` or ``"peer_sign"``.

    Returns
    -------
    AuditResult

    Raises
    ------
    ValueError
        If ``verification_type`` is not ``photo`` or ``peer_sign``.
        Web/location/api verification is handled by other runtime
        paths and must never reach this dispatcher.
    KeyError
        If ``evidence`` is missing required keys for the lane.
    """
    vtype = verification_type.lower().strip()

    if vtype == "photo":
        return await audit_photo(claim_text, evidence["photo_url"], evidence)

    if vtype == "peer_sign":
        return await audit_peer_sign(
            signature=evidence["signature"],
            expected_message=evidence["expected_message"],
            signer_address=evidence["signer_address"],
        )

    raise ValueError(
        f"Auditor does not handle verification_type={verification_type!r}. "
        f"Supported types: {sorted(SUPPORTED_TYPES)}. "
        f"Web/location/api evidence must be routed by the runtime, not the auditor."
    )


# ---------------------------------------------------------------------------
# PHOTO lane — Venice vision analysis
# ---------------------------------------------------------------------------


async def audit_photo(
    claim_text: str, photo_url: str, spec: dict[str, Any] | None = None
) -> AuditResult:
    """Verify photo evidence using Venice's vision-capable model.

    Sends the claim text and photo to the vision model, which returns a
    JSON verdict. The model's self-assessed confidence is used directly,
    with a safety downgrade: PASS below the configured threshold becomes
    UNCERTAIN.

    Parameters
    ----------
    claim_text
        The commitment claim the photo is meant to support.
    photo_url
        Publicly accessible URL of the photo to analyze.
    spec
        Optional full CommitmentSpec dict for additional context
        (deadline, stake, etc.). Currently used for logging only.

    Returns
    -------
    AuditResult
        Verdict PASS/FAIL/UNCERTAIN with confidence and reasoning.
        On Venice API failure, returns UNCERTAIN with confidence 0.0.
    """
    if spec:
        logger.debug(
            "audit_photo: spec deadline=%s stake=%s MON",
            spec.get("deadline_iso", "unknown"),
            spec.get("stake_amount_mon", "unknown"),
        )

    messages = [
        {"role": "system", "content": VISION_SYSTEM_PROMPT},
        {
            "role": "user",
            # OpenAI-compatible multimodal content array — Venice accepts
            # image_url just like OpenAI's vision endpoint.
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"<claim>\n  {claim_text}\n</claim>\n\n"
                        "Analyze the photo below and determine whether it "
                        "supports the claim. Respond with the JSON object only."
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {"url": photo_url},
                },
            ],
        },
    ]

    try:
        raw = await chat_completion(
            model=VENICE_VISION_MODEL,
            messages=messages,
            temperature=0.1,  # Low temperature for consistent judgments
            max_tokens=400,
        )
    except VeniceError as exc:
        logger.error("Venice vision call failed: %s", exc)
        return AuditResult(
            verdict=AuditVerdict.UNCERTAIN,
            confidence=0.0,
            reasoning=f"Vision API call failed; cannot verify photo. Error: {exc}",
            evidence_type="photo",
        )

    # Parse the model's JSON response.
    try:
        result = _extract_json(raw)
    except ValueError as exc:
        logger.error("Failed to parse vision model JSON: %s. Raw: %s", exc, raw[:300])
        return AuditResult(
            verdict=AuditVerdict.UNCERTAIN,
            confidence=0.0,
            reasoning="Vision model returned an unparseable response; cannot verify photo.",
            evidence_type="photo",
        )

    # Normalize the verdict string.
    verdict_str = str(result.get("verdict", "")).lower().strip()
    reasoning = str(result.get("reasoning", "No reasoning provided.")).strip()
    confidence = _clamp_confidence(result.get("confidence", 0.0))

    try:
        verdict = AuditVerdict(verdict_str)
    except ValueError:
        logger.error("Vision model returned invalid verdict=%r", verdict_str)
        return AuditResult(
            verdict=AuditVerdict.UNCERTAIN,
            confidence=0.0,
            reasoning=f"Vision model returned an unrecognized verdict: {verdict_str!r}.",
            evidence_type="photo",
        )

    # Safety downgrade: an overconfident-but-weak PASS becomes UNCERTAIN.
    # This guards against the model approving with marginal confidence.
    if verdict == AuditVerdict.PASS and confidence < PASS_CONFIDENCE_THRESHOLD:
        logger.info(
            "Downgrading PASS→UNCERTAIN: confidence %.2f below threshold %.2f",
            confidence,
            PASS_CONFIDENCE_THRESHOLD,
        )
        verdict = AuditVerdict.UNCERTAIN

    logger.info(
        "audit_photo verdict=%s confidence=%.2f claim=%r",
        verdict.value,
        confidence,
        claim_text[:80],
    )

    return AuditResult(
        verdict=verdict,
        confidence=confidence,
        reasoning=reasoning,
        evidence_type="photo",
    )


# ---------------------------------------------------------------------------
# PEER-SIGN lane — EIP-191 signature recovery
# ---------------------------------------------------------------------------


async def audit_peer_sign(
    signature: str, expected_message: str, signer_address: str
) -> AuditResult:
    """Verify a counterparty's EIP-191 signature approval.

    Recovers the signer address from the signature using ecrecover and
    checks it against the expected counterparty address. This is fully
    deterministic — no AI involved.

    Parameters
    ----------
    signature
        The hex-encoded EIP-191 signature (``0x...``, 65 bytes / 130 hex
        chars + ``0x`` prefix).
    expected_message
        The exact message text that was expected to be signed. This must
        match byte-for-byte what the counterparty actually signed.
    signer_address
        The checksum address of the expected signer (the counterparty
        from the CommitmentSpec parties).

    Returns
    -------
    AuditResult
        PASS with confidence 1.0 on exact address match.
        FAIL with confidence 1.0 on mismatch.
        FAIL with confidence 0.0 on malformed signature or recovery error.
    """
    try:
        # EIP-191: \\x19Ethereum Signed Message:\\n<len> prefix.
        msg = encode_defunct(text=expected_message)
        recovered = Account.recover_message(msg, signature=signature)
    except Exception as exc:
        # eth_account raises various errors for malformed signatures.
        logger.error("Signature recovery failed: %s", exc)
        return AuditResult(
            verdict=AuditVerdict.FAIL,
            confidence=0.0,
            reasoning=f"Signature is malformed or could not be recovered: {exc}",
            evidence_type="peer_sign",
        )

    # Case-insensitive comparison — addresses are hex; checksum is a
    # display convention, not a semantic distinction.
    match = recovered.lower() == signer_address.lower()

    if match:
        logger.info(
            "audit_peer_sign PASS: recovered=%s matches expected=%s",
            recovered,
            signer_address,
        )
        return AuditResult(
            verdict=AuditVerdict.PASS,
            confidence=1.0,
            reasoning=f"Signature recovered to {recovered}, matching the expected counterparty {signer_address}.",
            evidence_type="peer_sign",
        )

    logger.warning(
        "audit_peer_sign FAIL: recovered=%s does NOT match expected=%s",
        recovered,
        signer_address,
    )
    return AuditResult(
        verdict=AuditVerdict.FAIL,
        confidence=1.0,
        reasoning=(
            f"Signature recovered to {recovered}, which does NOT match the "
            f"expected counterparty {signer_address}."
        ),
        evidence_type="peer_sign",
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _clamp_confidence(value: Any) -> float:
    """Coerce a model-provided confidence value to a clamped float."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return 0.0
    if f < 0.0:
        return 0.0
    if f > 1.0:
        return 1.0
    return f


def _extract_json(raw: str) -> dict[str, Any]:
    """Extract a JSON object from an LLM's raw text response.

    Handles common LLM output quirks:
      - Wrapped in ```json ... ``` markdown fences
      - Leading/trailing prose
      - Extra whitespace

    Raises ValueError if no valid JSON object is found.
    """
    raw = raw.strip()

    # Strip markdown code fences if present.
    if raw.startswith("```"):
        newline = raw.find("\n")
        if newline != -1:
            raw = raw[newline + 1 :]
    if raw.endswith("```"):
        raw = raw[:-3]
    raw = raw.strip()

    first_brace = raw.find("{")
    last_brace = raw.rfind("}")
    if first_brace == -1 or last_brace == -1:
        raise ValueError(f"No JSON object found in response: {raw[:200]!r}")

    json_str = raw[first_brace : last_brace + 1]
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse JSON: {exc}. Raw: {json_str[:200]!r}") from exc
