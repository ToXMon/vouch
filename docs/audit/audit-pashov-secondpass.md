# Pashov Second-Pass Audit — Vouch.sol (POST audit-417 patches)

**Date:** 2026-07-18
**Methodology:** pashov/skills solidity-auditor (12-agent parallel swarm, Feynman+Socratic+Inversion)
**Scope:** PATCHED Vouch.sol with audit-417 fixes F1–F7
**Goal:** Find regressions or issues introduced/missed by first audit
**Agents run:** 11/12 completed (A10 numerical-gap failed: model loop)

---

## Deduplicated FINDINGS (5)

### P1 [Medium] — `settle(Challenged)` has no timestamp expiry → adjudicator can front-run forceSettle

**Found by:** A9 (boundary), corroborated A3, A4, A11, A12 (5-agent convergence)

`settle()`'s Challenged branch checks only `msg.sender == adjudicator` — no upper time bound.
After `deadline + CHALLENGE_WINDOW + ADJUDICATOR_TIMEOUT`, both `settle(id, false)` (adjudicator,
counterparty wins) and `forceSettle(id)` (anyone, creator wins) are simultaneously valid with
_opposite_ outcomes. Adjudicator (compromised/colluding) can always front-run the creator's
forceSettle, defeating the liveness fallback F3 added.

**PoC:**
- t=0: creator locks 10 ETH, deadline=100
- t=124: counterparty challenges → Challenged
- t=124+7d+1: creator broadcasts forceSettle(id)
- Same block: compromised adjudicator front-runs with settle(id, false)
- Result: counterparty wins 10 ETH, forceSettle reverts AlreadySettled

**Fix:** Add upper bound to settle's Challenged branch:
```solidity
if (c.status == Status.Challenged) {
    if (msg.sender != adjudicator) revert Vouch__NotAdjudicator();
    if (block.timestamp > c.deadline + CHALLENGE_WINDOW + ADJUDICATOR_TIMEOUT)
        revert Vouch__AdjudicatorTimeoutExpired();
    _settle(c, id, creatorWins, true);
}
```

### P2 [Medium] — `forceSettle` hardcodes creatorWins=true → DOS incentive

**Found by:** A11 (trust-gap), corroborated A3, A7, A8 (4-agent convergence)

`forceSettle` always resolves to creator. Anyone who can suppress adjudicator liveness for 7 days
converts any Challenged commitment into a creator win — bypassing F1's identity guard via
liveness manipulation rather than address overlap.

**PoC:**
- Alice (creator EOA 0xA1ICE) ≠ adjudicator EOA (0xAD1), but Alice operates the off-chain
  adjudicator service.
- Alice creates commitment, doesn't fulfill.
- Bob (counterparty) challenges with valid evidence.
- Alice suppresses adjudicator (shuts down service, doesn't sign settle tx).
- After 7 days, anyone (or Alice) calls forceSettle(id) → creator wins full stake.
- Bob's valid challenge discarded.

**Fix options:**
- (a) Split stake 50/50 on timeout
- (b) Burn stake on timeout
- (c) Escrow to governance for manual review

### P3 [Low/Medium] — Free challenge griefing (no counterparty bond)

**Found by:** A3 (economic-security), corroborated A8, A12 (3-agent convergence)

`challenge()` requires zero stake from counterparty. Counterparty can lock creator's stake for
up to 8 days (1d window + 7d timeout) at ~$2 gas cost, with zero downside. If adjudicator
rules counterparty-favorable, they extract the full stake having risked nothing.

**Cost ratio:** attacker ~$2 gas, victim ~$33 opportunity cost on 10 ETH @ 5% APR for 8 days.

**Fix:** Require counterparty to lock a challenge bond, forfeited to creator on losing adjudication.

### P4 [Low] — Missing `Withdrawn` event breaks integrator indexing

**Found by:** A6 (periphery)

`withdraw()` executes silent ETH transfer with no event. Pull-payment pattern credits
`withdrawable[winner]` in `_settle` (also silent — only emits Settled). Indexers tracking
`Settled` see "winner credited" but never "winner paid". Two commitments to same winner
aggregate into one balance and one withdrawal with no on-chain attribution.

**Fix:** Add `event Withdrawn(address indexed user, uint256 amount);` and emit in withdraw().

### P5 [Low] — Event ordering: ForceSettled fires AFTER Settled, misleads integrators

**Found by:** A6 (periphery)

forceSettle calls `_settle` (which emits `Settled(id, creator, stake, disputed=true)`) BEFORE
emitting `ForceSettled(id, caller)`. The Settled payload is identical to an adjudicator ruling.
Integrators indexing Settled as terminal event silently misattribute timeout-forced resolutions
as adjudicated rulings.

**Fix options:**
- (a) Emit ForceSettled BEFORE _settle, skip Settled emission in forceSettle path
- (b) Add `bool forceSettled` field to Settled event

---

## Deduplicated LEADS (7)

| # | Issue | Convergence |
|---|---|---|
| L1 | `Status.Expired` declared but never assigned — dead enum | A1, A4, A6, A9, A12 (5 agents) |
| L2 | Error selector reuse (forceSettle reuses ChallengeWindowOpen/AlreadySettled for different semantics) | A1, A6, A9, A12 (4 agents) |
| L3 | Evidence hash is mutable until deadline — bait-and-switch possible | A7 |
| L4 | Adjudicator multialias collusion (F1 closes address-level only, not control-level) | A2, A11 |
| L5 | Adjudicator has unguarded Active path in settle() — caller check asymmetric vs Challenged branch | A2 |
| L6 | No receive()/fallback() — forced ETH via selfdestruct creates permanent accounting noise | A5 |
| L7 | Stranded credit if winner is contract that can't receive ETH — standard pull-payment tradeoff | A1, A5 |

---

## What audit-417 missed (gap analysis)

| Item | One Dollar Audit | Pashov second-pass |
|---|---|---|
| P1 — settle(Challenged) no expiry | Not flagged | **FOUND** (5-agent convergence) |
| P2 — forceSettle DOS incentive | F3 noted as design tradeoff, not exploitation path | **FOUND** (4-agent convergence) |
| P3 — free challenge griefing | Not flagged | **FOUND** (3-agent convergence) |
| P4 — missing Withdrawn event | Not flagged (out of scope — integrator surface) | **FOUND** |
| P5 — event ordering | Not flagged | **FOUND** |
| F1–F7 patches themselves | All 7 issues found | All 7 patches confirmed code-correct, no regressions |

**Confidence:** High. 5-agent convergence on P1 (the most impactful new finding) with concrete
PoC and minimal fix. The DOS-incentive framing (P2) is a genuine escalation of F3 from
"liveness risk" to "exploitable via off-chain suppression".

---

## Recommendation

**P1 is a true Medium and should be fixed before mainnet.** It's a one-line addition (upper
bound on settle's Challenged branch) and closes the post-timeout race that 5 agents independently
surfaced.

**P2 is a design decision** — forceSettle resolving to creator is intentional (liveness fallback),
but the DOS-incentive framing means it should be documented as an explicit tradeoff OR mitigated
via stake splitting.

**P3–P5 are quality-of-life fixes** that improve integrator UX and reduce griefing surface. Cheap
to add.
