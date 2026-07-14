# Vouch

> AI-verified personal claims and bets on Monad. Micro-stakes via sub-cent gas. Shareable onchain receipts. Cross-model AI dispute resolution.

## One-Liner

"I bet @sarah $500 I'll ship my startup by Q4. Here's the onchain receipt. The world can watch me win or fail publicly."

## Quick Start

cp .env.example .env  # Fill in your keys
make install
make test
make dev

## Architecture

User -> AI Architect (Venice) -> Vouch.sol (Monad) -> AI Auditor (Venice + three.ws) -> Settlement

## Stack

| Component | Technology |
|-----------|-----------|
| Smart Contract | Solidity / Foundry on Monad Testnet |
| AI Agents | Venice API (Architect, Auditor, Adjudicator) |
| Verification | three.ws Fact Check API (web claims) |
| Agent Runtime | Python / FastAPI on Akash |
| Frontend | React / Para Wallet |

## Demo

AI-vs-AI mode: Two Venice-powered agents make a verifiable promise to each other on Monad, autonomously.

## License

MIT
