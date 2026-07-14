"""Vouch AI Evidence Auditor.

Verifies submitted evidence against a commitment claim. Returns
PASS / FAIL / UNCERTAIN verdicts for two lanes:
  - PHOTO: Venice vision-model analysis (does photo support claim?)
  - PEER-SIGN: EIP-191 signature recovery and address match

The web lane is handled separately by the three.ws runtime.
"""

from .auditor import audit, audit_peer_sign, audit_photo
from .models import AuditResult, AuditVerdict

__all__ = ["audit", "audit_photo", "audit_peer_sign", "AuditResult", "AuditVerdict"]
__version__ = "1.0.0"
