# 🔐 Vouch Security & Audit Documentation

> **Fund safety is a first-class concern.** Vouch locks real ETH stakes on binding commitments —
> the contract was hardened through a rigorous two-phase audit process before any mainnet
> consideration. This document records what was reviewed, what was found, and how it was fixed.

---

## Audit Summary

| Phase | Auditor | Methodology | Findings | Status |
|-------|--------|------------|----------|--------|
| **Phase 1** | [One Dollar Audit](https://onedollaraudit.com) (LeftClaw #417) | 3-phase AI orchestration: context map → ethskills breadth (5 domains) → pashov depth (12 agents, blind) | 7 findings (2 High, 2 Medium, 3 Low) | ✅ All 7 remediated |
| **Phase 2** | [Pashov Second-Pass](https://github.com/pashov/skills) (self-run) | 12-agent parallel swarm (Feynman + Socratic + Inversion) on PATCHED code | 5 findings (2 Medium, 3 Low) + 7 leads | ✅ All 5 remediated + 3 leads addressed |

**Total: 12 findings identified, 15 remediations applied (12 findings + 3 leads), 0 outstanding.**

---

## Phase 1 — One Dollar Audit (Job #417)

**Engagement:** Paid $1 USDC on Base via EIP-3009 (x402 gasless payment).
**Report:** [`docs/audit/audit-417-vouch.md`](docs/audit/audit-417-vouch.md)

### Findings Remediated

| # | Severity | Issue | Remediation |
|---|----------|-------|-------------|
| F1 | 🔴 High | Adjudicator self-dealing — could name itself as counterparty, then challenge+settle to steal any stake | Added guard: `if (counterparty == adjudicator \|\| msg.sender == adjudicator) revert` |
| F2 | 🔴 High | Push-payment locked stake forever if winner couldn't receive ETH | Switched to pull-payment: `withdrawable[]` mapping + `withdraw()` function |
| F3 | 🟠 Med | Immutable adjudicator — lost key freezes all challenged commitments forever | Added `forceSettle()` liveness fallback with 7-day timeout |
| F4 | 🟠 Med | Boundary race: `challenge()` and `settle()` both valid at exact boundary timestamp | Changed `<` to `<=` in settle's Active branch |
| F5 | 🟡 Low | `isInChallengeWindow()` returned true for Challenged commitments | Added `c.status == Status.Active` check |
| F6 | 🟡 Low | Unbounded `deadlineSeconds` could overflow, permanently locking stake | Added 3650-day upper bound |
| F7 | 🟡 Low | `getCommitment()` returned zeroed struct (status=Active) for nonexistent IDs | Added existence guard revert |

---

## Phase 2 — Pashov Second-Pass Audit

**Engagement:** Self-run using [pashov/skills](https://github.com/pashov/skills) solidity-auditor skill — 12 parallel hacking agents applied Feynman, Socratic, and Inversion methodology to the PATCHED code.
**Report:** [`docs/audit/audit-pashov-secondpass.md`](docs/audit/audit-pashov-secondpass.md)

### Findings Remediated

| # | Severity | Issue | Remediation |
|---|----------|-------|-------------|
| P1 | 🟠 Med | `settle(Challenged)` had no timestamp expiry — adjudicator could front-run `forceSettle` forever | Added upper bound: adjudicator authority expires after `ADJUDICATOR_TIMEOUT` |
| P2 | 🟠 Med | `forceSettle` hardcoded creatorWins=true — DOS incentive (suppress adjudicator 7 days → steal stake) | Changed to 50/50 stake split on timeout |
| P3 | 🟡 Low/Med | Free challenge griefing — counterparty could lock creator's stake at ~$2 cost with zero downside | Added mandatory challenge bond (≥10% of stake) |
| P4 | 🟡 Low | Missing `Withdrawn` event — integrators couldn't track actual ETH payouts | Added `Withdrawn(address indexed user, uint256 amount)` event |
| P5 | 🟡 Low | `ForceSettled` fired AFTER `Settled` — integrators misattributed timeouts as rulings | Reordered: ForceSettled now fires BEFORE state transition |

### Leads Addressed

| # | Issue | Remediation |
|---|-------|-------------|
| L1 | `Status.Expired` enum was dead code (5-agent convergence) | Removed from enum |
| L2 | Error selectors reused for different semantics (4-agent convergence) | Added 5 dedicated error types |
| L3 | Evidence hash was mutable — bait-and-switch possible | Made immutable once set |

---

## Test Coverage

| Metric | Value |
|--------|-------|
| Unit tests | **58/58 passing** (0 failures) |
| Invariant fuzz suites | **2/2 passing** (256 runs × 128k calls each) |
| Line coverage | **100%** (93/93) |
| Function coverage | **100%** (11/11) |
| Statement coverage | 95.35% (123/129) |
| Branch coverage | 89.19% (33/37) |
| Static analysis (Slither) | 0 High/Medium (7 Low/Info) |

### Invariant Properties Proven

1. **Stake + Bond Conservation:** `contract.balance == Σ(unsettled stakes + bonds) + Σ(withdrawable credits)` — holds under all call sequences
2. **Settled is Terminal:** A Settled commitment never transitions to another status

### Regression Tests

Every finding from both audits has dedicated regression tests:
- F1–F7: 9 tests covering all audit-417 findings
- P1–P5: 5 tests covering all pashov findings
- Handler-based fuzzing exercises all 6 state-changing entry points

---

## Fund Safety Architecture

### Pull-Payment Pattern (F2)

Stakes are **never pushed** to winners. Settlement credits an internal `withdrawable[]` ledger;
winners must explicitly call `withdraw()` to pull their ETH. This prevents:
- Fund lockup from non-payable winner contracts
- Gas-bomb reentrancy via recipient fallback functions
- Cross-commitment accounting corruption

### Challenge Bond (P3)

Counterparties must post a **≥10% bond** to challenge. This prevents:
- Free griefing (locking creator stakes at ~$2 cost)
- Spam adjudication queue with dust disputes

Bond distribution:
- **Creator wins** → creator receives stake + counterparty's bond
- **Counterparty wins** → counterparty receives stake + their bond back
- **Timeout split** → stake split 50/50, counterparty's bond returned

### Liveness Fallback (F3 + P1 + P2)

If the adjudicator becomes unresponsive:
1. After 7 days, **anyone** can call `forceSettle()`
2. Stake is **split 50/50** (removes DOS incentive)
3. Counterparty's bond is returned
4. Adjudicator's `settle()` authority expires (prevents front-running)

This guarantees no funds are permanently locked, regardless of adjudicator availability.

### Access Control

| Function | Who can call | What they control |
|----------|-------------|------------------|
| `createCommitment` | Anyone (except adjudicator) | Own stake only |
| `submitEvidence` | Creator only | Evidence hash (immutable once set) |
| `challenge` | Counterparty only (with bond) | Transition to Challenged |
| `settle` (Challenged) | Adjudicator only (within timeout) | Ruling: creatorWins |
| `settle` (Active) | Anyone | Auto-settle to creator (hardcoded) |
| `forceSettle` | Anyone (after timeout) | Split resolution |
| `withdraw` | Any credited address | Own balance only |

**No admin, owner, pause, or upgrade mechanism exists.** The contract is immutable and ownerless.

---

## Adjudicator Key Management

The adjudicator is a single `immutable` address set at deployment. Recommendations:

1. **Use a dedicated key** — never reuse the deployer wallet
2. **Store in HSM or multisig** — protects against key loss
3. **Monitor `ForceSettled` events** — indicates adjudicator downtime
4. **Operational redundancy** — maintain backup infrastructure

---

## Known Design Tradeoffs

These are accepted tradeoffs, documented for transparency:

1. **Single adjudicator trust model** — The adjudicator has authority over disputed settlements. This is the protocol's core trust assumption. Mitigation: 7-day timeout fallback with stake split.
2. **No upgrade path** — Contract is immutable. No bug can be patched post-deploy. Mitigation: thorough pre-deploy audits.
3. **Evidence is off-chain** — `evidenceHash` is a commitment, not verification. The contract cannot enforce evidence validity.

---

## Reporting Vulnerabilities

Found a vulnerability? Email **security@vouch.xyz** with:

1. Description of the issue
2. Steps to reproduce
3. Potential impact
4. Suggested fix (optional)

Please do not disclose publicly until a fix is deployed.

---

## Audit Artifacts

All audit reports are preserved in [`docs/audit/`](docs/audit/):

| File | Description |
|------|-------------|
| `audit-417-vouch.md` | One Dollar Audit — full findings, PoCs, and fix diffs |
| `audit-417-vouch.html` | Formatted HTML version |
| `audit-pashov-secondpass.md` | Pashov 12-agent second-pass report |
