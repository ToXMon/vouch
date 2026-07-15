# Vouch — Product Brief

## What
Vouch is Polymarket for personal claims. Users make AI-verified bets on Monad blockchain: "I'll ship my startup by Q4," "I'll run a sub-20 5K," "I'll merge PR #42 by Friday." Stake MON, lock it onchain, AI verifies the outcome, winner takes the stake.

## Who
Crypto-native builders, founders, fitness enthusiasts, and degens who want public accountability with skin in the game. They already use Polymarket, Farcaster, and Monad testnet. They want social proof with financial commitment.

## Why Now
- Monad testnet live with sub-cent gas (perfect for micro-stakes)
- Venice AI provides uncensored, fast LLM inference for verification
- three.ws Fact Check API returns SHA-256 attestations — cryptographic evidence
- AI-vs-AI mode is novel: two agents making verifiable promises to each other

## Tone
Confident, technical, slightly edgy. Not corporate. Not SaaS-default. This is a tool for people who keep their word — or lose money trying. Web3-native but not memecoin-bro. Think Linear meets Polymarket.

## Platform
Web (React + Vite). Desktop-first — power users on laptops managing commitments. Mobile must work for read-only feed viewing. Para embedded wallet (not MetaMask).

## Register
Product (design serves the product). Not brand-led. Functional density matters — users want to see active commitments, stakes, deadlines, and verification status at a glance. Information hierarchy is critical.

## Brand Seed
oklch(0.750 0.080 170.0) — teal. "Sea-glass on a foggy Pacific shoreline — weathered, mineral, quietly oxidized." Pair with deeper kelp-toned primary and rusted coral accent.

## Key Surfaces
1. **Public Feed** — scrollable list of commitments (active/challenged/settled). Shows claim, parties, stake, deadline countdown, verification status.
2. **Create Commitment** — form: claim text, counterparty, verification type (photo/web/location/peer-sign/API), stake amount, deadline.
3. **Commitment Detail** — full spec, evidence, challenge/settle buttons, AI verdict display.
4. **Wallet Connect** — Para embedded wallet, shows address + MON balance.

## Anti-References (Do NOT Look Like)
- Polymarket's green-on-black terminal aesthetic (too obvious for prediction markets)
- SaaS dashboard with cream/beige backgrounds (the AI default)
- Purple gradient hero (universal AI tell)
- Icon-tile feature cards

## What Must Work
- Creating a commitment end-to-end: AI generates spec → user signs tx → stake locks
- Viewing public feed of onchain commitments
- Submitting evidence + seeing AI verdict
- Challenging + adjudication display
- All on Monad testnet with real MON stakes
