# Vouch AI Promise Architect

> Transforms natural-language claims into structured, onchain-verifiable commitment specs.

## What It Does

The Architect is the **first agent** a Vouch user interacts with. It takes a
natural-language claim or bet ("I'll ship my startup by Q4"), **forces** a
verification type selection (photo / web / location / peer-sign / API), and
produces a deterministic `CommitmentSpec` that gets keccak256-hashed and
locked onchain in `Vouch.sol` on Monad.

```
User claim ──► AI Architect (Venice) ──► CommitmentSpec ──► keccak256 ──► Vouch.sol
```

## The Verification Gate

Every commitment **must** have exactly one verification type. The Architect
never allows freeform or unspecified verification. If a claim is ambiguous,
the Architect proposes the most practical type and explains why.

| Type | Use When | Example |
|------|----------|--------|
| `photo` | Physical-world achievements | "I'll lose 10 lbs" — scale photo |
| `web` | Publicly verifiable online claim | "I'll publish a blog post" — URL check |
| `location` | Geographic presence | "I'll run a 5K at Central Park" |
| `peer_sign` | Trusted witness confirms | "Dave will verify my pushups" |
| `api` | Automated external API attestation | Strava data, GitHub commit count |

## API Contract

### `generate_spec(claim_text, creator_address, counterparty_address) -> CommitmentSpec`

```python
from agents.architect import generate_spec

spec = await generate_spec(
    claim_text="I bet $50 I'll publish my blog post by Friday",
    creator_address="0x1234...abcd",
    counterparty_address="0x5678...ef90",
)

print(spec.verification_type)  # VerificationType.WEB
print(spec.deadline_iso)       # "2026-07-18T23:59:59Z"
print(spec.stake_amount_mon)   # "25.0"

# Deterministic JSON for keccak256 hashing:
hashing_json = spec.to_deterministic_json()
# {"claim_text":"I will publish my blog post by Friday","deadline_iso":"2026-07-18T23:59:59Z","parties":{"counterparty":"0x5678...ef90","creator":"0x1234...abcd"},"spec_version":"1.0.0","stake_amount_mon":"25.0","verification_type":"web"}
``n
### CommitmentSpec Fields

| Field | Type | Description |
|-------|------|-------------|
| `claim_text` | `str` | Concise restatement of the claim |
| `verification_type` | `VerificationType` | Enum: `photo`, `web`, `location`, `peer_sign`, `api` |
| `parties` | `Parties` | `{creator, counterparty}` — checksum addresses |
| `deadline_iso` | `str` | ISO-8601 UTC deadline (`YYYY-MM-DDTHH:MM:SSZ`) |
| `stake_amount_mon` | `str` | Stake in MON as a decimal string |
| `spec_version` | `str` | Schema version (default: `"1.0.0"`) |

## Configuration

All configuration is via environment variables. **Never hardcode secrets.**

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VENICE_API_KEY` | **Yes** | — | Venice AI API key. Read from `os.environ` only. |
| `VENICE_BASE_URL` | No | `https://api.venice.ai/api/v1/chat/completions` | Venice API endpoint |
| `VENICE_MODEL` | No | `llama-3.3-70b` | Venice model ID |
| `VENICE_TIMEOUT` | No | `30` | Request timeout (seconds) |
| `VENICE_MAX_RETRIES` | No | `3` | Max retry attempts on 429/timeout |
| `VENICE_RETRY_BACKOFF` | No | `1.5` | Exponential backoff base |

```bash
# .env
VENICE_API_KEY=your_key_here
```

## Error Handling

| Error | When | Retry? |
|-------|------|--------|
| `MissingApiKeyError` | `VENICE_API_KEY` not set | No |
| `RateLimitError` | Venice returns 429 after all retries exhausted | Built-in retries |
| `VeniceTimeoutError` | Request exceeds timeout after all retries | Built-in retries |
| `MalformedResponseError` | LLM output cannot be parsed as JSON | No |
| `InvalidVerificationTypeError` | LLM returns a verification type outside the allowed set | No |

## Deterministic Serialization

The `CommitmentSpec.to_deterministic_json()` method produces canonical JSON:

- **Sorted keys** at every nesting level
- **Compact separators** — no whitespace after `,` or `:`
- **No trailing newline**

This guarantees the same spec always produces the same keccak256 hash:

```python
from web3 import Web3

hash = Web3.keccak(text=spec.to_deterministic_json()).hex()
```

## Example I/O

### Input
```
claim: I bet Sarah $50 I'll publish my blog post by Friday
creator: 0x1234567890abcdef1234567890abcdef12345678
counterparty: 0xabcdef1234567890abcdef1234567890abcdef12
```

### Output (CommitmentSpec)
```json
{
  "claim_text": "I will publish my blog post by Friday",
  "verification_type": "web",
  "parties": {
    "creator": "0x1234567890abcdef1234567890abcdef12345678",
    "counterparty": "0xabcdef1234567890abcdef1234567890abcdef12"
  },
  "deadline_iso": "2026-07-18T23:59:59Z",
  "stake_amount_mon": "25.0",
  "spec_version": "1.0.0"
}
```

### Deterministic JSON (for hashing)
```
{"claim_text":"I will publish my blog post by Friday","deadline_iso":"2026-07-18T23:59:59Z","parties":{"counterparty":"0xabcdef1234567890abcdef1234567890abcdef12","creator":"0x1234567890abcdef1234567890abcdef12345678"},"spec_version":"1.0.0","stake_amount_mon":"25.0","verification_type":"web"}
```

## Architecture

```
agents/architect/
├── __init__.py       # Public exports
├── architect.py      # generate_spec() + Venice API client with retry
├── prompts.py        # SYSTEM_PROMPT, VERIFICATION_TYPES, build_user_prompt
├── models.py         # CommitmentSpec, Parties, VerificationType
├── requirements.txt  # httpx, pydantic
└── README.md         # This file
```

## License

MIT
