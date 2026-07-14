"""Pydantic models for the Evidence Auditor output.

AuditResult is the canonical return type for every audit lane.
It is consumed by the runtime and (eventually) the onchain
adjudicator when disputes are escalated.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class AuditVerdict(str, Enum):
    """Three-state verdict to avoid forcing a binary decision.

    - PASS: evidence clearly supports the claim.
    - FAIL: evidence contradicts the claim or is invalid.
    - UNCERTAIN: evidence is ambiguous or verification could not
      complete (API error, unclear photo, etc.). The adjudicator
      or a human can escalate UNCERTAIN cases.
    """

    PASS = "pass"
    FAIL = "fail"
    UNCERTAIN = "uncertain"


class AuditResult(BaseModel):
    """Structured result of an evidence audit.

    Attributes
    ----------
    verdict
        PASS, FAIL, or UNCERTAIN.
    confidence
        Float in [0.0, 1.0]. For photo lane, derived from the
        vision model's self-assessment. For peer-sign, 1.0 on
        exact address match, 0.0 on mismatch.
    reasoning
        Human-readable explanation of the verdict.
    evidence_type
        The lane that produced this result (``"photo"`` or
        ``"peer_sign"``).
    """

    verdict: AuditVerdict
    confidence: float = Field(..., ge=0.0, le=1.0)
    reasoning: str
    evidence_type: str
