"""Vouch agent runtime — FastAPI application.

Orchestrates Venice AI agents (architect, auditor, adjudicator) and the
three.ws Fact Check API to power Vouch's commitment lifecycle:

  POST /api/commitments/spec   — generate a commitment spec + keccak256 hash
  POST /api/evidence/audit     — fact-check web evidence via three.ws
  POST /api/dispute/adjudicate — cross-model ruling on a disputed commitment
  GET  /api/health             — service health + configuration status

Sibling agent packages (agents/architect, agents/auditor, agents/adjudicator)
are imported dynamically so the runtime degrades gracefully when a sibling
has not been implemented yet.

All secrets come from os.environ ONLY — VENICE_API_KEY, THREE_WS_API_KEY.
"""

from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from web3 import Web3

from . import threews_client
from . import venice_client

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# ---------------------------------------------------------------------------
# Path setup — make sibling agent packages (agents.*) importable.
# ---------------------------------------------------------------------------

_VOUCH_ROOT = Path(__file__).resolve().parent.parent.parent  # vouch/
if str(_VOUCH_ROOT) not in sys.path:
    sys.path.insert(0, str(_VOUCH_ROOT))


def _try_import_sibling(name: str) -> Any | None:
    """Dynamically import a sibling agent package. Returns None if unavailable."""
    try:
        return importlib.import_module(f"agents.{name}")
    except ImportError as exc:
        logger.info("Sibling agent %s not importable yet: %s", name, exc)
        return None
    except Exception as exc:  # noqa: BLE001 — sibling may have import-time errors
        logger.warning("Sibling agent %s failed to import: %s", name, exc)
        return None


# Eagerly load architect (implemented); lazy-load auditor/adjudicator at call time.
architect_mod = _try_import_sibling("architect")

# ---------------------------------------------------------------------------
# Pydantic request / response models
# ---------------------------------------------------------------------------


class SpecRequest(BaseModel):
    claim_text: str = Field(..., min_length=1, description="Natural-language claim or bet")
    creator_address: str = Field(..., description="Checksum address of the claim creator")
    counterparty_address: str = Field(..., description="Checksum address of the counterparty")


class SpecResponse(BaseModel):
    spec: dict[str, Any]
    keccak256_hash: str


class EvidenceAuditRequest(BaseModel):
    claim: str = Field(..., min_length=1, description="The claim text to fact-check")
    evidence_url: str | None = Field(None, description="URL of web evidence")
    verification_type: str = Field("web", description="Evidence type: web, photo, location, etc.")
    strictness: str = Field("medium", description="Fact-check strictness: low, medium, high")


class EvidenceAuditResponse(BaseModel):
    verdict: str
    confidence: float
    sources: list[Any]
    attestation: str
    error: str | None = None


class DisputeRequest(BaseModel):
    commitment: dict[str, Any] = Field(..., description="The disputed commitment spec")
    dispute_reason: str | None = Field(None, description="Why the commitment is disputed")


class DisputeResponse(BaseModel):
    ruling: str
    reasoning: str
    confidence: float
    method: str = Field("adjudicator", description="How the ruling was produced")


class HealthResponse(BaseModel):
    status: str
    venice_configured: bool
    threews_configured: bool


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Vouch Agent Runtime",
    description="Orchestrates Venice AI agents and three.ws fact-check for Vouch commitments.",
    version="0.1.0",
)

# CORS — allow frontend. Configurable via VOUCH_CORS_ORIGINS env var.
_cors_origins = os.environ.get("VOUCH_CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Health check — reports service status and API configuration."""
    return HealthResponse(
        status="ok",
        venice_configured=bool(os.environ.get("VENICE_API_KEY")),
        threews_configured=bool(os.environ.get("THREE_WS_API_KEY")),
    )


@app.post("/api/commitments/spec", response_model=SpecResponse)
async def create_commitment_spec(req: SpecRequest) -> SpecResponse:
    """Generate a structured commitment spec via the AI Architect.

    Returns the spec dict and its keccak256 hash for onchain locking.
    """
    if architect_mod is None:
        raise HTTPException(
            status_code=503,
            detail="Architect agent not available. Ensure agents/architect/ is implemented.",
        )

    try:
        spec = await architect_mod.generate_spec(
            claim_text=req.claim_text,
            creator_address=req.creator_address,
            counterparty_address=req.counterparty_address,
        )
    except Exception as exc:
        logger.error("Architect generate_spec failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Architect error: {exc}") from exc

    spec_dict = spec.to_deterministic_dict()
    canonical_json = spec.to_deterministic_json()
    keccak_hash = Web3.keccak(text=canonical_json).hex()

    logger.info("Commitment spec generated; hash=%s", keccak_hash)
    return SpecResponse(spec=spec_dict, keccak256_hash=keccak_hash)


@app.post("/api/evidence/audit", response_model=EvidenceAuditResponse)
async def audit_evidence(req: EvidenceAuditRequest) -> EvidenceAuditResponse:
    """Audit submitted evidence.

    For web-type evidence, calls three.ws fact-check and returns the verdict.
    For other evidence types, attempts to use the AI Auditor agent if available.
    """
    if req.verification_type == "web":
        # Web claims → three.ws fact-check.
        claim_to_check = req.claim
        if req.evidence_url:
            claim_to_check = f"{req.claim} (Evidence URL: {req.evidence_url})"

        result = await threews_client.fact_check(claim_to_check, strictness=req.strictness)
        return EvidenceAuditResponse(
            verdict=result["verdict"],
            confidence=result["confidence"],
            sources=result["sources"],
            attestation=result["attestation"],
            error=result.get("error"),
        )

    # Non-web evidence → try AI Auditor agent.
    auditor_mod = _try_import_sibling("auditor")
    if auditor_mod is None:
        raise HTTPException(
            status_code=503,
            detail=f"Auditor agent not available for verification_type={req.verification_type}. "
            f"Only web-type evidence is currently supported.",
        )

    try:
        result = await auditor_mod.audit(req.claim, req.evidence_url)
        return EvidenceAuditResponse(
            verdict=result.get("verdict", "insufficient"),
            confidence=result.get("confidence", 0.0),
            sources=result.get("sources", []),
            attestation=result.get("attestation", ""),
        )
    except Exception as exc:
        logger.error("Auditor audit failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Auditor error: {exc}") from exc


@app.post("/api/dispute/adjudicate", response_model=DisputeResponse)
async def adjudicate_dispute(req: DisputeRequest) -> DisputeResponse:
    """Adjudicate a disputed commitment via cross-model ruling.

    Tries the AI Adjudicator agent first. If unavailable, falls back to a
    venice_client-based cross-model ruling using two different models.
    """
    # --- Try dedicated adjudicator agent first ------------------------------
    adjudicator_mod = _try_import_sibling("adjudicator")
    if adjudicator_mod is not None and hasattr(adjudicator_mod, "adjudicate"):
        try:
            result = await adjudicator_mod.adjudicate(req.commitment, req.dispute_reason)
            return DisputeResponse(
                ruling=result.get("ruling", "insufficient"),
                reasoning=result.get("reasoning", ""),
                confidence=result.get("confidence", 0.0),
                method="adjudicator",
            )
        except Exception as exc:
            logger.error("Adjudicator failed, falling back to cross-model: %s", exc)

    # --- Fallback: cross-model ruling via venice_client ---------------------
    return await _cross_model_ruling(req.commitment, req.dispute_reason)


# ---------------------------------------------------------------------------
# Cross-model ruling fallback (used when adjudicator/ is not implemented)
# ---------------------------------------------------------------------------

_CROSS_MODELS = [
    os.environ.get("VOUCH_ADJUDICATOR_MODEL_1", "llama-3.3-70b"),
    os.environ.get("VOUCH_ADJUDICATOR_MODEL_2", "deepseek-r1-70b"),
]

_ADJUDICATOR_SYSTEM_PROMPT = (
    "You are an impartial adjudicator for Vouch, a Polymarket-for-personal-claims platform. "
    "Given a disputed commitment spec and a dispute reason, produce a JSON object with: "
    '\"ruling\": "upheld" | "rejected" | "insufficient", '
    '\"reasoning\": brief explanation, '
    '\"confidence\": float 0.0-1.0. '
    "Respond with ONLY the JSON object, no markdown."
)


async def _cross_model_ruling(
    commitment: dict[str, Any], dispute_reason: str | None
) -> DisputeResponse:
    """Call two Venice models on the same dispute and aggregate their rulings."""
    import json

    user_msg = json.dumps(
        {"commitment": commitment, "dispute_reason": dispute_reason or "unspecified"},
        ensure_ascii=False,
    )
    messages = [
        {"role": "system", "content": _ADJUDICATOR_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    rulings: list[dict[str, Any]] = []
    for model in _CROSS_MODELS:
        try:
            raw = await venice_client.chat_completion(model, messages, temperature=0.1)
            parsed = _extract_json(raw)
            rulings.append(parsed)
            logger.info("Cross-model ruling from %s: %s", model, parsed.get("ruling"))
        except Exception as exc:
            logger.warning("Cross-model ruling failed for %s: %s", model, exc)

    if not rulings:
        raise HTTPException(
            status_code=502,
            detail="All cross-model adjudication attempts failed. Check VENICE_API_KEY and model availability.",
        )

    # Aggregate: if all agree, high confidence. If they disagree, lower confidence.
    ruling_values = [r.get("ruling", "insufficient") for r in rulings]
    if len(set(ruling_values)) == 1:
        final_ruling = ruling_values[0]
        confidence = min(float(r.get("confidence", 0.5)) for r in rulings)
    else:
        # Majority vote, or first if tie.
        from collections import Counter

        counts = Counter(ruling_values)
        final_ruling = counts.most_common(1)[0][0]
        confidence = 0.4  # models disagreed → low confidence

    reasoning_parts = [f"{_CROSS_MODELS[i]}: {r.get('reasoning', '')}" for i, r in enumerate(rulings)]
    return DisputeResponse(
        ruling=final_ruling,
        reasoning=" | ".join(reasoning_parts),
        confidence=confidence,
        method="cross-model-fallback",
    )


def _extract_json(raw: str) -> dict[str, Any]:
    """Best-effort extraction of a JSON object from an LLM response."""
    import json

    raw = raw.strip()
    # Strip markdown code fences if present.
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Try to find first { and last }
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(raw[start : end + 1])
        raise
