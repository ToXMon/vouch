# Vouch Adjudicator

**Cross-model binding dispute resolution for Vouch commitments.**

## Role in the Vouch Pipeline

```
User creates commitment \u2192 Evidence submitted \u2192 AI Auditor checks
                                                          \u2193
                                    24h optimistic challenge window
                                                          \u2193
                                    [Challenged?] \u2192 Adjudicator renders BINDING ruling
```

The Adjudicator is the **final authority** on disputed commitments. When a
counterparty challenges the Auditor's verdict, the Adjudicator reviews all
inputs and issues a binding ruling that determines fund distribution.

## Cross-Model Design (Bias Prevention)

The Adjudicator **must** use a different Venice model than the Auditor:

| Layer | Default Model | Model Family |
|-------|--------------|--------------|
| Auditor | `qwen3-vl-235b-a22b` | Qwen (vision) |
| **Adjudicator** | **`llama-3.3-70b`** | **Llama (text)** |

### Why Different Models?

1. **No single-model bias dominates.** If the Auditor model has a systematic
   bias (e.g., too lenient on photo evidence, biased toward "pass" verdicts),
   a different model family won't share that bias.

2. **Independent reasoning.** Different model architectures produce different
   reasoning patterns. What one model overlooks, another may catch.

3. **Adversarial robustness.** A prompt-injection attack tuned to fool one
   model family is unlikely to fool both.

4. **No cascade failures.** If a model has a known blind spot, using it for
   both audit and adjudication amplifies the error. Cross-model limits this.

### Configuration

```bash
# The Auditor model (set via the Auditor's env var)
export VENICE_VISION_MODEL="qwen3-vl-235b-a22b"

# The Adjudicator model (MUST differ in family)
export ADJUDICATOR_MODEL="llama-3.3-70b"
```

If `ADJUDICATOR_MODEL` is unset, it defaults to `llama-3.3-70b`.

## Usage

```python
import asyncio
from agents.adjudicator import adjudicate

result = asyncio.run(adjudicate(
    commitment_spec={
        "claim_text": "I ran a marathon on July 1",
        "verification_type": "photo",
        "parties": {"creator": "0x...", "counterparty": "0x..."},
        "deadline_iso": "2026-07-02T00:00:00Z",
        "stake_amount_mon": "10",
    },
    evidence={
        "photo_url": "strava_screenshot.png",
        "description": "Official race results",
    },
    auditor_verdict={
        "verdict": "pass",
        "confidence": 0.9,
        "reasoning": "Screenshot shows official results",
    },
    challenge_argument="The timestamp is inconsistent with the race start time.",
))

print(result.ruling)        # Ruling.CHALLENGER_WINS
print(result.confidence)    # 0.75
print(result.model_used)    # "llama-3.3-70b"
```

## API

### `adjudicate(commitment_spec, evidence, auditor_verdict, challenge_argument) -> AdjudicationResult`

| Parameter | Type | Description |
|-----------|------|-------------|
| `commitment_spec` | `dict` | The original commitment spec (see `architect/models.py`) |
| `evidence` | `dict` | The evidence submitted by the creator |
| `auditor_verdict` | `dict` | The Auditor's verdict on the evidence |
| `challenge_argument` | `str` | The challenger's argument against the verdict |

### `AdjudicationResult`

| Field | Type | Description |
|-------|------|-------------|
| `ruling` | `Ruling` | `CREATOR_WINS`, `CHALLENGER_WINS`, or `INSUFFICIENT_EVIDENCE` |
| `confidence` | `float` | 0.0\u20131.0 confidence score |
| `reasoning` | `str` | Detailed reasoning referencing evidence and arguments |
| `model_used` | `str` | The Venice model that rendered this ruling |

## Files

| File | Purpose |
|------|---------|
| `__init__.py` | Package exports |
| `models.py` | `Ruling` enum, `AdjudicationResult` model |
| `prompts.py` | Adjudication system prompt (XML-tagged, few-shot examples) |
| `adjudicator.py` | `adjudicate()` async function with cross-model design |
| `requirements.txt` | `httpx`, `pydantic` |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VENICE_API_KEY` | Yes | \u2014 | Venice AI API key |
| `ADJUDICATOR_MODEL` | No | `llama-3.3-70b` | Venice model for adjudication (must differ from Auditor) |
