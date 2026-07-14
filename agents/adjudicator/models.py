"""Models for the Vouch Adjudicator.

Defines the binding ruling enum and the structured adjudication result.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class Ruling(str, Enum):
    """Binding rulings the Adjudicator can issue."""

    CREATOR_WINS = "creator_wins"
    CHALLENGER_WINS = "challenger_wins"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class AdjudicationResult(BaseModel):
    """Structured output of a binding adjudication."""

    ruling: Ruling = Field(..., description="The binding ruling")
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Confidence score 0.0\u20131.0"
    )
    reasoning: str = Field(
        ..., description="Detailed reasoning for the ruling"
    )
    model_used: str = Field(
        ..., description="The Venice model that rendered this ruling"
    )
