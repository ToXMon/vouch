"""Vouch AI Promise Architect.

Transforms natural-language claims into structured commitment specs
that are keccak256-hashed and locked onchain in Vouch.sol.
"""

from .architect import generate_spec
from .models import CommitmentSpec, Parties, VerificationType

__all__ = ["generate_spec", "CommitmentSpec", "Parties", "VerificationType"]
__version__ = "1.0.0"
