# Vouch AI Evidence Auditor

Verifies submitted evidence against a commitment claim and returns a
**PASS / FAIL / UNCERTAIN** verdict. The Auditor is the second agent in
the Vouch flow — it runs after a user creates a commitment and locks
stake onchain, when they submit their evidence.

## Flow Position

```
User claim
   │
   ▼
[Architect] ──► CommitmentSpec ──► Vouch.sol.lockStake()
                                          │
                                          ▼
                              User submits evidence
                                          │
                                          ▼
                                    [Auditor] ◄── this module
                                          │
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                       PHOTO         PEER-SIGN          WEB
                     (Venice)     (eth_account)    (three.ws)
                          │               │               │
                          └───────────────┴───────────────┘
                                          │
                                          ▼
                                   AuditResult
                                   {PASS|FAIL|UNCERTAIN}
```

The **WEB** lane (public URL fact-checking) is handled separately by
the three.ws runtime (`agents/runtime/threews_client.py`) and is NOT
part of this module. The Auditor explicitly rejects `web`, `location`,
and `api` verification types — those belong to other runtime paths.

## Verification Lanes

### 1. PHOTO Lane — `audit_photo(claim_text, photo_url, spec)`

Uses **Venice AI's vision-capable model** (`qwen3-vl-235b-a22b` by
default) to analyze whether a submitted photo supports the user's
claim.

- Sends claim text + photo URL to the vision model via an OpenAI-
  compatible multimodal content array.
- The model returns JSON: `{verdict, confidence, reasoning}`.
- **Safety downgrade**: any PASS with confidence below
  `AUDITOR_PASS_THRESHOLD` (default `0.6`) is automatically downgraded
  to UNCERTAIN. This guards against overconfident approvals on weak
  evidence — real money is at stake.
- API failures (rate limits, timeouts, malformed responses) return
  UNCERTAIN with confidence 0.0 rather than failing the whole flow.

### 2. PEER-SIGN Lane — `audit_peer_sign(signature, expected_message, signer_address)`

Verifies a counterparty's cryptographic signature approving the claim.
This is fully deterministic — no AI involved.

- Uses `eth_account.Account.recover_message` with EIP-191
  (`\x19Ethereum Signed Message:\n<len>` prefix) to recover the signer
  address from the signature.
- Compares the recovered address (case-insensitive) to the expected
  counterparty address from the CommitmentSpec `parties.counterparty`.
- **PASS** with confidence 1.0 on exact match.
- **FAIL** with confidence 1.0 on address mismatch.
- **FAIL** with confidence 0.0 on malformed/unrecoverable signature.

## Usage

### Dispatcher (recommended entry point)

```python
import asyncio
from agents.auditor import audit

# PHOTO lane
result = asyncio.run(audit(
    claim_text="I went to the gym today",
    evidence={"photo_url": "https://example.com/gym-selfie.jpg"},
    verification_type="photo",
))
print(result)
# AuditResult(verdict=AuditVerdict.PASS, confidence=0.85,
#            reasoning="...", evidence_type="photo")

# PEER-SIGN lane
result = asyncio.run(audit(
    claim_text="Alice owes Bob 50 MON",
    evidence={
        "signature": "0x...",
        "expected_message": "I approve: Alice owes Bob 50 MON",
        "signer_address": "0xABCD...1234",
    },
    verification_type="peer_sign",
))
```

### Direct lane access

```python
from agents.auditor import audit_photo, audit_peer_sign

photo_result = await audit_photo("claim", "https://photo.url", spec_dict)
sign_result = await audit_peer_sign("0x...", "message", "0xABCD...")
```

## Example I/O

### PHOTO — PASS

```text
Input:
  claim_text   = "I went to the gym today"
  photo_url    = "https://cdn.vouch.app/evidence/abc123.jpg"
                 (a gym selfie)

Output:
  AuditResult(
    verdict=AuditVerdict.PASS,
    confidence=0.85,
    reasoning="Photo shows user in a gym with equipment visible...",
    evidence_type="photo",
  )
```

### PHOTO — FAIL

```text
Input:
  claim_text   = "I went to the gym today"
  photo_url    = "https://cdn.vouch.app/evidence/xyz789.jpg"
                 (a mountain landscape)

Output:
  AuditResult(
    verdict=AuditVerdict.FAIL,
    confidence=0.9,
    reasoning="Photo shows a mountain landscape with no gym...",
    evidence_type="photo",
  )
```

### PEER-SIGN — PASS

```text
Input:
  signature        = "0xabc123..." (65-byte EIP-191 signature)
  expected_message = "I approve the commitment"
  signer_address   = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEq1"

Output:
  AuditResult(
    verdict=AuditVerdict.PASS,
    confidence=1.0,
    reasoning="Signature recovered to 0x742d...bEq1, matching...",
    evidence_type="peer_sign",
  )
```

### PEER-SIGN — FAIL (mismatch)

```text
Input:
  signature        = "0xabc123..." (signed by a different key)
  expected_message = "I approve the commitment"
  signer_address   = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEq1"

Output:
  AuditResult(
    verdict=AuditVerdict.FAIL,
    confidence=1.0,
    reasoning="Signature recovered to 0x999..., which does NOT match...",
    evidence_type="peer_sign",
  )
```

## Configuration

All configuration is via environment variables — nothing is hardcoded.

| Variable | Default | Description |
|----------|---------|-------------|
| `VENICE_API_KEY` | _(required)_ | Venice AI API key. Read from `os.environ` only. |
| `VENICE_VISION_MODEL` | `qwen3-vl-235b-a22b` | Venice vision-capable model name. |
| `AUDITOR_PASS_THRESHOLD` | `0.6` | Confidence floor for PASS; below this, PASS → UNCERTAIN. |

The Auditor also inherits Venice client settings from
`agents/runtime/venice_client.py` (timeouts, retries, base URL).

## Dependencies

See `requirements.txt`:

- `httpx` — async HTTP client for Venice API (via shared client).
- `pydantic` — `AuditResult` / `AuditVerdict` models.
- `eth-account` — EIP-191 signature recovery for the peer-sign lane.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `VENICE_API_KEY` missing | `VeniceError` propagates from the shared client; photo lane returns UNCERTAIN. |
| Venice 429 rate limit | Shared client retries with exponential backoff; on exhaustion, photo lane returns UNCERTAIN. |
| Venice timeout | Shared client retries; on exhaustion, photo lane returns UNCERTAIN. |
| Malformed LLM JSON | Photo lane returns UNCERTAIN with confidence 0.0. |
| Invalid verdict string | Photo lane returns UNCERTAIN with confidence 0.0. |
| Malformed signature (peer-sign) | Returns FAIL with confidence 0.0. |
| Unsupported `verification_type` | `ValueError` raised — contract violation by the caller. |

The Auditor **never raises** for evidence-quality issues — it always
returns an `AuditResult`. The only raise is `ValueError` for a
contract violation (caller routed an unsupported type to the
auditor).
