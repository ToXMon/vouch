"""Vouch AI Adjudicator — cross-model binding dispute resolution."""

from .adjudicator import adjudicate
from .models import AdjudicationResult, Ruling

__all__ = ["adjudicate", "AdjudicationResult", "Ruling"]
