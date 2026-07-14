# Vouch Agent Runtime

FastAPI service that orchestrates Venice AI agents and the three.ws Fact Check API
for Vouch — a Polymarket-for-personal-claims app on Monad.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check — reports status and API configuration |
| `POST` | `/api/commitments/spec` | Generate a commitment spec + keccak256 hash via AI Architect |
| `POST` | `/api/evidence/audit` | Audit evidence (web claims via three.ws fact-check) |
| `POST` | `/api/dispute/adjudicate` | Cross-model ruling on a disputed commitment |

### POST /api/commitments/spec

Generates a structured `CommitmentSpec` from natural-language claim text using the
AI Architect (Venice AI), then returns the spec and its keccak256 hash for onchain
locking in `Vouch.sol`.

**Request:**
```json
{
  "claim_text": "I will run a sub-20 5K by August 1st",
  "creator_address": "0x1234...abcd",
  "counterparty_address": "0xabcd...1234"
}
```

**Response (200):**
```json
{
  "spec": {
    "claim_text": "I will run a sub-20 5K by August 1st",
    "verification_type": "location",
    "parties": {"creator": "0x1234...abcd", "counterparty": "0xabcd...1234"},
    "deadline_iso": "2026-08-01T23:59:59Z",
    "stake_amount_mon": "10",
    "spec_version": "1.0.0"
  },
  "keccak256_hash": "0xabcdef..."
}
```

### POST /api/evidence/audit

Audits submitted evidence. For `web`-type evidence, calls the three.ws Fact Check
API and returns the verdict, confidence, sources, and SHA-256 attestation.

**Request:**
```json
{
  "claim": "The Eiffel Tower is 330 meters tall",
  "evidence_url": "https://example.com/eiffel-height",
  "verification_type": "web",
  "strictness": "medium"
}
```

**Response (200):**
```json
{
  "verdict": "supported",
  "confidence": 0.95,
  "sources": ["https://wikipedia.org/..."],
  "attestation": "sha256:abc123...",
  "error": null
}
```

**Verdicts:** `supported`, `contradicted`, `mixed`, `insufficient`

### POST /api/dispute/adjudicate

Produces a cross-model ruling on a disputed commitment. Tries the AI Adjudicator
agent first; falls back to querying two different Venice models and aggregating
their rulings.

**Request:**
```json
{
  "commitment": {"claim_text": "...", "verification_type": "...", ...},
  "dispute_reason": "Counterparty claims the evidence was fabricated"
}
```

**Response (200):**
```json
{
  "ruling": "upheld",
  "reasoning": "Model A: ... | Model B: ...",
  "confidence": 0.75,
  "method": "cross-model-fallback"
}
```

**Rulings:** `upheld`, `rejected`, `insufficient`

### GET /api/health

```json
{
  "status": "ok",
  "venice_configured": true,
  "threews_configured": true
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VENICE_API_KEY` | Yes | Venice AI API key for architect/adjudicator LLM calls |
| `THREE_WS_API_KEY` | Yes | three.ws API key for fact-check endpoints |
| `VOUCH_CORS_ORIGINS` | No | Comma-separated CORS origins (default: `*`) |
| `VOUCH_ADJUDICATOR_MODEL_1` | No | First model for cross-model ruling (default: `llama-3.3-70b`) |
| `VOUCH_ADJUDICATOR_MODEL_2` | No | Second model for cross-model ruling (default: `deepseek-r1-70b`) |
| `UVICORN_WORKERS` | No | Number of uvicorn workers (default: `1`) |
| `VENICE_MODEL` | No | Model used by architect (default: `llama-3.3-70b`) |
| `VENICE_TIMEOUT` | No | Venice API timeout in seconds (default: `30`) |

**All secrets come from `os.environ` only. Never hardcode keys. No `.env` files.**

## Local Development

```bash
# From the vouch/ directory
export VENICE_API_KEY="your-venice-key"
export THREE_WS_API_KEY="your-threews-key"

pip install -r agents/runtime/requirements.txt

# Run the server (PYTHONPATH must include vouch/ for sibling imports)
PYTHONPATH=. uvicorn agents.runtime.main:app --host 0.0.0.0 --port 8000 --reload
```

Visit `http://localhost:8000/docs` for interactive API docs.

## Docker

```bash
# Build from the vouch/ directory (build context must include agents/)
docker build -t vouch-runtime -f agents/runtime/Dockerfile .

docker run -p 8000:8000 \
  -e VENICE_API_KEY="your-venice-key" \
  -e THREE_WS_API_KEY="your-threews-key" \
  vouch-runtime
```

## Akash Deployment

This service is designed to deploy on [Akash Network](https://akash.network).

1. Build and push the Docker image to a registry (GHCR/Docker Hub):
   ```bash
   docker build -t ghcr.io/yourorg/vouch-runtime:latest -f agents/runtime/Dockerfile .
   docker push ghcr.io/yourorg/vouch-runtime:latest
   ```

2. Create an Akash SDL deployment manifest (`deploy/akash/runtime.yaml`):
   ```yaml
   version: "2.0"
   services:
     runtime:
       image: ghcr.io/yourorg/vouch-runtime:latest
       env:
         - VENICE_API_KEY=$VENICE_API_KEY
         - THREE_WS_API_KEY=$THREE_WS_API_KEY
       expose:
         - port: 8000
           as: 80
           to:
             - global: true
   profiles:
     compute:
       runtime:
         resources:
           cpu: 1
           memory: 512Mi
           storage: 1Gi
     placement:
       akash:
         attributes:
           host: akash
         signedBy:
           anyOf:
             - "akash1365yvmc4s7awdyj3n2y7c5kwu8stx4dq4ql2a3"
         pricing:
           runtime:
             denom: uakt
             amount: 100
   deployment:
     runtime:
       akash:
         profile: runtime
         count: 1
   ```

3. Deploy via Akash CLI:
   ```bash
   akash deployment create deploy/akash/runtime.yaml --from $AKASH_KEY_NAME
   ```

4. Update the frontend to point at the Akash-provided URL.

## Architecture

```
┌──────────────┐     ┌──────────────────────────────────────────┐
│   Frontend   │────▶│         Agent Runtime (FastAPI)           │
│  (Vouch UI)  │     │                                          │
└──────────────┘     │  /api/commitments/spec ──▶ AI Architect   │
                     │                            (Venice AI)    │
                     │  /api/evidence/audit ────▶ three.ws API  │
                     │                            (fact-check)   │
                     │  /api/dispute/adjudicate ▶ AI Adjudicator│
                     │                            (cross-model)  │
                     └──────────────────────────────────────────┘
```

The runtime imports sibling agent packages (`agents/architect`, `agents/auditor`,
`agents/adjudicator`) dynamically. If a sibling is not yet implemented, the
runtime degrades gracefully — returning 503 for that endpoint or falling back
to a cross-model ruling for disputes.

## Error Handling

- All external API calls have timeouts and retry logic
- Venice 429 (rate limit) retries with exponential backoff (honoring `Retry-After`)
- three.ws 402 (paid tier) returns `insufficient` verdict gracefully
- Missing API keys are detected at call time and reported clearly
- All endpoints return structured JSON error responses with HTTP status codes
