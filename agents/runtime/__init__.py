"""Vouch agent runtime — FastAPI service orchestrating Venice AI agents and three.ws fact-check.

Exposes endpoints for commitment spec generation, evidence auditing, and dispute adjudication.
Sibling agent packages (architect, auditor, adjudicator) are imported at runtime.
"""

__version__ = "0.1.0"
