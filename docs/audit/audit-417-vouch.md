# 🔐 Security Review — Vouch.sol (job 417)

---

## Audit Target

|                        |                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| **Contract**           | `Vouch` (single file, no imports/inheritance)                                             |
| **Chain**              | Monad                                                                                      |
| **Solidity**           | 0.8.20                                                                                     |
| **Source provenance**  | Full source supplied inline in the leftclaw job description (no deployed address given). SHA-256 of the exact audited source: `507475e14f2ff11af26ac95eded486074ceb8b17543085213904ce8c1fc2ac5a` |
| **Lines**               | 279                                                                                        |
| **Mode**                | Default — single in-scope file, no exclusions needed                                      |
| **Methodology**         | Three-phase: context map → ethskills breadth (5 domains) → pashov depth (12 agents, blind) → reconciliation |
| **Confidence threshold**| 50 (findings below 50 listed as Leads, not findings)                                      |

---

## Reconciliation Summary

Overlap (both phases independently found the same root cause): **6** · Phase-1-only: **3** · Phase-2-only: **3** · Leads promoted to Finding via multi-agent convergence: **2** (adjudicator self-dealing — independently reached FINDING-grade proof by 2+ of 12 blind Phase-2 agents despite others demoting to Lead; push-payment lock — independently reached FINDING-grade proof by 3+ agents) · Coverage holes closed this pass: **0** (both phases already covered every entrypoint; one confirmatory re-read of `submitEvidence`/constructor turned up nothing new).

Entrypoints: 6 external/public functions in source (4 state-changing, 2 view) + 3 public state-variable getters — 6/6 covered in the inventory below, all appear in the threat catalog, and every one maps to a finding or an explicit "examined, no issue."

---

## Findings

[85] **1. `createCommitment` never checks `counterparty`/`creator` against `adjudicator`, enabling adjudicator self-dealing**

`Vouch.createCommitment` / `Vouch.challenge` / `Vouch.settle` · Confidence: 85 · Severity: **High** · Origin: `[both]` — phase1: general (G-2, G-3); phase2: agents 2 (access-control), 11 (trust-gap), corroborated as leads by agents 1, 5, 7, 8, 9

**Description**
`createCommitment` (source.sol:156) only rejects `counterparty == msg.sender`; nothing rejects `counterparty == adjudicator` or `msg.sender == adjudicator`. Since `adjudicator` is a `public immutable` address (source.sol:52), trivially readable by anyone, a creator can (knowingly or through social engineering) name the adjudicator itself as `counterparty`. The adjudicator can then call `challenge(id)` (source.sol:199-212), which passes because `c.counterparty == msg.sender` (source.sol:203), and subsequently call `settle(id, false)` (source.sol:221-234), which passes because `msg.sender == adjudicator` (source.sol:227) — sending the entire stake to itself via `_settle` (source.sol:264-279) regardless of the claim's actual merits. The symmetric case — the adjudicator itself calling `createCommitment` as `creator` — lets it always rule `creatorWins=true` on its own commitments, making them risk-free while still emitting the on-chain "attestation" events the protocol markets as trustworthy. Note also that `evidenceHash` (source.sol:189) is written but never read by any settlement logic (confirmed in `_settle`, source.sol:264-279), so there is no on-chain circuit-breaker even with airtight proof of the creator's honesty.

**Proof of Concept**
1. Read `adjudicator()` — public, free, e.g. returns `0xAAA`.
2. Victim calls `createCommitment{value: 10 ether}(specHash, VerificationType.Photo, 0xAAA, 86400)` — passes every guard since `0xAAA != msg.sender`.
3. After `deadline`, `0xAAA` calls `challenge(id)` — passes (`c.counterparty == msg.sender == 0xAAA`), status → `Challenged`.
4. `0xAAA` calls `settle(id, false)` — passes (`msg.sender == adjudicator == 0xAAA`). `_settle` computes `winner = c.counterparty = 0xAAA` and transfers the full 10 ETH to itself, irrespective of whether the victim actually fulfilled the commitment.

**Fix**

```diff
     function createCommitment(
         bytes32 specHash,
         VerificationType vType,
         address counterparty,
         uint256 deadlineSeconds
     ) external payable nonReentrant returns (uint256 id) {
         if (msg.value == 0) revert Vouch__ZeroStake();
         if (deadlineSeconds == 0) revert Vouch__InvalidDeadline();
         if (counterparty == msg.sender) revert Vouch__SelfCounterparty();
+        if (counterparty == adjudicator || msg.sender == adjudicator) revert Vouch__InvalidCommitment();
         if (specHash == bytes32(0)) revert Vouch__InvalidCommitment();
```

---

[80] **2. Unconditional push-payment in `_settle` permanently locks a commitment's stake if the ruled winner cannot receive ETH**

`Vouch._settle` · Confidence: 80 · Severity: **High** · Origin: `[both]` — phase1: dos (DOS-1, DOS-2, DOS-4); general (G-4); phase2: agents 3 (economic-security), 6 (periphery), 9 (boundary), corroborated as leads by 10, 12

**Description**
`_settle` (source.sol:264-279) sets `c.status = Status.Settled` (source.sol:270) and then unconditionally pushes the stake to `winner` via `winner.call{value: amount}("")` (source.sol:277), reverting the entire transaction — including the status write, due to CEI ordering — if the call fails (source.sol:278). Neither `createCommitment` nor `challenge` validates that `counterparty` (or `creator`) can actually receive ETH. A creator can name any address — including a simple contract with no `receive()`/payable `fallback()`, or even `address(this)` — as `counterparty` at zero cost to that party (the counterparty never posts stake). Once such a counterparty legitimately challenges and the adjudicator correctly rules in its favor, every subsequent `settle()` call for that commitment reverts identically, forever. There is no pull-payment fallback, no rescue/sweep function, and no timeout — the only "recovery" is the adjudicator issuing a ruling contrary to the actual facts, which defeats the adjudication guarantee entirely. A related, gas-griefing variant of the same seam: because the call is a high-level `.call`, Solidity copies the full returndata into memory before discarding it — a `winner` contract that returns a very large payload from its fallback can push the memory-expansion cost above the block gas limit, making settlement unconditionally and permanently un-callable for that commitment even without an explicit revert.

**Proof of Concept**
1. Creator stakes 10 ETH naming `Bad` (a contract with no `receive`/`fallback`) as `counterparty`.
2. `Bad.challenge(id)` succeeds after the deadline (any contract can originate a plain call — no ETH-receiving capability needed to call `challenge`).
3. Adjudicator, ruling correctly that `Bad` should win, calls `settle(id, false)`.
4. `_settle` sets `status = Settled`, then `Bad.call{value: 10 ether}("")` fails → `revert Vouch__TransferFailed()` (source.sol:278) unwinds the whole transaction, rolling `status` back to `Challenged`. Every subsequent `settle(id, false)` call fails identically — the 10 ETH is permanently stuck.

**Fix (Option A — pull-payment)**

```diff
+    mapping(address => uint256) public withdrawable;
+
     function _settle(
         Commitment storage c,
         uint256 id,
         bool creatorWins,
         bool disputed
     ) internal {
         c.status = Status.Settled;

         address winner = creatorWins ? c.creator : c.counterparty;
         uint256 amount = c.stake;

         emit Settled(id, winner, amount, disputed);

-        (bool success, ) = winner.call{value: amount}("");
-        if (!success) revert Vouch__TransferFailed();
+        withdrawable[winner] += amount;
     }
+
+    function withdraw() external nonReentrant {
+        uint256 amount = withdrawable[msg.sender];
+        withdrawable[msg.sender] = 0;
+        (bool success, ) = msg.sender.call{value: amount}("");
+        if (!success) revert Vouch__TransferFailed();
+    }
```

**Fix (Option B — bound the returndata-bomb variant only, if push-payment is kept)**

```diff
-        (bool success, ) = winner.call{value: amount}("");
-        if (!success) revert Vouch__TransferFailed();
+        bool success;
+        assembly {
+            success := call(gas(), winner, amount, 0, 0, 0, 0)
+        }
+        if (!success) revert Vouch__TransferFailed();
```

---

[70] **3. No timeout or fallback if the adjudicator is unresponsive — Challenged commitments can stall forever**

`Vouch.settle` (Challenged branch) · Confidence: 70 · Severity: **Medium** · Origin: `[both]` — phase1: access-control (AC-2), dos (DOS-3); phase2: leads from agents 2, 4, 6, 12

**Description**
Once a commitment reaches `Challenged` (via `challenge()`, source.sol:209), the only path to resolution is `adjudicator` calling `settle()` (the `msg.sender != adjudicator` guard at source.sol:227). `adjudicator` is `immutable` (source.sol:52), set once in the constructor (source.sol:131) with no rotation, timelock, or multisig mechanism. There is no timestamp gate on the Challenged branch and no fallback if the adjudicator's key is lost, the operator stops responding, or the service is discontinued. Unlike Finding 2 (scoped to one pathological recipient), this affects **every** commitment that reaches `Challenged` after the adjudicator becomes unavailable — a broader blast radius. This is a documented, apparently intentional centralization tradeoff (NatSpec describes the adjudicator as an "AI agent wallet"), which is why it is rated Medium rather than High absent a concrete bypass — but it is a genuine liveness gap worth the client's attention given it can freeze funds for both parties indefinitely.

**Proof of Concept**
Any commitment reaches `Challenged` via a legitimate `challenge()` call. If the `adjudicator` address's private key is subsequently lost, or the operator ceases running the service, `settle()`'s Challenged branch can never succeed for that commitment (or any future challenged commitment) — funds are frozen forever with no owner/pause/upgrade path to intervene.

**Recommendation**
Add a bounded timeout after which an unresolved `Challenged` commitment falls back to a defined default outcome (e.g., resolves to creator after N days of adjudicator silence), or document the centralization risk explicitly for integrators and end users. No code diff provided — this is a design-level tradeoff decision for the team, not a mechanical fix.

---

[65] **4. `challenge()` and `settle()`'s auto-settle branch share one overlapping boundary timestamp, enabling a front-runnable race**

`Vouch.challenge` / `Vouch.settle` · Confidence: 65 · Severity: **Medium** · Origin: `[both]` — phase1: access-control (AC-1), general (G-1), chain-specific (CS-4); phase2: agents 4, 5, 7, 8, 10, 12 (6/12 rated FINDING; agents 1, 3, 9 rated as Lead/MEV-adjacent)

**Description**
`challenge()` reverts only if `block.timestamp > c.deadline + CHALLENGE_WINDOW` (source.sol:207), i.e. it is valid on the closed interval `[deadline, deadline+CHALLENGE_WINDOW]`. `settle()`'s Active/auto-settle branch reverts only if `block.timestamp < c.deadline + CHALLENGE_WINDOW` (source.sol:231), i.e. it is valid on `[deadline+CHALLENGE_WINDOW, ∞)`. At the single instant `block.timestamp == deadline+CHALLENGE_WINDOW`, both are simultaneously legal against the same still-`Active` commitment. Since the auto-settle branch is fully permissionless (no caller restriction, source.sol:229-233) and always pays the creator (`creatorWins` hardcoded `true` at source.sol:232, ignoring the caller-supplied argument), a creator (or any bystander with an incentive) can front-run a counterparty's last-second `challenge()` with a higher-gas `settle(id, true)` in the same block. If the auto-settle transaction lands first, `status` becomes `Settled` and the counterparty's simultaneously-valid `challenge()` then reverts with `Vouch__AlreadyChallenged` (source.sol:204) — a dispute submitted within the documented window is permanently foreclosed. `isInChallengeWindow()` (source.sol:253) also reports `true` at this same instant, telling honest integrators the window is still open even as it can be raced away. This reduces to ordinary same-block transaction-ordering/MEV rather than a distinct logic flaw exploitable at will, and is scoped to the single boundary second — hence Medium rather than High.

**Proof of Concept**
Let `deadline=1000000`, `CHALLENGE_WINDOW=86400`, boundary=`1086400`. At `block.timestamp==1086400`: counterparty broadcasts `challenge(id)` (valid, `1086400 <= 1086400`); creator broadcasts `settle(id, true)` with higher gas in the same block (valid, `1086400 >= 1086400`). If the creator's transaction is ordered first, `c.status` becomes `Settled`, the stake pays to the creator, and the counterparty's `challenge(id)` then reverts against `status != Active`.

**Fix**

```diff
         } else {
             // Active: auto-settle only after challenge window closes
-            if (block.timestamp < c.deadline + CHALLENGE_WINDOW) revert Vouch__ChallengeWindowOpen();
+            if (block.timestamp <= c.deadline + CHALLENGE_WINDOW) revert Vouch__ChallengeWindowOpen();
             _settle(c, id, true, false);
         }
```

---

[55] **5. `isInChallengeWindow()` does not check commitment status — misleading for integrators**

`Vouch.isInChallengeWindow` · Confidence: 55 · Severity: Low · Origin: `[phase2 only]` — agent 6 (periphery)

**Description**
`isInChallengeWindow` (source.sol:250-254) checks only `c.creator == address(0)` for existence (source.sol:252) and then a pure timestamp range (source.sol:253) — it never reads `c.status`. A commitment already `Challenged` (or, in principle, already `Settled` within the same time band, since the Challenged branch of `settle()` has no timestamp restriction) still returns `true`, identical to a still-`Active`, not-yet-challenged commitment. An off-chain frontend/bot relying on this view to decide "is a dispute still actionable" gets a false positive.

**Proof of Concept**
Counterparty calls `challenge(id)` at `t = deadline+100` — `status` becomes `Challenged` (source.sol:209). At `t = deadline+5000` (still `<= deadline+86400`), `isInChallengeWindow(id)` still returns `true` — indistinguishable from an unchallenged Active commitment — even though a second `challenge(id)` call at this timestamp reverts with `Vouch__AlreadyChallenged` (source.sol:204).

**Fix**

```diff
     function isInChallengeWindow(uint256 id) external view returns (bool) {
         Commitment storage c = commitments[id];
         if (c.creator == address(0)) return false;
-        return block.timestamp >= c.deadline && block.timestamp <= c.deadline + CHALLENGE_WINDOW;
+        return c.status == Status.Active && block.timestamp >= c.deadline && block.timestamp <= c.deadline + CHALLENGE_WINDOW;
     }
```

---

[55] **6. Unbounded `deadlineSeconds` can overflow downstream additions, permanently self-locking a commitment's stake**

`Vouch.createCommitment` · Confidence: 55 · Severity: Low · Origin: `[both]` — phase1: precision-math (PM-1); phase2: agents 9 (boundary), 10 (numerical-gap), corroborated as leads by 1, 5

**Description**
`deadlineSeconds` is only checked for `!= 0` (source.sol:155); there is no upper bound. A creator who supplies `deadlineSeconds ≈ type(uint256).max - block.timestamp` causes `deadline` (source.sol:160) to land at exactly `type(uint256).max` without reverting at creation (the sum fits exactly). Every later evaluation of `c.deadline + CHALLENGE_WINDOW` — inside `challenge()` (source.sol:207), `settle()`'s Active branch (source.sol:231), and `isInChallengeWindow()` (source.sol:253) — then overflows Solidity 0.8.20's checked `uint256` arithmetic and panics. `challenge()` never even reaches that expression, since its earlier `block.timestamp < c.deadline` check (source.sol:206) reverts first and permanently (real time will never approach `2^256-1`). Net effect: the commitment is stuck `Active` forever with no cancel/refund path. This only risks the creator's own staked ETH (the counterparty never posts collateral) and requires the creator to deliberately or accidentally choose an astronomical duration — self-inflicted, hence Low severity, but a real, fully-provable, irreversible fund lock rather than a cosmetic issue.

**Proof of Concept**
With `block.timestamp = T`, call `createCommitment(specHash, vType, counterparty, type(uint256).max - T)`. `deadline = T + (type(uint256).max - T) = type(uint256).max` — no revert. Any later `settle(id, _)` call while status is Active evaluates `c.deadline + CHALLENGE_WINDOW = type(uint256).max + 86400`, panicking (`Panic(0x11)`) every time.

**Fix**

```diff
         if (msg.value == 0) revert Vouch__ZeroStake();
         if (deadlineSeconds == 0) revert Vouch__InvalidDeadline();
+        if (deadlineSeconds > 3650 days) revert Vouch__InvalidDeadline();
         if (counterparty == msg.sender) revert Vouch__SelfCounterparty();
```

---

[50] **7. `getCommitment()` returns a zeroed struct for nonexistent IDs, indistinguishable from a real Active commitment**

`Vouch.getCommitment` · Confidence: 50 · Severity: Low/Info · Origin: `[phase2 only]` — agent 6 (periphery)

**Description**
`getCommitment` (source.sol:243-245) has no existence guard (contrast with `isInChallengeWindow`, which explicitly checks `c.creator == address(0)` at source.sol:252). For any never-created `id` (id 0 is guaranteed unused since `nextId` starts at 1, and any `id >= nextId` was never written), the function returns a fully zeroed `Commitment` struct whose `status` field equals `Status.Active` (the enum's zero value, source.sol:26) — indistinguishable from a legitimately-created, zero-stake commitment. An integrator that doesn't independently check `creator != address(0)` before trusting the returned `status` could mistake a nonexistent commitment for a real, live one.

**Recommendation**
Revert when `commitments[id].creator == address(0)`, or add an explicit existence signal (a separate `commitmentExists(id)` view, or an `exists` boolean in the return value).

---

## Leads

_Trails with concrete code smells where the full exploit path did not clear all four judging gates in this pass. Not scored._

- **Solidity 0.8.20 defaults to PUSH0 (Shanghai target)** — contract-wide — Code smell: `pragma solidity 0.8.20;` (source.sol:2) emits `PUSH0` by default. Deployment-environment risk, not a runtime bug — confirm Monad's execution client supports `PUSH0`, or pin `evmVersion` to a supported target if not. [phase1: general G-7, chain-specific CS-5]
- **`creatorWins` parameter silently ignored on the auto-settle path** — `settle()` — Code smell: the caller-supplied `creatorWins` bool is discarded and hardcoded to `true` at source.sol:232 whenever `status != Challenged`. Documented in the inline comment, not exploitable, but an API-clarity footgun for integrators who might assume the argument always controls the outcome. [phase1: access-control AC-4, general G-5]
- **No rescue path for ETH force-fed via `selfdestruct`/coinbase reward** — contract-wide — Code smell: no `receive()`/`fallback()`/sweep function; settlement logic pays out only `c.stake` per commitment, not `address(this).balance`, so forced ETH doesn't break per-commitment accounting but is permanently unclaimable. No action required given the ownerless, immutable design. [phase1: general G-6]
- **`Status.Expired` enum member declared but never assigned or read anywhere** — contract-wide — Code smell: dead state; every commitment's terminal status is always `Settled`, never `Expired`. Not independently exploitable, but worth confirming with the team whether an expiry/timeout feature was intended and dropped (see Finding 3). [phase0 open question; phase2 leads from agents 7, 8, 9, 12]
- **Evidence hash never enforced on-chain** — `submitEvidence` / `settle` — Code smell: `evidenceHash` (source.sol:189) is write-only and never read by `_settle` or any settlement check; the "AI-verified" claim is purely off-chain and unenforceable by the contract itself. By design per the NatSpec, but amplifies Finding 1's severity (no on-chain circuit-breaker even with airtight evidence). [phase2: agent 11, trust-gap]
- **Shared hot-storage slots (`nextId`, `_reentrancyStatus`) serialize all state-changing calls under Monad's parallel-execution model** — contract-wide — Throughput/liveness characteristic, not a correctness bug; every state-changing call touches `_reentrancyStatus`, so unrelated commitments' transactions cannot execute in parallel. [phase1: chain-specific CS-6]

---

## Access-Control Inventory

| Function | Guard (line) | Caller | Writes | Value? |
|---|---|---|---|---|
| `constructor(address)` (L129) | `_adjudicator==0` → revert (L130) | deployer, once | `adjudicator` (immutable), `_reentrancyStatus`, `nextId` | no |
| `createCommitment(...)` (L148) | `nonReentrant`(153); `msg.value==0`(154); `deadlineSeconds==0`(155); `counterparty==msg.sender`(156); `specHash==0`(157) | **anyone** | `nextId`(159), new `commitments[id]`(162-171) | **in**, locks `msg.value` |
| `submitEvidence(id,hash)` (L181) | `nonReentrant`(181); existence(183); `creator!=msg.sender`(184); `status!=Active`(185); `t>=deadline`(186); `hash==0`(187) | **creator only** | `commitments[id].evidenceHash`(189) | no |
| `challenge(id)` (L199) | `nonReentrant`(199); existence(201); `counterparty==0`(202); `counterparty!=msg.sender`(203); `status!=Active`(204); `t<deadline`(206); `t>deadline+WINDOW`(207) | **counterparty only** (blocked if counterparty==0) | `status=Challenged`(209) | no |
| `settle(id,bool)` (L221) | `nonReentrant`(221); existence(223); `status==Settled`→revert(224); **Challenged**: `msg.sender!=adjudicator`(227); **Active**: `t<deadline+WINDOW`(231) | **Challenged: adjudicator only. Active: anyone** | via `_settle`: `status=Settled`(270) | **out**, full stake via `.call` |
| `getCommitment(id)` (L243) | none, view | anyone | — | no |
| `isInChallengeWindow(id)` (L250) | none, view | anyone | — | no |
| `_settle(...)` (L264, internal) | none of its own — inherits caller's `nonReentrant` | only reachable from `settle`(228, 232) | `status`(270) | `winner.call{value:amount}`(277), revert on failure(278) |

**Roles.** Only `adjudicator` (L52, `address public immutable`). Set once in constructor (L131) with a zero-address check (L130). No setter exists anywhere — cannot be transferred, rotated, or renounced. Unlocks only the Challenged branch of `settle` (L227), where it supplies the `creatorWins` ruling. No owner, admin, pause, or upgrade mechanism exists in the contract (see Finding 3 for the liveness consequence, and Finding 1 for the missing role-separation guard).

**Unguarded (state-changing, arbitrary caller):** `createCommitment` (own funds only); `settle`'s Active/auto-settle branch (anyone may trigger, but cannot redirect funds since `creatorWins` is hardcoded `true` there — see Finding 4 for the timing race this still enables).

---

## Threat Model

| Actor | Reaches | Could gain | Invariant / disposition |
|---|---|---|---|
| Adjudicator (self-dealing) | `createCommitment` naming itself as party, then `challenge`+`settle` | 100% of a commitment's stake, unconditionally | **Addressed by Finding 1** — no guard prevents role collision |
| Hostile/non-payable counterparty | `_settle`'s `winner.call` | Permanently freezes the creator's stake at zero cost to itself | **Addressed by Finding 2** — no pull-payment fallback |
| Adjudicator (unavailable) | `settle`'s Challenged branch | N/A (liveness failure, not profit) | **Addressed by Finding 3** — no timeout/fallback resolution |
| Creator (or any bystander) racing a counterparty | `challenge` vs. `settle` at `t==deadline+WINDOW` | Forces auto-settle before a legitimate dispute lands | **Addressed by Finding 4** — boundary overlap |
| Arbitrary caller | `settle`'s Active branch | Nothing directly — `creatorWins` forced `true` regardless of caller | **Invariant holds** — caller identity cannot redirect funds on this path (only timing matters — see Finding 4) |
| Creator | `createCommitment`, choosing `counterparty=address(0)` | Removes challengeability entirely (self-commitment) | **Invariant holds by design** — confirmed via `challenge()`'s L202 guard, matches NatSpec (L143) |
| Any address | `winner.call` reentrancy attempt during `_settle` | Double-settlement / cross-function reentrancy | **Invariant holds** — global `nonReentrant` (L115-120) covers all 4 state-changing entrypoints; independently confirmed by all 17 hunting agents across both phases |

---

> ⚠️ This review was performed by an AI-orchestrated three-phase audit (context mapping → ethskills breadth → pashov-methodology depth, 20 sub-agents total) as part of an automated leftclaw.services engagement. AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. A human review, bug bounty program, and on-chain monitoring are strongly recommended before mainnet deployment, particularly given the unresolved centralization/liveness dependency on the `adjudicator` role (Finding 3) and the missing role-separation guard (Finding 1).
