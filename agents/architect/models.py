"""Pydantic models for the Vouch commitment specification.

The CommitmentSpec is the canonical structured output of the AI Architect.
It is serialized deterministically (sorted keys, no whitespace) before
being keccak256-hashed and committed onchain in Vouch.sol.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class VerificationType(str, Enum):
    """Allowed verification mechanisms for a Vouch commitment.

    The Architect MUST select exactly one. Freeform / unspecified
    verification is rejected.
    """

    PHOTO = "photo"
    WEB = "web"
    LOCATION = "location"
    PEER_SIGN = "peer_sign"
    API = "api"


class Parties(BaseModel):
    """The two parties to a commitment."""

    creator: str = Field(..., description="Checksum address of the claim creator")
    counterparty: str = Field(..., description="Checksum address of the counterparty")

    @field_validator("creator", "counterparty")
    @classmethod
    def _valid_address(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith("0x") or len(v) != 42:
            raise ValueError(f"Invalid Ethereum-style address: {v!r}")
        return v


class CommitmentSpec(BaseModel):
    """Structured commitment specification produced by the AI Architect.

    This object is the direct input to keccak256 hashing and onchain
    locking. Field order and serialization are versioned via
    ``spec_version``.
    """

    claim_text: str = Field(..., description="The natural-language claim / bet")
    verification_type: VerificationType = Field(
        ..., description="One of: photo, web, location, peer_sign, api"
    )
    parties: Parties = Field(..., description="Creator and counterparty addresses")
    deadline_iso: str = Field(
        ...,
        description="ISO-8601 UTC deadline by which verification must complete",
    )
    stake_amount_mon: str = Field(
        ...,
        description="Stake amount in MON as a decimal string (avoids float drift)",
    )
    spec_version: str = Field(
        default="1.0.0",
        description="Schema version — bump when CommitmentSpec fields change",
    )

    @field_validator("deadline_iso")
    @classmethod
    def _valid_iso(cls, v: str) -> str:
        # Parse and re-emit to guarantee canonical formatting.
        dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    @field_validator("stake_amount_mon", mode="before")
    @classmethod
    def _stake_is_string(cls, v: Any) -> str:
        # Always coerce to string so the hash never drifts between
        # number vs string representations.
        if isinstance(v, (int, float)):
            v = str(v)
        # Validate it's a valid decimal.
        float(v)
        return v

    def to_deterministic_dict(self) -> dict[str, Any]:
        """Return a dict suitable for deterministic JSON serialization.

        Nested enums are expanded to their string values.
        """
        return self.model_dump(mode="json")

    def to_deterministic_json(self) -> str:
        """Serialize to canonical JSON for keccak256 hashing.

        Rules:
        - Sorted keys (alphabetical at every nesting level)
        - Compact separators (no spaces after ',' or ':')
        - No trailing newline

        The same CommitmentSpec always produces the same bytes → same hash.
        """
        return json.dumps(
            self.to_deterministic_dict(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
